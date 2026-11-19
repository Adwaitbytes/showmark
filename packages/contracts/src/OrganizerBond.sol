// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2StepNoRenounce} from "./utils/Ownable2StepNoRenounce.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IOrganizerBond} from "./interfaces/IOrganizerBond.sol";
import {ICampaignVault} from "./interfaces/ICampaignVault.sol";

/// @title OrganizerBond
/// @notice Organizers stake native QIE so sponsors can open campaigns to any bonded organizer. A sponsor may
/// challenge an organizer over one of its campaigns; the arbitrator (the owner, the protocol Safe) resolves it and
/// may slash. Arbitration is centralized in v1.
/// @dev Each open challenge locks at most what its campaign paid for the organizer's events, and only that much is
/// held back from unbonding and can be slashed. A challenger posts `challengeDeposit`, returned if the arbitrator
/// slashes and forfeited to the organizer if the challenge is dismissed, so spam is paid for (re-review N-02).
contract OrganizerBond is IOrganizerBond, Ownable2StepNoRenounce, ReentrancyGuard {
    /// @notice Delay between requestUnbond and completeUnbond.
    uint256 public constant UNBOND_DELAY = 7 days;
    /// @notice Largest challenge reason accepted, in bytes.
    uint256 public constant MAX_REASON_BYTES = 2048;

    struct Pending {
        uint256 amount;
        uint64 availableAt;
    }

    /// @notice The CampaignVault used to check that a challenger sponsors the campaign. Set once.
    address public vault;

    /// @notice Deposit a challenger must post with each challenge, in native QIE.
    uint256 public immutable challengeDeposit;

    /// @notice Number of unresolved challenges per organizer.
    mapping(address organizer => uint256) public openChallenges;
    /// @notice Stake held back by an organizer's open challenges; always at most bonded plus pending.
    mapping(address organizer => uint256) public lockedOf;
    /// @notice Challenge deposits awarded to an account and not yet claimed.
    mapping(address account => uint256) public depositOwed;

    uint256 private _nextChallengeId = 1;
    mapping(address organizer => uint256) private _bonded;
    mapping(address organizer => Pending) private _pending;
    mapping(uint256 challengeId => Challenge) private _challenges;
    mapping(uint256 campaignId => mapping(address organizer => bool)) private _openFor;

    /// @param owner_ The arbitrator; move to the protocol Safe after deploy.
    /// @param challengeDeposit_ Deposit per challenge, in wei (1 QIE on mainnet; a small value on testnet).
    constructor(address owner_, uint256 challengeDeposit_) Ownable(owner_) {
        if (challengeDeposit_ == 0) revert ZeroAmount();
        challengeDeposit = challengeDeposit_;
    }

    /// @notice Sets the vault once. Owner only. Needed because the vault itself is constructed with this bond.
    /// @param vault_ The CampaignVault.
    function setVault(address vault_) external onlyOwner {
        if (vault_ == address(0)) revert ZeroAddress();
        if (vault != address(0)) revert VaultNotSettable();
        vault = vault_;
        emit VaultSet(vault_);
    }

    /// @notice The account that resolves challenges (the owner).
    /// @return The arbitrator.
    function arbitrator() external view returns (address) {
        return owner();
    }

    /// @inheritdoc IOrganizerBond
    function bond() external payable {
        if (msg.value == 0) revert ZeroAmount();
        uint256 total = _bonded[msg.sender] + msg.value;
        _bonded[msg.sender] = total;
        emit Bonded(msg.sender, msg.value, total);
    }

    /// @inheritdoc IOrganizerBond
    function requestUnbond(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 bonded = _bonded[msg.sender];
        if (amount > bonded) revert InsufficientBond();
        _bonded[msg.sender] = bonded - amount;

        Pending storage p = _pending[msg.sender];
        p.amount += amount;
        uint64 availableAt = uint64(block.timestamp + UNBOND_DELAY);
        p.availableAt = availableAt;
        emit UnbondRequested(msg.sender, amount, availableAt);
    }

    /// @inheritdoc IOrganizerBond
    function completeUnbond() external nonReentrant {
        Pending storage p = _pending[msg.sender];
        uint256 pending = p.amount;
        if (pending == 0) revert NothingPending();
        if (block.timestamp < p.availableAt) revert UnbondNotReady();
        // Locks are covered by the bonded stake first; only the rest must stay in the pending unbond.
        uint256 locked = lockedOf[msg.sender];
        uint256 bonded = _bonded[msg.sender];
        uint256 held = locked > bonded ? locked - bonded : 0;
        if (pending <= held) revert ChallengeOpen();

        uint256 payout = pending - held;
        p.amount = held;
        emit Unbonded(msg.sender, payout);
        Address.sendValue(payable(msg.sender), payout);
    }

    /// @inheritdoc IOrganizerBond
    function challenge(address organizer, uint256 campaignId, string calldata reason)
        external
        payable
        returns (uint256 challengeId)
    {
        if (msg.value != challengeDeposit) revert BadChallengeDeposit();
        address v = vault;
        if (v == address(0)) revert VaultNotSettable();
        if (organizer == address(0)) revert ZeroAddress();
        if (bytes(reason).length > MAX_REASON_BYTES) revert ReasonTooLong();
        ICampaignVault.Campaign memory cam = ICampaignVault(v).campaign(campaignId);
        if (cam.sponsor != msg.sender) revert NotCampaignSponsor();
        // Only a campaign that actually paid this organizer has a grievance, and one open challenge per pair is
        // enough (audit L-03).
        uint256 paid = ICampaignVault(v).paidForOrganizer(campaignId, organizer);
        if (paid == 0) revert OrganizerNotPaid();
        if (_openFor[campaignId][organizer]) revert DuplicateChallenge();
        _openFor[campaignId][organizer] = true;

        // Lock no more than the grievance (re-review N-02). A token campaign's payout is not comparable with a QIE
        // stake, so it locks whatever is unlocked; the deposit is what makes spamming that costly.
        uint256 alreadyLocked = lockedOf[organizer];
        uint256 stake = _bonded[organizer] + _pending[organizer].amount;
        uint256 free = stake - alreadyLocked;
        uint256 lock = cam.token == address(0) && paid < free ? paid : free;
        lockedOf[organizer] = alreadyLocked + lock;

        challengeId = _nextChallengeId++;
        _challenges[challengeId] = Challenge({
            sponsor: msg.sender,
            organizer: organizer,
            campaignId: campaignId,
            resolved: false,
            locked: lock,
            deposit: msg.value
        });
        openChallenges[organizer] += 1;
        emit Challenged(challengeId, organizer, campaignId, msg.sender, reason);
        emit StakeLocked(challengeId, organizer, lock, msg.value);
    }

    /// @inheritdoc IOrganizerBond
    function resolve(uint256 challengeId, uint256 slashAmount, address recipient) external onlyOwner nonReentrant {
        Challenge storage c = _challenges[challengeId];
        address organizer = c.organizer;
        if (organizer == address(0) || c.resolved) revert ChallengeNotOpen();

        if (slashAmount > c.locked) revert SlashExceedsLock();
        if (slashAmount != 0 && recipient == address(0)) revert ZeroAddress();
        uint256 bonded = _bonded[organizer];
        uint256 pending = _pending[organizer].amount;

        c.resolved = true;
        _openFor[c.campaignId][organizer] = false;
        openChallenges[organizer] -= 1;
        lockedOf[organizer] -= c.locked;
        // The deposit goes back to a vindicated challenger, or to the organizer when the challenge is dismissed.
        // Pull payment, so neither side can block resolution.
        address awarded = slashAmount != 0 ? c.sponsor : organizer;
        depositOwed[awarded] += c.deposit;
        if (slashAmount <= bonded) {
            _bonded[organizer] = bonded - slashAmount;
        } else {
            _bonded[organizer] = 0;
            _pending[organizer].amount = pending - (slashAmount - bonded);
        }
        emit Resolved(challengeId, organizer, slashAmount, recipient);
        emit DepositAwarded(challengeId, awarded, c.deposit);
        if (slashAmount != 0) Address.sendValue(payable(recipient), slashAmount);
    }

    /// @notice Pays the caller every challenge deposit awarded to it.
    function claimDeposit() external nonReentrant {
        uint256 amount = depositOwed[msg.sender];
        if (amount == 0) revert NothingToClaim();
        depositOwed[msg.sender] = 0;
        emit DepositClaimed(msg.sender, amount);
        Address.sendValue(payable(msg.sender), amount);
    }

    /// @inheritdoc IOrganizerBond
    function bondOf(address organizer) external view returns (uint256) {
        return _bonded[organizer];
    }

    /// @notice The organizer's pending unbond.
    /// @param organizer The organizer.
    /// @return amount Amount waiting for the delay (still slashable).
    /// @return availableAt When completeUnbond becomes possible.
    function pendingUnbond(address organizer) external view returns (uint256 amount, uint64 availableAt) {
        Pending storage p = _pending[organizer];
        return (p.amount, p.availableAt);
    }

    /// @notice Returns a challenge. All fields are zero for an unknown id.
    /// @param challengeId The challenge.
    /// @return The challenge.
    function challengeOf(uint256 challengeId) external view returns (Challenge memory) {
        return _challenges[challengeId];
    }

    /// @inheritdoc IOrganizerBond
    function hasOpenChallenge(uint256 campaignId, address organizer) external view returns (bool) {
        return _openFor[campaignId][organizer];
    }

    /// @notice The id the next challenge will get. Ids start at 1.
    /// @return The next challenge id.
    function nextChallengeId() external view returns (uint256) {
        return _nextChallengeId;
    }
}

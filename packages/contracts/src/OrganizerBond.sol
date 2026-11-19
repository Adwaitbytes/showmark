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
/// @dev A challenge files a claim equal to the exposure the bond backed for that open campaign. While claims are
/// open, min(stake, sum of open claims) is held back from unbonding, and each resolution slashes at most
/// min(its claim, current stake), so dismissing one challenge never frees stake another open claim needs, whatever
/// the order (re-review N2-01). Only open-to-bonded campaigns the bond actually backed can claim (N2-02). A
/// challenger posts `challengeDeposit`, returned on a slash and forfeited to the organizer on a dismissal.
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
    /// @notice Sum of the claims of an organizer's open challenges. May exceed the stake.
    mapping(address organizer => uint256) public claimedOf;
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
        uint256 bonded = _bonded[msg.sender];
        uint256 locked = _locked(msg.sender, bonded + pending);
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
        // The bond only ever backed open-to-bonded campaigns the organizer opted into; their exposure is the claim.
        uint256 claim = cam.openToBonded ? ICampaignVault(v).exposureOf(campaignId, organizer) : 0;
        if (claim == 0) revert NoBondClaim();
        if (_openFor[campaignId][organizer]) revert DuplicateChallenge();
        _openFor[campaignId][organizer] = true;
        claimedOf[organizer] += claim;

        challengeId = _nextChallengeId++;
        _challenges[challengeId] = Challenge({
            sponsor: msg.sender,
            organizer: organizer,
            campaignId: campaignId,
            resolved: false,
            claim: claim,
            deposit: msg.value
        });
        openChallenges[organizer] += 1;
        emit Challenged(challengeId, organizer, campaignId, msg.sender, reason);
        emit ClaimFiled(challengeId, organizer, claim, msg.value);
    }

    /// @inheritdoc IOrganizerBond
    function resolve(uint256 challengeId, uint256 slashAmount, address recipient) external onlyOwner nonReentrant {
        Challenge storage c = _challenges[challengeId];
        address organizer = c.organizer;
        if (organizer == address(0) || c.resolved) revert ChallengeNotOpen();

        uint256 bonded = _bonded[organizer];
        uint256 pending = _pending[organizer].amount;
        uint256 claim = c.claim;
        uint256 stake = bonded + pending;
        if (slashAmount > (claim < stake ? claim : stake)) revert SlashExceedsClaim();
        if (slashAmount != 0 && recipient == address(0)) revert ZeroAddress();

        c.resolved = true;
        _openFor[c.campaignId][organizer] = false;
        openChallenges[organizer] -= 1;
        claimedOf[organizer] -= claim;
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

    /// @notice Stake held back from unbonding: min(bonded + pending, sum of open claims).
    /// @param organizer The organizer.
    /// @return The locked amount.
    function lockedOf(address organizer) external view returns (uint256) {
        return _locked(organizer, _bonded[organizer] + _pending[organizer].amount);
    }

    function _locked(address organizer, uint256 stake) private view returns (uint256) {
        uint256 claimed = claimedOf[organizer];
        return claimed < stake ? claimed : stake;
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

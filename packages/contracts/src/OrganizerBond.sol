// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IOrganizerBond} from "./interfaces/IOrganizerBond.sol";
import {ICampaignVault} from "./interfaces/ICampaignVault.sol";

/// @title OrganizerBond
/// @notice Organizers stake native QIE so sponsors can open campaigns to any bonded organizer. A sponsor may
/// challenge an organizer over one of its campaigns; the arbitrator (the owner, the protocol Safe) resolves it and
/// may slash. Arbitration is centralized in v1.
/// @dev An organizer with an open challenge cannot complete an unbond, so the slashable pending amount cannot
/// leave while the arbitrator decides.
contract OrganizerBond is IOrganizerBond, Ownable2Step, ReentrancyGuard {
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

    /// @notice Number of unresolved challenges per organizer.
    mapping(address organizer => uint256) public openChallenges;

    uint256 private _nextChallengeId = 1;
    mapping(address organizer => uint256) private _bonded;
    mapping(address organizer => Pending) private _pending;
    mapping(uint256 challengeId => Challenge) private _challenges;

    /// @param owner_ The arbitrator; move to the protocol Safe after deploy.
    constructor(address owner_) Ownable(owner_) {}

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
        Pending memory p = _pending[msg.sender];
        if (p.amount == 0) revert NothingPending();
        if (block.timestamp < p.availableAt) revert UnbondNotReady();
        if (openChallenges[msg.sender] != 0) revert ChallengeOpen();

        delete _pending[msg.sender];
        emit Unbonded(msg.sender, p.amount);
        Address.sendValue(payable(msg.sender), p.amount);
    }

    /// @inheritdoc IOrganizerBond
    function challenge(address organizer, uint256 campaignId, string calldata reason)
        external
        returns (uint256 challengeId)
    {
        address v = vault;
        if (v == address(0)) revert VaultNotSettable();
        if (organizer == address(0)) revert ZeroAddress();
        if (bytes(reason).length > MAX_REASON_BYTES) revert ReasonTooLong();
        if (ICampaignVault(v).campaign(campaignId).sponsor != msg.sender) revert NotCampaignSponsor();

        challengeId = _nextChallengeId++;
        _challenges[challengeId] =
            Challenge({sponsor: msg.sender, organizer: organizer, campaignId: campaignId, resolved: false});
        openChallenges[organizer] += 1;
        emit Challenged(challengeId, organizer, campaignId, msg.sender, reason);
    }

    /// @inheritdoc IOrganizerBond
    function resolve(uint256 challengeId, uint256 slashAmount, address recipient) external onlyOwner nonReentrant {
        Challenge storage c = _challenges[challengeId];
        address organizer = c.organizer;
        if (organizer == address(0) || c.resolved) revert ChallengeNotOpen();

        uint256 bonded = _bonded[organizer];
        uint256 pending = _pending[organizer].amount;
        if (slashAmount > bonded + pending) revert SlashExceedsBond();
        if (slashAmount != 0 && recipient == address(0)) revert ZeroAddress();

        c.resolved = true;
        openChallenges[organizer] -= 1;
        if (slashAmount <= bonded) {
            _bonded[organizer] = bonded - slashAmount;
        } else {
            _bonded[organizer] = 0;
            _pending[organizer].amount = pending - (slashAmount - bonded);
        }
        emit Resolved(challengeId, organizer, slashAmount, recipient);
        if (slashAmount != 0) Address.sendValue(payable(recipient), slashAmount);
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

    /// @notice The id the next challenge will get. Ids start at 1.
    /// @return The next challenge id.
    function nextChallengeId() external view returns (uint256) {
        return _nextChallengeId;
    }
}

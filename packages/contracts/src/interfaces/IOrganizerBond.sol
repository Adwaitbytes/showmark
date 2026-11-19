// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IOrganizerBond
/// @notice Organizer stake in native QIE, sponsor challenges and arbitration by the protocol Safe.
/// @dev Spec: docs/INTERFACES.md section 2.6. Arbitration is centralized in v1.
interface IOrganizerBond {
    /// @notice A sponsor's challenge against an organizer.
    struct Challenge {
        address sponsor;
        address organizer;
        uint256 campaignId;
        bool resolved;
    }

    /// @notice Emitted when an organizer adds to its bond.
    /// @param organizer The organizer.
    /// @param amount Amount added.
    /// @param bonded Bond after the addition.
    event Bonded(address indexed organizer, uint256 amount, uint256 bonded);

    /// @notice Emitted when an organizer starts unbonding.
    /// @param organizer The organizer.
    /// @param amount Amount moved to the pending unbond.
    /// @param availableAt When the whole pending amount can be withdrawn.
    event UnbondRequested(address indexed organizer, uint256 amount, uint64 availableAt);

    /// @notice Emitted when an organizer withdraws its pending unbond.
    /// @param organizer The organizer.
    /// @param amount Amount paid out.
    event Unbonded(address indexed organizer, uint256 amount);

    /// @notice Emitted when a sponsor challenges an organizer.
    /// @param challengeId The new challenge id (ids start at 1).
    /// @param organizer The challenged organizer.
    /// @param campaignId The sponsor's campaign the challenge concerns.
    /// @param sponsor The challenger.
    /// @param reason Free-form reason, at most 2,048 bytes.
    event Challenged(
        uint256 indexed challengeId, address indexed organizer, uint256 indexed campaignId, address sponsor, string reason
    );

    /// @notice Emitted when the arbitrator resolves a challenge.
    /// @param challengeId The challenge.
    /// @param organizer The challenged organizer.
    /// @param slashed Amount taken from the organizer's bond.
    /// @param recipient Receiver of the slashed amount.
    event Resolved(uint256 indexed challengeId, address indexed organizer, uint256 slashed, address recipient);

    /// @notice Emitted once, when the vault used to authenticate sponsors is set.
    /// @param vault The CampaignVault.
    event VaultSet(address vault);

    /// @notice Amount must be positive.
    error ZeroAmount();
    /// @notice Amount exceeds the bonded balance.
    error InsufficientBond();
    /// @notice No pending unbond.
    error NothingPending();
    /// @notice The unbond delay has not passed.
    error UnbondNotReady();
    /// @notice The organizer has unresolved challenges.
    error ChallengeOpen();
    /// @notice Caller is not the sponsor of the campaign.
    error NotCampaignSponsor();
    /// @notice The vault is not set yet, or is being set twice.
    error VaultNotSettable();
    /// @notice An address argument is zero.
    error ZeroAddress();
    /// @notice The reason is longer than 2,048 bytes.
    error ReasonTooLong();
    /// @notice Unknown or already resolved challenge.
    error ChallengeNotOpen();
    /// @notice Slash amount exceeds bonded plus pending unbond.
    error SlashExceedsBond();

    /// @notice Adds msg.value to the caller's bond.
    function bond() external payable;

    /// @notice Moves `amount` from the bond to a pending unbond and restarts the UNBOND_DELAY timer.
    /// @param amount Amount to unbond.
    function requestUnbond(uint256 amount) external;

    /// @notice Pays the pending unbond to the caller after the delay, when no challenge is open.
    function completeUnbond() external;

    /// @notice Opens a challenge against an organizer. Sponsor of `campaignId` only.
    /// @param organizer The organizer challenged.
    /// @param campaignId The caller's campaign the challenge concerns.
    /// @param reason Free-form reason, at most 2,048 bytes.
    /// @return challengeId The new challenge id.
    function challenge(address organizer, uint256 campaignId, string calldata reason)
        external
        returns (uint256 challengeId);

    /// @notice Closes a challenge and slashes the organizer. Arbitrator (owner) only.
    /// @param challengeId The challenge.
    /// @param slashAmount Amount to slash from bonded, then pending unbond; 0 dismisses the challenge.
    /// @param recipient Receiver of the slashed amount.
    function resolve(uint256 challengeId, uint256 slashAmount, address recipient) external;

    /// @notice Bond counted for eligibility. Pending unbonds are excluded.
    /// @param organizer The organizer.
    /// @return The bonded amount.
    function bondOf(address organizer) external view returns (uint256);
}

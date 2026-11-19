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
        uint256 claim; // exposure the bond backed for the campaign when filed; resolve slashes at most min(claim, stake)
        uint256 deposit; // challenger's deposit, returned on a slash, forfeited to the organizer on dismissal
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
        uint256 indexed challengeId,
        address indexed organizer,
        uint256 indexed campaignId,
        address sponsor,
        string reason
    );

    /// @notice Emitted when the arbitrator resolves a challenge.
    /// @param challengeId The challenge.
    /// @param organizer The challenged organizer.
    /// @param slashed Amount taken from the organizer's bond.
    /// @param recipient Receiver of the slashed amount.
    event Resolved(uint256 indexed challengeId, address indexed organizer, uint256 slashed, address recipient);

    /// @notice Emitted with every challenge: the claim it files on the organizer's stake and the deposit it posted.
    /// @param challengeId The challenge.
    /// @param organizer The challenged organizer.
    /// @param claim The campaign's bonded exposure for the organizer when the challenge was filed.
    /// @param deposit Deposit paid by the challenger.
    event ClaimFiled(uint256 indexed challengeId, address indexed organizer, uint256 claim, uint256 deposit);

    /// @notice Emitted when an open claim is raised to the campaign's current bonded exposure.
    /// @param challengeId The challenge.
    /// @param organizer The challenged organizer.
    /// @param claim The claim after the raise.
    event ClaimRefreshed(uint256 indexed challengeId, address indexed organizer, uint256 claim);

    /// @notice Emitted at resolution: who the challenge deposit is owed to.
    /// @param challengeId The challenge.
    /// @param to The challenger after a slash, the organizer after a dismissal.
    /// @param amount The deposit.
    event DepositAwarded(uint256 indexed challengeId, address indexed to, uint256 amount);

    /// @notice Emitted when an account collects deposits owed to it.
    /// @param account The account paid.
    /// @param amount Amount paid.
    event DepositClaimed(address indexed account, uint256 amount);

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
    /// @notice Slash amount exceeds min(the challenge's claim, the organizer's current stake).
    error SlashExceedsClaim();
    /// @notice msg.value is not exactly the challenge deposit.
    error BadChallengeDeposit();
    /// @notice No deposit is owed to the caller.
    error NothingToClaim();
    /// @notice The campaign is not open to bonded organizers, or the bond backed nothing for this organizer in it.
    error NoBondClaim();
    /// @notice This campaign already has an open challenge against this organizer.
    error DuplicateChallenge();

    /// @notice Adds msg.value to the caller's bond.
    function bond() external payable;

    /// @notice Moves `amount` from the bond to a pending unbond and restarts the UNBOND_DELAY timer.
    /// @param amount Amount to unbond.
    function requestUnbond(uint256 amount) external;

    /// @notice Pays the pending unbond to the caller after the delay, except what open claims need:
    /// min(stake, sum of open claims), covered by the bonded stake first.
    function completeUnbond() external;

    /// @notice Opens a challenge against an organizer. Sponsor of `campaignId` only, with exactly `challengeDeposit`
    /// in msg.value. The campaign must be open to bonded organizers and the bond must have backed payouts for the
    /// organizer in it (`vault.exposureOf > 0`); that exposure becomes the challenge's claim. At most one challenge per
    /// (campaign, organizer) may be open.
    /// @param organizer The organizer challenged.
    /// @param campaignId The caller's campaign the challenge concerns.
    /// @param reason Free-form reason, at most 2,048 bytes.
    /// @return challengeId The new challenge id.
    function challenge(address organizer, uint256 campaignId, string calldata reason)
        external
        payable
        returns (uint256 challengeId);

    /// @notice Raises an open challenge's claim to the campaign's current `vault.exposureOf`; never lowers it. Anyone
    /// may call. Exposure can only grow while the challenge is open (release is blocked), so the claim keeps up with
    /// payouts made after the challenge was filed (re-review N3-01).
    /// @param challengeId An open challenge.
    function refreshClaim(uint256 challengeId) external;

    /// @notice Closes a challenge and slashes the organizer. Arbitrator (owner) only. Refreshes the claim first, so
    /// the slash limit uses the live exposure.
    /// @param challengeId The challenge.
    /// @param slashAmount Amount to slash from bonded, then pending unbond, at most min(claim, current stake); 0
    /// dismisses the challenge and forfeits the deposit to the organizer. Other open claims keep their hold.
    /// @param recipient Receiver of the slashed amount.
    function resolve(uint256 challengeId, uint256 slashAmount, address recipient) external;

    /// @notice Bond counted for eligibility. Pending unbonds are excluded.
    /// @param organizer The organizer.
    /// @return The bonded amount.
    function bondOf(address organizer) external view returns (uint256);

    /// @notice Whether `campaignId` has an unresolved challenge against `organizer`.
    /// @param campaignId The campaign.
    /// @param organizer The organizer.
    /// @return The flag.
    function hasOpenChallenge(uint256 campaignId, address organizer) external view returns (bool);
}

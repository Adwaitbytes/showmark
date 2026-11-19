import { parseAbi } from "viem";

// Hand-written from docs/INTERFACES.md. Replaced by ABIs generated from the Foundry artifacts once the contracts compile.

export const registryAbi = parseAbi([
  "struct EventInfo { address organizer; uint64 startsAt; uint64 endsAt; uint32 capacity; uint32 checkedIn; uint32 maxPassAge; uint64 seriesId; uint32 seriesIndex; }",
  "struct Presence { uint8 mode; uint64 at; }",
  "struct CheckInData { uint256 eventId; address attendee; uint8 mode; uint64 doorTime; bytes attendeeSig; bytes doorSig; }",
  "function createSeries(string metadata) returns (uint64 seriesId)",
  "function createEvent(uint64 startsAt, uint64 endsAt, uint32 capacity, uint32 maxPassAge, uint64 seriesId, string metadata) returns (uint256 eventId)",
  "function updateEventMetadata(uint256 eventId, string metadata)",
  "function setCapacity(uint256 eventId, uint32 capacity)",
  "function authorizeDoorKey(uint256 eventId, address key, uint64 validUntil)",
  "function revokeDoorKey(uint256 eventId, address key)",
  "function checkIn(CheckInData d) returns (bool recorded)",
  "function checkInBatch(CheckInData[] ds) returns (uint8[] status)",
  "function linkWallet(address pass, address wallet, uint64 deadline, bytes passSig, bytes walletSig, uint256[] relocateEventIds)",
  "function eventInfo(uint256 eventId) view returns (EventInfo)",
  "function presenceOf(uint256 eventId, address attendee) view returns (Presence)",
  "function hasAttended(uint256 eventId, address account) view returns (bool)",
  "function streakOf(uint64 seriesId, address pass) view returns (uint32 current, uint32 best)",
  "function doorKeyValidUntil(uint256 eventId, address key) view returns (uint64)",
  "function walletOf(address pass) view returns (address)",
  "function passOf(address wallet) view returns (address)",
  "function nextEventId() view returns (uint256)",
  "function stamp() view returns (address)",
  "function paused() view returns (bool)",
  "event SeriesCreated(uint64 indexed seriesId, address indexed organizer, string metadata)",
  "event EventCreated(uint256 indexed eventId, address indexed organizer, uint64 startsAt, uint64 endsAt, uint32 capacity, uint32 maxPassAge, uint64 indexed seriesId, uint32 seriesIndex, string metadata)",
  "event EventMetadataUpdated(uint256 indexed eventId, string metadata)",
  "event CapacityChanged(uint256 indexed eventId, uint32 capacity)",
  "event DoorKeyAuthorized(uint256 indexed eventId, address indexed key, uint64 validUntil)",
  "event DoorKeyRevoked(uint256 indexed eventId, address indexed key)",
  "event CheckedIn(uint256 indexed eventId, address indexed attendee, uint8 mode, address doorKey, uint64 doorTime, uint32 streak)",
  "event CheckInRejected(uint256 indexed eventId, address indexed attendee, uint8 status)",
  "event WalletLinked(address indexed pass, address indexed wallet)",
]);

export const vaultAbi = parseAbi([
  "struct CampaignParams { address token; uint8 pricing; uint128 amountPerPresence; uint16 attendeeShareBps; uint8 minProofMode; bool requireQieId; uint64 startsAt; uint64 endsAt; uint32 maxPerEvent; uint32 maxTotal; bool openToBonded; uint128 minBond; string metadata; }",
  "struct SettleItem { uint256 campaignId; uint256 eventId; address attendee; }",
  "function createCampaign(CampaignParams p, uint256 deposit) payable returns (uint256 campaignId)",
  "function topUp(uint256 campaignId, uint256 amount) payable",
  "function approveEvents(uint256 campaignId, uint256[] eventIds)",
  "function revokeEvents(uint256 campaignId, uint256[] eventIds)",
  "function closeCampaign(uint256 campaignId)",
  "function settle(uint256 campaignId, uint256 eventId, address attendee) returns (uint256 paid)",
  "function settleBatch(SettleItem[] items) returns (uint8[] status)",
  "function refund(uint256 campaignId)",
  "function withdraw(address token, address account)",
  "function claimable(address token, address account) view returns (uint256)",
  "function isApproved(uint256 campaignId, uint256 eventId) view returns (bool)",
  "function isSettled(uint256 campaignId, uint256 eventId, address attendee) view returns (bool)",
  "function quote(uint256 campaignId) view returns (uint256 amountInToken, bool priceFresh)",
  "function totalLiabilities(address token) view returns (uint256)",
  "function paused() view returns (bool)",
  "event CampaignCreated(uint256 indexed campaignId, address indexed sponsor, address indexed token, uint8 pricing, uint128 amountPerPresence, uint16 attendeeShareBps, uint8 minProofMode, bool requireQieId, uint64 startsAt, uint64 endsAt, uint16 feeBps, string metadata)",
  "event CampaignFunded(uint256 indexed campaignId, address indexed from, uint256 amount)",
  "event EventsApproved(uint256 indexed campaignId, uint256[] eventIds)",
  "event EventsRevoked(uint256 indexed campaignId, uint256[] eventIds)",
  "event CampaignClosed(uint256 indexed campaignId, uint64 endsAt)",
  "event Settled(uint256 indexed campaignId, uint256 indexed eventId, address indexed attendee, address organizer, uint256 gross, uint256 toAttendee, uint256 toOrganizer, uint256 fee, uint256 price)",
  "event SettlementSkipped(uint256 indexed campaignId, uint256 indexed eventId, address indexed attendee, uint8 status)",
  "event Refunded(uint256 indexed campaignId, address indexed sponsor, uint256 amount)",
  "event Withdrawn(address indexed token, address indexed account, address indexed to, uint256 amount)",
  "event FeeChanged(uint16 bps, address recipient)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const zoneAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function domainExistsByName(string name, string tld) view returns (bool)",
]);

export const aggregatorAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

export const CHECK_IN_STATUS = [
  "Recorded",
  "AlreadyPresent",
  "UnknownEvent",
  "BadAttendeeSig",
  "BadDoorSig",
  "DoorKeyNotAuthorized",
  "Stale",
  "OutsideEventWindow",
  "AtCapacity",
  "BadMode",
  "Paused",
] as const;

export const SETTLE_STATUS = [
  "Settled",
  "AlreadySettled",
  "UnknownCampaign",
  "NotPresent",
  "OutsideCampaignWindow",
  "EventNotEligible",
  "EventCapReached",
  "TotalCapReached",
  "NeedsQieId",
  "PriceStale",
  "InsufficientBudget",
  "SettlementClosed",
  "Paused",
] as const;

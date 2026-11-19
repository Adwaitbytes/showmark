import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress, parseAbi, parseAbiItem } from "viem";
import { checkedInFilter, presenceCalldata, presenceMode } from "./chain-watch";

// The hand-encoded RPC calls must match what viem's encoder produces for the registry ABI.

const ATTENDEE = getAddress("0x7ae3b1c9d4f20a8e6b5c3d1f9a2e4b6c8d0f1a3b");
const abi = parseAbi(["struct Presence { uint8 mode; uint64 at; }", "function presenceOf(uint256 eventId, address attendee) view returns (Presence)"]);

describe("chain-watch encoding", () => {
  it("encodes presenceOf like viem", () => {
    expect(presenceCalldata(BigInt(42), ATTENDEE)).toBe(encodeFunctionData({ abi, functionName: "presenceOf", args: [BigInt(42), ATTENDEE] }));
  });

  it("reads the mode from the result", () => {
    expect(presenceMode(encodeAbiParameters([{ type: "uint8" }, { type: "uint64" }], [1, BigInt(1_764_245_000)]))).toBe(1);
    expect(presenceMode(encodeAbiParameters([{ type: "uint8" }, { type: "uint64" }], [0, BigInt(0)]))).toBe(0);
    expect(presenceMode("0x")).toBeNull();
  });

  it("filters CheckedIn logs by event and attendee like viem", () => {
    const topics = encodeEventTopics({
      abi: [parseAbiItem("event CheckedIn(uint256 indexed eventId, address indexed attendee, uint8 mode, address doorKey, uint64 doorTime, uint32 streak)")],
      eventName: "CheckedIn",
      args: { eventId: BigInt(42), attendee: ATTENDEE },
    });
    expect(checkedInFilter(BigInt(42), ATTENDEE, BigInt(10), BigInt(20)).topics).toEqual(topics);
  });
});

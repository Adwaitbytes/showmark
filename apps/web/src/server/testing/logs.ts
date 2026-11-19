import {
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  keccak256,
  toHex,
  type Abi,
  type AbiEvent,
  type Address,
  type GetEventArgs,
  type ContractEventName,
  type Hex,
  type Log,
} from "viem";

export interface LogPosition {
  address: Address;
  block: bigint;
  logIndex: number;
  /** Defaults to a hash derived from block and log index. */
  tx?: Hex;
}

/**
 * Builds a raw RPC log exactly as eth_getLogs returns it: indexed arguments ABI-encoded into topics,
 * the rest ABI-encoded into data. Lets decoder tests run on real encodings instead of hand-made objects.
 */
export function encodeLog<const abi extends Abi, name extends ContractEventName<abi>>(
  abi: abi,
  eventName: name,
  args: GetEventArgs<abi, name, { EnableUnion: false; IndexedOnly: false; Required: true }>,
  at: LogPosition,
): Log {
  const item = getAbiItem({ abi: abi as Abi, name: eventName as string }) as AbiEvent;
  const values = args as Record<string, unknown>;
  const topics = encodeEventTopics({ abi: [item], eventName: item.name, args: values } as Parameters<typeof encodeEventTopics>[0]);
  const dataInputs = item.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(
    dataInputs,
    dataInputs.map((i) => values[i.name ?? ""]),
  );
  const tx = at.tx ?? keccak256(toHex(`${at.block}:${at.logIndex}`));
  return {
    address: at.address,
    topics: topics as [Hex, ...Hex[]],
    data,
    blockNumber: at.block,
    blockHash: keccak256(toHex(`block:${at.block}`)),
    transactionHash: tx,
    transactionIndex: 0,
    logIndex: at.logIndex,
    removed: false,
  };
}

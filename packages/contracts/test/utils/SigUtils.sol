// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Vm} from "forge-std/Vm.sol";

/// @notice Builds EIP-712 digests straight from docs/INTERFACES.md 2.2, independent of the registry code,
/// and signs them with forge cheatcodes.
library SigUtils {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant CHECK_IN_TYPEHASH = keccak256("CheckIn(uint256 eventId,address attendee)");
    bytes32 internal constant DOOR_PASS_TYPEHASH = keccak256("DoorPass(uint256 eventId,uint64 issuedAt)");
    bytes32 internal constant DOOR_ATTEST_TYPEHASH =
        keccak256("DoorAttest(uint256 eventId,address attendee,uint64 attestedAt)");
    bytes32 internal constant LINK_WALLET_TYPEHASH =
        keccak256("LinkWallet(address pass,address wallet,uint64 deadline)");

    function domainSeparator(uint256 chainId, address registry) internal pure returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("Showmark"), keccak256("1"), chainId, registry));
    }

    function digest(bytes32 separator, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", separator, structHash));
    }

    function sign(uint256 pk, bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function checkInDigest(bytes32 separator, uint256 eventId, address attendee) internal pure returns (bytes32) {
        return digest(separator, keccak256(abi.encode(CHECK_IN_TYPEHASH, eventId, attendee)));
    }

    function doorPassDigest(bytes32 separator, uint256 eventId, uint64 issuedAt) internal pure returns (bytes32) {
        return digest(separator, keccak256(abi.encode(DOOR_PASS_TYPEHASH, eventId, issuedAt)));
    }

    function doorAttestDigest(bytes32 separator, uint256 eventId, address attendee, uint64 attestedAt)
        internal
        pure
        returns (bytes32)
    {
        return digest(separator, keccak256(abi.encode(DOOR_ATTEST_TYPEHASH, eventId, attendee, attestedAt)));
    }

    function linkDigest(bytes32 separator, address pass, address wallet, uint64 deadline)
        internal
        pure
        returns (bytes32)
    {
        return digest(separator, keccak256(abi.encode(LINK_WALLET_TYPEHASH, pass, wallet, deadline)));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Computes Showmark EIP-712 digests the way the registry must: domain name "Showmark", version "1",
///         block.chainid, this contract as verifyingContract, and the type strings from INTERFACES 2.2.
/// @dev Written without OpenZeppelin on purpose. OZ 5.6.1 EIP712 imports Strings -> Bytes, which uses mcopy and
///      does not compile for evm_version shanghai, the QIE target.
contract DigestHarness {
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant CHECK_IN_TYPEHASH = keccak256("CheckIn(uint256 eventId,address attendee)");
    bytes32 public constant DOOR_PASS_TYPEHASH = keccak256("DoorPass(uint256 eventId,uint64 issuedAt)");
    bytes32 public constant DOOR_ATTEST_TYPEHASH = keccak256("DoorAttest(uint256 eventId,address attendee,uint64 attestedAt)");
    bytes32 public constant LINK_WALLET_TYPEHASH = keccak256("LinkWallet(address pass,address wallet,uint64 deadline)");

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("Showmark"), keccak256("1"), block.chainid, address(this)));
    }

    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function hashCheckIn(uint256 eventId, address attendee) external view returns (bytes32) {
        return _digest(keccak256(abi.encode(CHECK_IN_TYPEHASH, eventId, attendee)));
    }

    function hashDoorPass(uint256 eventId, uint64 issuedAt) external view returns (bytes32) {
        return _digest(keccak256(abi.encode(DOOR_PASS_TYPEHASH, eventId, issuedAt)));
    }

    function hashDoorAttest(uint256 eventId, address attendee, uint64 attestedAt) external view returns (bytes32) {
        return _digest(keccak256(abi.encode(DOOR_ATTEST_TYPEHASH, eventId, attendee, attestedAt)));
    }

    function hashLinkWallet(address pass, address wallet, uint64 deadline) external view returns (bytes32) {
        return _digest(keccak256(abi.encode(LINK_WALLET_TYPEHASH, pass, wallet, deadline)));
    }

    /// @dev Expects a 65-byte r || s || v signature, the format the SDK and the QR codes carry.
    function recover(bytes32 digest, bytes calldata signature) external pure returns (address) {
        require(signature.length == 65, "length");
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        return ecrecover(digest, v, r, s);
    }
}

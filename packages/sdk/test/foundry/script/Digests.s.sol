// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {DigestHarness} from "../src/DigestHarness.sol";

/// @notice Writes ../fixtures/eip712-digests.json: digests and signatures for fixed inputs on both QIE chain ids.
///         Keys are derived from fixed labels, so the fixture holds no secrets and anyone can regenerate it.
contract Digests is Script {
    uint256 internal constant ATTENDEE_PK = uint256(keccak256("showmark sdk fixture attendee"));
    uint256 internal constant DOOR_PK = uint256(keccak256("showmark sdk fixture door"));
    uint256 internal constant WALLET_PK = uint256(keccak256("showmark sdk fixture wallet"));
    uint256 internal constant TICKET_PK = uint256(keccak256("showmark sdk fixture ticket"));

    DigestHarness internal harness;
    string internal out;

    function run() external {
        harness = new DigestHarness();
        out = string.concat('{"verifyingContract":"', vm.toString(address(harness)), '","chains":[');
        _chain(1983);
        out = string.concat(out, ",");
        _chain(1990);
        out = string.concat(out, "]}");
        vm.writeFile("../fixtures/eip712-digests.json", out);
    }

    function _chain(uint256 chainId) internal {
        vm.chainId(chainId);
        address attendee = vm.addr(ATTENDEE_PK);
        address door = vm.addr(DOOR_PK);
        address wallet = vm.addr(WALLET_PK);
        address ticket = vm.addr(TICKET_PK);
        uint256 maxId = type(uint256).max;
        uint64 maxTime = type(uint64).max;

        out = string.concat(
            out,
            '{"chainId":',
            vm.toString(chainId),
            ',"domainSeparator":"',
            vm.toString(harness.domainSeparator()),
            '","attendee":"',
            vm.toString(attendee),
            '","door":"',
            vm.toString(door),
            '","wallet":"',
            vm.toString(wallet),
            '","ticketAddress":"',
            vm.toString(ticket),
            '","checkIn":['
        );
        out = string.concat(
            out, _checkIn(42, attendee, 1, ATTENDEE_PK), ",", _checkIn(42, attendee, 2, ATTENDEE_PK), ",", _checkIn(maxId, address(0), 255, 0), "]"
        );

        out = string.concat(out, ',"doorPass":[');
        out = string.concat(
            out,
            _doorPass(42, 1795073006, ticket, DOOR_PK),
            ",",
            _doorPass(0, 0, address(0), 0),
            ",",
            _doorPass(maxId, maxTime, address(type(uint160).max), 0),
            "]"
        );

        out = string.concat(out, ',"ticket":[');
        out = string.concat(out, _ticket(42, attendee, TICKET_PK), ",", _ticket(maxId, address(0), 0), "]");

        out = string.concat(out, ',"doorAttest":[');
        out = string.concat(out, _doorAttest(42, attendee, 1795073006, DOOR_PK), ",", _doorAttest(maxId, address(type(uint160).max), maxTime, 0), "]");

        out = string.concat(out, ',"linkWallet":[');
        out = string.concat(out, _linkWallet(attendee, wallet, 1795080000, ATTENDEE_PK), ",", _linkWallet(attendee, wallet, 1795080000, WALLET_PK), "]}");
    }

    function _sig(bytes32 digest, uint256 pk) internal view returns (string memory) {
        if (pk == 0) return "null";
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        require(harness.recover(digest, sig) == vm.addr(pk), "recover mismatch");
        return string.concat('"', vm.toString(sig), '"');
    }

    function _checkIn(uint256 eventId, address attendee, uint8 mode, uint256 pk) internal view returns (string memory) {
        bytes32 digest = harness.hashCheckIn(eventId, attendee, mode);
        return string.concat(
            '{"eventId":"', vm.toString(eventId), '","attendee":"', vm.toString(attendee),
            '","mode":', vm.toString(uint256(mode)),
            ',"digest":"', vm.toString(digest), '","signature":', _sig(digest, pk), "}"
        );
    }

    function _doorPass(uint256 eventId, uint64 issuedAt, address ticket, uint256 pk) internal view returns (string memory) {
        bytes32 digest = harness.hashDoorPass(eventId, issuedAt, ticket);
        return string.concat(
            '{"eventId":"', vm.toString(eventId), '","issuedAt":"', vm.toString(uint256(issuedAt)),
            '","ticket":"', vm.toString(ticket),
            '","digest":"', vm.toString(digest), '","signature":', _sig(digest, pk), "}"
        );
    }

    function _ticket(uint256 eventId, address attendee, uint256 pk) internal view returns (string memory) {
        bytes32 digest = harness.hashTicket(eventId, attendee);
        return string.concat(
            '{"eventId":"', vm.toString(eventId), '","attendee":"', vm.toString(attendee),
            '","digest":"', vm.toString(digest), '","signature":', _sig(digest, pk), "}"
        );
    }

    function _doorAttest(uint256 eventId, address attendee, uint64 attestedAt, uint256 pk) internal view returns (string memory) {
        bytes32 digest = harness.hashDoorAttest(eventId, attendee, attestedAt);
        return string.concat(
            '{"eventId":"', vm.toString(eventId), '","attendee":"', vm.toString(attendee),
            '","attestedAt":"', vm.toString(uint256(attestedAt)),
            '","digest":"', vm.toString(digest), '","signature":', _sig(digest, pk), "}"
        );
    }

    function _linkWallet(address pass, address wallet, uint64 deadline, uint256 pk) internal view returns (string memory) {
        bytes32 digest = harness.hashLinkWallet(pass, wallet, deadline);
        return string.concat(
            '{"pass":"', vm.toString(pass), '","wallet":"', vm.toString(wallet),
            '","deadline":"', vm.toString(uint256(deadline)), '","signer":"', vm.toString(vm.addr(pk)),
            '","digest":"', vm.toString(digest), '","signature":', _sig(digest, pk), "}"
        );
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IPresence} from "showmark/interfaces/IPresence.sol";
import {BuilderPerks} from "../src/examples/BuilderPerks.sol";

/// @dev Stands in for PresenceLens: one pass that attended event 42, linked to one wallet.
contract FakePresence is IPresence {
    address public immutable pass;
    address public immutable wallet;

    constructor(address pass_, address wallet_) {
        pass = pass_;
        wallet = wallet_;
    }

    function hasAttended(uint256 eventId, address account) external view returns (bool) {
        return eventId == 42 && (account == pass || account == wallet);
    }

    function attendedCount(address, uint256[] calldata) external pure returns (uint256) {
        return 0;
    }

    function streakOf(uint64, address) external pure returns (uint32, uint32) {
        return (0, 0);
    }

    function presenceKeyOf(address account) external view returns (address) {
        return account == wallet ? pass : account;
    }
}

contract BuilderPerksTest is Test {
    address internal pass = makeAddr("pass");
    address internal wallet = makeAddr("wallet");
    BuilderPerks internal perks;

    function setUp() public {
        perks = new BuilderPerks(new FakePresence(pass, wallet), 42);
    }

    function test_attendeeClaimsOnce() public {
        vm.prank(pass);
        perks.claim();
        assertTrue(perks.claimed(pass));
        vm.prank(pass);
        vm.expectRevert(BuilderPerks.AlreadyClaimed.selector);
        perks.claim();
    }

    function test_linkedWalletCannotClaimAgain() public {
        vm.prank(wallet);
        perks.claim();
        vm.prank(pass);
        vm.expectRevert(BuilderPerks.AlreadyClaimed.selector);
        perks.claim();
    }

    function test_strangerIsRejected() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(BuilderPerks.NotPresent.selector);
        perks.claim();
    }
}

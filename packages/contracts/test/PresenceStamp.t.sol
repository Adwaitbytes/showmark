// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC1155MetadataURI} from "@openzeppelin/contracts/token/ERC1155/extensions/IERC1155MetadataURI.sol";
import {PresenceStamp} from "../src/PresenceStamp.sol";
import {RegistryFixture} from "./utils/RegistryFixture.sol";

contract PresenceStampTest is RegistryFixture {
    function setUp() public override {
        super.setUp();
        _checkInNow(eventId, attendeePk);
    }

    function test_metadata() public view {
        assertEq(stamp.name(), "Showmark stamps");
        assertEq(stamp.symbol(), "STAMP");
        assertEq(stamp.uri(eventId), string.concat(BASE_URI, "1"));
        assertEq(stamp.uri(4567), string.concat(BASE_URI, "4567"));
        assertEq(stamp.baseURI(), BASE_URI);
    }

    function test_setBaseURI_ownerOnly() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        stamp.setBaseURI("x");

        vm.expectEmit(address(stamp));
        emit PresenceStamp.BaseURIChanged("ipfs://new/");
        vm.prank(owner);
        stamp.setBaseURI("ipfs://new/");
        assertEq(stamp.uri(eventId), "ipfs://new/1");
    }

    function test_transfersAndApprovalsAreSoulbound() public {
        vm.startPrank(attendee);
        vm.expectRevert(PresenceStamp.Soulbound.selector);
        stamp.safeTransferFrom(attendee, wallet, eventId, 1, "");

        uint256[] memory ids = new uint256[](1);
        ids[0] = eventId;
        uint256[] memory values = new uint256[](1);
        values[0] = 1;
        vm.expectRevert(PresenceStamp.Soulbound.selector);
        stamp.safeBatchTransferFrom(attendee, wallet, ids, values, "");

        vm.expectRevert(PresenceStamp.Soulbound.selector);
        stamp.setApprovalForAll(wallet, true);
        vm.stopPrank();

        assertEq(stamp.balanceOf(attendee, eventId), 1);
        assertFalse(stamp.isApprovedForAll(attendee, wallet));
    }

    function test_mintAndRelocate_registryOnly() public {
        vm.expectRevert(PresenceStamp.NotRegistry.selector);
        stamp.mint(attendee, 9);
        vm.expectRevert(PresenceStamp.NotRegistry.selector);
        stamp.relocate(attendee, wallet, eventId);
    }

    function test_relocate_movesHeldStampAndSkipsMissing() public {
        vm.startPrank(address(registry));
        stamp.relocate(attendee, wallet, eventId);
        stamp.relocate(attendee, wallet, 999);
        vm.stopPrank();
        assertEq(stamp.balanceOf(attendee, eventId), 0);
        assertEq(stamp.balanceOf(wallet, eventId), 1);
        assertEq(stamp.balanceOf(wallet, 999), 0);
    }

    function test_supportsErc1155Interfaces() public view {
        assertTrue(stamp.supportsInterface(type(IERC1155).interfaceId));
        assertTrue(stamp.supportsInterface(type(IERC1155MetadataURI).interfaceId));
    }

    function test_constructor_rejectsZeroRegistry() public {
        vm.expectRevert(PresenceStamp.NotRegistry.selector);
        this.deployStamp(address(0));
    }

    /// External so a reverting constructor is a call frame expectRevert can match without ending the test.
    function deployStamp(address registry_) external returns (address) {
        return address(new PresenceStamp(registry_, owner, BASE_URI));
    }
}

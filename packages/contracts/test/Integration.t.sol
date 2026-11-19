// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IShowmarkRegistry} from "../src/interfaces/IShowmarkRegistry.sol";
import {ICampaignVault} from "../src/interfaces/ICampaignVault.sol";
import {ProtocolFixture} from "./utils/ProtocolFixture.sol";

/// @notice End-to-end flows across registry, vault and bond.
contract IntegrationTest is ProtocolFixture {
    /// Invariant 2: no vault state can make checkIn revert. Vault paused, campaign broke, oracle stale and
    /// reverting, Zone broken: check-ins still record presence, single and batched.
    function test_checkInSucceedsWhateverTheVaultState() public {
        uint256 usd = _createApproved(_usdParams(1e6), 7 ether); // one payout only
        _checkInNow(eventId, 0x5EED);
        vault.settle(usd, eventId, vm.addr(0x5EED));

        vm.prank(owner);
        vault.pause();
        oracle.setPrice(PRICE, block.timestamp - MAX_ORACLE_AGE - 1);
        oracle.setReverting(true);
        zone.setBroken(true);

        assertTrue(_checkInNow(eventId, attendeePk));

        IShowmarkRegistry.CheckInData[] memory ds = new IShowmarkRegistry.CheckInData[](1);
        ds[0] = _mode1(eventId, 0xBEEF, doorPk, T0);
        assertEq(registry.checkInBatch(ds)[0], 0);
        assertTrue(registry.hasAttended(eventId, attendee));
        assertTrue(registry.hasAttended(eventId, vm.addr(0xBEEF)));

        // and the deferred settlements land once the vault recovers
        vm.prank(owner);
        vault.unpause();
        oracle.setReverting(false);
        oracle.setPrice(PRICE, block.timestamp);
        vm.deal(sponsor, 100 ether);
        vm.prank(sponsor);
        vault.topUp{value: 20 ether}(usd, 20 ether);
        assertGt(vault.settle(usd, eventId, attendee), 0);
    }

    /// The full sponsor journey: fund, approve, check in, settle in a batch, link, withdraw, refund the rest.
    function test_fullJourney() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.requireQieId = true;
        uint256 id = _createApproved(p, 3 ether);

        _checkInNow(eventId, attendeePk);
        _checkInNow(eventId, 0xBEEF);

        ICampaignVault.SettleItem[] memory items = new ICampaignVault.SettleItem[](2);
        items[0] = ICampaignVault.SettleItem(id, eventId, attendee);
        items[1] = ICampaignVault.SettleItem(id, eventId, vm.addr(0xBEEF));
        uint8[] memory s = vault.settleBatch(items);
        assertEq(s[0], 8, "needs a QIE ID first");

        address wal = _linkWithQieId(attendeePk, walletPk);
        s = vault.settleBatch(items);
        assertEq(s[0], 0);
        assertEq(s[1], 8);

        vm.prank(relayer);
        vault.withdraw(NATIVE, attendee);
        assertEq(wal.balance, 0.5 ether);
        vm.prank(organizer);
        vault.withdraw(NATIVE, organizer);
        assertEq(organizer.balance, 0.5 ether);

        vm.warp(T0 + 10 days + 1);
        uint256 before = sponsor.balance;
        vm.prank(sponsor);
        vault.refund(id);
        assertEq(sponsor.balance - before, 2 ether);
        assertEq(address(vault).balance, 0);
        assertEq(vault.totalLiabilities(NATIVE), 0);
    }
}

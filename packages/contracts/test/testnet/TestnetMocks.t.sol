// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TestnetQUSDC} from "../../src/testnet/TestnetQUSDC.sol";
import {TestnetNameRegistry} from "../../src/testnet/TestnetNameRegistry.sol";
import {TestnetAggregator} from "../../src/testnet/TestnetAggregator.sol";
import {QieIdCheck} from "../../src/QieIdCheck.sol";

contract TestnetMocksTest is Test {
    TestnetQUSDC internal qusdc;
    TestnetNameRegistry internal names;
    TestnetAggregator internal feed;
    address internal team = makeAddr("team");
    address internal tester = makeAddr("tester");

    function setUp() public {
        vm.warp(1_790_000_000);
        qusdc = new TestnetQUSDC();
        names = new TestnetNameRegistry();
        feed = new TestnetAggregator(team, 16_500_000);
    }

    function test_qusdc_faucetIsPublicAndCapped() public {
        assertEq(qusdc.decimals(), 6);
        assertEq(qusdc.symbol(), "QUSDC");
        vm.prank(tester);
        qusdc.mint(tester, 10_000e6);
        assertEq(qusdc.balanceOf(tester), 10_000e6);
        vm.expectRevert(TestnetQUSDC.FaucetCapExceeded.selector);
        qusdc.mint(tester, 10_000e6 + 1);
    }

    function test_names_claimGivesAQieIdThroughQieIdCheck() public {
        QieIdCheck check = new QieIdCheck(address(names));
        assertFalse(check.hasQieId(tester));

        vm.expectEmit(address(names));
        emit TestnetNameRegistry.NameClaimed(tester, "alice.qie");
        vm.prank(tester);
        names.claim("alice");
        assertEq(names.userDomain(tester), "alice.qie");
        assertEq(names.ownerOfName("alice"), tester);
        assertTrue(check.hasQieId(tester));
    }

    function test_names_rules() public {
        vm.startPrank(tester);
        vm.expectRevert(TestnetNameRegistry.InvalidName.selector);
        names.claim("");
        vm.expectRevert(TestnetNameRegistry.InvalidName.selector);
        names.claim("Alice");
        vm.expectRevert(TestnetNameRegistry.InvalidName.selector);
        names.claim("al.ice");
        vm.expectRevert(TestnetNameRegistry.InvalidName.selector);
        names.claim(string(new bytes(33)));
        names.claim("al-1ce");
        vm.expectRevert(TestnetNameRegistry.AlreadyNamed.selector);
        names.claim("bob");
        vm.stopPrank();

        vm.prank(team);
        vm.expectRevert(TestnetNameRegistry.NameTaken.selector);
        names.claim("al-1ce");
    }

    function test_feed_ownerSetsFreshRounds() public {
        assertEq(feed.decimals(), 8);
        assertEq(feed.description(), "QIE / USD (Showmark testnet)");
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredIn) = feed.latestRoundData();
        assertEq(roundId, 1);
        assertEq(answer, 16_500_000);
        assertEq(updatedAt, block.timestamp);
        assertEq(answeredIn, 1);

        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        feed.setAnswer(1);

        vm.prank(team);
        feed.setAnswer(20_000_000);
        (roundId, answer,, updatedAt, answeredIn) = feed.latestRoundData();
        assertEq(roundId, 2);
        assertEq(answer, 20_000_000);
        assertEq(updatedAt, block.timestamp);
        assertEq(answeredIn, 2);
    }
}

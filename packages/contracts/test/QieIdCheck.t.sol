// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {QieIdCheck} from "../src/QieIdCheck.sol";
import {MockQieNameRegistry} from "./mocks/MockQieNameRegistry.sol";

contract QieIdCheckTest is Test {
    MockQieNameRegistry internal names;
    QieIdCheck internal check;
    address internal holder = makeAddr("holder");
    address internal nobody = makeAddr("nobody");

    function setUp() public {
        names = new MockQieNameRegistry();
        check = new QieIdCheck(address(names));
        names.setDomain(holder, "alice.qie");
    }

    function test_constructor() public {
        assertEq(check.nameRegistry(), address(names));
        vm.expectRevert(QieIdCheck.InvalidRegistry.selector);
        new QieIdCheck(address(0));
        vm.expectRevert(QieIdCheck.InvalidRegistry.selector);
        new QieIdCheck(makeAddr("eoa"));
    }

    function test_nameHolderHasQieId() public view {
        assertTrue(check.hasQieId(holder));
        assertFalse(check.hasQieId(nobody));
    }

    function test_revertingRegistryReadsAsNoId() public {
        names.setMode(MockQieNameRegistry.Mode.Reverts);
        assertFalse(check.hasQieId(holder));
    }

    function test_malformedAnswersReadAsNoId() public {
        MockQieNameRegistry.Mode[5] memory modes = [
            MockQieNameRegistry.Mode.EmptyReturn,
            MockQieNameRegistry.Mode.ShortReturn,
            MockQieNameRegistry.Mode.BadOffset,
            MockQieNameRegistry.Mode.HugeLength,
            MockQieNameRegistry.Mode.TruncatedPayload
        ];
        for (uint256 i; i < modes.length; ++i) {
            names.setMode(modes[i]);
            assertFalse(check.hasQieId(holder));
        }
    }

    function test_gasBurnerIsCappedAndReadsAsNoId() public {
        names.setMode(MockQieNameRegistry.Mode.GasBurner);
        uint256 before = gasleft();
        assertFalse(check.hasQieId(holder));
        assertLt(before - gasleft(), check.QUERY_GAS() + 20_000, "registry gets at most QUERY_GAS");
    }

    function test_returnBombIsNotCopied() public {
        names.setMode(MockQieNameRegistry.Mode.ReturnBomb);
        uint256 before = gasleft();
        assertTrue(check.hasQieId(holder));
        assertLt(before - gasleft(), check.QUERY_GAS() + 20_000);
    }

    /// Runs against QIE mainnet when QIE_FORK_RPC is set (e.g. https://rpc1mainnet.qie.digital).
    function test_fork_mainnetRegistry() public {
        string memory rpc = vm.envOr("QIE_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        QieIdCheck live = new QieIdCheck(0x1D69d75AD7b77b91C3760F84faC52E651710f62e);
        assertTrue(live.hasQieId(0x8d858aaEA1cdA41D4E9c187c4Dc079E6342486bA), "qwtff250.qie holder");
        assertFalse(live.hasQieId(0x000000000000000000000000000000000000dEaD));
    }
}

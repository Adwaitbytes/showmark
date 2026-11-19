// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {ShowmarkRegistry} from "../src/ShowmarkRegistry.sol";
import {PresenceStamp} from "../src/PresenceStamp.sol";
import {CampaignVault} from "../src/CampaignVault.sol";
import {OrganizerBond} from "../src/OrganizerBond.sol";
import {PresenceLens} from "../src/PresenceLens.sol";
import {QieIdCheck} from "../src/QieIdCheck.sol";
import {TestnetAggregator} from "../src/testnet/TestnetAggregator.sol";
import {TestnetNameRegistry} from "../src/testnet/TestnetNameRegistry.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockQUSDC} from "./mocks/MockQUSDC.sol";

contract DeployTest is Test {
    Deploy internal script;
    uint256 internal constant KEY = 0xDE9107;
    address internal deployer;
    address internal safe = makeAddr("safe");
    string internal constant OUT = "deployments/test-tmp";

    function setUp() public {
        script = new Deploy();
        deployer = vm.addr(KEY);
        vm.deal(deployer, 100 ether);
    }

    function test_testnet_deploysMocksWiresEverythingAndHandsOwnershipToSafe() public {
        vm.chainId(1983);
        Deploy.Config memory c = _config(safe, 250);
        Deploy.Deployment memory d = script.deploy(c);

        assertTrue(d.testnetMocks);
        assertEq(d.deployer, deployer);
        _assertWiring(d, c);
        assertEq(QieIdCheck(d.qieIdCheck).nameRegistry(), d.nameRegistry);
        assertEq(TestnetAggregator(d.oracle).owner(), deployer, "testnet feed stays with the team");
        (, int256 answer,,,) = TestnetAggregator(d.oracle).latestRoundData();
        assertEq(answer, 16_500_000);

        // ownership transfer is started, not completed: the Safe must accept
        assertEq(ShowmarkRegistry(d.registry).owner(), deployer);
        assertEq(ShowmarkRegistry(d.registry).pendingOwner(), safe);
        assertEq(PresenceStamp(d.stamp).pendingOwner(), safe);
        assertEq(OrganizerBond(d.bond).pendingOwner(), safe);
        assertEq(CampaignVault(d.vault).pendingOwner(), safe);

        // a tester can claim a QIE ID on testnet and the deployed check sees it
        vm.prank(makeAddr("tester"));
        TestnetNameRegistry(d.nameRegistry).claim("tester");
        assertTrue(QieIdCheck(d.qieIdCheck).hasQieId(makeAddr("tester")));

        string memory json = vm.readFile(string.concat(OUT, "/1983.json"));
        assertEq(vm.parseJsonUint(json, ".chainId"), 1983);
        assertEq(vm.parseJsonUint(json, ".deployBlock"), d.deployBlock);
        assertEq(vm.parseJsonAddress(json, ".registry"), d.registry);
        assertEq(vm.parseJsonAddress(json, ".stamp"), d.stamp);
        assertEq(vm.parseJsonAddress(json, ".vault"), d.vault);
        assertEq(vm.parseJsonAddress(json, ".bond"), d.bond);
        assertEq(vm.parseJsonAddress(json, ".lens"), d.lens);
        assertEq(vm.parseJsonAddress(json, ".qieIdCheck"), d.qieIdCheck);
        assertEq(vm.parseJsonAddress(json, ".nameRegistry"), d.nameRegistry);
        assertEq(vm.parseJsonAddress(json, ".qusdc"), d.qusdc);
        assertEq(vm.parseJsonAddress(json, ".oracle"), d.oracle);
        assertEq(vm.parseJsonAddress(json, ".pendingOwner"), safe);
        assertEq(vm.parseJsonUint(json, ".oracleMaxAge"), 172_800);
        assertEq(vm.parseJsonUint(json, ".feeBps"), 250);
        assertTrue(vm.parseJsonBool(json, ".testnetMocks"));
        vm.removeFile(string.concat(OUT, "/1983.json"));
    }

    function test_mainnet_usesRealAddressesAndHandsOwnershipToSafe() public {
        _etchMainnet(8, 6);
        Deploy.Config memory c = _config(safe, 0);
        Deploy.Deployment memory d = script.deploy(c);

        assertFalse(d.testnetMocks);
        assertEq(d.qusdc, 0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5);
        assertEq(d.nameRegistry, 0x1D69d75AD7b77b91C3760F84faC52E651710f62e);
        assertEq(d.oracle, 0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17);
        _assertWiring(d, c);
        assertEq(ShowmarkRegistry(d.registry).pendingOwner(), safe);
        assertEq(CampaignVault(d.vault).pendingOwner(), safe);
        vm.removeFile(string.concat(OUT, "/1990.json"));
    }

    function test_mainnet_refusesWithoutSafe() public {
        _etchMainnet(8, 6);
        Deploy.Config memory c = _config(address(0), 0);
        vm.expectRevert(Deploy.SafeRequired.selector);
        script.deploy(c);
    }

    function test_mainnet_refusesUnexpectedDecimals() public {
        _etchMainnet(18, 6);
        Deploy.Config memory c = _config(safe, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                Deploy.UnexpectedDecimals.selector, address(0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17), 18
            )
        );
        script.deploy(c);
    }

    /// The only test that touches the environment, so parallel tests cannot race on it.
    function test_configFromEnv_mainnetRequiresSafeAndExplicitFeeRecipient() public {
        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(bytes32(KEY)));
        vm.setEnv("SAFE_ADDRESS", "");
        vm.setEnv("FEE_RECIPIENT", "");
        vm.chainId(1983);
        Deploy.Config memory c = script.configFromEnv();
        assertEq(c.feeRecipient, deployer, "testnet defaults the fee recipient to the deployer");
        assertEq(c.safe, address(0));
        assertEq(c.oracleMaxAge, 172_800);

        vm.chainId(1990);
        vm.expectRevert(Deploy.SafeRequired.selector);
        script.configFromEnv();

        vm.setEnv("SAFE_ADDRESS", vm.toString(safe));
        vm.expectRevert(Deploy.FeeRecipientRequired.selector);
        script.configFromEnv();

        vm.setEnv("FEE_RECIPIENT", vm.toString(address(0xFEE)));
        c = script.configFromEnv();
        assertEq(c.safe, safe);
        assertEq(c.feeRecipient, address(0xFEE));

        vm.setEnv("FEE_BPS", "501");
        vm.expectRevert(abi.encodeWithSelector(Deploy.FeeTooHigh.selector, 501));
        script.configFromEnv();
        vm.setEnv("FEE_BPS", "0");
        vm.setEnv("SAFE_ADDRESS", "");
        vm.setEnv("FEE_RECIPIENT", "");
    }

    function _etchMainnet(uint8 oracleDecimals, uint8 qusdcDecimals) internal {
        vm.chainId(1990);
        // stand-in code at the real addresses so constructors and decimal checks that read them succeed
        vm.etch(0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17, address(new MockAggregator(oracleDecimals)).code);
        vm.etch(0x1D69d75AD7b77b91C3760F84faC52E651710f62e, address(new TestnetNameRegistry()).code);
        vm.etch(0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5, address(new MockQUSDC()).code);
        assertEq(qusdcDecimals, 6, "MockQUSDC has 6 decimals");
    }

    function test_rejectsOtherChains() public {
        vm.chainId(31337);
        Deploy.Config memory c = _config(address(0), 0);
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, 31337));
        script.deploy(c);
    }

    function _assertWiring(Deploy.Deployment memory d, Deploy.Config memory c) internal view {
        ShowmarkRegistry registry = ShowmarkRegistry(d.registry);
        CampaignVault vault = CampaignVault(d.vault);
        assertEq(registry.stamp(), d.stamp);
        assertEq(PresenceStamp(d.stamp).registry(), d.registry);
        assertEq(PresenceStamp(d.stamp).baseURI(), c.stampBaseURI);
        assertEq(address(vault.registry()), d.registry);
        assertEq(address(vault.qieIdCheck()), d.qieIdCheck);
        assertEq(address(vault.oracle()), d.oracle);
        assertEq(address(vault.bond()), d.bond);
        assertEq(vault.maxOracleAge(), c.oracleMaxAge);
        assertEq(vault.feeBps(), c.feeBps);
        assertEq(vault.feeRecipient(), c.feeRecipient);
        assertEq(OrganizerBond(d.bond).vault(), d.vault);
        assertEq(address(PresenceLens(d.lens).registry()), d.registry);
        assertEq(registry.owner(), deployer);
        assertEq(vault.owner(), deployer);
        assertEq(OrganizerBond(d.bond).owner(), deployer);
    }

    function _config(address safe_, uint16 feeBps) internal view returns (Deploy.Config memory c) {
        c.deployerKey = KEY;
        c.safe = safe_;
        c.oracleMaxAge = 172_800;
        c.feeBps = feeBps;
        c.feeRecipient = deployer;
        c.stampBaseURI = "https://showmark.example/api/stamp/";
        c.outDir = OUT;
    }
}

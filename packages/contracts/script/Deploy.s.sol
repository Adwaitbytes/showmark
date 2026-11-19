// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Script, console2} from "forge-std/Script.sol";
import {ShowmarkRegistry} from "../src/ShowmarkRegistry.sol";
import {PresenceStamp} from "../src/PresenceStamp.sol";
import {CampaignVault} from "../src/CampaignVault.sol";
import {OrganizerBond} from "../src/OrganizerBond.sol";
import {PresenceLens} from "../src/PresenceLens.sol";
import {QieIdCheck} from "../src/QieIdCheck.sol";
import {TestnetQUSDC} from "../src/testnet/TestnetQUSDC.sol";
import {TestnetNameRegistry} from "../src/testnet/TestnetNameRegistry.sol";
import {TestnetAggregator} from "../src/testnet/TestnetAggregator.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title Deploy
/// @notice Deploys the Showmark protocol to QIE testnet (1983, with testnet stand-ins for QUSDC, QIE names and the
/// price feed) or QIE mainnet (1990, real QIE addresses), starts the ownership handover to the protocol Safe and
/// writes `deployments/{chainId}.json`.
/// @dev Environment:
///   DEPLOYER_PRIVATE_KEY  required
///   SAFE_ADDRESS          testnet optional, mainnet required; transferOwnership(SAFE) is started on every
///                         Ownable2Step contract
///   ORACLE_MAX_AGE        optional, seconds, default 172800 (48 h; measured p99 feed gap 29.5 h, max 50 h)
///   FEE_BPS               optional, default 0, at most 500
///   FEE_RECIPIENT         testnet optional (default the deployer), mainnet required
///   STAMP_BASE_URI        optional, default "" (owner can set it later with PresenceStamp.setBaseURI)
///   DEPLOYMENTS_DIR       optional, default "deployments"
contract Deploy is Script {
    uint256 internal constant QIE_MAINNET = 1990;
    uint256 internal constant QIE_TESTNET = 1983;
    address internal constant MAINNET_QUSDC = 0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5;
    address internal constant MAINNET_NAME_REGISTRY = 0x1D69d75AD7b77b91C3760F84faC52E651710f62e;
    address internal constant MAINNET_ORACLE = 0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17;
    int256 internal constant TESTNET_INITIAL_PRICE = 16_500_000;
    uint256 internal constant DEFAULT_ORACLE_MAX_AGE = 172_800;

    /// @notice The script only knows QIE mainnet and testnet.
    error UnsupportedChain(uint256 chainId);
    /// @notice FEE_BPS is above the vault's MAX_FEE_BPS.
    error FeeTooHigh(uint256 bps);
    /// @notice Mainnet needs SAFE_ADDRESS, so the deployer EOA never keeps the owner powers.
    error SafeRequired();
    /// @notice Mainnet needs an explicit FEE_RECIPIENT.
    error FeeRecipientRequired();
    /// @notice A mainnet dependency does not report the decimals the vault and the app assume.
    error UnexpectedDecimals(address token, uint8 decimals);

    struct Config {
        uint256 deployerKey;
        address safe;
        uint256 oracleMaxAge;
        uint16 feeBps;
        address feeRecipient;
        string stampBaseURI;
        string outDir;
    }

    struct Deployment {
        address deployer;
        uint256 deployBlock;
        address registry;
        address stamp;
        address vault;
        address bond;
        address lens;
        address qieIdCheck;
        address nameRegistry;
        address qusdc;
        address oracle;
        bool testnetMocks;
    }

    /// @notice Entry point for `forge script`.
    /// @return The deployed addresses.
    function run() external returns (Deployment memory) {
        return deploy(configFromEnv());
    }

    /// @notice Reads the deployment configuration from the environment.
    /// @return c The configuration.
    function configFromEnv() public view returns (Config memory c) {
        c.deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        c.safe = _envAddress("SAFE_ADDRESS");
        c.oracleMaxAge = vm.envOr("ORACLE_MAX_AGE", DEFAULT_ORACLE_MAX_AGE);
        uint256 fee = vm.envOr("FEE_BPS", uint256(0));
        if (fee > 500) revert FeeTooHigh(fee);
        c.feeBps = uint16(fee);
        c.feeRecipient = _envAddress("FEE_RECIPIENT");
        if (block.chainid == QIE_MAINNET) {
            if (c.safe == address(0)) revert SafeRequired();
            if (c.feeRecipient == address(0)) revert FeeRecipientRequired();
        } else if (c.feeRecipient == address(0)) {
            c.feeRecipient = vm.addr(c.deployerKey);
        }
        c.stampBaseURI = vm.envOr("STAMP_BASE_URI", string(""));
        c.outDir = vm.envOr("DEPLOYMENTS_DIR", string("deployments"));
    }

    /// @notice Deploys everything for the current chain and writes the deployments file.
    /// @param c The configuration.
    /// @return d The deployed addresses.
    function deploy(Config memory c) public returns (Deployment memory d) {
        d.deployer = vm.addr(c.deployerKey);
        // Latest block before the first deploy transaction: a safe lower bound for the indexer to start from.
        d.deployBlock = block.number;

        vm.startBroadcast(c.deployerKey);
        if (block.chainid == QIE_TESTNET) {
            d.testnetMocks = true;
            d.qusdc = address(new TestnetQUSDC());
            d.nameRegistry = address(new TestnetNameRegistry());
            d.oracle = address(new TestnetAggregator(d.deployer, TESTNET_INITIAL_PRICE));
        } else if (block.chainid == QIE_MAINNET) {
            if (c.safe == address(0)) revert SafeRequired();
            _requireDecimals(MAINNET_ORACLE, IAggregatorV3(MAINNET_ORACLE).decimals(), 8);
            _requireDecimals(MAINNET_QUSDC, IERC20Metadata(MAINNET_QUSDC).decimals(), 6);
            d.qusdc = MAINNET_QUSDC;
            d.nameRegistry = MAINNET_NAME_REGISTRY;
            d.oracle = MAINNET_ORACLE;
        } else {
            revert UnsupportedChain(block.chainid);
        }

        d.qieIdCheck = address(new QieIdCheck(d.nameRegistry));
        ShowmarkRegistry registry = new ShowmarkRegistry(d.deployer, c.stampBaseURI);
        d.registry = address(registry);
        d.stamp = registry.stamp();
        OrganizerBond bond = new OrganizerBond(d.deployer);
        d.bond = address(bond);
        CampaignVault vault = new CampaignVault(
            d.registry, d.qieIdCheck, d.oracle, d.bond, c.oracleMaxAge, d.deployer, c.feeRecipient, c.feeBps
        );
        d.vault = address(vault);
        bond.setVault(d.vault);
        d.lens = address(new PresenceLens(d.registry));

        if (c.safe != address(0)) {
            registry.transferOwnership(c.safe);
            PresenceStamp(d.stamp).transferOwnership(c.safe);
            bond.transferOwnership(c.safe);
            vault.transferOwnership(c.safe);
        }
        vm.stopBroadcast();

        _write(c, d);
        _log(c, d);
    }

    /// @dev An unset or empty variable reads as address(0).
    function _envAddress(string memory name) internal view returns (address) {
        string memory raw = vm.envOr(name, string(""));
        return bytes(raw).length == 0 ? address(0) : vm.parseAddress(raw);
    }

    function _requireDecimals(address token, uint8 actual, uint8 expected) internal pure {
        if (actual != expected) revert UnexpectedDecimals(token, actual);
    }

    function _write(Config memory c, Deployment memory d) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", d.deployBlock);
        vm.serializeAddress(k, "deployer", d.deployer);
        vm.serializeAddress(k, "pendingOwner", c.safe);
        vm.serializeAddress(k, "registry", d.registry);
        vm.serializeAddress(k, "stamp", d.stamp);
        vm.serializeAddress(k, "vault", d.vault);
        vm.serializeAddress(k, "bond", d.bond);
        vm.serializeAddress(k, "lens", d.lens);
        vm.serializeAddress(k, "qieIdCheck", d.qieIdCheck);
        vm.serializeAddress(k, "nameRegistry", d.nameRegistry);
        vm.serializeAddress(k, "qusdc", d.qusdc);
        vm.serializeAddress(k, "oracle", d.oracle);
        vm.serializeUint(k, "oracleMaxAge", c.oracleMaxAge);
        vm.serializeUint(k, "feeBps", c.feeBps);
        vm.serializeAddress(k, "feeRecipient", c.feeRecipient);
        vm.serializeString(k, "stampBaseURI", c.stampBaseURI);
        vm.serializeInt(k, "testnetInitialPrice", d.testnetMocks ? TESTNET_INITIAL_PRICE : int256(0));
        string memory json = vm.serializeBool(k, "testnetMocks", d.testnetMocks);

        vm.createDir(c.outDir, true);
        vm.writeJson(json, string.concat(c.outDir, "/", vm.toString(block.chainid), ".json"));
    }

    function _log(Config memory c, Deployment memory d) internal view {
        console2.log("chainId       ", block.chainid);
        console2.log("deployBlock   ", d.deployBlock);
        console2.log("registry      ", d.registry);
        console2.log("stamp         ", d.stamp);
        console2.log("vault         ", d.vault);
        console2.log("bond          ", d.bond);
        console2.log("lens          ", d.lens);
        console2.log("qieIdCheck    ", d.qieIdCheck);
        console2.log("nameRegistry  ", d.nameRegistry);
        console2.log("qusdc         ", d.qusdc);
        console2.log("oracle        ", d.oracle);
        console2.log("oracleMaxAge  ", c.oracleMaxAge);
        console2.log("feeBps        ", c.feeBps);
        if (c.safe != address(0)) console2.log("ownership pending for Safe", c.safe);
        else console2.log("SAFE_ADDRESS not set: the deployer still owns every contract");
    }
}

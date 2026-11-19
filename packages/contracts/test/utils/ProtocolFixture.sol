// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {RegistryFixture} from "./RegistryFixture.sol";
import {CampaignVault} from "../../src/CampaignVault.sol";
import {OrganizerBond} from "../../src/OrganizerBond.sol";
import {ICampaignVault} from "../../src/interfaces/ICampaignVault.sol";
import {MockQUSDC} from "../mocks/MockQUSDC.sol";
import {MockQieNameRegistry} from "../mocks/MockQieNameRegistry.sol";
import {QieIdCheck} from "../../src/QieIdCheck.sol";
import {MockAggregator} from "../mocks/MockAggregator.sol";

/// @notice Registry fixture plus vault, bond, QIE ID check, QUSDC, name registry and oracle mocks, a funded sponsor and campaign helpers.
abstract contract ProtocolFixture is RegistryFixture {
    uint256 internal constant MAX_ORACLE_AGE = 36 hours;
    int256 internal constant PRICE = 16_500_000; // $0.165 per QIE, 8 decimals
    string internal constant CAMPAIGN_META = '{"v":1,"name":"Demo","sponsor":"Acme","description":"x"}';

    MockQUSDC internal qusdc;
    MockQieNameRegistry internal names;
    QieIdCheck internal qieIdCheck;
    MockAggregator internal oracle;
    OrganizerBond internal bond;
    CampaignVault internal vault;

    address internal sponsor = makeAddr("sponsor");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal constant NATIVE = address(0);

    function setUp() public virtual override {
        super.setUp();
        qusdc = new MockQUSDC();
        names = new MockQieNameRegistry();
        qieIdCheck = new QieIdCheck(address(names));
        oracle = new MockAggregator(8);
        oracle.setPrice(PRICE, block.timestamp);
        bond = new OrganizerBond(owner);
        vault = new CampaignVault(
            address(registry),
            address(qieIdCheck),
            address(oracle),
            address(bond),
            MAX_ORACLE_AGE,
            owner,
            feeRecipient,
            0
        );
        vm.prank(owner);
        bond.setVault(address(vault));

        vm.deal(sponsor, 1_000_000 ether);
        qusdc.mint(sponsor, 1_000_000e6);
        vm.prank(sponsor);
        qusdc.approve(address(vault), type(uint256).max);
    }

    /// @dev Native, token-priced, 1 QIE per presence, 50/50 split, mode 1, open for a week around T0.
    function _params(address token) internal pure returns (ICampaignVault.CampaignParams memory p) {
        p.token = token;
        p.pricing = ICampaignVault.Pricing.Token;
        p.amountPerPresence = token == NATIVE ? 1 ether : 10e6;
        p.attendeeShareBps = 5000;
        p.minProofMode = 1;
        p.startsAt = T0 - 1 days;
        p.endsAt = T0 + 7 days;
        p.metadata = CAMPAIGN_META;
    }

    function _usdParams(uint128 usd6) internal pure returns (ICampaignVault.CampaignParams memory p) {
        p = _params(NATIVE);
        p.pricing = ICampaignVault.Pricing.UsdInNative;
        p.amountPerPresence = usd6;
    }

    function _create(ICampaignVault.CampaignParams memory p, uint256 deposit) internal returns (uint256 id) {
        vm.prank(sponsor);
        id = vault.createCampaign{value: p.token == NATIVE ? deposit : 0}(p, deposit);
    }

    function _createApproved(ICampaignVault.CampaignParams memory p, uint256 deposit) internal returns (uint256 id) {
        id = _create(p, deposit);
        _approve(id, eventId);
    }

    function _approve(uint256 campaignId, uint256 eventId_) internal {
        uint256[] memory ids = new uint256[](1);
        ids[0] = eventId_;
        vm.prank(sponsor);
        vault.approveEvents(campaignId, ids);
    }

    function _linkWithQieId(uint256 passPk, uint256 signerPk) internal returns (address wal) {
        address pass = vm.addr(passPk);
        wal = vm.addr(signerPk);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        (bytes memory p, bytes memory w) = _linkSigs(passPk, signerPk, pass, wal, deadline);
        registry.linkWallet(pass, wal, deadline, p, w, new uint256[](0));
        names.setDomain(wal, "attendee.qie");
    }
}

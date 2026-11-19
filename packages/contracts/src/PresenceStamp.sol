// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2StepNoRenounce} from "./utils/Ownable2StepNoRenounce.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title PresenceStamp
/// @notice Non-transferable ERC-1155 proof of presence. Token id = Showmark event id.
/// @dev Deployed by ShowmarkRegistry, which alone mints and relocates. Mint and relocate deliberately skip the
/// ERC-1155 receiver hook: a soulbound stamp needs no acceptance check, and skipping it means a check-in or a wallet
/// link never makes an external call to attendee-controlled code.
contract PresenceStamp is ERC1155, Ownable2StepNoRenounce {
    using Strings for uint256;

    /// @notice Stamps cannot be transferred or approved.
    error Soulbound();
    /// @notice Caller is not the registry, or the registry address is zero.
    error NotRegistry();

    /// @notice Emitted when the owner changes the metadata base URI.
    /// @param baseURI The new base; `uri(id)` returns `{baseURI}{id}`.
    event BaseURIChanged(string baseURI);

    /// @notice The ShowmarkRegistry that controls minting.
    address public immutable registry;

    /// @notice Metadata base URI, e.g. `https://app/api/stamp/`.
    string public baseURI;

    modifier onlyRegistry() {
        if (msg.sender != registry) revert NotRegistry();
        _;
    }

    /// @param registry_ The registry allowed to mint and relocate.
    /// @param owner_ Account allowed to change the base URI.
    /// @param baseURI_ Initial metadata base URI.
    constructor(address registry_, address owner_, string memory baseURI_) ERC1155("") Ownable(owner_) {
        if (registry_ == address(0)) revert NotRegistry();
        registry = registry_;
        baseURI = baseURI_;
    }

    /// @notice Collection name shown by wallets and explorers.
    /// @return The name.
    function name() external pure returns (string memory) {
        return "Showmark stamps";
    }

    /// @notice Collection symbol.
    /// @return The symbol.
    function symbol() external pure returns (string memory) {
        return "STAMP";
    }

    /// @notice Metadata URI for a stamp: `{baseURI}{id}`.
    /// @param id The event id.
    /// @return The URI.
    function uri(uint256 id) public view override returns (string memory) {
        return string.concat(baseURI, id.toString());
    }

    /// @notice Changes the metadata base URI. Owner only.
    /// @param baseURI_ The new base URI.
    function setBaseURI(string calldata baseURI_) external onlyOwner {
        baseURI = baseURI_;
        emit BaseURIChanged(baseURI_);
    }

    /// @notice Mints the stamp for event `id` to `to`. Registry only.
    /// @param to The receiver (the pass, or its linked wallet).
    /// @param id The event id.
    function mint(address to, uint256 id) external onlyRegistry {
        _update(address(0), to, _single(id), _single(1));
    }

    /// @notice Moves the stamp for event `id` from `from` to `to` if `from` holds it. Registry only.
    /// @param from The pass.
    /// @param to The wallet linked to the pass.
    /// @param id The event id.
    function relocate(address from, address to, uint256 id) external onlyRegistry {
        uint256 held = balanceOf(from, id);
        if (held == 0) return;
        _update(from, to, _single(id), _single(held));
    }

    /// @notice Always reverts: stamps are soulbound.
    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    /// @notice Always reverts: stamps are soulbound.
    function safeTransferFrom(address, address, uint256, uint256, bytes memory) public pure override {
        revert Soulbound();
    }

    /// @notice Always reverts: stamps are soulbound.
    function safeBatchTransferFrom(address, address, uint256[] memory, uint256[] memory, bytes memory)
        public
        pure
        override
    {
        revert Soulbound();
    }

    function _single(uint256 value) private pure returns (uint256[] memory arr) {
        arr = new uint256[](1);
        arr[0] = value;
    }
}

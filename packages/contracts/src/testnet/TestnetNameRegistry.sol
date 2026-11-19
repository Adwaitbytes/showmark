// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IQieNameRegistry} from "../interfaces/IQieNameRegistry.sol";

/// @title TestnetNameRegistry
/// @notice Testnet stand-in for QIE's name registry, which exists on mainnet only. Anyone may claim one
/// `label.qie` name, so testers can hold a QIE ID; QieIdCheck reads it exactly as it reads mainnet.
/// Never deploy on mainnet.
contract TestnetNameRegistry is IQieNameRegistry {
    /// @notice Labels are 1 to 32 characters of a-z, 0-9 and '-'.
    error InvalidName();
    /// @notice Someone already holds this label.
    error NameTaken();
    /// @notice The caller already holds a name.
    error AlreadyNamed();

    /// @notice Emitted when a wallet claims a name.
    /// @param wallet The new holder.
    /// @param name The full name, `label.qie`.
    event NameClaimed(address indexed wallet, string name);

    mapping(address wallet => string) private _names;
    mapping(bytes32 labelHash => address) private _owners;

    /// @notice Claims `label.qie` for the caller.
    /// @param label 1 to 32 characters of a-z, 0-9 and '-'.
    function claim(string calldata label) external {
        bytes calldata b = bytes(label);
        if (b.length == 0 || b.length > 32) revert InvalidName();
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (!((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-")) revert InvalidName();
        }
        if (bytes(_names[msg.sender]).length != 0) revert AlreadyNamed();
        bytes32 key = keccak256(b);
        if (_owners[key] != address(0)) revert NameTaken();

        _owners[key] = msg.sender;
        string memory full = string.concat(label, ".qie");
        _names[msg.sender] = full;
        emit NameClaimed(msg.sender, full);
    }

    /// @inheritdoc IQieNameRegistry
    function userDomain(address wallet) external view returns (string memory) {
        return _names[wallet];
    }

    /// @notice The holder of `label`, 0 if unclaimed.
    /// @param label The label without `.qie`.
    /// @return The holder.
    function ownerOfName(string calldata label) external view returns (address) {
        return _owners[keccak256(bytes(label))];
    }
}

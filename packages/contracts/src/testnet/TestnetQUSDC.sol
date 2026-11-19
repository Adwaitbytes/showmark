// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestnetQUSDC
/// @notice Testnet stand-in for QUSDC (6 decimals). QUSDC exists on mainnet only. Anyone may mint up to
/// FAUCET_CAP per call so testers can fund campaigns. Never deploy on mainnet.
contract TestnetQUSDC is ERC20 {
    /// @notice Largest amount one mint call may create (10,000 QUSDC).
    uint256 public constant FAUCET_CAP = 10_000e6;

    /// @notice The requested amount is above FAUCET_CAP.
    error FaucetCapExceeded();

    constructor() ERC20("Showmark Testnet QUSDC", "QUSDC") {}

    /// @notice QUSDC has 6 decimals.
    /// @return 6.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Public faucet.
    /// @param to Receiver.
    /// @param amount Amount with 6 decimals, at most FAUCET_CAP.
    function mint(address to, uint256 amount) external {
        if (amount > FAUCET_CAP) revert FaucetCapExceeded();
        _mint(to, amount);
    }
}

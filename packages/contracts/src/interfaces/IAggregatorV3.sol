// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAggregatorV3
/// @notice The subset of the Chainlink-style AggregatorV3Interface that QIE oracles expose and Showmark reads.
interface IAggregatorV3 {
    /// @notice Decimals of the answer.
    /// @return The number of decimals.
    function decimals() external view returns (uint8);

    /// @notice The latest round. Reverts on QIE feeds that were never updated.
    /// @return roundId The round id.
    /// @return answer The price.
    /// @return startedAt When the round started.
    /// @return updatedAt When the answer was last updated.
    /// @return answeredInRound The round in which the answer was computed.
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

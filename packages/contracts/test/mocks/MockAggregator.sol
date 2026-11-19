// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

/// @notice Test oracle with every latestRoundData field settable, plus a revert switch
/// (QIE feeds revert when never updated).
contract MockAggregator is IAggregatorV3 {
    uint8 public immutable decimals;
    uint80 public roundId;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public answeredInRound;
    bool public reverting;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    /// @notice Sets a fresh, complete round.
    function setPrice(int256 answer_, uint256 updatedAt_) external {
        roundId += 1;
        answer = answer_;
        updatedAt = updatedAt_;
        answeredInRound = roundId;
    }

    function setRound(uint80 roundId_, int256 answer_, uint256 updatedAt_, uint80 answeredInRound_) external {
        roundId = roundId_;
        answer = answer_;
        updatedAt = updatedAt_;
        answeredInRound = answeredInRound_;
    }

    function setReverting(bool reverting_) external {
        reverting = reverting_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!reverting, "No data present");
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }
}

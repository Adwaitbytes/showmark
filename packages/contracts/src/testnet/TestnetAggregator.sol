// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// @title TestnetAggregator
/// @notice Testnet stand-in for the QIE/USD feed (8 decimals), which exists on mainnet only. The owner posts
/// prices; each post is a complete, fresh round. The vault treats rounds older than maxOracleAge as stale, so the
/// owner must post at least that often. Plain Ownable on purpose: it stays with the team and is not handed to the
/// protocol Safe. Never deploy on mainnet.
contract TestnetAggregator is IAggregatorV3, Ownable {
    /// @notice Emitted on every posted price.
    /// @param current The new answer.
    /// @param roundId The new round.
    /// @param updatedAt Block time of the post.
    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    uint80 private _roundId;
    int256 private _answer;
    uint256 private _updatedAt;

    /// @param owner_ Account allowed to post prices.
    /// @param initialAnswer First price, 8 decimals (16_500_000 is $0.165).
    constructor(address owner_, int256 initialAnswer) Ownable(owner_) {
        _post(initialAnswer);
    }

    /// @inheritdoc IAggregatorV3
    function decimals() external pure returns (uint8) {
        return 8;
    }

    /// @notice Human-readable feed name.
    /// @return The description.
    function description() external pure returns (string memory) {
        return "QIE / USD (Showmark testnet)";
    }

    /// @notice Posts a new price as a fresh round. Owner only.
    /// @param answer Price with 8 decimals.
    function setAnswer(int256 answer) external onlyOwner {
        _post(answer);
    }

    /// @inheritdoc IAggregatorV3
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }

    function _post(int256 answer) private {
        uint80 roundId = _roundId + 1;
        _roundId = roundId;
        _answer = answer;
        _updatedAt = block.timestamp;
        emit AnswerUpdated(answer, roundId, block.timestamp);
    }
}

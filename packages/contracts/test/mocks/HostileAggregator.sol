// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice Oracle whose decimals() is correct but whose latestRoundData is hostile: short data, out-of-range round
/// ids, or burning all gas, as a misconfigured or upgraded feed proxy could (audit L-02).
contract HostileAggregator {
    enum Mode {
        ShortAnswer,
        OversizedRoundId,
        GasBurner,
        Empty
    }

    Mode public mode;

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    fallback() external {
        Mode m = mode;
        if (m == Mode.GasBurner) {
            uint256 i;
            while (gasleft() > 0) ++i;
        }
        uint256 t = block.timestamp;
        assembly ("memory-safe") {
            switch m
            case 0 {
                mstore(0, 1)
                return(0, 0x20)
            }
            case 1 {
                // a fresh-looking round whose roundId does not fit uint80
                mstore(0x00, shl(80, 1))
                mstore(0x20, 16500000)
                mstore(0x40, t)
                mstore(0x60, t)
                mstore(0x80, shl(80, 1))
                return(0, 0xa0)
            }
            default { return(0, 0) }
        }
    }
}

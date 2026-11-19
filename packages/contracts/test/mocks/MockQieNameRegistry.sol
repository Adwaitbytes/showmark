// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice Test stand-in for QIE's name registry, with hostile modes to prove QieIdCheck never reverts and never
/// misreads malformed answers.
contract MockQieNameRegistry {
    enum Mode {
        Normal,
        Reverts,
        EmptyReturn,
        ShortReturn,
        BadOffset,
        HugeLength,
        TruncatedPayload,
        GasBurner,
        ReturnBomb
    }

    Mode public mode;
    mapping(address => string) private _domains;

    function setDomain(address wallet, string calldata name) external {
        _domains[wallet] = name;
    }

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    function userDomain(address wallet) external view returns (string memory) {
        Mode m = mode;
        if (m == Mode.Reverts) revert("registry down");
        if (m == Mode.GasBurner) {
            uint256 i;
            while (gasleft() > 0) ++i;
        }
        assembly ("memory-safe") {
            switch m
            case 2 { return(0, 0) }
            case 3 {
                mstore(0, 0x20)
                return(0, 0x20)
            }
            case 4 {
                mstore(0, 0x40)
                mstore(0x20, 1)
                return(0, 0x40)
            }
            case 5 {
                mstore(0, 0x20)
                mstore(0x20, not(0))
                return(0, 0x40)
            }
            case 6 {
                mstore(0, 0x20)
                mstore(0x20, 100)
                return(0, 0x40)
            }
            case 8 {
                // a valid one-byte name followed by ~100 KB of padding
                mstore(0, 0x20)
                mstore(0x20, 1)
                return(0, 100000)
            }
        }
        return _domains[wallet];
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Test stand-in for the QIE ID (Zone) ERC-721. `setBroken` makes balanceOf revert.
contract MockZone is ERC721 {
    uint256 private _nextId = 1;
    bool public broken;

    constructor() ERC721("Mock Zone", ".qie") {}

    function mint(address to) external returns (uint256 id) {
        id = _nextId++;
        _mint(to, id);
    }

    function burn(uint256 id) external {
        _burn(id);
    }

    function setBroken(bool broken_) external {
        broken = broken_;
    }

    function balanceOf(address owner) public view override returns (uint256) {
        require(!broken, "zone broken");
        return super.balanceOf(owner);
    }
}

//SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./MergerBase.sol";
import "../token/IFei.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title Contract to exchange TRIBE with FEI post-merger
/// @author elee
contract TRIBERagequit is MergerBase {
    using SafeERC20 for IERC20;

    address public constant coreAddress = 0x8d5ED43dCa8C2F7dFB20CF7b53CC7E593635d7b9;
    address public constant guardian = 0xB8f482539F2d3Ae2C9ea6076894df36D1f632775;

    uint256 public intrinsicValueExchangeRateBase;

    address public constant rewardsDripper = 0x3Fe0EAD3500e767F0F8bC2d3B5AF7755B1b21A6a;
    IFei public constant fei = IFei(0x956F47F50A910163D8BF957Cf5846D573E7f87CA);

    uint256 public immutable rageQuitEnd;

    mapping(address => uint256) public claimed;

    event Exchange(address indexed from, uint256 amountIn, uint256 amountOut);

    bytes32 public merkleRoot;

    constructor(
        bytes32 root, 
        uint256 _rageQuitEnd,
        address tribeRariDAO
    ) MergerBase(tribeRariDAO) {
        merkleRoot = root;

        rageQuitEnd = _rageQuitEnd;
    }

    /// @notice ragequit held TRIBE with FEI
    /// @dev not gonna make it
    /// @param amount the amount to redeem in TRIBE
    /// @param key the amount of TRIBE allocated to the caller in the merkle drop
    /// @param merkleProof a proof proving that the caller may redeem up to `key` amount of tribe
    function ngmi(
        uint256 amount,
        uint256 key,
        bytes32[] calldata merkleProof
    ) external {
        require(isEnabled, "Proposals are not both passed");
        require(block.timestamp < rageQuitEnd, "outside ragequit window");
        require(
            verifyClaim(msg.sender, key, merkleProof),
            "invalid proof"
        );
        require(
            (claimed[msg.sender] + amount) <= key,
            "exceeds ragequit limit"
        );
        claimed[msg.sender] = claimed[msg.sender] + amount;
        uint256 tribeTokenTakenTotal = amount;
        uint256 token1GivenTotal = amount * intrinsicValueExchangeRateBase / scalar;
        tribe.safeTransferFrom(msg.sender, coreAddress, tribeTokenTakenTotal);
        fei.mint(msg.sender, token1GivenTotal);
        emit Exchange(msg.sender, tribeTokenTakenTotal, token1GivenTotal);
    }

    function getCirculatingTribe() public view returns (uint256) {
        return tribe.totalSupply() - tribe.balanceOf(coreAddress) - tribe.balanceOf(rewardsDripper);
    }
    
    /// @notice recalculate the exchange amount using the protocolEquity
    /// @param protocolEquity the protocol equity
    /// @return the new intrinsicValueExchangeRateBase
    function exchangeRate(uint256 protocolEquity) public view returns (uint256) {
        return (scalar * uint256(protocolEquity)) / getCirculatingTribe();
    }

    /// @notice Update the exchange rate based on protocol equity
    /// @param protocolEquity the protocol equity
    /// @return the new exchange rate
    /// @dev only callable once by guardian
    function setExchangeRate(uint256 protocolEquity) external returns (uint256) {
        require(intrinsicValueExchangeRateBase == 0, "already set");
        require(msg.sender == guardian, "guardian");
        intrinsicValueExchangeRateBase = exchangeRate(protocolEquity);
        return intrinsicValueExchangeRateBase;
    }

    /// @notice validate the proof of a merkle drop claim
    /// @param claimer the address attempting to claim
    /// @param key the amount of scaled TRIBE allocated the claimer claims that they have credit over
    /// @param merkleProof a proof proving that claimer may redeem up to `key` amount of tribe
    /// @return boolean true if the proof is valid, false if the proof is invalid
    function verifyClaim(
        address claimer,
        uint256 key,
        bytes32[] memory merkleProof
    ) private view returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(claimer, key));
        return MerkleProof.verify(merkleProof, merkleRoot, leaf);
    }
}
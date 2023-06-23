// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

/**
 * @title LOTTY Staking Contract
 * @author @Xirynx
 */
contract LottyStaking is Ownable {
    //============================================//
    //                Definitions                 //
    //============================================//

    struct StakePosition {
        address owner;
        uint256 timestamp;
        uint256 liquidity;
        uint256 timeLocked;
    }

    //============================================//
    //                  Errors                    //
    //============================================//

    error BalanceTransferFailed();
    error CallerNotOrigin();
    error CallerDoesNotOwnPosition();
    error PositionLocked();

    //============================================//
    //                  Events                    //
    //============================================//

    event Stake(
        address indexed owner,
        uint256 indexed positionNonce,
        uint256 timestamp,
        uint256 liquidity
    );
    event Unstake(
        address indexed owner,
        uint256 indexed positionNonce,
        uint256 timestamp,
        uint256 liquidity
    );

    //============================================//
    //                 Constants                  //
    //============================================//

    IUniswapV2Pair constant uniswapV2Pair =
        IUniswapV2Pair(0x1840c51B131a51bb66F3019CC7B2d54e6d686E10);
    IUniswapV2Router02 constant uniswapV2Router =
        IUniswapV2Router02(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
    IERC20 constant lotty = IERC20(0xB459F7204A8Ac84F9e7758d6d839eBD01670E35C);

    //============================================//
    //              State Variables               //
    //============================================//

    uint256 public totalLiquidity;
    uint256 public stakeNonce;
    mapping(uint256 => StakePosition) public positions;

    //============================================//
    //                 Read Only                  //
    //============================================//

    /**
     * @notice Returns staking position indexed at `_nonce`
     * @param _nonce: Index of the staking position being queried.
     */
    function checkPosition(
        uint256 _nonce
    ) public view returns (StakePosition memory _position) {
        _position = positions[_nonce];
    }

    //============================================//
    //                Core Methods                //
    //============================================//

    /**
     * @notice Stakes Lotty and ETH and locks liquidity for duration of _timeLocked
     * @dev Caller must be not be contract
     * @dev Caller must have approved at least `_amountLottyDesired` tokens before staking
     * @param _amountLottyDesired: Ideal amount of Lotty tokens to stake
     * @param _amountLottyMin: Bounds the extent to which the ETH/Lotty price can go up before the transaction reverts. Must be <= _amountLottyDesired
     * @param _amountETHMin: Bounds the extent to which the Lotty/ETH price can go up before the transaction reverts. Must be <= `msg.value`
     * @param _deadline: Unix timestamp after which the transaction will revert
     * @param _timeLocked: Duration (seconds) for which the position will be unstakeable
     */
    function stake(
        uint256 _amountLottyDesired,
        uint256 _amountLottyMin,
        uint256 _amountETHMin,
        uint256 _deadline,
        uint256 _timeLocked
    ) public payable {
        if (msg.sender != tx.origin) revert CallerNotOrigin();

        lotty.transferFrom(msg.sender, address(this), _amountLottyDesired);
        lotty.approve(address(uniswapV2Router), _amountLottyDesired);
        stakeNonce += 1;

        (, , uint256 liquidity) = uniswapV2Router.addLiquidityETH{
            value: msg.value
        }(
            address(lotty),
            _amountLottyDesired,
            _amountLottyMin,
            _amountETHMin,
            address(this),
            _deadline
        );

        totalLiquidity += liquidity;
        positions[stakeNonce] = StakePosition(
            msg.sender,
            block.timestamp,
            liquidity,
            _timeLocked
        );

        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool callSuccess, ) = payable(msg.sender).call{value: balance}("");
            if (!callSuccess) revert BalanceTransferFailed();
        }

        uint256 lottyBalance = lotty.balanceOf(address(this));
        if (lottyBalance > 0) {
            lotty.transfer(msg.sender, lottyBalance);
        }

        emit Stake(msg.sender, stakeNonce, block.timestamp, liquidity);
    }

    /**
     * @notice Burns the position's liquidity tokens and returns the equivalent Lotty and ETH back to the staker
     * @dev Caller must own the position
     * @dev `block.timestamp` must be greater than the position's unlock time
     * @param _positionNonce: Nonce by which to identify the position for unstaking
     * @param _amountLottyMin: The minimum amount of Lotty that must be received for the transaction not to revert
     * @param _amountETHMin: The minimum amount of ETH that must be received for the transaction not to revert.
     * @param _deadline: Unix timestamp after which the transaction will revert
     */
    function unstake(
        uint256 _positionNonce,
        uint256 _amountLottyMin,
        uint256 _amountETHMin,
        uint256 _deadline
    ) public {
        StakePosition memory position = positions[_positionNonce];
        if (position.owner != msg.sender) revert CallerDoesNotOwnPosition();
        if (block.timestamp - position.timestamp < position.timeLocked)
            revert PositionLocked();

        totalLiquidity -= position.liquidity;
        positions[_positionNonce].owner = address(0);

        uniswapV2Pair.approve(address(uniswapV2Router), position.liquidity);

        uniswapV2Router.removeLiquidityETH(
            address(lotty),
            position.liquidity,
            _amountLottyMin,
            _amountETHMin,
            address(this),
            _deadline
        );

        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool callSuccess, ) = payable(msg.sender).call{value: balance}("");
            if (!callSuccess) revert BalanceTransferFailed();
        }

        uint256 lottyBalance = lotty.balanceOf(address(this));
        if (lottyBalance > 0) {
            lotty.transfer(msg.sender, lottyBalance);
        }

        emit Unstake(
            msg.sender,
            _positionNonce,
            block.timestamp,
            position.liquidity
        );
    }

    receive() external payable {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Paymaster
 * @dev Contract for handling gas fee payments in ERC20 tokens
 */
contract Paymaster is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable entryPoint;
    mapping(address => bool) public supportedTokens;
    mapping(address => uint256) public tokenExchangeRate; // Token to ETH rate with 18 decimals
    mapping(address => uint256) public userDeposits;
    mapping(address => mapping(address => uint256)) public userTokenBalances;

    uint256 public constant RATE_DENOMINATOR = 1e18;
    uint256 public minDepositAmount;

    event TokenAdded(address indexed token, uint256 exchangeRate);
    event TokenRemoved(address indexed token);
    event ExchangeRateUpdated(address indexed token, uint256 newRate);
    event UserDepositUpdated(address indexed user, uint256 newBalance);
    event TokensDeposited(address indexed user, address indexed token, uint256 amount);
    event TokensWithdrawn(address indexed user, address indexed token, uint256 amount);

    constructor(address _entryPoint, uint256 _minDepositAmount) {
        require(_entryPoint != address(0), "Invalid entry point");
        require(_minDepositAmount > 0, "Invalid min deposit");
        entryPoint = _entryPoint;
        minDepositAmount = _minDepositAmount;
    }

    /**
     * @dev Add support for a new token
     */
    function addSupportedToken(address token, uint256 exchangeRate) external onlyOwner {
        require(token != address(0), "Invalid token");
        require(exchangeRate > 0, "Invalid exchange rate");
        require(!supportedTokens[token], "Token already supported");

        supportedTokens[token] = true;
        tokenExchangeRate[token] = exchangeRate;
        emit TokenAdded(token, exchangeRate);
    }

    /**
     * @dev Remove support for a token
     */
    function removeSupportedToken(address token) external onlyOwner {
        require(supportedTokens[token], "Token not supported");
        supportedTokens[token] = false;
        delete tokenExchangeRate[token];
        emit TokenRemoved(token);
    }

    /**
     * @dev Update the exchange rate for a supported token
     */
    function updateExchangeRate(address token, uint256 newRate) external onlyOwner {
        require(supportedTokens[token], "Token not supported");
        require(newRate > 0, "Invalid exchange rate");
        tokenExchangeRate[token] = newRate;
        emit ExchangeRateUpdated(token, newRate);
    }

    /**
     * @dev Deposit tokens to cover gas fees
     */
    function depositTokens(address token, uint256 amount) external nonReentrant {
        require(supportedTokens[token], "Token not supported");
        require(amount >= minDepositAmount, "Amount below minimum");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        userTokenBalances[msg.sender][token] += amount;
        
        uint256 ethValue = (amount * tokenExchangeRate[token]) / RATE_DENOMINATOR;
        userDeposits[msg.sender] += ethValue;
        
        emit TokensDeposited(msg.sender, token, amount);
        emit UserDepositUpdated(msg.sender, userDeposits[msg.sender]);
    }

    /**
     * @dev Withdraw deposited tokens
     */
    function withdrawTokens(address token, uint256 amount) external nonReentrant {
        require(supportedTokens[token], "Token not supported");
        require(userTokenBalances[msg.sender][token] >= amount, "Insufficient balance");

        uint256 ethValue = (amount * tokenExchangeRate[token]) / RATE_DENOMINATOR;
        require(userDeposits[msg.sender] >= ethValue, "Insufficient deposit");

        userTokenBalances[msg.sender][token] -= amount;
        userDeposits[msg.sender] -= ethValue;
        
        IERC20(token).safeTransfer(msg.sender, amount);
        
        emit TokensWithdrawn(msg.sender, token, amount);
        emit UserDepositUpdated(msg.sender, userDeposits[msg.sender]);
    }

    /**
     * @dev Validate a paymaster user operation
     */
    function validatePaymasterUserOp(
        address sender,
        uint256 requiredPreFund
    ) external view returns (bytes memory context) {
        require(msg.sender == entryPoint, "Only entry point");
        require(userDeposits[sender] >= requiredPreFund, "Insufficient deposit");
        
        return abi.encode(sender, requiredPreFund);
    }

    /**
     * @dev Post-operation processing
     */
    function postOp(
        bytes calldata context,
        uint256 actualGasCost
    ) external {
        require(msg.sender == entryPoint, "Only entry point");
        
        (address sender, uint256 requiredPreFund) = abi.decode(context, (address, uint256));
        uint256 actualCost = actualGasCost > requiredPreFund ? actualGasCost : requiredPreFund;
        
        userDeposits[sender] -= actualCost;
        emit UserDepositUpdated(sender, userDeposits[sender]);
    }

    /**
     * @dev Get user's deposit balance
     */
    function getDepositBalance(address user) external view returns (uint256) {
        return userDeposits[user];
    }

    /**
     * @dev Get user's token balance
     */
    function getTokenBalance(address user, address token) external view returns (uint256) {
        return userTokenBalances[user][token];
    }

    /**
     * @dev Update minimum deposit amount
     */
    function setMinDepositAmount(uint256 newAmount) external onlyOwner {
        require(newAmount > 0, "Invalid amount");
        minDepositAmount = newAmount;
    }

    /**
     * @dev Withdraw tokens in case of emergency (only owner)
     */
    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @dev Withdraw ETH in case of emergency (only owner)
     */
    function emergencyWithdrawETH(
        address payable to,
        uint256 amount
    ) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        (bool success,) = to.call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    receive() external payable {}
} 
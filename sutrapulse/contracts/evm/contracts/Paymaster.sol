// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title Paymaster
 * @dev Contract for sponsoring gas fees in Account Abstraction
 */
contract Paymaster is Ownable, ReentrancyGuard {
    address public immutable entryPoint;
    uint256 public immutable minDepositAmount;
    
    mapping(address => uint256) public deposits;
    mapping(address => bool) public whitelistedWallets;

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event WalletWhitelisted(address indexed wallet, bool status);

    constructor(address _entryPoint, uint256 _minDepositAmount) {
        require(_entryPoint != address(0), "Invalid EntryPoint");
        require(_minDepositAmount > 0, "Invalid minimum deposit");
        entryPoint = _entryPoint;
        minDepositAmount = _minDepositAmount;
        _transferOwnership(msg.sender);
    }

    /**
     * @dev Deposit funds to sponsor gas fees
     */
    function deposit() external payable {
        require(msg.value >= minDepositAmount, "Deposit too small");
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @dev Withdraw deposited funds
     */
    function withdraw(uint256 amount) external nonReentrant {
        require(deposits[msg.sender] >= amount, "Insufficient deposit");
        deposits[msg.sender] -= amount;
        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Withdrawal failed");
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @dev Whitelist a wallet for gas sponsorship
     */
    function setWalletWhitelisted(address wallet, bool status) external onlyOwner {
        require(wallet != address(0), "Invalid wallet");
        whitelistedWallets[wallet] = status;
        emit WalletWhitelisted(wallet, status);
    }

    /**
     * @dev Validate a user operation for gas sponsorship
     */
    function validatePaymasterUserOp(address sender, uint256 requiredPreFund) external view returns (bool) {
        require(msg.sender == entryPoint, "Only EntryPoint can validate");
        require(whitelistedWallets[sender], "Wallet not whitelisted");
        return deposits[owner()] >= requiredPreFund;
    }

    /**
     * @dev Forward deposit to EntryPoint
     */
    function addDepositToEntryPoint() external payable onlyOwner {
        (bool success,) = entryPoint.call{value: msg.value}("");
        require(success, "Failed to deposit to EntryPoint");
    }

    receive() external payable {
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }
} 
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title SmartWallet
 * @dev Implementation of a smart contract wallet with account abstraction support
 */
contract SmartWallet is Initializable, ReentrancyGuard {
    using ECDSA for bytes32;
    using Address for address;

    address public owner;
    address public entryPoint;
    uint256 private nonce;
    mapping(address => bool) public authorizedSigners;
    mapping(bytes4 => bool) public whitelistedFunctions;

    event WalletInitialized(address indexed owner, address indexed entryPoint);
    event SignerAuthorized(address indexed signer, bool status);
    event FunctionWhitelisted(bytes4 indexed selector, bool status);
    event TransactionExecuted(address indexed target, uint256 value, bytes data);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyEntryPointOrOwner() {
        require(msg.sender == entryPoint || msg.sender == owner, "Only EntryPoint or owner");
        _;
    }

    /**
     * @dev Initialize the wallet with an owner and entry point
     */
    function initialize(address _owner, address _entryPoint) public initializer {
        require(_owner != address(0), "Invalid owner");
        require(_entryPoint != address(0), "Invalid entry point");
        owner = _owner;
        entryPoint = _entryPoint;
        authorizedSigners[_owner] = true;
        emit WalletInitialized(_owner, _entryPoint);
    }

    /**
     * @dev Execute a transaction through the entry point
     */
    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyEntryPointOrOwner nonReentrant returns (bool success) {
        require(target != address(0), "Invalid target");
        
        if (data.length > 0) {
            bytes4 selector;
            assembly {
                selector := calldataload(data.offset)
            }
            require(whitelistedFunctions[selector], "Function not whitelisted");
        }

        nonce++;
        (success,) = target.call{value: value}(data);
        require(success, "Transaction failed");
        emit TransactionExecuted(target, value, data);
    }

    /**
     * @dev Validate a signature for account abstraction
     */
    function isValidSignature(bytes32 hash, bytes memory signature) public view returns (bool) {
        address signer = hash.recover(signature);
        return authorizedSigners[signer];
    }

    /**
     * @dev Check if a signer is authorized
     */
    function isValidSigner(address signer) external view returns (bool) {
        return authorizedSigners[signer];
    }

    /**
     * @dev Add or remove an authorized signer
     */
    function setAuthorizedSigner(address signer, bool status) external onlyOwner {
        require(signer != address(0), "Invalid signer");
        authorizedSigners[signer] = status;
        emit SignerAuthorized(signer, status);
    }

    /**
     * @dev Whitelist or blacklist a function selector
     */
    function setWhitelistedFunction(bytes4 selector, bool status) external onlyOwner {
        whitelistedFunctions[selector] = status;
        emit FunctionWhitelisted(selector, status);
    }

    /**
     * @dev Get the current nonce
     */
    function getNonce() external view returns (uint256) {
        return nonce;
    }

    /**
     * @dev Change the owner of the wallet
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid new owner");
        owner = newOwner;
        authorizedSigners[newOwner] = true;
    }

    /**
     * @dev Deposit funds into the wallet
     */
    receive() external payable {}

    /**
     * @dev Withdraw funds from the wallet
     */
    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        require(address(this).balance >= amount, "Insufficient balance");
        (bool success,) = to.call{value: amount}("");
        require(success, "Withdrawal failed");
    }

    /**
     * @dev Get the wallet's balance
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @dev Batch execute multiple transactions
     */
    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external onlyEntryPointOrOwner nonReentrant returns (bool[] memory successes) {
        require(targets.length == values.length && values.length == datas.length, "Array lengths mismatch");
        
        successes = new bool[](targets.length);
        for (uint256 i = 0; i < targets.length; i++) {
            require(targets[i] != address(0), "Invalid target");
            
            if (datas[i].length > 0) {
                bytes4 selector;
                assembly {
                    let data := calldataload(add(datas.offset, mul(i, 0x20)))
                    let ptr := add(data, 32)
                    selector := calldataload(ptr)
                }
                require(whitelistedFunctions[selector], "Function not whitelisted");
            }

            nonce++;
            (successes[i],) = targets[i].call{value: values[i]}(datas[i]);
            emit TransactionExecuted(targets[i], values[i], datas[i]);
        }
    }
} 
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title EntryPoint
 * @dev Main entry point for Account Abstraction. Handles user operations and manages gas refunds.
 */
contract EntryPoint is ReentrancyGuard {
    using ECDSA for bytes32;
    using Address for address;

    // Gas calculations and limits
    uint256 constant public REFUND_POSTOP_COST = 15000;
    uint256 constant public SIG_VALIDATION_FAILED = 1;
    
    // Mapping of account balances for gas payments
    mapping(address => uint256) public deposits;
    mapping(address => uint256) public balances;

    struct UserOperation {
        address sender;              // The wallet contract address
        uint256 nonce;              // Anti-replay protection
        bytes initCode;             // If set, create new wallet
        bytes callData;             // The method call to execute on sender
        uint256 callGasLimit;       // Gas limit for the method call
        uint256 verificationGasLimit; // Gas for verification steps
        uint256 preVerificationGas;   // Gas paid for pre-verification
        uint256 maxFeePerGas;        // Max gas fee (similar to EIP-1559)
        uint256 maxPriorityFeePerGas; // Max priority fee (similar to EIP-1559)
        bytes paymasterAndData;       // Paymaster address and data
        bytes signature;              // Wallet signature
    }

    struct UserOpInfo {
        uint256 prefund;
        bool paymaster;
        bytes context;
        uint256 preOpGas;
    }

    event UserOperationEvent(
        bytes32 indexed userOpHash,
        address indexed sender,
        address indexed paymaster,
        uint256 nonce,
        bool success,
        uint256 actualGasCost,
        uint256 actualGas
    );

    event Deposited(
        address indexed account,
        uint256 totalDeposit
    );

    event Withdrawn(
        address indexed account,
        address indexed withdrawAddress,
        uint256 amount
    );

    /**
     * @dev Main function to handle user operations
     * @param ops Array of user operations to process
     * @param beneficiary Address to receive gas refunds
     */
    function handleOps(UserOperation[] calldata ops, address payable beneficiary) external nonReentrant {
        uint256 opslen = ops.length;
        UserOpInfo[] memory opInfos = new UserOpInfo[](opslen);

        // Validation phase
        for (uint256 i = 0; i < opslen; i++) {
            UserOpInfo memory opInfo = opInfos[i];
            (bytes32 userOpHash, uint256 prefund) = _validatePrepayment(i, ops[i], opInfo);
            opInfo.prefund = prefund;
            _validateAccountAndPaymasterValidationData(userOpHash, ops[i], opInfo);
        }

        // Execution phase
        uint256 collected = 0;
        for (uint256 i = 0; i < opslen; i++) {
            collected += _executeUserOp(i, ops[i], opInfos[i]);
        }

        // Pay the beneficiary
        if (beneficiary != address(0) && collected > 0) {
            (bool success,) = beneficiary.call{value: collected}("");
            require(success, "Failed to pay beneficiary");
        }
    }

    /**
     * @dev Validate and prepare the user operation for execution
     */
    function _validatePrepayment(
        uint256 opIndex,
        UserOperation calldata userOp,
        UserOpInfo memory outOpInfo
    ) private returns (bytes32 userOpHash, uint256 prefund) {
        userOpHash = getUserOpHash(userOp);
        
        // Validate signature
        bytes32 hash = userOpHash.toEthSignedMessageHash();
        address recovered = hash.recover(userOp.signature);
        require(recovered == userOp.sender || _isValidSigner(userOp.sender, recovered), "Invalid signature");

        // Calculate required prefund
        uint256 maxGasPrice = userOp.maxFeePerGas;
        uint256 maxGasCost = userOp.callGasLimit + userOp.verificationGasLimit + userOp.preVerificationGas;
        prefund = maxGasCost * maxGasPrice;

        // Verify sufficient balance
        require(deposits[userOp.sender] >= prefund, "Insufficient balance for gas");
        
        return (userOpHash, prefund);
    }

    /**
     * @dev Execute a validated user operation
     */
    function _executeUserOp(
        uint256 opIndex,
        UserOperation calldata op,
        UserOpInfo memory opInfo
    ) private returns (uint256 actualGasCost) {
        uint256 preGas = gasleft();
        bytes memory context = opInfo.context;
        uint256 gasPrice = tx.gasprice;

        try this.innerHandleOp(op.callData, op.sender) returns (bool success) {
            uint256 actualGas = preGas - gasleft() + opInfo.preOpGas;
            actualGasCost = actualGas * gasPrice;
            
            // Handle gas refund
            if (opInfo.paymaster) {
                deposits[address(bytes20(op.paymasterAndData[0:20]))] -= actualGasCost;
            } else {
                deposits[op.sender] -= actualGasCost;
            }

            emit UserOperationEvent(
                getUserOpHash(op),
                op.sender,
                opInfo.paymaster ? address(bytes20(op.paymasterAndData[0:20])) : address(0),
                op.nonce,
                success,
                actualGasCost,
                actualGas
            );
        } catch {
            uint256 actualGas = preGas - gasleft() + opInfo.preOpGas;
            actualGasCost = actualGas * gasPrice;
            emit UserOperationEvent(
                getUserOpHash(op),
                op.sender,
                opInfo.paymaster ? address(bytes20(op.paymasterAndData[0:20])) : address(0),
                op.nonce,
                false,
                actualGasCost,
                actualGas
            );
        }
    }

    /**
     * @dev Inner function to handle the actual operation execution
     */
    function innerHandleOp(bytes calldata callData, address sender) external returns (bool success) {
        require(msg.sender == address(this), "Only EntryPoint can call");
        (success,) = sender.call(callData);
    }

    /**
     * @dev Calculate the user operation hash for signature verification
     */
    function getUserOpHash(UserOperation calldata userOp) public view returns (bytes32) {
        return keccak256(abi.encode(
            userOp.sender,
            userOp.nonce,
            keccak256(userOp.initCode),
            keccak256(userOp.callData),
            userOp.callGasLimit,
            userOp.verificationGasLimit,
            userOp.preVerificationGas,
            userOp.maxFeePerGas,
            userOp.maxPriorityFeePerGas,
            keccak256(userOp.paymasterAndData),
            block.chainid
        ));
    }

    /**
     * @dev Verify if a signer is valid for a given wallet
     */
    function _isValidSigner(address wallet, address signer) internal view returns (bool) {
        try IWallet(wallet).isValidSigner(signer) returns (bool valid) {
            return valid;
        } catch {
            return false;
        }
    }

    /**
     * @dev Validate account and paymaster validation data
     */
    function _validateAccountAndPaymasterValidationData(
        bytes32 userOpHash,
        UserOperation calldata op,
        UserOpInfo memory opInfo
    ) private {
        // Validate wallet
        if (op.initCode.length == 0) {
            require(op.sender.code.length > 0, "Account not deployed");
        }

        // Validate paymaster if present
        if (op.paymasterAndData.length >= 20) {
            address paymaster = address(bytes20(op.paymasterAndData[0:20]));
            require(paymaster.code.length > 0, "Invalid paymaster");
            opInfo.paymaster = true;
        }
    }

    /**
     * @dev Deposit funds for gas payments
     */
    function depositTo(address account) external payable {
        deposits[account] += msg.value;
        emit Deposited(account, deposits[account]);
    }

    /**
     * @dev Withdraw deposited funds
     */
    function withdrawTo(address payable withdrawAddress, uint256 amount) external nonReentrant {
        require(deposits[msg.sender] >= amount, "Insufficient deposit");
        deposits[msg.sender] -= amount;
        (bool success,) = withdrawAddress.call{value: amount}("");
        require(success, "Withdrawal failed");
        emit Withdrawn(msg.sender, withdrawAddress, amount);
    }

    receive() external payable {
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, deposits[msg.sender]);
    }
}

interface IWallet {
    function isValidSigner(address signer) external view returns (bool);
} 
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/Create2.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./SmartWallet.sol";

/**
 * @title SmartWalletFactory
 * @dev Factory contract for deploying new SmartWallet instances using CREATE2
 */
contract SmartWalletFactory {
    SmartWallet public immutable walletImplementation;
    
    event WalletCreated(address indexed wallet, address indexed owner, address indexed entryPoint);
    
    constructor() {
        walletImplementation = new SmartWallet();
    }
    
    /**
     * @dev Create a new wallet instance
     * @param owner The owner of the new wallet
     * @param entryPoint The entry point contract address
     * @param salt Additional salt for CREATE2
     * @return wallet The address of the newly created wallet
     */
    function createWallet(
        address owner,
        address entryPoint,
        bytes32 salt
    ) external returns (address wallet) {
        require(owner != address(0), "Invalid owner");
        require(entryPoint != address(0), "Invalid entry point");

        bytes memory initData = abi.encodeWithSelector(
            SmartWallet.initialize.selector,
            owner,
            entryPoint
        );

        bytes memory deploymentData = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(address(walletImplementation), initData)
        );

        wallet = Create2.deploy(0, salt, deploymentData);
        emit WalletCreated(wallet, owner, entryPoint);
    }

    /**
     * @dev Calculate the counterfactual address of a wallet before it is deployed
     */
    function getWalletAddress(
        address owner,
        address entryPoint,
        bytes32 salt
    ) public view returns (address) {
        bytes memory initData = abi.encodeWithSelector(
            SmartWallet.initialize.selector,
            owner,
            entryPoint
        );

        bytes memory deploymentData = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(address(walletImplementation), initData)
        );

        return Create2.computeAddress(
            salt,
            keccak256(deploymentData)
        );
    }

    /**
     * @dev Create multiple wallet instances in a single transaction
     */
    function createWalletBatch(
        address[] calldata owners,
        address entryPoint,
        bytes32[] calldata salts
    ) external returns (address[] memory wallets) {
        require(owners.length == salts.length, "Array lengths mismatch");
        require(entryPoint != address(0), "Invalid entry point");

        wallets = new address[](owners.length);
        for (uint256 i = 0; i < owners.length; i++) {
            require(owners[i] != address(0), "Invalid owner");

            bytes memory initData = abi.encodeWithSelector(
                SmartWallet.initialize.selector,
                owners[i],
                entryPoint
            );

            bytes memory deploymentData = abi.encodePacked(
                type(ERC1967Proxy).creationCode,
                abi.encode(address(walletImplementation), initData)
            );

            wallets[i] = Create2.deploy(0, salts[i], deploymentData);
            emit WalletCreated(wallets[i], owners[i], entryPoint);
        }
    }

    /**
     * @dev Check if a wallet has been deployed at a specific address
     */
    function isWalletDeployed(address wallet) external view returns (bool) {
        return wallet.code.length > 0;
    }
} 
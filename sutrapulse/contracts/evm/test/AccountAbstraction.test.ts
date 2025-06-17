import { expect } from "chai";
import { ethers } from "hardhat";
import { BaseContract } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther, parseUnits } from "ethers";
import { randomBytes } from "crypto";

describe("Account Abstraction Tests", function () {
  let entryPoint: BaseContract;
  let smartWallet: BaseContract;
  let walletFactory: BaseContract;
  let paymaster: BaseContract;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let ownerAddress: string;
  let userAddress: string;

  const minDepositAmount = parseEther("0.01");

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    userAddress = await user.getAddress();

    // Deploy EntryPoint
    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    entryPoint = await EntryPoint.deploy();
    await entryPoint.waitForDeployment();

    // Deploy Paymaster
    const Paymaster = await ethers.getContractFactory("Paymaster");
    paymaster = await Paymaster.deploy(await entryPoint.getAddress(), minDepositAmount);
    await paymaster.waitForDeployment();

    // Deploy WalletFactory
    const WalletFactory = await ethers.getContractFactory("SmartWalletFactory");
    walletFactory = await WalletFactory.deploy();
    await walletFactory.waitForDeployment();

    // Create a new wallet instance
    const tx = await walletFactory.createWallet(
      ownerAddress,
      await entryPoint.getAddress(),
      randomBytes(32)
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find(
      (e: any) => e.eventName === "WalletCreated"
    );
    const walletAddress = event?.args[0];

    // Get wallet instance
    const SmartWallet = await ethers.getContractFactory("SmartWallet");
    smartWallet = SmartWallet.attach(walletAddress);
  });

  describe("SmartWallet", function () {
    it("Should initialize with correct owner and entry point", async function () {
      expect(await smartWallet.owner()).to.equal(ownerAddress);
      expect(await smartWallet.entryPoint()).to.equal(await entryPoint.getAddress());
    });

    it("Should allow owner to execute transactions", async function () {
      const amount = parseEther("1.0");
      await owner.sendTransaction({
        to: await smartWallet.getAddress(),
        value: amount,
      });

      const balanceBefore = await ethers.provider.getBalance(userAddress);
      await smartWallet.execute(userAddress, amount, "0x");
      const balanceAfter = await ethers.provider.getBalance(userAddress);

      expect(balanceAfter - balanceBefore).to.equal(amount);
    });
  });

  describe("Paymaster", function () {
    it("Should accept deposits and track balances", async function () {
      const depositAmount = parseEther("0.1");
      await owner.sendTransaction({
        to: await entryPoint.getAddress(),
        value: depositAmount,
      });

      expect(await entryPoint.deposits(ownerAddress)).to.equal(depositAmount);
    });

    it("Should validate user operations with sufficient balance", async function () {
      const depositAmount = parseEther("0.1");
      await owner.sendTransaction({
        to: await entryPoint.getAddress(),
        value: depositAmount,
      });

      const requiredPrefund = parseEther("0.05");
      await expect(
        paymaster.validatePaymasterUserOp(ownerAddress, requiredPrefund)
      ).to.not.be.revertedWith("Insufficient deposit");
    });
  });

  describe("EntryPoint", function () {
    it("Should handle user operations", async function () {
      // Fund the wallet
      const amount = parseEther("1.0");
      await owner.sendTransaction({
        to: await smartWallet.getAddress(),
        value: amount,
      });

      // Create user operation
      const userOp = {
        sender: await smartWallet.getAddress(),
        nonce: 0,
        initCode: "0x",
        callData: smartWallet.interface.encodeFunctionData("execute", [
          userAddress,
          parseEther("0.1"),
          "0x",
        ]),
        callGasLimit: 500000,
        verificationGasLimit: 500000,
        preVerificationGas: 50000,
        maxFeePerGas: parseUnits("100", "gwei"),
        maxPriorityFeePerGas: parseUnits("5", "gwei"),
        paymasterAndData: "0x",
        signature: "0x",
      };

      // Fund entry point for gas
      await owner.sendTransaction({
        to: await entryPoint.getAddress(),
        value: parseEther("1.0"),
      });

      // Sign the user operation
      const userOpHash = await entryPoint.getUserOpHash(userOp);
      const signature = await owner.signMessage(Buffer.from(userOpHash.slice(2), "hex"));
      userOp.signature = signature;

      // Execute the user operation
      await expect(
        entryPoint.handleOps([userOp], ownerAddress)
      ).to.not.be.revertedWith("Invalid user operation");
    });
  });
}); 
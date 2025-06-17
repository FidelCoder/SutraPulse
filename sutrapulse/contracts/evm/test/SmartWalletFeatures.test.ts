import { expect } from "chai";
import { ethers } from "hardhat";
import { BaseContract, parseEther } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { randomBytes } from "crypto";

describe("Smart Wallet Advanced Features", function () {
  let entryPoint: BaseContract;
  let smartWallet: BaseContract;
  let walletFactory: BaseContract;
  let paymaster: BaseContract;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let guardian1: HardhatEthersSigner;
  let guardian2: HardhatEthersSigner;
  let beneficiary: HardhatEthersSigner;

  const minDepositAmount = parseEther("0.01");

  beforeEach(async function () {
    [owner, user, guardian1, guardian2, beneficiary] = await ethers.getSigners();

    // Deploy EntryPoint
    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    entryPoint = await EntryPoint.deploy();
    await entryPoint.waitForDeployment();

    // Deploy Paymaster
    const Paymaster = await ethers.getContractFactory("Paymaster");
    paymaster = await Paymaster.deploy(await entryPoint.getAddress(), minDepositAmount);
    await paymaster.waitForDeployment();

    // Fund EntryPoint for paymaster
    await entryPoint.depositTo(await paymaster.getAddress(), { value: parseEther("5.0") });

    // Deploy WalletFactory
    const WalletFactory = await ethers.getContractFactory("SmartWalletFactory");
    walletFactory = await WalletFactory.deploy();
    await walletFactory.waitForDeployment();

    // Create a new wallet instance
    const salt = randomBytes(32);
    const tx = await walletFactory.createWallet(
      await owner.getAddress(),
      await entryPoint.getAddress(),
      salt
    );
    const receipt = await tx.wait();
    const event = receipt?.logs.find(
      (e: any) => e.eventName === "WalletCreated"
    );
    const walletAddress = event?.args[0];

    // Get wallet instance
    const SmartWallet = await ethers.getContractFactory("SmartWallet");
    smartWallet = SmartWallet.attach(walletAddress);

    // Fund the wallet
    await owner.sendTransaction({
      to: await smartWallet.getAddress(),
      value: parseEther("2.0"),
    });

    // Whitelist the wallet in Paymaster
    await paymaster.setWalletWhitelisted(await smartWallet.getAddress(), true);

    // Whitelist execute and executeBatch functions by default
    const executeSelector = smartWallet.interface.getFunction("execute")?.selector;
    const executeBatchSelector = smartWallet.interface.getFunction("executeBatch")?.selector;
    if (executeSelector) {
      await smartWallet.setWhitelistedFunction(executeSelector, true);
    }
    if (executeBatchSelector) {
      await smartWallet.setWhitelistedFunction(executeBatchSelector, true);
    }
  });

  describe("Wallet Creation", function () {
    it("Should deploy wallet with correct initialization", async function () {
      // Verify wallet owner
      expect(await smartWallet.owner()).to.equal(await owner.getAddress());
      
      // Verify EntryPoint
      expect(await smartWallet.entryPoint()).to.equal(await entryPoint.getAddress());
      
      // Verify wallet has funds
      const balance = await ethers.provider.getBalance(await smartWallet.getAddress());
      expect(balance).to.equal(parseEther("2.0"));
    });

    it("Should allow creating multiple wallets for the same owner", async function () {
      const salt = randomBytes(32);
      const tx = await walletFactory.createWallet(
        await owner.getAddress(),
        await entryPoint.getAddress(),
        salt
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (e: any) => e.eventName === "WalletCreated"
      );
      expect(event).to.not.be.undefined;
    });
  });

  describe("Transaction Execution", function () {
    it("Should execute a transaction with gas sponsorship", async function () {
      const amount = parseEther("0.1");
      const recipientBalanceBefore = await ethers.provider.getBalance(await beneficiary.getAddress());

      // Create UserOperation
      const userOp = {
        sender: await smartWallet.getAddress(),
        nonce: 0,
        initCode: "0x",
        callData: smartWallet.interface.encodeFunctionData("execute", [
          await beneficiary.getAddress(),
          amount,
          "0x",
        ]),
        callGasLimit: 500000,
        verificationGasLimit: 500000,
        preVerificationGas: 50000,
        maxFeePerGas: ethers.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("5", "gwei"),
        paymasterAndData: ethers.concat([await paymaster.getAddress(), "0x"]),
        signature: "0x",
      };

      // Sign UserOperation
      const userOpHash = await entryPoint.getUserOpHash(userOp);
      const signature = await owner.signMessage(ethers.getBytes(userOpHash));
      userOp.signature = signature;

      // Execute via EntryPoint
      await entryPoint.handleOps([userOp], await beneficiary.getAddress());

      // Verify transfer (allow for small gas cost variations)
      const recipientBalanceAfter = await ethers.provider.getBalance(await beneficiary.getAddress());
      const balanceDiff = recipientBalanceAfter - recipientBalanceBefore;
      expect(balanceDiff).to.be.closeTo(amount, parseEther("0.001")); // Allow 0.001 ETH variance
    });
  });

  describe("Batch Transactions", function () {
    it("Should execute multiple transactions in a single batch", async function () {
      const amount = parseEther("0.1");
      const recipients = [
        await user.getAddress(),
        await guardian1.getAddress(),
        await guardian2.getAddress(),
      ];
      const amounts = Array(3).fill(amount);
      const datas = Array(3).fill("0x");

      // Get initial balances
      const initialBalances = await Promise.all(
        recipients.map((r) => ethers.provider.getBalance(r))
      );

      // Execute batch transaction
      await smartWallet.executeBatch(recipients, amounts, datas);

      // Verify transfers
      const finalBalances = await Promise.all(
        recipients.map((r) => ethers.provider.getBalance(r))
      );

      for (let i = 0; i < recipients.length; i++) {
        expect(finalBalances[i] - initialBalances[i]).to.equal(amount);
      }
    });
  });

  describe("Function Whitelisting", function () {
    it("Should allow whitelisted functions and reject others", async function () {
      // Create a test function call
      const amount = parseEther("0.1");
      const callData = smartWallet.interface.encodeFunctionData("execute", [
        await user.getAddress(),
        amount,
        "0x",
      ]);
      const selector = callData.slice(0, 10); // First 4 bytes (including 0x)

      // Remove from whitelist first
      await smartWallet.setWhitelistedFunction(selector, false);
      
      // Should revert when not whitelisted
      await expect(
        smartWallet.execute(await user.getAddress(), amount, "0x")
      ).to.be.revertedWith("Function not whitelisted");

      // Add to whitelist
      await smartWallet.setWhitelistedFunction(selector, true);
      
      // Should execute successfully when whitelisted
      await expect(
        smartWallet.execute(await user.getAddress(), amount, "0x")
      ).to.not.be.reverted;
    });
  });
}); 
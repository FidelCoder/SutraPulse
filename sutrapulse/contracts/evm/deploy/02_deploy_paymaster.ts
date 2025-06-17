import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Get the deployed EntryPoint contract
  const entryPoint = await deployments.get("EntryPoint");
  
  // Set minimum deposit amount (0.01 ETH)
  const minDepositAmount = ethers.parseEther("0.01");

  console.log("Deploying Paymaster contract...");
  console.log("Deployer:", deployer);
  console.log("EntryPoint address:", entryPoint.address);
  console.log("Minimum deposit amount:", minDepositAmount.toString());

  const paymaster = await deploy("Paymaster", {
    from: deployer,
    args: [entryPoint.address, minDepositAmount],
    log: true,
    waitConfirmations: 1,
  });

  console.log("Paymaster deployed to:", paymaster.address);

  // Verify on Etherscan if not on a local network
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    try {
      await hre.run("verify:verify", {
        address: paymaster.address,
        constructorArguments: [entryPoint.address, minDepositAmount],
      });
      console.log("Paymaster contract verified on Etherscan");
    } catch (error) {
      console.log("Error verifying contract:", error);
    }
  }
};

func.tags = ["Paymaster", "production", "test"];
func.dependencies = ["EntryPoint"];
export default func; 
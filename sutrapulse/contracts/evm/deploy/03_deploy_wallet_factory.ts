import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log("Deploying SmartWalletFactory contract...");
  console.log("Deployer:", deployer);

  const walletFactory = await deploy("SmartWalletFactory", {
    from: deployer,
    args: [],
    log: true,
    waitConfirmations: 1,
  });

  console.log("SmartWalletFactory deployed to:", walletFactory.address);

  // Verify on Etherscan if not on a local network
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    try {
      await hre.run("verify:verify", {
        address: walletFactory.address,
        constructorArguments: [],
      });
      console.log("SmartWalletFactory contract verified on Etherscan");
    } catch (error) {
      console.log("Error verifying contract:", error);
    }
  }
};

func.tags = ["SmartWalletFactory", "production", "test"];
export default func; 
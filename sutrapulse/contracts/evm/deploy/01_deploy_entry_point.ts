import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const ENTRY_POINT_ADDRESS = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { save } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log("Using official EntryPoint address:", ENTRY_POINT_ADDRESS);

  // Save the EntryPoint address in the deployments
  await save("EntryPoint", {
    address: ENTRY_POINT_ADDRESS,
    abi: [], // We don't need the ABI since we're using the official deployment
  });
};

func.tags = ["EntryPoint", "production", "test"];
export default func; 
use ethers::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use crate::error::{Result, UserOpError};

const ENV_PREFIX: &str = "env";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainConfig {
    pub chain_id: u64,
    pub rpc_url: String,
    pub entry_point_address: String,
    pub wallet_factory_address: String,
    pub paymaster_address: String,
}

#[derive(Debug, Clone)]
pub struct ContractAddresses {
    pub entry_point: Address,
    pub wallet_factory: Address,
    pub paymaster: Address,
}

impl TryFrom<&ChainConfig> for ContractAddresses {
    type Error = UserOpError;

    fn try_from(config: &ChainConfig) -> Result<Self> {
        Ok(Self {
            entry_point: Address::from_str(&config.entry_point_address)
                .map_err(|e| UserOpError::Config(format!("Invalid entry point address: {}", e)))?,
            wallet_factory: Address::from_str(&config.wallet_factory_address)
                .map_err(|e| UserOpError::Config(format!("Invalid wallet factory address: {}", e)))?,
            paymaster: Address::from_str(&config.paymaster_address)
                .map_err(|e| UserOpError::Config(format!("Invalid paymaster address: {}", e)))?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub chains: HashMap<u64, ChainConfig>,
}

impl Config {
    fn get_env_var(section: &str, key: &str) -> Result<String> {
        let var_name = format!("{}.{}§{}", ENV_PREFIX, section, key);
        std::env::var(&var_name)
            .map_err(|_| UserOpError::Config(format!("Environment variable {} not found", var_name)))
    }

    fn get_env_var_optional(section: &str, key: &str, default: &str) -> String {
        let var_name = format!("{}.{}§{}", ENV_PREFIX, section, key);
        std::env::var(&var_name).unwrap_or_else(|_| default.to_string())
    }

    pub fn from_env() -> Result<Self> {
        dotenv::dotenv().ok();

        // Get the entry point address from env
        let entry_point = Self::get_env_var_optional(
            "CONTRACTS",
            "ENTRY_POINT_ADDRESS",
            "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"
        );

        let mut chains = HashMap::new();

        // Ethereum Mainnet (Chain ID: 1)
        if let Ok(eth_rpc) = Self::get_env_var("RPC", "ETH_PROVIDER_URL") {
            chains.insert(1, ChainConfig {
                chain_id: 1,
                rpc_url: eth_rpc,
                entry_point_address: entry_point.clone(),
                wallet_factory_address: Self::get_env_var("CONTRACTS", "ETH_WALLET_FACTORY")?,
                paymaster_address: Self::get_env_var("CONTRACTS", "ETH_PAYMASTER")?,
            });
        }

        // Polygon Mainnet (Chain ID: 137)
        if let Ok(polygon_rpc) = Self::get_env_var("RPC", "POLYGON_PROVIDER_URL") {
            chains.insert(137, ChainConfig {
                chain_id: 137,
                rpc_url: polygon_rpc,
                entry_point_address: entry_point.clone(),
                wallet_factory_address: Self::get_env_var("CONTRACTS", "POLYGON_WALLET_FACTORY")?,
                paymaster_address: Self::get_env_var("CONTRACTS", "POLYGON_PAYMASTER")?,
            });
        }

        // Arbitrum Mainnet (Chain ID: 42161)
        if let Ok(arbitrum_rpc) = Self::get_env_var("RPC", "ARBITRUM_PROVIDER_URL") {
            chains.insert(42161, ChainConfig {
                chain_id: 42161,
                rpc_url: arbitrum_rpc,
                entry_point_address: entry_point.clone(),
                wallet_factory_address: Self::get_env_var("CONTRACTS", "ARBITRUM_WALLET_FACTORY")?,
                paymaster_address: Self::get_env_var("CONTRACTS", "ARBITRUM_PAYMASTER")?,
            });
        }

        if chains.is_empty() {
            return Err(UserOpError::Config("No chain configurations found in environment variables".to_string()));
        }

        Ok(Config { chains })
    }

    pub fn get_chain_config(&self, chain_id: u64) -> Result<&ChainConfig> {
        self.chains
            .get(&chain_id)
            .ok_or_else(|| UserOpError::Config(format!("Chain ID {} not found in config", chain_id)))
    }

    pub fn get_provider(&self, chain_id: u64) -> Result<Provider<Http>> {
        let config = self.get_chain_config(chain_id)?;
        Provider::<Http>::try_from(&config.rpc_url)
            .map_err(|e| UserOpError::Config(format!("Failed to create provider: {}", e)))
    }

    pub fn get_contract_addresses(&self, chain_id: u64) -> Result<ContractAddresses> {
        let config = self.get_chain_config(chain_id)?;
        ContractAddresses::try_from(config)
    }

    pub fn get_signer(&self, chain_id: u64) -> Result<LocalWallet> {
        let private_key = Self::get_env_var("KEYS", "PRIVATE_KEY")?;
        
        let wallet = LocalWallet::from_str(&private_key)
            .map_err(|e| UserOpError::Config(format!("Invalid private key: {}", e)))?;
        
        Ok(wallet.with_chain_id(chain_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_env() {
        std::env::set_var("env.ETH_PROVIDER_URL");
        std::env::set_var("ENTRY_POINT_ADDRESS", "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789");
        std::env::set_var("env.PRIVATE_KEY", "0000000000000000000000000000000000000000000000000000000000000001");
        std::env::set_var("env.ETH_WALLET_FACTORY", "0x1234567890123456789012345678901234567890");
        std::env::set_var("env.ETH_PAYMASTER", "0x1234567890123456789012345678901234567890");
    }

    #[test]
    fn test_config_from_env() {
        setup_test_env();
        let config = Config::from_env();
        assert!(config.is_ok());
        let config = config.unwrap();
        assert!(config.chains.contains_key(&1));
    }

    #[test]
    fn test_get_chain_config() {
        setup_test_env();
        let config = Config::from_env().unwrap();
        let result = config.get_chain_config(1);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().chain_id, 1);
    }

    #[test]
    fn test_get_signer() {
        setup_test_env();
        let config = Config::from_env().unwrap();
        let result = config.get_signer(1);
        assert!(result.is_ok());
    }
} 
use ethers::prelude::*;
use std::sync::Arc;
use crate::error::Result;

pub mod ethereum;
pub mod polygon;
pub mod arbitrum;

#[derive(Debug, Clone)]
pub struct ChainConfig {
    pub chain_id: u64,
    pub entry_point: Address,
    pub provider_url: String,
    pub confirmations: u64,
}

pub trait ChainProvider {
    fn get_provider(&self) -> Arc<Provider<Http>>;
    fn get_chain_id(&self) -> u64;
    fn get_entry_point(&self) -> Address;
    fn get_confirmations(&self) -> u64;
}

pub struct Chain {
    config: ChainConfig,
    provider: Arc<Provider<Http>>,
}

impl Chain {
    pub fn new(config: ChainConfig) -> Result<Self> {
        let provider = Provider::<Http>::try_from(&config.provider_url)
            .map_err(|e| crate::error::UserOpError::ChainConfig(e.to_string()))?;
        
        Ok(Self {
            config,
            provider: Arc::new(provider),
        })
    }
}

impl ChainProvider for Chain {
    fn get_provider(&self) -> Arc<Provider<Http>> {
        self.provider.clone()
    }

    fn get_chain_id(&self) -> u64 {
        self.config.chain_id
    }

    fn get_entry_point(&self) -> Address {
        self.config.entry_point
    }

    fn get_confirmations(&self) -> u64 {
        self.config.confirmations
    }
}

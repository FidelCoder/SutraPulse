use ethers::prelude::*;
use moka::future::Cache;
use std::time::Duration;
use crate::error::{Result, UserOpError};

pub struct GasCache {
    base_fee_cache: Cache<u64, U256>,
    priority_fee_cache: Cache<u64, U256>,
    nonce_cache: Cache<(u64, Address), U256>,
}

impl GasCache {
    pub fn new() -> Self {
        Self {
            base_fee_cache: Cache::builder()
                .time_to_live(Duration::from_secs(12)) // Cache for 12 seconds
                .time_to_idle(Duration::from_secs(24)) // Remove if not accessed for 24 seconds
                .build(),
            priority_fee_cache: Cache::builder()
                .time_to_live(Duration::from_secs(12))
                .time_to_idle(Duration::from_secs(24))
                .build(),
            nonce_cache: Cache::builder()
                .time_to_live(Duration::from_secs(5)) // Shorter TTL for nonces
                .time_to_idle(Duration::from_secs(10))
                .build(),
        }
    }

    pub async fn get_base_fee(&self, chain_id: u64) -> Option<U256> {
        self.base_fee_cache.get(&chain_id)
    }

    pub async fn set_base_fee(&self, chain_id: u64, value: U256) {
        self.base_fee_cache.insert(chain_id, value).await;
    }

    pub async fn get_priority_fee(&self, chain_id: u64) -> Option<U256> {
        self.priority_fee_cache.get(&chain_id)
    }

    pub async fn set_priority_fee(&self, chain_id: u64, value: U256) {
        self.priority_fee_cache.insert(chain_id, value).await;
    }

    pub async fn get_nonce(&self, chain_id: u64, address: Address) -> Option<U256> {
        self.nonce_cache.get(&(chain_id, address))
    }

    pub async fn set_nonce(&self, chain_id: u64, address: Address, value: U256) {
        self.nonce_cache.insert((chain_id, address), value).await;
    }

    pub async fn invalidate_nonce(&self, chain_id: u64, address: Address) {
        self.nonce_cache.invalidate(&(chain_id, address)).await;
    }
}

#[derive(Clone)]
pub struct RpcCache {
    provider_cache: Cache<String, Provider<Http>>,
}

impl RpcCache {
    pub fn new() -> Self {
        Self {
            provider_cache: Cache::builder()
                .time_to_live(Duration::from_secs(3600)) // Cache providers for 1 hour
                .time_to_idle(Duration::from_secs(7200)) // Remove if not accessed for 2 hours
                .build(),
        }
    }

    pub async fn get_provider(&self, url: &str) -> Result<Provider<Http>> {
        if let Some(provider) = self.provider_cache.get(url) {
            return Ok(provider);
        }

        let provider = Provider::<Http>::try_from(url)
            .map_err(|e| UserOpError::RPC(e.to_string()))?;
        
        self.provider_cache.insert(url.to_string(), provider.clone()).await;
        Ok(provider)
    }
} 
use ethers::prelude::*;
use std::sync::Arc;
use crate::error::{Result, UserOpError};
use crate::userop::UserOperation;
use crate::cache::{GasCache, RpcCache};
use crate::retry::{RetryConfig, with_retry};
use crate::metrics::Timer;

#[derive(Debug, Clone)]
pub struct GasParams {
    pub call_gas_limit: U256,
    pub verification_gas_limit: U256,
    pub pre_verification_gas: U256,
    pub max_fee_per_gas: U256,
    pub max_priority_fee_per_gas: U256,
}

pub struct ChainProviders {
    pub ethereum: Provider<Http>,
    pub polygon: Provider<Http>,
    pub arbitrum: Provider<Http>,
}

pub struct GasEstimator {
    providers: Arc<ChainProviders>,
    gas_cache: Arc<GasCache>,
    rpc_cache: Arc<RpcCache>,
    retry_config: RetryConfig,
}

impl GasEstimator {
    pub fn new(
        providers: Arc<ChainProviders>,
        gas_cache: Arc<GasCache>,
        rpc_cache: Arc<RpcCache>,
        retry_config: RetryConfig,
    ) -> Self {
        Self {
            providers,
            gas_cache,
            rpc_cache,
            retry_config,
        }
    }

    pub async fn estimate_gas(&self, user_op: &UserOperation, chain_id: u64) -> Result<GasParams> {
        let timer = Timer::new();
        
        let result = match chain_id {
            1 => self.estimate_ethereum_gas(user_op).await,
            137 => self.estimate_polygon_gas(user_op).await,
            42161 => self.estimate_arbitrum_gas(user_op).await,
            _ => Err(UserOpError::UnsupportedChain(chain_id.to_string())),
        };

        // Record metrics
        crate::metrics::Metrics::record_gas_estimation(chain_id, timer.elapsed());
        
        result
    }

    async fn estimate_ethereum_gas(&self, user_op: &UserOperation) -> Result<GasParams> {
        let chain_id = 1;
        
        // Check cache for gas prices
        if let (Some(base_fee), Some(priority_fee)) = (
            self.gas_cache.get_base_fee(chain_id).await,
            self.gas_cache.get_priority_fee(chain_id).await,
        ) {
            crate::metrics::Metrics::record_cache_hit("gas_prices");
            
            // Still need to estimate call gas limit
            let call_gas_limit = self.estimate_call_gas_limit(chain_id, user_op).await?;
            
            return Ok(GasParams {
                call_gas_limit,
                verification_gas_limit: U256::from(100000),
                pre_verification_gas: U256::from(21000),
                max_fee_per_gas: base_fee + priority_fee,
                max_priority_fee_per_gas: priority_fee,
            });
        }

        crate::metrics::Metrics::record_cache_miss("gas_prices");

        // Get fresh gas prices with retry
        let provider = &self.providers.ethereum;
        let fee_history = with_retry(
            chain_id,
            || async {
                provider
                    .fee_history(4, BlockNumber::Latest, &[10.0, 50.0])
                    .await
                    .map_err(|e| UserOpError::GasEstimation(e.to_string()))
            },
            &self.retry_config,
        ).await?;

        let base_fee = fee_history.base_fee_per_gas.last()
            .ok_or_else(|| UserOpError::GasEstimation("No base fee available".into()))?;

        let priority_fee = fee_history.reward
            .last()
            .and_then(|r| r.get(1))
            .ok_or_else(|| UserOpError::GasEstimation("No priority fee available".into()))?;

        // Cache the new values
        self.gas_cache.set_base_fee(chain_id, *base_fee).await;
        self.gas_cache.set_priority_fee(chain_id, *priority_fee).await;

        let call_gas_limit = self.estimate_call_gas_limit(chain_id, user_op).await?;

        Ok(GasParams {
            call_gas_limit,
            verification_gas_limit: U256::from(100000),
            pre_verification_gas: U256::from(21000),
            max_fee_per_gas: base_fee + priority_fee,
            max_priority_fee_per_gas: *priority_fee,
        })
    }

    async fn estimate_polygon_gas(&self, user_op: &UserOperation) -> Result<GasParams> {
        let eth_estimate = self.estimate_ethereum_gas(user_op).await?;
        
        Ok(GasParams {
            call_gas_limit: eth_estimate.call_gas_limit * 2,
            verification_gas_limit: U256::from(200000),
            pre_verification_gas: U256::from(40000),
            max_fee_per_gas: eth_estimate.max_fee_per_gas,
            max_priority_fee_per_gas: eth_estimate.max_priority_fee_per_gas,
        })
    }

    async fn estimate_arbitrum_gas(&self, user_op: &UserOperation) -> Result<GasParams> {
        let chain_id = 42161;
        
        // Check cache for gas price
        if let Some(gas_price) = self.gas_cache.get_base_fee(chain_id).await {
            crate::metrics::Metrics::record_cache_hit("arbitrum_gas_price");
            
            let call_gas_limit = self.estimate_call_gas_limit(chain_id, user_op).await?;
            
            return Ok(GasParams {
                call_gas_limit,
                verification_gas_limit: U256::from(150000),
                pre_verification_gas: U256::from(50000),
                max_fee_per_gas: gas_price,
                max_priority_fee_per_gas: U256::zero(),
            });
        }

        crate::metrics::Metrics::record_cache_miss("arbitrum_gas_price");

        // Get fresh gas price with retry
        let provider = &self.providers.arbitrum;
        let gas_price = with_retry(
            chain_id,
            || async {
                provider
                    .get_gas_price()
                    .await
                    .map_err(|e| UserOpError::GasEstimation(e.to_string()))
            },
            &self.retry_config,
        ).await?;

        // Cache the new value
        self.gas_cache.set_base_fee(chain_id, gas_price).await;

        let call_gas_limit = self.estimate_call_gas_limit(chain_id, user_op).await?;

        Ok(GasParams {
            call_gas_limit,
            verification_gas_limit: U256::from(150000),
            pre_verification_gas: U256::from(50000),
            max_fee_per_gas: gas_price,
            max_priority_fee_per_gas: U256::zero(),
        })
    }

    async fn estimate_call_gas_limit(&self, chain_id: u64, user_op: &UserOperation) -> Result<U256> {
        let provider = match chain_id {
            1 => &self.providers.ethereum,
            137 => &self.providers.polygon,
            42161 => &self.providers.arbitrum,
            _ => return Err(UserOpError::UnsupportedChain(chain_id.to_string())),
        };

        with_retry(
            chain_id,
            || async {
                let tx = TransactionRequest::new()
                    .to(user_op.sender)
                    .data(user_op.call_data.clone())
                    .into();
                    
                provider
                    .estimate_gas(&tx, None)
                    .await
                    .map_err(|e| UserOpError::GasEstimation(e.to_string()))
            },
            &self.retry_config,
        ).await
    }
}

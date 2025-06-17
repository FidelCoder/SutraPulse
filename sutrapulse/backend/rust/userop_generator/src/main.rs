mod error;
mod gas;
mod userop;
mod chain;
mod cache;
mod metrics;
mod retry;

use std::sync::Arc;
use dotenv::dotenv;
use std::env;
use ethers::prelude::*;
use crate::chain::{ethereum, polygon, arbitrum};
use crate::gas::{GasEstimator, ChainProviders};
use crate::cache::{GasCache, RpcCache};
use crate::metrics::Metrics;
use crate::retry::{RetryConfig, RateLimiter};
use std::time::Duration;
use tracing::info;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load environment variables
    dotenv().ok();

    // Initialize logging with env filter
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    // Initialize metrics
    Metrics::init();
    info!("Metrics server started on port 9000");

    // Get provider URLs from environment
    let eth_url = env::var("ETH_PROVIDER_URL").expect("ETH_PROVIDER_URL must be set");
    let polygon_url = env::var("POLYGON_PROVIDER_URL").expect("POLYGON_PROVIDER_URL must be set");
    let arbitrum_url = env::var("ARBITRUM_PROVIDER_URL").expect("ARBITRUM_PROVIDER_URL must be set");

    // Get EntryPoint address
    let entry_point = env::var("ENTRY_POINT_ADDRESS").expect("ENTRY_POINT_ADDRESS must be set");
    let entry_point = entry_point.parse::<Address>()?;

    // Initialize caches
    let gas_cache = Arc::new(GasCache::new());
    let rpc_cache = Arc::new(RpcCache::new());

    // Initialize rate limiter with chain-specific limits
    let eth_rate_limiter = Arc::new(RateLimiter::new(1, 100));     // 100 requests per second
    let polygon_rate_limiter = Arc::new(RateLimiter::new(1, 200)); // 200 requests per second
    let arbitrum_rate_limiter = Arc::new(RateLimiter::new(1, 150)); // 150 requests per second

    // Create retry configs for each chain
    let eth_retry_config = RetryConfig {
        max_attempts: 3,
        initial_interval: Duration::from_millis(100),
        max_interval: Duration::from_secs(5),
        multiplier: 2.0,
        rate_limiter: eth_rate_limiter,
    };

    let polygon_retry_config = RetryConfig {
        max_attempts: 4,
        initial_interval: Duration::from_millis(50),
        max_interval: Duration::from_secs(3),
        multiplier: 1.5,
        rate_limiter: polygon_rate_limiter,
    };

    let arbitrum_retry_config = RetryConfig {
        max_attempts: 3,
        initial_interval: Duration::from_millis(200),
        max_interval: Duration::from_secs(8),
        multiplier: 2.0,
        rate_limiter: arbitrum_rate_limiter,
    };

    // Initialize chain providers with caching
    let eth_provider = rpc_cache.get_provider(&eth_url).await?;
    let polygon_provider = rpc_cache.get_provider(&polygon_url).await?;
    let arbitrum_provider = rpc_cache.get_provider(&arbitrum_url).await?;

    let chain_providers = Arc::new(ChainProviders {
        ethereum: eth_provider,
        polygon: polygon_provider,
        arbitrum: arbitrum_provider,
    });

    // Initialize chains
    let _ethereum = ethereum::create_ethereum_chain(entry_point, eth_url.clone())?;
    let _polygon = polygon::create_polygon_chain(entry_point, polygon_url.clone())?;
    let _arbitrum = arbitrum::create_arbitrum_chain(entry_point, arbitrum_url.clone())?;

    // Initialize gas estimator with caching and retry logic
    let _gas_estimator = GasEstimator::new(
        chain_providers.clone(),
        gas_cache.clone(),
        rpc_cache.clone(),
        eth_retry_config.clone(), // Use Ethereum's retry config as default
    );

    info!("UserOp Generator initialized with optimizations:");
    info!("- Caching enabled for gas prices and RPC providers");
    info!("- Rate limiting: ETH({}/s), Polygon({}/s), Arbitrum({}/s)",
        eth_retry_config.rate_limiter.max_requests,
        polygon_retry_config.rate_limiter.max_requests,
        arbitrum_retry_config.rate_limiter.max_requests
    );
    info!("- Metrics exposed on :9000/metrics");
    info!("- Chain-specific retry policies configured");

    // Keep the application running
    loop {
        tokio::time::sleep(Duration::from_secs(1)).await;
        
        // Record metrics periodically
        for (chain_id, _) in [
            (1, &chain_providers.ethereum),
            (137, &chain_providers.polygon),
            (42161, &chain_providers.arbitrum),
        ] {
            // Record basic chain metrics
            Metrics::record_active_connections(chain_id, 1); // Just record that the provider is active
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[tokio::test]
    async fn test_environment_setup() {
        // Test with hardcoded values instead of environment variables
        let eth_url = "https://eth-mainnet.g.alchemy.com/v2/your-api-key";
        let entry_point = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
        
        let entry_point_addr = Address::from_str(entry_point);
        assert!(entry_point_addr.is_ok(), "Should be able to parse a valid address");
        
        // Test provider creation
        let provider = Provider::<Http>::try_from(eth_url);
        assert!(provider.is_ok(), "Should be able to create a provider from URL");
    }

    #[tokio::test]
    async fn test_caching() {
        let gas_cache = GasCache::new();
        let chain_id = 1;
        let test_value = U256::from(100);
        
        gas_cache.set_base_fee(chain_id, test_value).await;
        let cached_value = gas_cache.get_base_fee(chain_id).await;
        
        assert_eq!(cached_value, Some(test_value));
    }

    #[tokio::test]
    async fn test_rate_limiting() {
        let rate_limiter = RateLimiter::new(1, 2); // 2 requests per second
        let chain_id = 1;

        assert!(rate_limiter.check_and_record(chain_id).await); // First request
        assert!(rate_limiter.check_and_record(chain_id).await); // Second request
        assert!(!rate_limiter.check_and_record(chain_id).await); // Third request should be limited
    }
}

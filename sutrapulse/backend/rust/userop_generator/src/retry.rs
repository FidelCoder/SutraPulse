use backoff::{backoff::Backoff, ExponentialBackoffBuilder};
use std::time::Duration;
use tokio::time::sleep;
use dashmap::DashMap;
use std::sync::Arc;
use std::time::Instant;
use crate::error::{Result, UserOpError};
use crate::metrics::Timer;

pub struct RateLimiter {
    requests: DashMap<u64, Vec<Instant>>,
    window: Duration,
    pub max_requests: usize,
}

impl RateLimiter {
    pub fn new(window_secs: u64, max_requests: usize) -> Self {
        Self {
            requests: DashMap::new(),
            window: Duration::from_secs(window_secs),
            max_requests,
        }
    }

    pub async fn check_and_record(&self, chain_id: u64) -> bool {
        let now = Instant::now();
        let mut requests = self.requests.entry(chain_id).or_insert_with(Vec::new);
        
        // Remove old requests
        requests.retain(|&time| now.duration_since(time) <= self.window);
        
        if requests.len() >= self.max_requests {
            false
        } else {
            requests.push(now);
            true
        }
    }
}

#[derive(Clone)]
pub struct RetryConfig {
    pub max_attempts: u32,
    pub initial_interval: Duration,
    pub max_interval: Duration,
    pub multiplier: f64,
    pub rate_limiter: Arc<RateLimiter>,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            initial_interval: Duration::from_millis(100),
            max_interval: Duration::from_secs(10),
            multiplier: 2.0,
            rate_limiter: Arc::new(RateLimiter::new(1, 100)), // 100 requests per second by default
        }
    }
}

pub async fn with_retry<T, F, Fut>(
    chain_id: u64,
    operation: F,
    config: &RetryConfig,
) -> Result<T>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    let mut backoff = ExponentialBackoffBuilder::new()
        .with_initial_interval(config.initial_interval)
        .with_max_interval(config.max_interval)
        .with_multiplier(config.multiplier)
        .with_max_elapsed_time(Some(config.max_interval * config.max_attempts))
        .build();

    let timer = Timer::new();
    let mut attempt = 0;

    loop {
        attempt += 1;

        // Check rate limit
        if !config.rate_limiter.check_and_record(chain_id).await {
            sleep(Duration::from_millis(100)).await;
            continue;
        }

        match operation().await {
            Ok(value) => {
                // Record successful operation metrics
                crate::metrics::Metrics::record_rpc_call(
                    chain_id,
                    "operation",
                    true,
                    timer.elapsed(),
                );
                return Ok(value);
            }
            Err(e) => {
                if attempt >= config.max_attempts {
                    // Record failed operation metrics
                    crate::metrics::Metrics::record_rpc_call(
                        chain_id,
                        "operation",
                        false,
                        timer.elapsed(),
                    );
                    return Err(e);
                }

                let next_backoff = backoff.next_backoff()
                    .ok_or_else(|| UserOpError::RPC("Retry limit exceeded".to_string()))?;
                
                sleep(next_backoff).await;
            }
        }
    }
} 
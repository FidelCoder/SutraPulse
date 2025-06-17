use metrics::{counter, gauge, histogram};
use metrics_exporter_prometheus::PrometheusBuilder;
use std::time::Instant;

pub struct Metrics;

impl Metrics {
    pub fn init() {
        PrometheusBuilder::new()
            .with_http_listener(([0, 0, 0, 0], 9000))
            .install()
            .expect("Failed to install Prometheus metrics exporter");
    }

    pub fn record_userop_generation(chain_id: u64, success: bool) {
        let chain = chain_id.to_string();
        counter!("userop_generation_total", 1, "chain" => chain.clone());
        if success {
            counter!("userop_generation_success", 1, "chain" => chain);
        } else {
            counter!("userop_generation_failure", 1, "chain" => chain);
        }
    }

    pub fn record_gas_estimation(chain_id: u64, duration: f64) {
        histogram!("gas_estimation_duration_seconds", duration, "chain" => chain_id.to_string());
    }

    pub fn record_rpc_call(chain_id: u64, method: &str, success: bool, duration: f64) {
        let chain = chain_id.to_string();
        counter!("rpc_calls_total", 1, "chain" => chain.clone(), "method" => method.to_string());
        histogram!("rpc_call_duration_seconds", duration, "chain" => chain.clone(), "method" => method.to_string());
        
        if !success {
            counter!("rpc_calls_failed", 1, "chain" => chain, "method" => method.to_string());
        }
    }

    pub fn record_cache_hit(cache_type: &str) {
        counter!("cache_hits_total", 1, "type" => cache_type.to_string());
    }

    pub fn record_cache_miss(cache_type: &str) {
        counter!("cache_misses_total", 1, "type" => cache_type.to_string());
    }

    pub fn record_active_connections(chain_id: u64, count: i64) {
        gauge!("active_connections", count as f64, "chain" => chain_id.to_string());
    }
}

pub struct Timer {
    start: Instant,
}

impl Timer {
    pub fn new() -> Self {
        Self {
            start: Instant::now(),
        }
    }

    pub fn elapsed(&self) -> f64 {
        self.start.elapsed().as_secs_f64()
    }
} 
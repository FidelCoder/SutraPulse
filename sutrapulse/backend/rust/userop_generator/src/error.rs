use thiserror::Error;

pub type Result<T> = std::result::Result<T, UserOpError>;

#[derive(Error, Debug)]
pub enum UserOpError {
    #[error("RPC error: {0}")]
    RPC(String),

    #[error("Gas estimation error: {0}")]
    GasEstimation(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Contract interaction error: {0}")]
    Contract(String),

    #[error("Invalid signature: {0}")]
    Signature(String),

    #[error("Cache error: {0}")]
    Cache(String),

    #[error("Rate limit exceeded: {0}")]
    RateLimit(String),

    #[error("Retry error: {0}")]
    Retry(String),

    #[error("Metrics error: {0}")]
    Metrics(String),

    #[error("Chain error: {0}")]
    Chain(String),

    #[error("Unknown error: {0}")]
    Unknown(String),
}

use thiserror::Error;

#[derive(Error, Debug)]
pub enum UserOpError {
    #[error("Chain configuration error: {0}")]
    ChainConfig(String),

    #[error("Gas estimation error: {0}")]
    GasEstimation(String),

    #[error("RPC error: {0}")]
    RPC(String),

    #[error("Signature error: {0}")]
    Signature(String),

    #[error("Invalid UserOp: {0}")]
    InvalidUserOp(String),

    #[error("Chain not supported: {0}")]
    UnsupportedChain(String),

    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Ethereum error: {0}")]
    Ethereum(#[from] ethers::prelude::ProviderError),
}

pub type Result<T> = std::result::Result<T, UserOpError>;

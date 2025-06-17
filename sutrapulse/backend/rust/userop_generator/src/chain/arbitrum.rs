use ethers::prelude::*;
use super::{Chain, ChainConfig, ChainProvider};
use crate::error::Result;

pub fn create_arbitrum_chain(entry_point: Address, provider_url: String) -> Result<Chain> {
    let config = ChainConfig {
        chain_id: 42161, // Arbitrum One
        entry_point,
        provider_url,
        confirmations: 64, // Arbitrum's recommended confirmation count
    };

    Chain::new(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_arbitrum_chain() {
        let entry_point = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789".parse().unwrap();
        let chain = Chain::new(ChainConfig {
            chain_id: 42161,
            entry_point,
            provider_url: "https://arb-mainnet.g.alchemy.com/v2/your-api-key".to_string(),
            confirmations: 64,
        }).unwrap();

        assert_eq!(chain.get_chain_id(), 42161);
        assert_eq!(chain.get_confirmations(), 64);
        assert_eq!(chain.get_entry_point(), entry_point);
    }
}

use ethers::prelude::*;
use super::{Chain, ChainConfig, ChainProvider};
use crate::error::Result;

pub fn create_ethereum_chain(entry_point: Address, provider_url: String) -> Result<Chain> {
    let config = ChainConfig {
        chain_id: 1, // Ethereum Mainnet
        entry_point,
        provider_url,
        confirmations: 12, // Standard Ethereum confirmation count
    };

    Chain::new(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ethereum_chain() {
        let entry_point = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789".parse().unwrap();
        let chain = Chain::new(ChainConfig {
            chain_id: 1,
            entry_point,
            provider_url: "https://eth-mainnet.g.alchemy.com/v2/your-api-key".to_string(),
            confirmations: 12,
        }).unwrap();

        assert_eq!(chain.get_chain_id(), 1);
        assert_eq!(chain.get_confirmations(), 12);
        assert_eq!(chain.get_entry_point(), entry_point);
    }
}

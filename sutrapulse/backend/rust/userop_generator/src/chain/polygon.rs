use ethers::prelude::*;
use super::{Chain, ChainConfig, ChainProvider};
use crate::error::Result;

pub fn create_polygon_chain(entry_point: Address, provider_url: String) -> Result<Chain> {
    let config = ChainConfig {
        chain_id: 137, // Polygon Mainnet
        entry_point,
        provider_url,
        confirmations: 256, // Polygon's recommended confirmation count
    };

    Chain::new(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_polygon_chain() {
        let entry_point = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789".parse().unwrap();
        let chain = Chain::new(ChainConfig {
            chain_id: 137,
            entry_point,
            provider_url: "https://polygon-mainnet.g.alchemy.com/v2/your-api-key".to_string(),
            confirmations: 256,
        }).unwrap();

        assert_eq!(chain.get_chain_id(), 137);
        assert_eq!(chain.get_confirmations(), 256);
        assert_eq!(chain.get_entry_point(), entry_point);
    }
}

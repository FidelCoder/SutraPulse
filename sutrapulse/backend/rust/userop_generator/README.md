# UserOp Generator

A Rust-based UserOperation generator for Account Abstraction across multiple EVM chains.

## Features

- Generate UserOperations with proper gas estimation
- Support for multiple EVM chains (Ethereum, Polygon, Arbitrum)
- Contract interaction layer for EntryPoint, Smart Wallet, and Paymaster
- Retry logic and rate limiting
- Caching layers for gas prices and RPC providers
- Metrics collection
- Comprehensive test suite

## Configuration

The UserOp generator requires a configuration file with chain-specific settings. Copy the `config.example.json` to `config.json` and update it with your settings.

### Contract Addresses

The configuration requires three contract addresses:

1. **EntryPoint** (`0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`):
   - This is the official ERC-4337 EntryPoint contract
   - Same address across all chains (Ethereum, Polygon, Arbitrum)
   - DO NOT change this address unless the ERC-4337 standard updates it

2. **Wallet Factory**:
   - You need to deploy your own Smart Wallet Factory contract
   - Replace `YOUR_WALLET_FACTORY_ADDRESS` with your deployed contract address
   - Can be different for each chain

3. **Paymaster**:
   - You need to deploy your own Paymaster contract
   - Replace `YOUR_PAYMASTER_ADDRESS` with your deployed contract address
   - Can be different for each chain

Example configuration:

```json
{
    "chains": {
        "1": {
            "chain_id": 1,
            "rpc_url": "https://eth-mainnet.g.alchemy.com/v2/your-api-key",
            "entry_point_address": "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
            "wallet_factory_address": "YOUR_WALLET_FACTORY_ADDRESS",
            "paymaster_address": "YOUR_PAYMASTER_ADDRESS"
        }
    }
}
```

## Contract Interaction

The contract interaction layer provides a type-safe interface for interacting with:

- EntryPoint contract
- Smart Wallet contract
- Paymaster contract

Key functionalities include:

- Getting UserOperation hash
- Submitting UserOperations
- Retrieving wallet nonce
- Validating signatures
- Checking deposits
- Validating paymaster operations

Example usage:

```rust
use userop_generator::{Config, Contracts, UserOperation};

async fn example() {
    // Load configuration
    let config = Config::from_env().unwrap();
    
    // Get chain-specific provider and contract addresses
    let provider = config.get_provider(1).unwrap();
    let addresses = config.get_contract_addresses(1).unwrap();
    
    // Create contracts instance
    let contracts = Contracts::new(
        provider,
        addresses.entry_point,
        addresses.wallet_factory,
        addresses.paymaster,
        1,
    );
    
    // Get UserOperation hash
    let user_op = UserOperation::default();
    let hash = contracts.get_user_op_hash(&user_op).await.unwrap();
    
    // Submit UserOperation
    let tx_hash = contracts.submit_user_op(user_op, beneficiary).await.unwrap();
}
```

## Installation

Add this to your `Cargo.toml`:

```toml
[dependencies]
userop_generator = { git = "https://github.com/yourusername/userop_generator" }
```

## Testing

Run the test suite:

```bash
cargo test
```

## License

MIT 
use ethers::prelude::*;
use std::sync::Arc;
use crate::error::{Result, UserOpError};
use crate::userop::UserOperation;

abigen!(
    IEntryPoint,
    r#"[
        function getUserOpHash(
            (address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit,
            uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas,
            uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature) calldata userOp
        ) external view returns (bytes32)
        function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature)[] calldata ops, address payable beneficiary) external
        function deposits(address) external view returns (uint256)
    ]"#
);

abigen!(
    ISmartWallet,
    r#"[
        function initialize(address owner, address entryPoint) external
        function execute(address target, uint256 value, bytes calldata data) external returns (bool)
        function getNonce() external view returns (uint256)
        function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bool)
    ]"#
);

abigen!(
    IPaymaster,
    r#"[
        function validatePaymasterUserOp(address sender, uint256 requiredPreFund) external view returns (bool)
        function deposits(address) external view returns (uint256)
    ]"#
);

#[derive(Clone)]
pub struct Contracts {
    entry_point: Arc<IEntryPoint<Provider<Http>>>,
    wallet_factory: Arc<ISmartWallet<Provider<Http>>>,
    paymaster: Arc<IPaymaster<Provider<Http>>>,
    chain_id: u64,
}

impl Contracts {
    pub fn new(
        provider: Provider<Http>,
        entry_point_address: Address,
        wallet_factory_address: Address,
        paymaster_address: Address,
        chain_id: u64,
    ) -> Self {
        Self {
            entry_point: Arc::new(IEntryPoint::new(entry_point_address, Arc::new(provider.clone()))),
            wallet_factory: Arc::new(ISmartWallet::new(wallet_factory_address, Arc::new(provider.clone()))),
            paymaster: Arc::new(IPaymaster::new(paymaster_address, Arc::new(provider))),
            chain_id,
        }
    }

    pub async fn get_user_op_hash(&self, user_op: &UserOperation) -> Result<H256> {
        self.entry_point
            .get_user_op_hash(user_op.into())
            .call()
            .await
            .map_err(|e| UserOpError::RPC(e.to_string()))
    }

    pub async fn submit_user_op(
        &self,
        user_op: UserOperation,
        beneficiary: Address,
    ) -> Result<H256> {
        let tx = self.entry_point
            .handle_ops(vec![user_op.into()], beneficiary);

        let pending_tx = tx
            .send()
            .await
            .map_err(|e| UserOpError::RPC(e.to_string()))?;

        Ok(pending_tx.tx_hash())
    }

    pub async fn get_wallet_nonce(&self, wallet_address: Address) -> Result<U256> {
        let wallet = ISmartWallet::new(wallet_address, self.entry_point.client());
        
        wallet
            .get_nonce()
            .call()
            .await
            .map_err(|e| UserOpError::RPC(e.to_string()))
    }

    pub async fn validate_signature(
        &self,
        wallet_address: Address,
        hash: H256,
        signature: Bytes,
    ) -> Result<bool> {
        let wallet = ISmartWallet::new(wallet_address, self.entry_point.client());
        
        wallet
            .is_valid_signature(hash, signature)
            .call()
            .await
            .map_err(|e| UserOpError::RPC(e.to_string()))
    }

    pub async fn validate_paymaster(
        &self,
        sender: Address,
        required_prefund: U256,
    ) -> Result<bool> {
        self.paymaster
            .validate_paymaster_user_op(sender, required_prefund)
            .call()
            .await
            .map_err(|e| UserOpError::RPC(e.to_string()))
    }

    pub async fn get_entry_point_deposit(&self, address: Address) -> Result<U256> {
        self.entry_point
            .deposits(address)
            .call()
            .await
            .map_err(|e| UserOpError::RPC(e.to_string()))
    }

    pub async fn get_paymaster_deposit(&self, address: Address) -> Result<U256> {
        self.paymaster
            .deposits(address)
            .call()
            .await
            .map_err(|e| UserOpError::RPC(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;
    use ethers::types::U256;

    // Official ERC-4337 EntryPoint contract address (same across all chains)
    const ENTRY_POINT: &str = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
    
    // Test addresses - replace with your actual contract addresses in production
    const TEST_WALLET_FACTORY: &str = "0x1234567890123456789012345678901234567890";
    const TEST_PAYMASTER: &str = "0x2234567890123456789012345678901234567890";
    
    // Replace with your actual RPC URL
    const TEST_RPC_URL: &str = "https://eth-mainnet.g.alchemy.com/v2/your-api-key";

    async fn setup_contracts() -> Contracts {
        let provider = Provider::<Http>::try_from(TEST_RPC_URL).unwrap();
        
        Contracts::new(
            provider,
            Address::from_str(ENTRY_POINT).unwrap(),
            Address::from_str(TEST_WALLET_FACTORY).unwrap(),
            Address::from_str(TEST_PAYMASTER).unwrap(),
            1, // Ethereum mainnet
        )
    }

    #[tokio::test]
    async fn test_get_user_op_hash() {
        let contracts = setup_contracts().await;
        let user_op = UserOperation {
            sender: Address::from_str("0x1234567890123456789012345678901234567890").unwrap(),
            nonce: U256::zero(),
            init_code: Bytes::default(),
            call_data: Bytes::default(),
            call_gas_limit: U256::from(100000),
            verification_gas_limit: U256::from(100000),
            pre_verification_gas: U256::from(21000),
            max_fee_per_gas: U256::from(1000000000),
            max_priority_fee_per_gas: U256::from(1000000000),
            paymaster_and_data: Bytes::default(),
            signature: Bytes::default(),
        };

        let result = contracts.get_user_op_hash(&user_op).await;
        assert!(result.is_ok(), "Failed to get user op hash: {:?}", result.err());
    }

    #[tokio::test]
    async fn test_get_wallet_nonce() {
        let contracts = setup_contracts().await;
        let wallet_address = Address::from_str("0x1234567890123456789012345678901234567890").unwrap();

        let result = contracts.get_wallet_nonce(wallet_address).await;
        assert!(result.is_ok(), "Failed to get wallet nonce: {:?}", result.err());
    }

    #[tokio::test]
    async fn test_validate_paymaster() {
        let contracts = setup_contracts().await;
        let sender = Address::from_str("0x1234567890123456789012345678901234567890").unwrap();
        let required_prefund = U256::from(1000000000);

        let result = contracts.validate_paymaster(sender, required_prefund).await;
        assert!(result.is_ok(), "Failed to validate paymaster: {:?}", result.err());
    }

    #[tokio::test]
    async fn test_get_deposits() {
        let contracts = setup_contracts().await;
        let address = Address::from_str("0x1234567890123456789012345678901234567890").unwrap();

        let entry_point_result = contracts.get_entry_point_deposit(address).await;
        assert!(entry_point_result.is_ok(), "Failed to get entry point deposit: {:?}", entry_point_result.err());

        let paymaster_result = contracts.get_paymaster_deposit(address).await;
        assert!(paymaster_result.is_ok(), "Failed to get paymaster deposit: {:?}", paymaster_result.err());
    }
} 
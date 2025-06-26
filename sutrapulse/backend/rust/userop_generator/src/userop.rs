use ethers::prelude::*;
use ethers::abi::Token;
use serde::{Deserialize, Serialize};
use crate::error::{Result, UserOpError};
use crate::gas::GasEstimator;
use crate::contracts::{UserOperationCall, IEntryPointCalls};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserOperation {
    pub sender: Address,
    pub nonce: U256,
    pub init_code: Bytes,
    pub call_data: Bytes,
    pub call_gas_limit: U256,
    pub verification_gas_limit: U256,
    pub pre_verification_gas: U256,
    pub max_fee_per_gas: U256,
    pub max_priority_fee_per_gas: U256,
    pub paymaster_and_data: Bytes,
    pub signature: Bytes,
}

impl From<UserOperation> for UserOperationCall {
    fn from(op: UserOperation) -> Self {
        UserOperationCall {
            sender: op.sender,
            nonce: op.nonce,
            init_code: op.init_code,
            call_data: op.call_data,
            call_gas_limit: op.call_gas_limit,
            verification_gas_limit: op.verification_gas_limit,
            pre_verification_gas: op.pre_verification_gas,
            max_fee_per_gas: op.max_fee_per_gas,
            max_priority_fee_per_gas: op.max_priority_fee_per_gas,
            paymaster_and_data: op.paymaster_and_data,
            signature: op.signature,
        }
    }
}

impl UserOperation {
    pub fn new(sender: Address) -> Self {
        Self {
            sender,
            nonce: U256::zero(),
            init_code: Bytes::default(),
            call_data: Bytes::default(),
            call_gas_limit: U256::zero(),
            verification_gas_limit: U256::zero(),
            pre_verification_gas: U256::zero(),
            max_fee_per_gas: U256::zero(),
            max_priority_fee_per_gas: U256::zero(),
            paymaster_and_data: Bytes::default(),
            signature: Bytes::default(),
        }
    }

    pub fn with_nonce(mut self, nonce: U256) -> Self {
        self.nonce = nonce;
        self
    }

    pub fn with_call_data(mut self, call_data: Bytes) -> Self {
        self.call_data = call_data;
        self
    }

    pub fn with_signature(mut self, signature: Bytes) -> Self {
        self.signature = signature;
        self
    }

    pub fn with_paymaster(mut self, paymaster: Address, paymaster_data: Bytes) -> Self {
        self.paymaster_and_data = Bytes::from([paymaster.as_bytes(), paymaster_data.as_ref()].concat());
        self
    }
}

pub struct UserOpGenerator {
    gas_estimator: GasEstimator,
}

impl UserOpGenerator {
    pub fn new(gas_estimator: GasEstimator) -> Self {
        Self { gas_estimator }
    }

    pub async fn generate_user_op(
        &self,
        sender: Address,
        call_data: Bytes,
        chain_id: u64,
        paymaster: Option<(Address, Bytes)>,
    ) -> Result<UserOperation> {
        let mut user_op = UserOperation::new(sender);

        // Set call data
        user_op = user_op.with_call_data(call_data);

        // Estimate gas parameters
        let gas_params = self.gas_estimator.estimate_gas(&user_op, chain_id).await?;
        
        user_op.call_gas_limit = gas_params.call_gas_limit;
        user_op.verification_gas_limit = gas_params.verification_gas_limit;
        user_op.pre_verification_gas = gas_params.pre_verification_gas;
        user_op.max_fee_per_gas = gas_params.max_fee_per_gas;
        user_op.max_priority_fee_per_gas = gas_params.max_priority_fee_per_gas;

        // Add paymaster if provided
        if let Some((paymaster_addr, paymaster_data)) = paymaster {
            user_op = user_op.with_paymaster(paymaster_addr, paymaster_data);
        }

        Ok(user_op)
    }

    pub async fn sign_user_op<S: Signer>(
        &self,
        user_op: &mut UserOperation,
        signer: &S,
        entry_point: Address,
        chain_id: u64,
    ) -> Result<()> {
        let user_op_hash = self.hash_user_op(user_op, entry_point, chain_id)?;
        let signature = signer
            .sign_message(user_op_hash)
            .await
            .map_err(|e| UserOpError::Signature(e.to_string()))?;
        
        user_op.signature = signature.to_vec().into();
        Ok(())
    }

    fn hash_user_op(
        &self,
        user_op: &UserOperation,
        entry_point: Address,
        chain_id: u64,
    ) -> Result<H256> {
        let encoded = ethers::abi::encode(&[
            Token::Address(user_op.sender),
            Token::Uint(user_op.nonce),
            Token::Bytes(user_op.init_code.to_vec()),
            Token::Bytes(user_op.call_data.to_vec()),
            Token::Uint(user_op.call_gas_limit),
            Token::Uint(user_op.verification_gas_limit),
            Token::Uint(user_op.pre_verification_gas),
            Token::Uint(user_op.max_fee_per_gas),
            Token::Uint(user_op.max_priority_fee_per_gas),
            Token::Bytes(user_op.paymaster_and_data.to_vec()),
            Token::Uint(U256::from(chain_id)),
            Token::Address(entry_point),
        ]);

        Ok(ethers::utils::keccak256(encoded).into())
    }
}

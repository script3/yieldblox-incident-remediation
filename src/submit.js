import {
  Transaction,
  TransactionBuilder,
  Operation,
  Claimant,
  Memo,
  Contract,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import {
  stellar_horizon,
  DIST_KEYPAIR,
  NETWORK,
  stellar_rpc,
} from "./config.js";
import { assembleTransaction } from "@stellar/stellar-sdk/rpc";

/**
 * Create a TransactionBuilder instance for the distribution account.
 * @returns {Promise<TransactionBuilder>} A TransactionBuilder instance for the distribution account
 */
async function distTransactionBuilder() {
  let account = await stellar_horizon.loadAccount(DIST_KEYPAIR.publicKey());
  return new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK,
    memo: Memo.text("YieldBlox Pool Remediation"),
  }).setTimeout(60);
}

/**
 * Sign and submit a Stellar transaction to the network.
 * @param {Transaction} transaction
 * @returns {Promise<string>} The transaction hash
 * @throws {Error} Throws an error if the transaction fails to submit
 */
async function signAndSubmitTransaction(transaction) {
  // return transaction.toXDR();

  try {
    transaction.sign(DIST_KEYPAIR);
    let result = await stellar_horizon.submitTransaction(transaction);
    if (result.successful) {
      console.log("Transaction submitted successfully:", result.hash);
      return result.hash;
    } else {
      throw new Error("Transaction failed: " + result.result_xdr);
    }
  } catch (error) {
    console.error("Error submitting transaction:", error);
    throw new Error(`Failed to submit transaction: ${error.message}`);
  }
}

/**
 * Simulate, sign, and submit a Stellar transaction to the network.
 * @param {Transaction} transaction
 * @return {Promise<string>} The transaction hash
 * @throws {Error} Throws an error if the transaction fails to simulate or submit
 */
async function simSignAndSubmitTransaction(transaction) {
  try {
    let simulation_resp = await stellar_rpc.simulateTransaction(transaction);
    if (!rpc.Api.isSimulationSuccess(simulation_resp)) {
      throw new Error(
        "Transaction simulation failed: " +
          simulation_resp.result.error_message,
      );
    }

    let assembled = assembleTransaction(transaction, simulation_resp).build();
    // return assembled.toXDR();
    assembled.sign(DIST_KEYPAIR);

    console.log(
      "Submitting transaction with hash...",
      assembled.hash().toString("hex"),
    );

    let send_tx_response = await stellar_rpc.sendTransaction(assembled);
    let curr_time = Date.now();
    while (
      send_tx_response.status === "TRY_AGAIN_LATER" &&
      Date.now() - curr_time < 20000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      send_tx_response = await stellar_rpc.sendTransaction(assembled);
    }
    if (send_tx_response.status !== "PENDING") {
      console.error(
        "Transaction failed to send: ",
        send_tx_response?.errorResult?.toXDR("base64"),
      );
      for (let event of send_tx_response?.diagnosticEvents || []) {
        console.error("Diag Event: ", event.toXDR("base64"));
      }
      throw new Error("Transaction failed to send");
    }

    let get_tx_response = await stellar_rpc.getTransaction(
      send_tx_response.hash,
    );
    console.log("Tx Hash: ", send_tx_response.hash);
    curr_time = Date.now();
    while (
      get_tx_response.status === "NOT_FOUND" &&
      Date.now() - curr_time < 20000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      get_tx_response = await stellar_rpc.getTransaction(send_tx_response.hash);
    }

    if (get_tx_response.status !== "SUCCESS") {
      console.log("Tx Failed: ", get_tx_response.status);
      console.log(get_tx_response.diagnosticEventsXdr);
      throw new Error("Transaction failed");
    }

    console.log("Transaction submitted successfully:", get_tx_response.txHash);
    return get_tx_response.txHash;
  } catch (error) {
    console.error("Error submitting transaction:", error);
    throw error;
  }
}

/**
 * Submit a claimable balance for a given claimant destination, asset, and amount.
 * @param {Asset} asset
 * @param {string} destination
 * @param {string} amount
 * @returns {Promise<string>} The transaction hash
 * @throws {Error} Throws an error if the transaction fails to submit
 */
export async function createClaimableBalance(asset, destination, amount) {
  let tx_builder = await distTransactionBuilder();

  let tx = tx_builder
    .addOperation(
      Operation.createClaimableBalance({
        asset: asset,
        amount: amount,
        claimants: [
          new Claimant(destination, Claimant.predicateUnconditional()),
        ],
      }),
    )
    .build();

  return await signAndSubmitTransaction(tx);
}

/**
 * Submit a payment for a given destination, asset, and amount.
 * @param {Asset} asset
 * @param {string} destination
 * @param {string} amount
 * @returns {Promise<string>} The transaction hash
 * @throws {Error} Throws an error if the transaction fails to submit
 */
export async function payment(asset, destination, amount) {
  let tx_builder = await distTransactionBuilder();

  let tx = tx_builder
    .addOperation(
      Operation.payment({
        destination: destination,
        asset: asset,
        amount: amount,
      }),
    )
    .build();

  return await signAndSubmitTransaction(tx);
}

/**
 * Invokes transfer on the asset_id contract to transfer the specified amount to the destination.
 * @param {string} asset_id
 * @param {string} destination
 * @param {string} amount
 * @returns {Promise<string>} The transaction hash
 * @throws {Error} Throws an error if the transaction fails to submit
 */
export async function transfer(asset_id, destination, amount) {
  let account = await stellar_rpc.getAccount(DIST_KEYPAIR.publicKey());
  let tx_builder = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK,
  }).setTimeout(60);

  let contract = new Contract(asset_id);

  const invokeArgs = {
    method: "transfer",
    args: [
      nativeToScVal(DIST_KEYPAIR.publicKey(), { type: "address" }),
      nativeToScVal(destination, { type: "address" }),
      nativeToScVal(amount, { type: "i128" }),
    ],
  };
  const operation = contract.call(invokeArgs.method, ...invokeArgs.args);

  let tx = tx_builder.addOperation(operation).build();

  return await simSignAndSubmitTransaction(tx);
}

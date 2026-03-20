import { appendFileSync, existsSync } from "fs";
import { readBackstopCsv } from "./reader.js";
import { BACKSTOP_TOKEN, DIST_KEYPAIR, stellar_horizon } from "./config.js";
import { transfer } from "./submit.js";

const LOG_HEADERS = "account,destination,asset,amount,transaction_hash\n";

const ASSET_CODE = "BLND-USDC-LP";

throw new Error("NOT READY");

await backstopRemediation();

/**
 * Execute the remediation process for a given asset by reading the aggregate loss CSV and submitting payments to affected accounts.
 * Creates a transaction log of all impacted accounts.
 */
export async function backstopRemediation() {
  const LOG_FILE_DEST = `./logs/${new Date().toISOString()}_remediation_log_${ASSET_CODE}.csv`;
  const WARN_FILE_DEST = `./logs/${new Date().toISOString()}_remediation_warnings_${ASSET_CODE}.csv`;
  const ERROR_FILE_DEST = `./logs/${new Date().toISOString()}_remediation_errors_${ASSET_CODE}.csv`;

  if (!existsSync(LOG_FILE_DEST)) {
    appendFileSync(LOG_FILE_DEST, LOG_HEADERS);
  }

  let entries = readBackstopCsv();
  console.log(
    `Starting processing for ${ASSET_CODE}. Total entries: ${entries.length}`,
  );

  try {
    DIST_KEYPAIR.secret();
    console.log("Distribution keypair is valid and can sign transactions.");
  } catch (error) {
    console.log(
      "Distribution keypair is invalid and CANNOT sign transactions.",
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));

  let total_processed = 0n;
  for (let entry of entries) {
    try {
      console.log("Processing entry:", entry);

      if (BigInt(entry.amount) < 100000n) {
        console.warn(
          `Amount for account ${entry.destination} is below threshold. Skipping entry.`,
        );
        appendFileSync(
          WARN_FILE_DEST,
          `${entry.destination},${entry.destination},${ASSET_CODE},${entry.amount},Amount below threshold\n`,
        );
        continue;
      }

      // Load destination and validate it exists
      try {
        if (entry.destination.startsWith("G")) {
          await stellar_horizon.loadAccount(entry.destination);
        }
      } catch (error) {
        if (error?.status === 404 || error?.message == "Not Found") {
          console.warn(
            `Destination account ${entry.destination} does not exist. Skipping entry for account ${entry.destination}.`,
          );
          appendFileSync(
            WARN_FILE_DEST,
            `${entry.destination},${entry.destination},${ASSET_CODE},${entry.amount},Account does not exist\n`,
          );
          continue;
        } else {
          throw error;
        }
      }

      let txHash = await transfer(
        BACKSTOP_TOKEN,
        entry.destination,
        entry.amount,
      );
      appendFileSync(
        LOG_FILE_DEST,
        `${entry.destination},${entry.destination},${ASSET_CODE},${entry.amount},${txHash}\n`,
      );
      console.log("Entry processed successfully:", entry.destination);
      total_processed += BigInt(entry.amount);
    } catch (error) {
      console.error(
        `Error processing entry for account ${entry.destination}:`,
        error,
      );
      appendFileSync(
        ERROR_FILE_DEST,
        `${entry.destination},${entry.destination},${ASSET_CODE},${entry.amount},${error.message}\n`,
      );
      throw new Error(
        `Failed to process entry for account ${entry.destination}: ${error.message}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(
    `Remediation process completed. Total processed amount: ${total_processed}`,
  );
}

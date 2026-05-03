// One-time setup for 0G Compute account.
// Usage: pnpm tsx src/setup-0g.ts
//
// This will:
//   1. Connect to 0G testnet using GM_PRIVATE_KEY
//   2. Check if a Ledger exists for this wallet
//   3. If not, create one with 3 OG (the minimum)
//   4. List available providers + their models

import "dotenv/config";
import { Wallet, JsonRpcProvider, formatEther } from "ethers";
import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require_("@0gfoundation/0g-compute-ts-sdk");

async function main(): Promise<void> {
  const rpcUrl = process.env.OG_RPC_URL || "https://evmrpc-testnet.0g.ai";
  const privateKey = process.env.GM_PRIVATE_KEY;
  if (!privateKey) throw new Error("GM_PRIVATE_KEY required");

  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  console.log(`Wallet: ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`OG balance: ${formatEther(balance)} OG`);
  if (balance < BigInt(3.5e18)) {
    console.warn(`⚠️  Wallet has < 3.5 OG. Top up at https://faucet.0g.ai`);
  }

  console.log("Initializing 0G Compute broker...");
  const broker = await createZGComputeNetworkBroker(wallet);

  // Check ledger
  let ledgerExists = false;
  try {
    const ledger = await broker.ledger.getLedger();
    ledgerExists = true;
    const balOG = Number(ledger.totalBalance) / 1e18;
    console.log(`Ledger exists. Balance: ${balOG.toFixed(4)} OG`);
    if (balOG < 1) {
      console.log("Topping up with 1 OG...");
      await broker.ledger.depositFund(1);
      console.log("Deposit done.");
    }
  } catch (e) {
    console.log("No ledger found. Creating with 3 OG (minimum)...");
    await broker.ledger.addLedger(3);
    console.log("Ledger created.");
  }

  // List providers
  const services = await broker.inference.listService();
  console.log(`\nAvailable providers (${services.length}):`);
  for (const svc of services) {
    console.log(`  ${svc.provider}  model=${svc.model}  url=${svc.url}`);
  }

  // Acknowledge our default provider
  const defaultProvider = process.env.OG_COMPUTE_PROVIDER;
  if (defaultProvider) {
    const exists = services.find((s: any) => s.provider?.toLowerCase() === defaultProvider.toLowerCase());
    if (exists) {
      console.log(`\nAcknowledging signer for ${defaultProvider}...`);
      await broker.inference.acknowledgeProviderSigner(defaultProvider);
      console.log("Acknowledged.");
    } else {
      console.warn(`\n⚠️  Default provider ${defaultProvider} not in list. Use one of the providers above.`);
      if (services[0]) {
        console.log(`Suggestion: set OG_COMPUTE_PROVIDER=${services[0].provider}`);
      }
    }
  }

  console.log("\n✅ Setup complete. You can now run gamemaster with LLM_MODE unset (uses 0G Compute).");
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});

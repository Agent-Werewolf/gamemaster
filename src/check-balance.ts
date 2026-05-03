// Quick wallet balance check
import { createPublicClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "dotenv";
import type { Hex } from "viem";

config();
const client = createPublicClient({ transport: http("https://evmrpc-testnet.0g.ai") });
const acc = privateKeyToAccount(process.env.GM_PRIVATE_KEY as Hex);
const bal = await client.getBalance({ address: acc.address });
console.log("Wallet:", acc.address);
console.log("Balance:", formatEther(bal), "OG");

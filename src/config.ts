import { config as dotenv } from "dotenv";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

dotenv();

export interface Deployments {
  chainId: number;
  AgentRegistry: string;
  ReputationOracle: string;
  GameArchive: string;
  GameMaster?: string;
}

export interface Config {
  gmPrivateKey: string;
  axlEndpoint: string;
  ogRpcUrl: string;
  ogStorageIndexer: string;
  ogComputeProvider: string;
  wsPort: number;
  httpPort: number;
  healthcheckPort: number;
  deployments: Deployments;
  // Game tuning
  playersPerGame: number;
  rolesDistribution: { WEREWOLF: number; VILLAGER: number; SEER: number };
  phaseTimings: { NIGHT: number; DAY_DISCUSSION: number; DAY_VOTE: number; REVEAL: number };
  maxSpeechesPerPhase: number;
}

export function loadConfig(): Config {
  const deploymentsPath = process.env.DEPLOYMENTS_PATH || "../contracts/deployments/galileo.json";
  let deployments: Deployments;
  if (existsSync(deploymentsPath)) {
    deployments = JSON.parse(readFileSync(deploymentsPath, "utf-8")) as Deployments;
  } else {
    deployments = {
      chainId: 16602,
      AgentRegistry: "0x0000000000000000000000000000000000000000",
      ReputationOracle: "0x0000000000000000000000000000000000000000",
      GameArchive: "0x0000000000000000000000000000000000000000"
    };
    console.warn(`[config] Deployments file not found at ${deploymentsPath} — using zero addresses (chain calls will fail).`);
  }

  return {
    gmPrivateKey: required("GM_PRIVATE_KEY"),
    axlEndpoint: process.env.AXL_ENDPOINT || "http://127.0.0.1:9002",
    ogRpcUrl: process.env.OG_RPC_URL || "https://evmrpc-testnet.0g.ai",
    ogStorageIndexer: process.env.OG_STORAGE_INDEXER || "https://indexer-storage-testnet-turbo.0g.ai",
    ogComputeProvider: process.env.OG_COMPUTE_PROVIDER || "0xf07240Efa67755B5311bc75784a061eDB47165Dd",
    wsPort: Number(process.env.WS_PORT || 8081),
    httpPort: Number(process.env.HTTP_PORT || 3000),
    healthcheckPort: Number(process.env.HEALTHCHECK_PORT || 8082),
    deployments,
    playersPerGame: Number(process.env.PLAYERS_PER_GAME || 8),
    rolesDistribution: { WEREWOLF: 2, VILLAGER: 5, SEER: 1 },
    phaseTimings: {
      NIGHT: Number(process.env.PHASE_NIGHT_MS || 30_000),
      DAY_DISCUSSION: Number(process.env.PHASE_DAY_DISCUSSION_MS || 90_000),
      DAY_VOTE: Number(process.env.PHASE_DAY_VOTE_MS || 15_000),
      REVEAL: Number(process.env.PHASE_REVEAL_MS || 5_000)
    },
    maxSpeechesPerPhase: Number(process.env.MAX_SPEECHES_PER_PHASE || 5)
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// Onchain client: read AgentRegistry, write Reputation + Archive.
import { createWalletClient, createPublicClient, http, type Address, type Hex, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Deployments, Config } from "./config.js";
import { log } from "./log.js";

export const galileoTestnet = defineChain({
  id: 16602,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "OG", symbol: "OG", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmrpc-testnet.0g.ai"] } },
  blockExplorers: { default: { name: "Chainscan", url: "https://chainscan-galileo.0g.ai" } }
});

const ABI_REGISTRY = [
  {
    inputs: [{ name: "agentId", type: "uint256" }],
    name: "getAgent",
    outputs: [
      {
        components: [
          { name: "agentId", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "axlPeerId", type: "bytes32" },
          { name: "displayName", type: "string" },
          { name: "metadataURI", type: "string" },
          { name: "registeredAt", type: "uint64" },
          { name: "active", type: "bool" }
        ],
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "owner", type: "address" }],
    name: "agentByOwner",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { name: "axlPeerId", type: "bytes32" },
      { name: "displayName", type: "string" },
      { name: "metadataURI", type: "string" }
    ],
    name: "register",
    outputs: [{ type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const;

const ABI_REPUTATION = [
  {
    inputs: [
      { name: "gameId", type: "bytes32" },
      { name: "agentIds", type: "uint256[]" },
      { name: "roles", type: "uint8[]" },
      { name: "outcomes", type: "uint8[]" },
      { name: "eliminatedByVote", type: "bool[]" },
      { name: "killedByWolves", type: "bool[]" }
    ],
    name: "recordBatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const;

const ABI_ARCHIVE = [
  {
    inputs: [
      { name: "gameId", type: "bytes32" },
      { name: "merkleRoot", type: "bytes32" },
      { name: "storageRoot", type: "bytes32" },
      { name: "participants", type: "uint256[]" },
      { name: "startedAt", type: "uint64" },
      { name: "endedAt", type: "uint64" },
      { name: "winner", type: "uint8" }
    ],
    name: "commitArchive",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ name: "gameId", type: "bytes32" }],
    name: "getArchive",
    outputs: [
      {
        components: [
          { name: "gameId", type: "bytes32" },
          { name: "merkleRoot", type: "bytes32" },
          { name: "storageRoot", type: "bytes32" },
          { name: "participants", type: "uint256[]" },
          { name: "startedAt", type: "uint64" },
          { name: "endedAt", type: "uint64" },
          { name: "winner", type: "uint8" }
        ],
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  }
] as const;

export function makeChainClient(cfg: Config) {
  const account = privateKeyToAccount(cfg.gmPrivateKey as Hex);
  const transport = http(cfg.ogRpcUrl);
  const publicClient = createPublicClient({ chain: galileoTestnet, transport });
  const walletClient = createWalletClient({ chain: galileoTestnet, transport, account });

  return {
    publicClient,
    walletClient,
    account,
    deployments: cfg.deployments,

    async getAgent(agentId: bigint) {
      return publicClient.readContract({
        address: cfg.deployments.AgentRegistry as Address,
        abi: ABI_REGISTRY,
        functionName: "getAgent",
        args: [agentId]
      });
    },

    async agentByOwner(owner: Address) {
      return publicClient.readContract({
        address: cfg.deployments.AgentRegistry as Address,
        abi: ABI_REGISTRY,
        functionName: "agentByOwner",
        args: [owner]
      });
    },

    async commitArchive(args: {
      gameId: Hex;
      merkleRoot: Hex;
      storageRoot: Hex;
      participants: bigint[];
      startedAt: bigint;
      endedAt: bigint;
      winner: 0 | 1;
    }): Promise<Hex> {
      const txHash = await walletClient.writeContract({
        address: cfg.deployments.GameArchive as Address,
        abi: ABI_ARCHIVE,
        functionName: "commitArchive",
        args: [
          args.gameId,
          args.merkleRoot,
          args.storageRoot,
          args.participants,
          args.startedAt,
          args.endedAt,
          args.winner
        ]
      });
      log.info({ txHash, gameId: args.gameId }, "GameArchive.commitArchive sent");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      log.info({ txHash }, "GameArchive.commitArchive confirmed");
      return txHash;
    },

    async recordBatch(args: {
      gameId: Hex;
      agentIds: bigint[];
      roles: number[]; // 1=W, 2=V, 3=S
      outcomes: number[]; // 0=L, 1=W
      eliminatedByVote: boolean[];
      killedByWolves: boolean[];
    }): Promise<Hex> {
      const txHash = await walletClient.writeContract({
        address: cfg.deployments.ReputationOracle as Address,
        abi: ABI_REPUTATION,
        functionName: "recordBatch",
        args: [
          args.gameId,
          args.agentIds,
          args.roles,
          args.outcomes,
          args.eliminatedByVote,
          args.killedByWolves
        ]
      });
      log.info({ txHash, gameId: args.gameId }, "ReputationOracle.recordBatch sent");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      log.info({ txHash }, "ReputationOracle.recordBatch confirmed");
      return txHash;
    }
  };
}

export type ChainClient = ReturnType<typeof makeChainClient>;

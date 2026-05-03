# AXL Setup for Agent Werewolf

This directory contains the AXL node configs that the gamemaster's
`axl-mirror` + `axl-witness` use to forward game events over real
Yggdrasil-over-TLS P2P.

## Prerequisites

Clone and build the AXL Go binary from upstream:

```bash
git clone https://github.com/gensyn-ai/axl.git ../axl
cd ../axl
go build -o node ./cmd/node/
```

The gamemaster expects `../axl/node` (or `node.exe` on Windows) to exist.

## Generate node keys

```bash
cd ../axl
mkdir -p keys configs logs
openssl genpkey -algorithm ed25519 -out keys/node-a.pem
openssl genpkey -algorithm ed25519 -out keys/node-b.pem

# Copy configs from this directory
cp ../gamemaster/axl-setup/configs/*.json configs/
```

## Start the two-node hub-and-spoke

Terminal 1 (Node A — listens, GM-side):
```bash
cd ../axl && ./node -config configs/node-a-gm.json
```

Note the line `[node] Our Public Key: <hex>` — that's `<NODE_A_PUBKEY>`.

Terminal 2 (Node B — dials A, agents-side):
```bash
cd ../axl && ./node -config configs/node-b-agents.json
```

Verify they peer: `curl http://127.0.0.1:9102/topology` should show one peer
with `up: true`.

## Start witness (Terminal 3)

```bash
cd ../gamemaster
GM_WALLET_ADDR=0xYourGmAddress \
AXL_WITNESS_API=http://127.0.0.1:9102 \
pnpm tsx src/axl-witness.ts
```

## Start gamemaster with AXL mirror (Terminal 4)

```bash
cd ../gamemaster
AXL_TRANSPORT=1 \
AXL_LOCAL_API=http://127.0.0.1:9103 \
AXL_DEST_PEER_ID=<NODE_A_PUBKEY> \
pnpm dev
```

Every game event will be signed and forwarded over AXL P2P. The witness
prints each envelope as it lands.

## Why two nodes on localhost?

For a hackathon demo, hub-and-spoke on a single machine is the smallest
configuration that proves the bytes actually traverse two AXL processes via
the Yggdrasil overlay. In production you'd run each node on a different
machine or VPS — same configs, just change `tls://127.0.0.1:9101` in Node B's
`Peers` to the public address of the Node A host.

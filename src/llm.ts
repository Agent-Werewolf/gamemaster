// LLM client wrapper for 0G Compute (Sealed Inference).
// Falls back to OpenAI-compatible endpoint if 0G_FALLBACK_LLM_URL is set,
// useful for offline dev without burning OG.

import { log } from "./log.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMConfig {
  providerAddress?: string; // 0G Compute provider
  fallbackBaseUrl?: string; // OpenAI-compatible (e.g., http://localhost:11434/v1 for Ollama)
  fallbackModel?: string;
  fallbackApiKey?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export class LLMClient {
  private mode: "0g" | "fallback" | "mock";
  private broker: any | null = null;

  constructor(private cfg: LLMConfig) {
    if (process.env.LLM_MODE === "mock") {
      this.mode = "mock";
      log.info("LLM client in MOCK mode (deterministic, no network)");
    } else if (cfg.fallbackBaseUrl) {
      this.mode = "fallback";
      log.info({ baseUrl: cfg.fallbackBaseUrl, model: cfg.fallbackModel }, "LLM client using fallback (OpenAI-compatible)");
    } else {
      this.mode = "0g";
      log.info({ provider: cfg.providerAddress }, "LLM client using 0G Compute");
    }
  }

  async generate(messages: ChatMessage[]): Promise<string> {
    const allMessages: ChatMessage[] = this.cfg.systemPrompt
      ? [{ role: "system", content: this.cfg.systemPrompt }, ...messages]
      : messages;

    if (this.mode === "mock") return this.generateMock(allMessages);
    if (this.mode === "fallback") return this.generateFallback(allMessages);
    return this.generate0G(allMessages);
  }

  private generateMock(messages: ChatMessage[]): Promise<string> {
    const lastUser = messages[messages.length - 1]?.content || "";
    // Detect vote prompt
    if (lastUser.includes("Respond ONLY in this exact JSON")) {
      const m = lastUser.match(/\b(\d+):/g);
      const ids = m ? m.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n)) : [1];
      const target = ids[Math.floor(Math.random() * ids.length)] ?? 1;
      const reasons = [
        "Their reasoning has been inconsistent.",
        "They've stayed too quiet.",
        "Their voting pattern matches a wolf.",
        "I distrust their early accusation.",
        "They're protecting someone."
      ];
      const reason = reasons[Math.floor(Math.random() * reasons.length)];
      return Promise.resolve(JSON.stringify({ target, reasoning: reason }));
    }
    // Detect speech prompt
    const lines = [
      "I find this whole thing suspicious.",
      "We need to think carefully before voting.",
      "Their silence speaks volumes to me.",
      "I trust nobody here right now.",
      "Patterns are forming — pay attention.",
      "Maybe we should wait and see.",
      "I have a strong read on at least two of you.",
      "Something doesn't add up about last night.",
      "Let's not rush into accusations.",
      "I've been watching the votes carefully."
    ];
    return Promise.resolve(lines[Math.floor(Math.random() * lines.length)]);
  }

  private async generateFallback(messages: ChatMessage[]): Promise<string> {
    const url = `${this.cfg.fallbackBaseUrl}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.cfg.fallbackApiKey ? { authorization: `Bearer ${this.cfg.fallbackApiKey}` } : {})
      },
      body: JSON.stringify({
        model: this.cfg.fallbackModel || "gpt-4o-mini",
        messages,
        max_tokens: this.cfg.maxTokens || 200,
        temperature: this.cfg.temperature ?? 0.8,
        stream: false
      })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`LLM fallback ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return (json.choices?.[0]?.message?.content || "").trim();
  }

  private async generate0G(messages: ChatMessage[]): Promise<string> {
    if (!this.broker) {
      // 0G SDK ESM exports are broken — use CJS via createRequire
      const { createRequire } = await import("node:module");
      const require_ = createRequire(import.meta.url);
      const { createZGComputeNetworkBroker } = require_("@0gfoundation/0g-compute-ts-sdk");
      const { Wallet, JsonRpcProvider } = await import("ethers");
      const provider = new JsonRpcProvider(process.env.OG_RPC_URL || "https://evmrpc-testnet.0g.ai");
      const wallet = new Wallet(process.env.GM_PRIVATE_KEY!, provider);
      this.broker = await createZGComputeNetworkBroker(wallet);
    }

    const provider = this.cfg.providerAddress!;
    await this.broker.inference.acknowledgeProviderSigner(provider);
    const { endpoint, model } = await this.broker.inference.getServiceMetadata(provider);
    const headers = await this.broker.inference.getRequestHeaders(provider, JSON.stringify(messages));

    const res = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: this.cfg.maxTokens || 200,
        temperature: this.cfg.temperature ?? 0.8,
        stream: false
      })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`0G LLM ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }>; id?: string };
    const content = (json.choices?.[0]?.message?.content || "").trim();

    // Process response for fee accounting (ignore errors — best effort)
    if (json.id) {
      try {
        await this.broker.inference.processResponse(provider, JSON.stringify(messages), content, json.id);
      } catch (e) {
        log.warn({ err: String(e) }, "0G processResponse failed (continuing)");
      }
    }
    return content;
  }
}

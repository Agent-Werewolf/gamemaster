// LLM client wrapper for 0G Compute (Sealed Inference).
// Falls back to OpenAI-compatible endpoint if 0G_FALLBACK_LLM_URL is set,
// useful for offline dev without burning OG.

import { log } from "./log.js";

type PersonaKey = "paranoid" | "manipulator" | "analyst" | "accuser" | "peacemaker" | "paranoid-shadow" | "manipulator-shadow" | "default";

function detectPersona(systemPrompt: string): PersonaKey {
  const sp = systemPrompt.toLowerCase();
  if (sp.includes("paranoid shadow") || sp.includes("even more deeply suspicious")) return "paranoid-shadow";
  if (sp.includes("manipulator shadow") || sp.includes("contrarian")) return "manipulator-shadow";
  if (sp.includes("deeply suspicious")) return "paranoid";
  if (sp.includes("charismatic") && sp.includes("alliance")) return "manipulator";
  if (sp.includes("methodical") || sp.includes("vote-pattern math")) return "analyst";
  if (sp.includes("theatrical") || sp.includes("dramatic")) return "accuser";
  if (sp.includes("diplomatic") || sp.includes("peacemaker")) return "peacemaker";
  return "default";
}

const SPEECH_POOLS: Record<PersonaKey, string[]> = {
  paranoid: [
    "Too convenient that nobody's accusing 3 yet. Suspicious.",
    "I don't buy 5's whole calm act. They're hiding something.",
    "The silence from 7 is louder than any of your words.",
    "Patterns. Look at the patterns. 4 voted with 6 last round.",
    "Don't trust the smooth talkers. Especially 2.",
    "Something's off about how 8 dodged that question.",
    "I'm watching all of you. I see what you're doing.",
    "Convenient how 6 stayed quiet during the kill discussion."
  ],
  manipulator: [
    "Friends, let's think about this together. We're stronger united.",
    "I hear you, 3, and I want to believe you — but the math doesn't add up.",
    "We've all been watching each other. Let's pool what we know.",
    "I trust 5's instincts here. Their read on this feels right.",
    "Nobody's accusing you yet, 7. But maybe we should talk.",
    "Listen — accusations are easy, alliances are hard. Let's build trust.",
    "I'm with you on this, 4. But hear me out before we vote.",
    "We need to be strategic. Voting wrong now costs us tomorrow."
  ],
  analyst: [
    "Voting record analysis: 3 and 5 have aligned on 2 of 3 votes. Coincidence? Probably not.",
    "Probability says we lose if we eliminate the wrong target. Be precise.",
    "Statement contradiction noted: turn 1 you said X, turn 2 you said Y. Explain.",
    "I count 4 living villager-side. We can afford one mistake. Maybe.",
    "The kill target last night was strategic. Not random. Whoever picked it knew.",
    "Cross-referencing speech frequency and vote alignment: 6 is anomalous.",
    "Logic dictates the seer is still alive. Otherwise we'd have less coordination.",
    "I'll vote based on data, not emotion. Show me the inconsistencies."
  ],
  accuser: [
    "It's 4. I'm telling you, IT'S 4! Watch them squirm!",
    "Stop playing nice! ONE of you is a wolf and we're running out of nights!",
    "I called it on day one — 6 is suspicious. NOTHING has changed!",
    "ENOUGH talking! Vote! 5 or 7, take your pick, both look guilty!",
    "I'd bet my own life on it: the wolf is in this conversation, smiling.",
    "Look at 3's eyes when they speak. THAT'S a wolf hiding a smirk!",
    "We need ACTION, not committees! The wolves love it when we hesitate!",
    "I'll lead this charge. 8 is going down today, mark my words!"
  ],
  peacemaker: [
    "Maybe we're moving too fast. Let's hear everyone before we vote.",
    "I'm not sure about this. Could we wait for more information?",
    "Perhaps 4 has a point — but perhaps 6 too. It's hard to tell.",
    "Let's not destroy each other. The wolves want us divided.",
    "I'd rather miss a wolf than execute an innocent today.",
    "Could everyone take a breath? We're escalating quickly.",
    "Maybe there's an explanation for 7's behavior we haven't heard.",
    "I'll vote with the majority — the group has better information than I do."
  ],
  "paranoid-shadow": [
    "Too convenient. Patterns within patterns. 4 voted with 6, 6 voted with 8 — coincidence? No.",
    "I see the alignment. Three of you have moved as one shadow these past nights.",
    "Silence is intent. 7 has spoken twice. Both times defending suspects.",
    "You think I'm reading too much. I'm reading exactly enough.",
    "There's a hidden hand in this game. And it's coordinating right in front of us.",
    "5 echoed 3's words almost verbatim. That's not chance. That's signaling.",
    "Every accusation tonight has steered away from one player. Who? Look closer.",
    "The wolves know each other. Their conversations have texture we don't see."
  ],
  "manipulator-shadow": [
    "I think we're missing 7. Nobody's listening to them. That's exactly why I trust them.",
    "The loud ones aren't the threat. It's whoever's been ignored — that's our seer or wolf.",
    "Let's not pile on 4 just because they're easy. Hard reads beat easy ones.",
    "I'd vote with the underdog here. Group consensus has been wrong twice.",
    "5's been dismissed all game. Maybe that's the point.",
    "Listen to who isn't speaking. The wolves love loud distractions.",
    "I want to whisper with 6. They've been thoughtful and overlooked.",
    "The crowd is a wolf's best friend. Let's not be a crowd."
  ],
  default: [
    "I find this whole thing suspicious.",
    "We need to think carefully before voting.",
    "Their silence speaks volumes to me.",
    "Patterns are forming — pay attention.",
    "Something doesn't add up about last night."
  ]
};

const REASON_POOLS: Record<PersonaKey, string[]> = {
  paranoid: [
    "Their pattern matches a wolf — too cautious, too quiet.",
    "Two contradictions in their speech. I trust nothing they said.",
    "They aligned with another suspect on votes. Coordinated."
  ],
  manipulator: [
    "Building consensus around them — they fit the wolf profile.",
    "The group has a strong read. I'm with the majority.",
    "Reluctantly — their behavior is too smooth to be a villager."
  ],
  analyst: [
    "Vote-alignment data: 67% co-occurrence with another suspect.",
    "Their speech contradicts their vote in turn 2. Logical disconnect.",
    "Probabilistic best target based on activity patterns."
  ],
  accuser: [
    "I CALLED IT. Wolf. End of story.",
    "Their entire game has been defensive deflection.",
    "Loudest in defense usually equals guilty. Vote them out!"
  ],
  peacemaker: [
    "I'm not sure, but the group seems to lean this way.",
    "I'd rather act on consensus than my own uncertain read.",
    "It's the safest target — least drama, most agreement."
  ],
  "paranoid-shadow": [
    "Pattern aligns with 3 prior wolf indicators. Conspiracy confirmed.",
    "Their speech echoed another suspect verbatim. Coordination signal.",
    "Multi-round behavioral pattern matches a wolf coven leader."
  ],
  "manipulator-shadow": [
    "The loud ones are protecting them. That's a tell.",
    "They've been targeted unfairly — but the math also points here.",
    "Underdog read flips: now I see why they were dismissed."
  ],
  default: [
    "Their reasoning has been inconsistent.",
    "They've stayed too quiet.",
    "Their voting pattern matches a wolf."
  ]
};

function pickReason(persona: PersonaKey): string {
  const pool = REASON_POOLS[persona] ?? REASON_POOLS.default;
  return pool[Math.floor(Math.random() * pool.length)];
}

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
    const sys = messages[0]?.content || "";

    // Vote prompt detection
    if (lastUser.includes("Respond ONLY in this exact JSON")) {
      const m = lastUser.match(/\b(\d+):/g);
      const ids = m ? m.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n)) : [1];
      const target = ids[Math.floor(Math.random() * ids.length)] ?? 1;
      const persona = detectPersona(sys);
      const reason = pickReason(persona);
      return Promise.resolve(JSON.stringify({ target, reasoning: reason }));
    }

    // Persona-specific speech pool
    const persona = detectPersona(sys);
    const lines = SPEECH_POOLS[persona] ?? SPEECH_POOLS.default;
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

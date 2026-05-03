// Shared types for Agent Werewolf

export type Role = "WEREWOLF" | "VILLAGER" | "SEER";
export type Winner = "WOLVES" | "VILLAGERS";
export type Phase = "NIGHT" | "DAY_DISCUSSION" | "DAY_VOTE" | "REVEAL";

export interface PeerRef {
  agentId: number;
  walletAddress: string;
  axlPeerId: string;
  displayName: string;
}

export interface PlayerState extends PeerRef {
  role: Role;
  alive: boolean;
  killedByWolves: boolean;
  eliminatedByVote: boolean;
}

export interface MessageEnvelope {
  v: 1;
  type: MessageType;
  gameId: string | null;
  from: number;
  to: number | "broadcast";
  ts: number;
  nonce: string;
  payload: Record<string, unknown>;
  sig: string;
}

export type MessageType =
  | "LOBBY_JOIN"
  | "LOBBY_ACK"
  | "LOBBY_REJECT"
  | "MATCH_ASSIGNED"
  | "ROSTER_ANNOUNCE"
  | "PHASE_START"
  | "PHASE_END"
  | "NIGHT_KILL"
  | "NIGHT_INVESTIGATE"
  | "DAY_SPEECH"
  | "DAY_VOTE"
  | "DAY_SPEECH_RELAY"
  | "VOTE_TALLY"
  | "ELIMINATION"
  | "GAME_END"
  | "ARCHIVE_AVAILABLE"
  | "COVEN_PROPOSE"
  | "COVEN_AGREE"
  | "WHISPER"
  | "SEER_INVESTIGATE_REQ"
  | "SEER_INVESTIGATE_RES"
  | "HEARTBEAT"
  | "ERROR";

export interface SpeechEvent {
  speakerId: number;
  text: string;
  ts: number;
  turn: number;
  addressing?: number;
}

export interface VoteEvent {
  voterId: number;
  targetId: number;
  reasoning: string;
  ts: number;
  turn: number;
}

export interface NightAction {
  agentId: number;
  type: "KILL" | "INVESTIGATE";
  targetId: number;
  ts: number;
  turn: number;
  reasoning?: string;
  result?: { role: Role };
}

export interface TurnRecord {
  turn: number;
  night: {
    kill: { wolfId: number; targetId: number; reasoning: string } | null;
    investigation: { seerId: number; targetId: number; discoveredRole: Role } | null;
    covenMessages: Array<{ from: number; to: number; text: string; ts: number }>;
  };
  day: {
    speeches: SpeechEvent[];
    whispers: Array<{ from: number; to: number; text: string; ts: number }>;
    votes: VoteEvent[];
    eliminated: number | null;
  };
}

export interface GameArchiveJSON {
  v: 1;
  gameId: string;
  startTs: number;
  endTs: number;
  winner: Winner;
  players: Array<{
    agentId: number;
    walletAddress: string;
    axlPeerId: string;
    displayName: string;
    finalRole: Role;
    survived: boolean;
  }>;
  turns: TurnRecord[];
  merkleRoot: string;
}

export interface AgentDecision {
  speak?: { text: string; addressing?: number };
  vote?: { target: number; reasoning: string };
  nightAction?: { kill?: number; investigate?: number; reasoning?: string };
}

export interface GameContext {
  gameId: string;
  agentId: number;
  role: Role;
  fellowWolves: PeerRef[] | null;
  players: PlayerState[];
  alivePlayers: number[];
  turn: number;
  phase: Phase;
  history: TurnRecord[];
  lastEliminated?: { agentId: number; role: Role } | null;
  seerKnowledge?: Array<{ targetId: number; role: Role; turn: number }>;
}

import type {
  CompanyOutcomeType,
  DifficultyType,
  GameType,
  ScenarioType,
  SpeedType,
} from "../Types";

export interface Seat {
  id: string;
  name: string;
}
/** What the host chose: an authored scenario or a custom game, at one difficulty for all. */
export interface MatchSpec {
  scenarioId: number;
  difficulty: DifficultyType;
  customScenario?: ScenarioType;
}
export interface Edge {
  disabled?: boolean;
  approvalFinanced?: boolean;
  annualOperatingCost: number;
  id: string;
  a: string;
  b: string;
  capacityW: number;
  ratingW: number;
  /** Positive from a to b. */
  flowW: number;
  approval?: string;
}
export type Command =
  | { kind: "pause" }
  | { kind: "ready" }
  | { kind: "speed"; speed: SpeedType }
  | { kind: "activity"; reason: string | null }
  | { kind: "action"; name: string; payload: unknown }
  | { kind: "rate"; value: number };
export interface CommandEnvelope {
  matchId: string;
  epoch: string;
  sequence: number;
  command: Command;
}
export interface World {
  commitments?: (
    import("../helpers/Commitment").SavedCommitmentMetadata[] | null
  )[];
  schema: 3;
  /** Solo-save structural version used by every grid in this atomic checkpoint. */
  gameSchema: number;
  rules: string;
  spec: MatchSpec;
  /** Companies whose run has ended, by seat. A failed company retires; the rest play on. */
  outcomes: Record<string, CompanyOutcomeType>;
  matchId: string;
  epoch: string;
  revision: number;
  seats: Seat[];
  grids: GameType[];
  edges: Edge[];
  selectedSpeeds: Record<string, SpeedType>;
  activities: Record<string, string>;
  speed: SpeedType;
  readyRequired: boolean;
  paused: boolean;
  reason: string;
  ready: string[];
  sequences: Record<string, number>;
  receipts: Record<string, { sequence: number; error?: string }>;
  pricePerMWh: number;
}
export interface GridView {
  seat: Seat;
  selectedSpeed: SpeedType;
  pauseReason?: string;
  /** This company's run has ended, so it no longer holds the shared clock. */
  retired?: boolean;
}
export interface RoomView {
  game?: GameType;
  speed: SpeedType;
  readyRequired: boolean;
  disconnected: string[];
  lastSequence: number;
  matchId: string;
  epoch: string;
  revision: number;
  reason: string;
  ready: string[];
  grids: GridView[];
  receipt?: { sequence: number; error?: string };
}

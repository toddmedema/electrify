import type { GameType, TickPresentFutureType } from "../Types";

/** Installed by the shared achievement entry point before saves or gameplay are loaded. */
export interface SimulationHooks {
  initialize(game: GameType): void;
  tick(game: GameType, tick: TickPresentFutureType): void;
  month(game: GameType, continuing: boolean): void;
  finish(game: GameType, outcome: string): void;
  converted(game: GameType, facilityId: number): void;
  tutorial(game: GameType): void;
  validate(value: unknown): boolean;
}

let hooks: SimulationHooks | undefined;
export function installSimulationHooks(value: SimulationHooks): void {
  hooks = value;
}
export function desktopSimulationHooks(): SimulationHooks | undefined {
  return hooks;
}

export interface AchievementMonth {
  nightServedWh: number;
  nightStorageWh: number;
  importedWh: number;
  exportedWh: number;
  eligibleWh: number;
  efficiencyWh: number;
}

export interface AchievementProgress {
  version: 1;
  startedWithCoal: boolean;
  startingFacilityKeys: string[];
  startingLineKeys: string[];
  commissionedIntertie: boolean;
  lastMinute: number;
  /** A legacy save's partial month is excluded from new counter-based achievements. */
  counterStartMonth: number;
  reliableMonths: number;
  recoveryMonths: number;
  convertedWh: Record<string, number>;
  month: AchievementMonth;
  earned: string[];
  completion?: { scenarioId: number; difficulty: GameType["difficulty"] };
}

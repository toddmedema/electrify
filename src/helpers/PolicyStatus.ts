import { POLICIES } from "../data/Policies";
import { GameType, PolicyId, PolicyProgramType } from "../Types";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { formatPercent, formatWatts } from "./Format";
import {
  BuildoutPolicyId,
  buildoutComplete,
  buildoutMonths,
  buildoutMonthsDone,
  isOperatingPolicy,
  programCustomers,
} from "./Policies";
import { policyWindowLabel } from "./PolicyWindow";

/**
 * A run-relative month as "Jan 2031". A fire season can open before the run did, so months may be
 * negative.
 */
export function labelMonth(game: GameType, month: number): string {
  const d = getDateFromMinute(
    (((month % 12) + 12) % 12) * MINUTES_PER_MONTH,
    game.startingYear + Math.floor(month / 12),
  );
  return `${d.month} ${d.year}`;
}

/** Build-out programs read as projects; operating offers are simply on or off. */
export function programStatus(
  game: GameType,
  id: PolicyId,
  program: PolicyProgramType,
): string {
  if (isOperatingPolicy(id)) return program.tier;
  const buildout = id as BuildoutPolicyId;
  if (buildoutComplete(program.adoption))
    return program.completedMonth === undefined
      ? "Completed"
      : `Completed ${labelMonth(game, program.completedMonth)}`;
  if (program.tier === "On")
    return `In progress · month ${buildoutMonthsDone(buildout, program.adoption)} of ${buildoutMonths(buildout)}`;
  if (program.adoption > 0)
    return `Paused · month ${buildoutMonthsDone(buildout, program.adoption)} of ${buildoutMonths(buildout)}`;
  return "Not started";
}

/** The change scheduled for a program, or undefined when nothing is. */
export function pendingLabel(
  game: GameType,
  id: PolicyId,
  program: PolicyProgramType,
): string | undefined {
  const pending = program.pending;
  if (!pending) return undefined;
  const when = labelMonth(game, pending.month);
  if (isOperatingPolicy(id))
    return pending.tier === "Off"
      ? `Turns off ${when}`
      : `${program.tier === "On" ? "Window moves" : "Turns on"} ${when} · ${policyWindowLabel(pending.startHour ?? program.startHour ?? 17)}`;
  if (pending.tier === "Off") return `Pauses ${when}`;
  return program.adoption > 0 ? `Resumes ${when}` : `Starts ${when}`;
}

/** The list's status line: the current state, then any change scheduled for next month. */
export function choiceStatus(
  game: GameType,
  id: PolicyId,
  program: PolicyProgramType,
): string {
  const status = programStatus(game, id, program);
  const pending = pendingLabel(game, id, program);
  if (!pending) return status;
  return `${status} · ${pending[0].toLowerCase()}${pending.slice(1)}`;
}

/** What a finished rebate build-out leaves behind. */
export function buildoutImpact(game: GameType, id: BuildoutPolicyId): string {
  return id === "solar"
    ? `${formatWatts(POLICIES.solar.cap * programCustomers(game))} of rooftop panels`
    : `Home and business use ${formatPercent(POLICIES.efficiency.applianceSaving)} lower, heating and cooling ${formatPercent(POLICIES.efficiency.weatherSaving)} lower`;
}

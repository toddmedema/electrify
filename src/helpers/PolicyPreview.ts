import cloneDeep from "lodash.clonedeep";
import { GameType, PolicyChangeType, TickPresentFutureType } from "../Types";
import { generateNewTimeline } from "../reducers/Game";
import {
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
  summarizeTimeline,
} from "./DateTime";
import { advancePolicies, emptyPolicies } from "./Policies";
import { TICK_MINUTES } from "../Constants";

export function previewPolicy(
  game: GameType,
  change: PolicyChangeType,
  month: number,
) {
  const draft = cloneDeep(game);
  draft.policies ??= emptyPolicies(game.date.monthsElapsed);
  const program = draft.policies.programs[change.id];
  if (change.tier === program.tier) delete program.pending;
  else program.pending = { tier: change.tier, month: change.month };
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  if (!now) throw new Error("No current simulation tick");
  const ticks = Math.ceil(
    ((month + 1) * MINUTES_PER_MONTH - game.date.minute) / TICK_MINUTES,
  );
  const before = generateNewTimeline(game, now.cash, now.customers, ticks);
  const after = generateNewTimeline(draft, now.cash, now.customers, ticks);
  const selected = (timeline: TickPresentFutureType[]) =>
    timeline.filter((t) => Math.floor(t.minute / MINUTES_PER_MONTH) === month);
  const current = selected(before);
  const changed = selected(after);
  advancePolicies(draft, month);
  return {
    spending: draft.policies!.programs[change.id].spending,
    current: current.map((t) => t.demandW),
    changed: changed.map((t) => t.demandW),
    before: summarizeTimeline(current, game.startingYear),
    after: summarizeTimeline(changed, game.startingYear),
    // The balance difference spans the same period as the projection, including every
    // intervening month's program spending, reduced sales, dispatch, and debt payments.
    cashChange: after[after.length - 1].cash - before[before.length - 1].cash,
  };
}
export type PolicyPreviewResult = ReturnType<typeof previewPolicy>;

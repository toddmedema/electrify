import cloneDeep from "lodash.clonedeep";
import { GameType, PolicyChangeType, TickPresentFutureType } from "../Types";
import { generateNewTimeline } from "../reducers/Game";
import {
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
  summarizeTimeline,
} from "./DateTime";
import { emptyPolicies, samePolicyChoice } from "./Policies";
import { TICK_MINUTES } from "../Constants";

export function previewPolicy(
  game: GameType,
  change: PolicyChangeType,
  month: number,
) {
  const draft = cloneDeep(game);
  draft.policies ??= emptyPolicies(game.date.monthsElapsed);
  const program = draft.policies.programs[change.id];
  if (samePolicyChoice(change.id, change, program)) delete program.pending;
  else {
    const { id: _id, ...pending } = change;
    program.pending = pending;
  }
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
  return {
    current: current.map((t) => t.demandW),
    changed: changed.map((t) => t.demandW),
    before: summarizeTimeline(current, game.startingYear),
    after: summarizeTimeline(changed, game.startingYear),
  };
}
export type PolicyPreviewResult = ReturnType<typeof previewPolicy>;

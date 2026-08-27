import {
  ActiveWorldEventType,
  CardNameType,
  DateType,
  GameEventImportanceType,
  GameEventKindType,
  LocationType,
  WorldEventEffectsType,
} from "../Types";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import { randomAt, RANDOM_STREAM } from "../helpers/Math";

export interface WorldEventContextType {
  seed: number;
  date: DateType;
  location: LocationType;
}

export type WorldEventRandomType = (attribute: string) => number;

export interface WorldEventDescriptionType {
  message: string;
  kind: GameEventKindType;
  importance?: GameEventImportanceType;
  actionTarget?: CardNameType;
  attributes: Record<string, string | number>;
  effects?: WorldEventEffectsType;
}

/**
 * Authored rule for a discrete occurrence. No rule ships yet: this is the engine contract future
 * wildfire, hail and policy content plugs into without taking randomness from a running sequence.
 */
export interface WorldEventDefinitionType {
  id: string;
  probabilityPerMonth: number;
  durationMonths: number;
  applies?: (context: WorldEventContextType) => boolean;
  describe: (
    context: WorldEventContextType,
    random: WorldEventRandomType,
  ) => WorldEventDescriptionType;
}

export interface ResolvedWorldEventType {
  checkedKey: string;
  occurrence?: ActiveWorldEventType & WorldEventDescriptionType;
}

// Deliberately empty for this first slice. Adding a phenomenon is content, balancing and a new
// icon/message contract; the engine can now support it without pretending one exists yet.
export const WORLD_EVENT_DEFINITIONS: WorldEventDefinitionType[] = [];

/** A stable 32-bit address for a string, independent of array order or other event definitions. */
function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result | 0;
}

function locationKey(location: LocationType): string {
  // Coordinates disambiguate custom locations whose user-facing id may have been reused.
  return `${location.id}|${location.lat.toFixed(5)}|${location.long.toFixed(5)}`;
}

export function worldEventCheckKey(
  context: WorldEventContextType,
  definitionId: string,
): string {
  return `${definitionId}|${locationKey(context.location)}|${context.date.year}-${context.date.monthNumber}`;
}

/**
 * Checks one event rule for one month. Every draw is addressed by seed + location + month + rule
 * + attribute, so replaying that world produces the same occurrence and the same size/details,
 * even if unrelated event rules are inserted or reordered later.
 */
export function resolveWorldEvent(
  definition: WorldEventDefinitionType,
  context: WorldEventContextType,
): ResolvedWorldEventType {
  const checkedKey = worldEventCheckKey(context, definition.id);
  const draw = (attribute: string) =>
    randomAt(
      context.seed,
      RANDOM_STREAM.worldEvents,
      hash(`${checkedKey}|${attribute}`),
    );
  if (
    (definition.applies && !definition.applies(context)) ||
    draw("occurs") >= definition.probabilityPerMonth
  ) {
    return { checkedKey };
  }
  const description = definition.describe(context, draw);
  return {
    checkedKey,
    occurrence: {
      key: checkedKey,
      definitionId: definition.id,
      startsMinute: context.date.minute,
      endsMinute:
        context.date.minute + definition.durationMonths * MINUTES_PER_MONTH,
      ...description,
      effects: description.effects || {},
    },
  };
}

export function activeWorldEventEffects(
  events: ActiveWorldEventType[] | undefined,
  minute: number,
): WorldEventEffectsType {
  const effects: WorldEventEffectsType = {};
  (events || []).forEach((event: ActiveWorldEventType) => {
    if (minute < event.startsMinute || minute >= event.endsMinute) {
      return;
    }
    effects.temperatureOffsetC =
      (effects.temperatureOffsetC || 0) +
      (event.effects.temperatureOffsetC || 0);
    effects.demandMultiplier =
      (effects.demandMultiplier || 1) * (event.effects.demandMultiplier || 1);
    if (event.effects.fuelPriceMultipliers) {
      effects.fuelPriceMultipliers = effects.fuelPriceMultipliers || {};
      Object.entries(event.effects.fuelPriceMultipliers).forEach(
        ([fuel, multiplier]) => {
          if (multiplier !== undefined) {
            effects.fuelPriceMultipliers![fuel] =
              (effects.fuelPriceMultipliers![fuel] || 1) * multiplier;
          }
        },
      );
    }
  });
  return effects;
}

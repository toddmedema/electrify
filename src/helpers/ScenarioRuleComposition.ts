import type {
  CompiledRuleEvent,
  CompiledScenarioRules,
  RuleDiagnostic,
} from "../data/ScenarioRules";
import type { FuelNameType } from "../Types";

export interface RuleStaticCostFactor {
  fuel: FuelNameType;
  buildCost?: number;
  annualOperatingCost?: number;
}

/** Conservative possible-window bounds are independent of the selected seed. */
function possibleAt(event: CompiledRuleEvent, month: number, term: number) {
  return (
    event.durationMonths > 0 &&
    month >= event.possibleStartMonths.from &&
    month <
      (event.durationUntilEnd
        ? term
        : event.possibleStartMonths.to + event.durationMonths)
  );
}

function factorEnvelope(
  entries: { event: CompiledRuleEvent; value: number }[],
  month: number,
  term: number,
) {
  const groups = new Map<string, typeof entries>();
  entries.forEach((entry) => {
    const condition = entry.event.requiresChoice;
    const key = condition
      ? `${condition.arc ?? "own"}:${condition.choiceId}`
      : `event:${entry.event.key}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  });
  let min = 1,
    max = 1,
    positiveMin = 1;
  for (const group of groups.values()) {
    const options = group[0].event.requiresChoice
      ? [
          undefined,
          ...new Set(
            group.flatMap((entry) => entry.event.requiresChoice!.optionIds),
          ),
        ]
      : [undefined];
    const outcomes = options.map((option) => {
      let low = 1,
        high = 1,
        positive = 1;
      group.forEach(({ event, value }) => {
        if (
          event.requiresChoice &&
          (option === undefined ||
            !event.requiresChoice.optionIds.includes(option))
        )
          return;
        const guaranteed =
          month >= event.possibleStartMonths.to &&
          month <
            (event.durationUntilEnd
              ? term
              : event.possibleStartMonths.from + event.durationMonths);
        low *= guaranteed ? value : Math.min(1, value);
        high *= guaranteed ? value : Math.max(1, value);
        positive *= value === 0 ? 1 : guaranteed ? value : Math.min(1, value);
      });
      return { low, high, positive };
    });
    min *= Math.min(...outcomes.map((outcome) => outcome.low));
    max *= Math.max(...outcomes.map((outcome) => outcome.high));
    positiveMin *= Math.min(...outcomes.map((outcome) => outcome.positive));
  }
  return { min, max, positiveMin };
}

export function scenarioRuleCompositionDiagnostics(
  rules: CompiledScenarioRules,
  staticCosts: readonly RuleStaticCostFactor[] = [],
): RuleDiagnostic[] {
  const events = [...rules.events, ...(rules.arcEvents ?? [])];
  const diagnostics: RuleDiagnostic[] = [];
  const seen = new Set<string>();
  const add = (code: string, path: string, month: number, message: string) => {
    const identity = `${code}:${path}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    diagnostics.push({
      code,
      path,
      severity: "error",
      message: `${message} (month ${month + 1}, ${rules.difficulty}).`,
    });
  };
  for (let month = 0; month < rules.durationMonths; month++) {
    const possible = events.filter((event) =>
      possibleAt(event, month, rules.durationMonths),
    );
    const fees = possible.filter(
      (event) => event.effects.carbonFeePerKgCO2e !== undefined,
    );
    for (let i = 0; i < fees.length; i++)
      for (let j = i + 1; j < fees.length; j++) {
        const first = fees[i].requiresChoice,
          second = fees[j].requiresChoice;
        const exclusive =
          first &&
          second &&
          first.arc === second.arc &&
          first.choiceId === second.choiceId &&
          !first.optionIds.some((id) => second.optionIds.includes(id));
        if (!exclusive)
          add(
            "overlapping-carbon-fee",
            "events.carbonFeeDollarsPerTonneCO2e",
            month,
            `Timed carbon fees ${fees[i].id} and ${fees[j].id} can overlap; move one window`,
          );
      }
    const paths = new Map<
      string,
      { event: CompiledRuleEvent; value: number }[]
    >();
    const collect = (path: string, value: number, event: CompiledRuleEvent) =>
      paths.set(path, [...(paths.get(path) ?? []), { event, value }]);
    possible.forEach((event) => {
      for (const field of [
        "demandMultiplier",
        "hydroRunoffMultiplier",
      ] as const)
        if (event.effects[field] !== undefined)
          collect(field, event.effects[field]!, event);
      for (const field of [
        "fuelPriceMultipliers",
        "buildCostMultipliersByFuel",
        "operatingCostMultipliersByFuel",
        "facilityOutputMultipliersByFuel",
      ] as const)
        Object.entries(event.effects[field] ?? {}).forEach(([fuel, value]) =>
          collect(`${field}.${fuel}`, value, event),
        );
    });
    for (const [path, values] of paths) {
      const { min, max, positiveMin } = factorEnvelope(
        values,
        month,
        rules.durationMonths,
      );
      const output = path.startsWith("facilityOutput");
      const zeroInflow = path === "hydroRunoffMultiplier" && min === 0;
      if (
        (!zeroInflow && min < (output ? 0 : 0.1) - 1e-12) ||
        (zeroInflow && positiveMin < 0.1 - 1e-12) ||
        max > (output ? 1 : 10) + 1e-12
      )
        add(
          "composed-factor",
          path,
          month,
          `${path} can compose to ${min}–${max}; keep the combined factor inside ${output ? "0–1" : "0.1–10"}`,
        );
      for (const staticCost of staticCosts) {
        const field =
          path === `buildCostMultipliersByFuel.${staticCost.fuel}`
            ? "buildCost"
            : path === `operatingCostMultipliersByFuel.${staticCost.fuel}`
              ? "annualOperatingCost"
              : undefined;
        if (!field) continue;
        const factor = staticCost[field] ?? 1;
        if (min * factor < 0.1 - 1e-12 || max * factor > 10 + 1e-12)
          add(
            "composed-static-factor",
            `${path}.${factor}`,
            month,
            `Static ${field} ${factor} and timed ${path} can compose outside 0.1–10`,
          );
      }
    }
  }
  return diagnostics;
}

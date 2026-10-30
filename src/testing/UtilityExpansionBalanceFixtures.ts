import { UTILITY_AREAS, UTILITY_TARGETS } from "../data/UtilityExpansion";
import { getMarketRate } from "../helpers/Customers";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import type { UtilityTargetId } from "../Types";
import { loadSimData } from "./SimData";
import type { ScheduledSimActionType } from "./Simulator";

export type ExpansionPortfolio =
  "line-only" | "unprepared" | "firm" | "mixed" | "both";
export interface ExpansionBalanceCase {
  id: string;
  targetId: UtilityTargetId;
  financed: boolean;
  portfolio: ExpansionPortfolio;
}
export const EXPANSION_BALANCE_CASES: readonly ExpansionBalanceCase[] = [
  ...UTILITY_TARGETS.flatMap((target) => [
    {
      id: `${target.id}-line-only`,
      targetId: target.id,
      financed: true,
      portfolio: "line-only" as const,
    },
    {
      id: `${target.id}-unprepared`,
      targetId: target.id,
      financed: true,
      portfolio: "unprepared" as const,
    },
    ...(["firm", "mixed"] as const).flatMap((portfolio) =>
      [true, false].map((financed) => ({
        id: `${target.id}-${portfolio}-${financed ? "loan" : "cash"}`,
        targetId: target.id,
        financed,
        portfolio,
      })),
    ),
  ]),
  {
    id: "both-firm-loan",
    targetId: "valley-electric",
    financed: true,
    portfolio: "both",
  },
];

/** The same annual competitor benchmark path applies to every portfolio and acquisition. */
export function expansionBalanceActions(
  fixture: ExpansionBalanceCase,
  seed: number,
): ScheduledSimActionType[] {
  loadSimData(UTILITY_AREAS.champlain.location);
  const target = UTILITY_TARGETS.find(({ id }) => id === fixture.targetId)!;
  const actions: ScheduledSimActionType[] = [
    {
      month: 0,
      type: "intertie",
      corridorId: target.corridorId,
      financed: true,
    },
    ...Array.from({ length: 19 }, (_, index): ScheduledSimActionType => ({
      month: (index + 1) * 12,
      type: "rate",
      dollarsPerkWh: getMarketRate(
        0.105,
        getDateFromMinute((index + 1) * 12 * MINUTES_PER_MONTH, 2005),
        2005,
        seed,
      ),
    })),
    { month: 180, type: "retire", assetId: "scenario-116-champlain-oil-a" },
  ];
  const prepared = fixture.portfolio !== "unprepared";
  // Cash purchases reserve working capital for local generation before the 2016 shortage.
  const purchaseMonth = fixture.financed ? 96 : 100;
  if (prepared)
    actions.push(
      {
        month: 0,
        type: "build",
        build: { name: "Natural Gas CC", peakW: 100e6, financed: true },
      },
      {
        month: 60,
        type: "build",
        build: {
          name: fixture.portfolio === "mixed" ? "Wind" : "Natural Gas CC",
          peakW: fixture.portfolio === "mixed" ? 200e6 : 100e6,
          financed: true,
        },
      },
      {
        month: 144,
        type: "build",
        build: { name: "Natural Gas CC", peakW: 100e6, financed: true },
      },
    );
  if (fixture.portfolio !== "line-only") {
    actions.push({
      month: purchaseMonth,
      type: "acquire",
      targetId: target.id,
      financed: fixture.financed,
    });
    if (prepared)
      actions.push(
        {
          month: purchaseMonth,
          type: "build",
          build: {
            name: fixture.financed ? "Natural Gas CC" : "Natural Gas Peaker",
            peakW: 150e6,
            financed: true,
            operatingAreaId: target.id,
          },
        },
        {
          month: 156,
          type: "build",
          build: {
            name: fixture.portfolio === "mixed" ? "Wind" : "Natural Gas CC",
            peakW: fixture.portfolio === "mixed" ? 300e6 : 150e6,
            financed: true,
            operatingAreaId: target.id,
          },
        },
      );
    actions.push({
      month: 216,
      type: "retire",
      assetId: `scenario-116-${target.id === "valley-electric" ? "valley" : "ridge"}-oil`,
    });
  }
  if (fixture.portfolio === "both")
    actions.push(
      {
        month: 0,
        type: "intertie",
        corridorId: "vt-champlain-ridge",
        financed: true,
      },
      {
        month: 108,
        type: "acquire",
        targetId: "ridge-electric",
        financed: true,
      },
      {
        month: 108,
        type: "build",
        build: {
          name: "Natural Gas CC",
          peakW: 150e6,
          financed: true,
          operatingAreaId: "ridge-electric",
        },
      },
      {
        month: 168,
        type: "build",
        build: {
          name: "Natural Gas CC",
          peakW: 150e6,
          financed: true,
          operatingAreaId: "ridge-electric",
        },
      },
      { month: 216, type: "retire", assetId: "scenario-116-ridge-oil" },
    );
  return actions.sort((left, right) => left.month - right.month);
}

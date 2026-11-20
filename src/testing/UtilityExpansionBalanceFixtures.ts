import { UTILITY_AREAS, UTILITY_TARGETS } from "../data/UtilityExpansion";
import { getMarketRate } from "../helpers/Customers";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import type { UtilityTargetId } from "../Types";
import { loadSimData } from "./SimData";
import type { ScheduledSimActionType } from "./Simulator";

export type ExpansionPortfolio =
  "standalone" | "unprepared" | "firm" | "mixed" | "both";
export interface ExpansionBalanceCase {
  id: string;
  targetId: UtilityTargetId;
  financed: boolean;
  portfolio: ExpansionPortfolio;
}
export const EXPANSION_BALANCE_CASES: readonly ExpansionBalanceCase[] = [
  ...UTILITY_TARGETS.flatMap((target) => [
    {
      id: `${target.id}-standalone`,
      targetId: target.id,
      financed: true,
      portfolio: "standalone" as const,
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
  ];
  const prepared = fixture.portfolio !== "unprepared";
  // Cash buyers save through 2013 so the company purchase preserves a generation down payment.
  const purchaseMonth = fixture.financed ? 96 : 108;
  // Fund Valley's equity purchase before adding wind; the planned peaker arrives early
  // enough to bridge the expanded load while that wind is under construction.
  const cashValleyMixed =
    fixture.targetId === "valley-electric" &&
    fixture.portfolio === "mixed" &&
    !fixture.financed;
  // The municipal load draws on firm capacity before Valley's nuclear reduction.
  const reserveBuildMonth = cashValleyMixed ? 126 : 144;
  if (prepared)
    actions.push(
      {
        month: 0,
        type: "build",
        build: { name: "Natural Gas CC", peakW: 100e6, financed: true },
      },
      {
        month: cashValleyMixed ? 120 : 60,
        type: "build",
        build: {
          name: fixture.portfolio === "mixed" ? "Wind" : "Natural Gas CC",
          peakW: fixture.portfolio === "mixed" ? 200e6 : 100e6,
          financed: true,
        },
      },
      {
        month: reserveBuildMonth,
        type: "build",
        build: { name: "Natural Gas CC", peakW: 100e6, financed: true },
      },
    );
  if (fixture.portfolio === "mixed")
    actions.push({
      month: 132,
      type: "build",
      build: { name: "Natural Gas Peaker", peakW: 200e6, financed: true },
    });
  if (fixture.portfolio === "firm" || fixture.portfolio === "both")
    actions.push({
      month: 132,
      type: "build",
      build: { name: "Natural Gas CC", peakW: 100e6, financed: true },
    });
  if (fixture.portfolio !== "standalone") {
    actions.push({
      month: purchaseMonth,
      type: "acquire",
      targetId: target.id,
      financed: fixture.financed,
    });
    if (prepared)
      actions.push(
        {
          month: fixture.financed ? purchaseMonth : cashValleyMixed ? 72 : 84,
          type: "build",
          build: {
            name: fixture.financed ? "Natural Gas CC" : "Natural Gas Peaker",
            peakW: 150e6,
            financed: true,
          },
        },
        {
          month: 156,
          type: "build",
          build: {
            name: fixture.portfolio === "mixed" ? "Wind" : "Natural Gas CC",
            peakW: fixture.portfolio === "mixed" ? 300e6 : 150e6,
            financed: true,
          },
        },
      );
  }
  if (fixture.portfolio === "both")
    actions.push(
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
        },
      },
      {
        month: 168,
        type: "build",
        build: {
          name: "Natural Gas CC",
          peakW: 150e6,
          financed: true,
        },
      },
    );
  if (prepared && fixture.portfolio !== "standalone") {
    actions.push(
      { month: 100, type: "tile", tileId: "green-uplands:site-2" },
      { month: 100, type: "tile", tileId: "green-uplands:site-5" },
      { month: 110, type: "acquire", targetId: "parcel-1", financed: false },
      ...(fixture.portfolio === "both"
        ? []
        : [
            {
              month: 114,
              type: "acquire" as const,
              targetId: "parcel-11" as const,
              financed: false,
            },
          ]),
    );
  }
  // New capacity is sited where the expanded company needs it. The home fleet remains
  // responsible for Champlain; the acquired territory receives its own replacement plants.
  // Split wind projects at the authored 150 MW site limit instead of bypassing site budgets.
  const territorialActions = actions.flatMap(
    (action): ScheduledSimActionType[] => {
      if (action.type !== "build") return [action];
      const territoryId =
        fixture.portfolio === "both" &&
        (action.month === 108 || action.month === 168)
          ? "ridge-electric"
          : action.month < purchaseMonth ||
              action.month === reserveBuildMonth ||
              (cashValleyMixed && action.month === 156)
            ? "champlain"
            : fixture.targetId;
      const build = action.build;
      if (build.peakW === undefined)
        return [{ ...action, build: { ...build, territoryId } }];
      const peakW = build.peakW;
      const projects = build.name === "Wind" ? Math.ceil(peakW / 150e6) : 1;
      return Array.from({ length: projects }, () => ({
        ...action,
        build: {
          ...build,
          peakW: peakW / projects,
          territoryId,
        },
      }));
    },
  );
  return territorialActions.sort((left, right) => left.month - right.month);
}

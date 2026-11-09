import type { RuleReport } from "../data/ScenarioRules";
import type {
  ActiveWorldEventType,
  GameEventImportanceType,
  MonthlyHistoryType,
  StoryAttributeValueType,
} from "../Types";
import {
  deriveExpandedSummary,
  MINUTES_PER_MONTH,
  summarizeHistory,
} from "./DateTime";
import {
  formatMoneyConcise,
  formatWatts,
  formatWattHours,
  formatFixed,
} from "./Format";
import { customerSalesRevenue } from "./Scoring";
import { MONTH_NAMES } from "../Constants";

/** The only fleet facts a capacity report needs, captured at its window's close. */
export interface RuleReportSnapshot {
  firmPeakW: number;
  storagePeakW: number;
  storagePeakWh: number;
}

export interface RuleReportContext {
  startingYear: number;
  /** A count: at the opening of zero-based month m, exactly m months have closed. */
  completedMonths: number;
  monthlyHistory: readonly MonthlyHistoryType[];
  snapshot?: RuleReportSnapshot;
  snapshotMonth?: number;
  occurrences?: readonly ActiveWorldEventType[];
  /** Author/arc event references resolve to exact persisted occurrence keys. */
  eventKeys?: Readonly<Record<string, string>>;
  startingRateDollarsPerKWh?: number;
  endingRateDollarsPerKWh?: number;
  /** Trusted catalog endings retain separately observed facts before a review window is complete. */
  catalogDebrief?: true;
}

export interface RuleReportMetric {
  id: string;
  label: string;
  unit:
    "share" | "Wh" | "W" | "hours" | "dollars" | "months" | "text" | "boolean";
  available: boolean;
  value?: number | string | boolean;
}

export interface RuleReportResult {
  id: string;
  kind: RuleReport["kind"];
  label: string;
  available: boolean;
  message: string;
  reason?: string;
  importance: GameEventImportanceType;
  turningPointPriority: number;
  metrics: RuleReportMetric[];
  attributes: Record<string, StoryAttributeValueType>;
}

const LABELS: Record<RuleReport["kind"], string> = {
  reliability: "Grid reliability",
  affectedFacilities: "Affected facilities",
  fuelMix: "Fuel mix",
  firmCoverage: "Firm capacity coverage",
  storageCoverage: "Storage coverage",
  profitLoss: "Profit and loss",
  dataCenter: "Data-center review",
  deepFreeze: "Deep-freeze review",
};
const PRIORITIES: Record<RuleReport["kind"], number> = {
  reliability: 90,
  affectedFacilities: 100,
  fuelMix: 85,
  firmCoverage: 90,
  storageCoverage: 90,
  profitLoss: 80,
  dataCenter: 95,
  deepFreeze: 110,
};
const REPORT_FACTS: Record<RuleReport["kind"], readonly string[]> = {
  reliability: ["demandWh", "unservedWh", "reliability"],
  affectedFacilities: ["selectedFacilityNames", "affectedFacilityCount"],
  fuelMix: ["selectedWh", "denominatorWh", "fuelShare", "basis"],
  firmCoverage: ["firmCoverage", "peakDemandW", "firmPeakW", "storagePeakW"],
  storageCoverage: [
    "storageCoverage",
    "storageHoursAtPeak",
    "peakDemandW",
    "storagePeakW",
    "storagePeakWh",
  ],
  profitLoss: ["netIncome"],
  dataCenter: [
    "demandWh",
    "unservedWh",
    "reliability",
    "blackoutMonths",
    "startingRate",
    "endingRate",
  ],
  deepFreeze: [
    "demandWh",
    "unservedWh",
    "reliability",
    "maximumDeficitW",
    "beforeRate",
    "afterRate",
    "cashStayedPositive",
  ],
};

/** Persisted review facts are presentation data, never effects or payment instructions.
 * Historical rows can age out, so validate their bounded shape without inventing replacement facts. */
export function validRuleReportReceipt(
  report: RuleReport,
  attributes: Record<string, unknown>,
  importance: unknown,
  priority: unknown,
): boolean {
  const fields = REPORT_FACTS[report.kind];
  const keys = Object.keys(attributes);
  if (!keys.length) return importance === "ROUTINE" && priority === 0;
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key)) ||
    !["ROUTINE", "NOTABLE"].includes(String(importance)) ||
    priority !== PRIORITIES[report.kind]
  )
    return false;
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "selectedFacilityNames") {
      if (
        !Array.isArray(value) ||
        !value.every((name) => typeof name === "string")
      )
        return false;
    } else if (key === "cashStayedPositive") {
      if (typeof value !== "boolean") return false;
    } else if (key === "basis") {
      if (
        report.kind !== "fuelMix" ||
        value !== (report.basis ?? "localGeneration")
      )
        return false;
    } else if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (key !== "netIncome" && value < 0)
    )
      return false;
  }
  if (
    attributes.reliability !== undefined &&
    Number(attributes.reliability) > 1
  )
    return false;
  if (report.kind === "affectedFacilities")
    return (
      attributes.affectedFacilityCount ===
      (attributes.selectedFacilityNames as string[]).length
    );
  if (report.kind === "dataCenter")
    return (
      Number.isInteger(attributes.blackoutMonths) &&
      Number(attributes.blackoutMonths) <=
        report.throughMonth - report.fromMonth + 1
    );
  return true;
}
const finite = (...values: number[]) => values.every(Number.isFinite);
const nonnegative = (...values: number[]) =>
  finite(...values) && values.every((value) => value >= 0);
const metric = (
  id: string,
  label: string,
  unit: RuleReportMetric["unit"],
  value: number | string | boolean,
): RuleReportMetric => ({ id, label, unit, available: true, value });
const missingMetric = (
  id: string,
  label: string,
  unit: RuleReportMetric["unit"],
): RuleReportMetric => ({ id, label, unit, available: false });

function unavailable(
  report: RuleReport,
  reason: string,
  metrics: RuleReportMetric[] = [],
): RuleReportResult {
  return {
    id: report.id,
    kind: report.kind,
    label: report.label ?? LABELS[report.kind],
    available: false,
    message: `Report unavailable. ${reason}`,
    reason,
    importance: "ROUTINE",
    turningPointPriority: 0,
    metrics,
    attributes: {},
  };
}

function observed(
  report: RuleReport,
  message: string,
  metrics: RuleReportMetric[],
  attributes: RuleReportResult["attributes"],
  importance: GameEventImportanceType = "ROUTINE",
): RuleReportResult {
  if (
    metrics.some(
      ({ value }) => typeof value === "number" && !Number.isFinite(value),
    )
  )
    return unavailable(report, "The recorded totals are not finite.");
  return {
    id: report.id,
    kind: report.kind,
    label: report.label ?? LABELS[report.kind],
    available: true,
    message,
    importance,
    turningPointPriority: PRIORITIES[report.kind],
    metrics,
    attributes,
  };
}

/** Keep a displayed share on the same side of a supplied threshold as the recorded fact. */
function percent(value: number, threshold?: number): string {
  for (let digits = 0; digits <= 6; digits++) {
    const display = Number((value * 100).toFixed(digits));
    const rounded = display / 100;
    if ((value > 0 && rounded === 0) || (value < 1 && rounded === 1)) continue;
    if (
      threshold !== undefined &&
      Math.sign(value - threshold) !== Math.sign(rounded - threshold)
    )
      continue;
    return `${display}%`;
  }
  return `${value * 100}%`;
}

function validWindow(
  report: Exclude<RuleReport, { kind: "affectedFacilities" }>,
  context: RuleReportContext,
): boolean {
  const { fromMonth, throughMonth } = report;
  return !(
    !Number.isInteger(fromMonth) ||
    !Number.isInteger(throughMonth) ||
    fromMonth < 0 ||
    throughMonth < fromMonth ||
    throughMonth >= 1200 ||
    !Number.isInteger(context.completedMonths) ||
    context.completedMonths < 0 ||
    !Number.isInteger(context.startingYear)
  );
}

function windowMonths(
  report: Exclude<RuleReport, { kind: "affectedFacilities" }>,
  context: RuleReportContext,
): MonthlyHistoryType[] | string {
  const { fromMonth, throughMonth } = report;
  if (!validWindow(report, context)) return "The report window is invalid.";
  if (throughMonth >= context.completedMonths)
    return "The report window has not completed.";
  const byMonth = new Map<number, MonthlyHistoryType>();
  for (const month of context.monthlyHistory) {
    const index = (month.year - context.startingYear) * 12 + month.month - 1;
    if (index < fromMonth || index > throughMonth) continue;
    if (
      !Number.isInteger(month.year) ||
      !Number.isInteger(month.month) ||
      month.month < 1 ||
      month.month > 12
    )
      return "A recorded calendar month is invalid.";
    if (byMonth.has(index))
      return `Month ${index + 1} has duplicate observations.`;
    byMonth.set(index, month);
  }
  const months: MonthlyHistoryType[] = [];
  for (let index = fromMonth; index <= throughMonth; index++) {
    const month = byMonth.get(index);
    if (!month) return `Month ${index + 1} has no completed observation.`;
    months.push(month);
  }
  return months;
}

function reliabilityFacts(months: MonthlyHistoryType[]) {
  if (!months.every((month) => nonnegative(month.supplyWh, month.demandWh)))
    return undefined;
  const demandWh = months.reduce((sum, month) => sum + month.demandWh, 0);
  const supplyWh = months.reduce((sum, month) => sum + month.supplyWh, 0);
  if (!nonnegative(demandWh, supplyWh) || demandWh === 0) return undefined;
  const unservedWh = Math.max(0, demandWh - supplyWh);
  return { demandWh, unservedWh, reliability: 1 - unservedWh / demandWh };
}

function billedRate(month: MonthlyHistoryType): number | undefined {
  if (
    !nonnegative(month.supplyWh) ||
    month.supplyWh === 0 ||
    !finite(month.revenue, month.revenueExports ?? 0, month.revenueGrants ?? 0)
  )
    return undefined;
  const rate = customerSalesRevenue(month) / (month.supplyWh / 1000);
  return nonnegative(rate) ? rate : undefined;
}

function rateText(rate: number): string {
  return `$${formatFixed(rate, 3).replace(/0+$/, "").replace(/\.$/, "")}/kWh`;
}

function dataCenterMetrics(
  months: MonthlyHistoryType[] | undefined,
  context: RuleReportContext,
): RuleReportMetric[] {
  const blackoutLabel = "Months with blackouts after Data Centers arrived";
  const knownEnergy =
    months?.length &&
    months.every((month) => nonnegative(month.demandWh, month.supplyWh));
  const before = context.startingRateDollarsPerKWh,
    after = context.endingRateDollarsPerKWh;
  return [
    knownEnergy
      ? metric(
          "blackoutMonths",
          blackoutLabel,
          "months",
          months.filter((month) => month.demandWh - month.supplyWh > 1).length,
        )
      : missingMetric("blackoutMonths", blackoutLabel, "months"),
    before !== undefined && after !== undefined && nonnegative(before, after)
      ? metric(
          "electricityRate",
          "Electricity rate",
          "text",
          `${rateText(before)} → ${rateText(after)}`,
        )
      : missingMetric("electricityRate", "Electricity rate", "text"),
  ];
}

function freezeFacts(
  before: MonthlyHistoryType | undefined,
  impact: MonthlyHistoryType | undefined,
  after: MonthlyHistoryType | undefined,
) {
  return {
    facts: impact ? reliabilityFacts([impact]) : undefined,
    beforeRate: before ? billedRate(before) : undefined,
    afterRate: after ? billedRate(after) : undefined,
    maximumDeficitW:
      impact?.minimumSupplyMarginW !== undefined &&
      finite(impact.minimumSupplyMarginW)
        ? Math.max(0, -impact.minimumSupplyMarginW)
        : undefined,
    cashStayedPositive:
      before && impact && after && finite(before.cash, impact.cash, after.cash)
        ? [before, impact, after].every((month) => month.cash > 0)
        : undefined,
  };
}

function freezeMetrics(
  facts: ReturnType<typeof freezeFacts>,
  labels = {
    unserved: "Demand not met during the freeze",
    shortage: "Largest shortage during the freeze",
    cash: "Cash stayed above $0 through the recovery month",
  },
): RuleReportMetric[] {
  return [
    facts.facts
      ? metric("unservedWh", labels.unserved, "Wh", facts.facts.unservedWh)
      : missingMetric("unservedWh", labels.unserved, "Wh"),
    facts.maximumDeficitW !== undefined
      ? metric("maximumDeficitW", labels.shortage, "W", facts.maximumDeficitW)
      : missingMetric("maximumDeficitW", labels.shortage, "W"),
    facts.beforeRate !== undefined && facts.afterRate !== undefined
      ? metric(
          "electricityRate",
          "Electricity rate · before → after",
          "text",
          `${rateText(facts.beforeRate)} → ${rateText(facts.afterRate)}`,
        )
      : missingMetric(
          "electricityRate",
          "Electricity rate · before → after",
          "text",
        ),
    facts.cashStayedPositive !== undefined
      ? metric(
          "cashStayedPositive",
          labels.cash,
          "boolean",
          facts.cashStayedPositive,
        )
      : missingMetric("cashStayedPositive", labels.cash, "boolean"),
  ];
}

/** A completed native run can end before a review's recovery month. Keep each recorded fact. */
function catalogDebriefReport(
  report: Exclude<RuleReport, { kind: "affectedFacilities" }>,
  context: RuleReportContext,
): RuleReportResult | undefined {
  if (!validWindow(report, context))
    return unavailable(report, "The report window is invalid.");
  if (report.kind === "dataCenter") {
    const throughMonth = Math.min(
      report.throughMonth,
      context.completedMonths - 1,
    );
    const reached =
      throughMonth >= report.fromMonth
        ? windowMonths({ ...report, throughMonth }, context)
        : undefined;
    const metrics = dataCenterMetrics(
      Array.isArray(reached) ? reached : undefined,
      context,
    );
    if (metrics.some((item) => !item.available))
      return unavailable(
        report,
        "Some connection review facts have not been recorded.",
        metrics,
      );
    return observed(report, "Recorded connection review.", metrics, {});
  }
  if (report.kind !== "deepFreeze") return undefined;
  if (report.throughMonth - report.fromMonth !== 2)
    return unavailable(
      report,
      "A deep-freeze review needs three consecutive completed months.",
    );
  const month = (index: number) => {
    const rows = windowMonths(
      { ...report, fromMonth: index, throughMonth: index },
      context,
    );
    return Array.isArray(rows) ? rows[0] : undefined;
  };
  const calendar = (index: number) =>
    `${MONTH_NAMES[index % 12].slice(0, 3)} ${context.startingYear + Math.floor(index / 12)}`;
  const impactMonth = report.fromMonth + 1;
  const name = report.label ?? "the deep freeze";
  const facts = freezeFacts(
    month(report.fromMonth),
    month(impactMonth),
    month(report.throughMonth),
  );
  const metrics = freezeMetrics(facts, {
    unserved: `Demand not met during ${name} · ${calendar(impactMonth)}`,
    shortage: `Largest shortage during ${name}`,
    cash: `Cash stayed above $0 through ${calendar(report.throughMonth)}`,
  });
  if (metrics.some((item) => !item.available))
    return unavailable(
      report,
      "Some freeze or recovery facts have not been recorded.",
      metrics,
    );
  return observed(report, "Recorded freeze and recovery review.", metrics, {});
}

/** Presentation only: never reads forecasts or changes effects, money, objectives or live state. */
export function interpretRuleReport(
  report: RuleReport,
  context: RuleReportContext,
): RuleReportResult {
  if (report.kind === "affectedFacilities") {
    const key = context.eventKeys?.[report.eventId];
    const occurrence = key
      ? context.occurrences?.find((event) => event.key === key)
      : undefined;
    if (
      !occurrence ||
      occurrence.startsMinute > context.completedMonths * MINUTES_PER_MONTH
    )
      return unavailable(report, "The event has no recorded activation.");
    const names = occurrence.attributes.selectedFacilityNames;
    if (
      !Array.isArray(names) ||
      !names.every((name) => typeof name === "string")
    )
      return unavailable(
        report,
        "The event has no recorded facility selection.",
      );
    const selectedNames = names as string[];
    return observed(
      report,
      selectedNames.length
        ? `Affected facilities: ${selectedNames.join(", ")}.`
        : "No owned facility was affected.",
      [
        metric(
          "affectedFacilities",
          "Affected facilities",
          "text",
          selectedNames.join(", "),
        ),
      ],
      {
        selectedFacilityNames: [...selectedNames],
        affectedFacilityCount: selectedNames.length,
      },
      selectedNames.length ? "ROUTINE" : "NOTABLE",
    );
  }
  if (context.catalogDebrief) {
    const partial = catalogDebriefReport(report, context);
    if (partial) return partial;
  }
  const months = windowMonths(report, context);
  if (typeof months === "string") return unavailable(report, months);

  if (report.kind === "reliability") {
    const facts = reliabilityFacts(months);
    if (!facts)
      return unavailable(
        report,
        "Reliability needs finite energy totals and nonzero demand.",
      );
    const target = report.minDemandServedShare ?? 0.999;
    return observed(
      report,
      `The grid met ${percent(facts.reliability, target)} of demand during the recorded window.`,
      [
        metric("reliability", "Demand served", "share", facts.reliability),
        metric("unservedWh", "Demand not met", "Wh", facts.unservedWh),
      ],
      facts,
      facts.reliability < target ? "NOTABLE" : "ROUTINE",
    );
  }
  if (report.kind === "fuelMix") {
    if (
      !months.every((month) =>
        Object.values(month.deliveredWhByFuel).every((wh) => nonnegative(wh)),
      )
    )
      return unavailable(
        report,
        "The recorded fuel-delivered energy is invalid.",
      );
    const selectedWh = months.reduce(
      (sum, month) =>
        sum +
        report.fuels.reduce(
          (total, fuel) => total + (month.deliveredWhByFuel[fuel] ?? 0),
          0,
        ),
      0,
    );
    const basis = report.basis ?? "localGeneration";
    const denominatorWh = months.reduce(
      (sum, month) =>
        sum +
        (basis === "customerDemand"
          ? month.demandWh
          : Object.values(month.deliveredWhByFuel).reduce(
              (total, wh) => total + wh,
              0,
            )),
      0,
    );
    if (
      !nonnegative(selectedWh, denominatorWh) ||
      denominatorWh === 0 ||
      (basis === "customerDemand" &&
        !months.every((month) => nonnegative(month.demandWh)))
    )
      return unavailable(
        report,
        "Fuel mix needs finite energy totals and a nonzero denominator.",
      );
    const fuelShare = selectedWh / denominatorWh;
    const basisLabel =
      basis === "customerDemand"
        ? "customer demand"
        : "local fuel-delivered power";
    return observed(
      report,
      `${report.fuels.join(" and ")} supplied ${percent(fuelShare)} of ${basisLabel} during the recorded window.`,
      [metric("fuelShare", "Selected fuel share", "share", fuelShare)],
      { selectedWh, denominatorWh, fuelShare, basis },
    );
  }
  if (report.kind === "firmCoverage" || report.kind === "storageCoverage") {
    const snapshot = context.snapshot;
    if (
      !snapshot ||
      context.snapshotMonth !== report.throughMonth ||
      !nonnegative(
        snapshot.firmPeakW,
        snapshot.storagePeakW,
        snapshot.storagePeakWh,
      ) ||
      !months.every((month) => nonnegative(month.peakDemandW))
    )
      return unavailable(
        report,
        "Coverage needs a recorded fleet snapshot at this window's close.",
      );
    const peakDemandW = Math.max(...months.map((month) => month.peakDemandW));
    if (peakDemandW === 0)
      return unavailable(
        report,
        "Coverage needs nonzero recorded peak demand.",
      );
    const firmCoverage =
      (snapshot.firmPeakW + snapshot.storagePeakW) / peakDemandW;
    if (report.kind === "firmCoverage")
      return observed(
        report,
        `Firm generation and storage power cover ${percent(firmCoverage)} of recorded peak demand.`,
        [
          metric(
            "firmCoverage",
            "Firm and storage power / peak demand",
            "share",
            firmCoverage,
          ),
        ],
        {
          firmCoverage,
          peakDemandW,
          firmPeakW: snapshot.firmPeakW,
          storagePeakW: snapshot.storagePeakW,
        },
        firmCoverage < 0.75 ? "NOTABLE" : "ROUTINE",
      );
    const storageCoverage = snapshot.storagePeakW / peakDemandW;
    const storageHoursAtPeak = snapshot.storagePeakWh / peakDemandW;
    return observed(
      report,
      `Storage power covers ${percent(storageCoverage)} of recorded peak demand, with ${formatFixed(storageHoursAtPeak, 1)} hours of energy at that demand.`,
      [
        metric(
          "storageCoverage",
          "Storage power / peak demand",
          "share",
          storageCoverage,
        ),
        metric(
          "storageHoursAtPeak",
          "Storage energy at peak demand",
          "hours",
          storageHoursAtPeak,
        ),
      ],
      {
        storageCoverage,
        storageHoursAtPeak,
        peakDemandW,
        storagePeakW: snapshot.storagePeakW,
        storagePeakWh: snapshot.storagePeakWh,
      },
    );
  }
  if (report.kind === "profitLoss") {
    if (
      !months.every((month) =>
        finite(
          month.revenue,
          month.expensesFuel,
          month.expensesOM,
          month.expensesCarbonFee,
          month.expensesInterest,
          month.expensesPolicy ?? 0,
          month.expensesImports ?? 0,
        ),
      )
    )
      return unavailable(
        report,
        "Profit and loss needs complete finite accounting facts.",
      );
    const summary = summarizeHistory([...months].reverse());
    const netIncome = deriveExpandedSummary(summary).profit;
    return observed(
      report,
      netIncome === 0
        ? "The grid broke even during the recorded window."
        : `The grid recorded ${formatMoneyConcise(Math.abs(netIncome))} in ${netIncome > 0 ? "profit" : "loss"} during the recorded window.`,
      [metric("netIncome", "Net income", "dollars", netIncome)],
      { netIncome },
      netIncome < 0 ? "NOTABLE" : "ROUTINE",
    );
  }
  if (report.kind === "dataCenter") {
    const facts = reliabilityFacts(months);
    if (!facts)
      return unavailable(
        report,
        "The data-center review needs finite energy totals and nonzero demand.",
      );
    const metrics = dataCenterMetrics(months, context);
    const blackoutMonths = Number(metrics[0].value);
    const before = context.startingRateDollarsPerKWh,
      after = context.endingRateDollarsPerKWh;
    if (
      before === undefined ||
      after === undefined ||
      !nonnegative(before, after)
    )
      return unavailable(
        report,
        "The data-center review has no recorded starting and ending tariffs.",
        metrics,
      );
    return observed(
      report,
      `The grid recorded ${blackoutMonths} ${blackoutMonths === 1 ? "month" : "months"} with blackouts after the connection. Electricity rate: ${rateText(before)} → ${rateText(after)}.`,
      metrics,
      { ...facts, blackoutMonths, startingRate: before, endingRate: after },
      blackoutMonths > 0 ? "NOTABLE" : "ROUTINE",
    );
  }
  // A freeze review explicitly observes the month before, the event month and the month after.
  if (months.length !== 3)
    return unavailable(
      report,
      "A deep-freeze review needs three consecutive completed months.",
    );
  const [before, impact, after] = months;
  const review = freezeFacts(before, impact, after);
  const { facts, beforeRate, afterRate, maximumDeficitW, cashStayedPositive } =
    review;
  if (
    !facts ||
    beforeRate === undefined ||
    afterRate === undefined ||
    maximumDeficitW === undefined ||
    cashStayedPositive === undefined
  )
    return unavailable(
      report,
      "The deep-freeze review needs recorded energy, shortage, billed-rate and cash facts.",
    );
  return observed(
    report,
    `Demand not met during the freeze: ${formatWattHours(facts.unservedWh)}. Largest shortage: ${formatWatts(maximumDeficitW)}. Billed electricity rate: ${rateText(beforeRate)} → ${rateText(afterRate)}. Cash stayed above $0: ${cashStayedPositive ? "Yes" : "No"}.`,
    freezeMetrics(review),
    { ...facts, maximumDeficitW, beforeRate, afterRate, cashStayedPositive },
    facts.reliability < 0.999 || !cashStayedPositive ? "NOTABLE" : "ROUTINE",
  );
}

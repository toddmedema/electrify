import { getScenarioLocation } from "../helpers/Locations";
import { deriveExpandedSummary, summarizeHistory } from "../helpers/DateTime";
import {
  formatMoneyConcise,
  formatWattHours,
  formatWatts,
} from "../helpers/Format";
import { FacilityOperatingType, MonthlyHistoryType } from "../Types";
import { SimResultType } from "./Simulator";

const DEFAULT_MAX_ROWS = 24;

function pad(s: string, width: number, left = false): string {
  if (s.length >= width) {
    return s;
  }
  const spaces = " ".repeat(width - s.length);
  return left ? spaces + s : s + spaces;
}

function percent(numerator: number, denominator: number): string {
  if (!denominator) {
    return "-";
  }
  return `${((100 * numerator) / denominator).toFixed(1)}%`;
}

function count(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * Picks at most `max` rows spread evenly across the run, always keeping the first and last so the
 * start and end of a 20 year game are both visible without printing 240 lines.
 */
function sampleRows<T>(
  rows: T[],
  max: number,
): Array<{ row: T; index: number }> {
  if (rows.length <= max) {
    return rows.map((row, index) => ({ row, index }));
  }
  const step = (rows.length - 1) / (max - 1);
  const picked: Array<{ row: T; index: number }> = [];
  let lastIndex = -1;
  for (let i = 0; i < max; i++) {
    const index = Math.round(i * step);
    if (index !== lastIndex) {
      picked.push({ row: rows[index], index });
      lastIndex = index;
    }
  }
  return picked;
}

const COLUMNS: Array<{
  header: string;
  width: number;
  value: (m: MonthlyHistoryType) => string;
}> = [
  {
    header: "MONTH",
    width: 9,
    value: (m) => `${m.year}-${String(m.month).padStart(2, "0")}`,
  },
  { header: "CUSTOMERS", width: 11, value: (m) => count(m.customers) },
  { header: "DEMAND", width: 10, value: (m) => formatWattHours(m.demandWh) },
  { header: "SUPPLIED", width: 10, value: (m) => formatWattHours(m.supplyWh) },
  {
    header: "UNSERVED",
    width: 9,
    value: (m) => percent(m.demandWh - m.supplyWh, m.demandWh),
  },
  { header: "CASH", width: 9, value: (m) => formatMoneyConcise(m.cash) },
  {
    header: "NET WORTH",
    width: 10,
    value: (m) => formatMoneyConcise(m.netWorth),
  },
  {
    header: "PROFIT",
    width: 10,
    value: (m) => formatMoneyConcise(deriveExpandedSummary(m).profit),
  },
  {
    header: "CO2/MWh",
    width: 8,
    value: (m) => `${Math.round(deriveExpandedSummary(m).kgco2ePerMWh)}kg`,
  },
];

function formatMonthTable(
  months: MonthlyHistoryType[],
  maxRows: number,
): string[] {
  const lines = [
    "  " + COLUMNS.map((c) => pad(c.header, c.width)).join(""),
    "  " + COLUMNS.map((c) => "-".repeat(c.width - 1) + " ").join(""),
  ];
  sampleRows(months, maxRows).forEach(({ row }) => {
    lines.push("  " + COLUMNS.map((c) => pad(c.value(row), c.width)).join(""));
  });
  if (months.length > maxRows) {
    lines.push(
      `  (${months.length} months, sampled to ${maxRows} rows -- pass --full for all of them)`,
    );
  }
  return lines;
}

function formatFacilities(facilities: FacilityOperatingType[]): string[] {
  if (facilities.length === 0) {
    return ["  (none)"];
  }
  return facilities.map((f: FacilityOperatingType) => {
    const size = f.peakWh
      ? `${formatWattHours(f.peakWh)} storage`
      : `${formatWatts(f.peakW)} ${f.fuel}`;
    const building =
      f.yearsToBuildLeft > 0
        ? ` -- ${f.yearsToBuildLeft.toFixed(1)}y left to build`
        : "";
    const loan =
      f.loanAmountLeft > 0
        ? ` -- ${formatMoneyConcise(f.loanAmountLeft)} owed`
        : "";
    return `  ${pad(f.name, 16)}${pad(size, 22)}${building}${loan}`;
  });
}

/** Renders a finished run as a plain text report suitable for a terminal. */
export function formatReport(
  result: SimResultType,
  options: { maxRows?: number; elapsedMs?: number } = {},
): string {
  const maxRows = options.maxRows || DEFAULT_MAX_ROWS;
  const { scenario, months, options: opts } = result;
  const location = getScenarioLocation(scenario);
  const summary = summarizeHistory(result.months);
  const derived = deriveExpandedSummary(summary);
  const first = months[0];
  const last = months[months.length - 1];

  const lines: string[] = [];
  lines.push("");
  lines.push(
    `${scenario.name}  ·  ${opts.difficulty}  ·  seed ${opts.seed}  ·  strategy ${opts.strategy}`,
  );
  lines.push(
    `${location ? location.name : scenario.locationId} · ` +
      (first && last ? `${first.year}-${last.year} · ` : "") +
      `${opts.months} months · ${count(result.ticks)} ticks` +
      (options.elapsedMs === undefined ? "" : ` · ${options.elapsedMs}ms`),
  );
  lines.push("");
  lines.push(...formatMonthTable(months, maxRows));

  lines.push("");
  lines.push("TOTALS");
  lines.push(
    `  Outcome          ${
      result.wentBankrupt
        ? `BANKRUPT at month ${result.bankruptAtMonth} of ${opts.months}`
        : `survived all ${opts.months} months`
    }`,
  );
  if (first && last) {
    lines.push(
      `  Cash             ${formatMoneyConcise(first.cash)} -> ${formatMoneyConcise(last.cash)}`,
    );
    lines.push(
      `  Net worth        ${formatMoneyConcise(first.netWorth)} -> ${formatMoneyConcise(last.netWorth)}`,
    );
    lines.push(
      `  Customers        ${count(first.customers)} -> ${count(last.customers)}`,
    );
  }
  lines.push(
    `  Revenue          ${formatMoneyConcise(summary.revenue)} (${formatMoneyConcise(derived.revenuePerkWh)}/kWh)`,
  );
  lines.push(
    `  Expenses         ${formatMoneyConcise(derived.expenses)}  ` +
      `[fuel ${formatMoneyConcise(summary.expensesFuel)} · O&M ${formatMoneyConcise(summary.expensesOM)} · ` +
      `interest ${formatMoneyConcise(summary.expensesInterest)} · carbon ${formatMoneyConcise(summary.expensesCarbonFee)} · ` +
      `marketing ${formatMoneyConcise(summary.expensesMarketing)}]`,
  );
  lines.push(`  Profit           ${formatMoneyConcise(derived.profit)}`);
  lines.push(
    `  Supplied         ${formatWattHours(summary.supplyWh)} of ${formatWattHours(summary.demandWh)} demanded ` +
      `(${percent(summary.demandWh - summary.supplyWh, summary.demandWh)} unserved)`,
  );
  lines.push(
    `  Emissions        ${count(summary.kgco2e / 1000)} tons (${Math.round(derived.kgco2ePerMWh)}kg/MWh)`,
  );
  if (result.averageStateOfCharge !== null) {
    lines.push(
      `  Storage          ${(100 * result.averageStateOfCharge).toFixed(1)}% average state of charge`,
    );
  }
  if (result.builds.length) {
    lines.push(`  Built            ${result.builds.length} facilities`);
  }

  lines.push("");
  lines.push("FINAL FLEET");
  lines.push(...formatFacilities(result.finalFacilities));

  lines.push("");
  if (result.violationCount === 0) {
    lines.push(
      `INVARIANTS  ok -- no violations across ${count(result.ticks)} ticks`,
    );
  } else {
    lines.push(`INVARIANTS  ${result.violationCount} VIOLATIONS`);
    Object.keys(result.violationCountByRule).forEach((rule: string) => {
      lines.push(`  ${result.violationCountByRule[rule]}x  ${rule}`);
    });
    lines.push("");
    result.violations.forEach((v) => {
      lines.push(`  ${pad(v.when, 17)}${v.rule}`);
      lines.push(`  ${" ".repeat(17)}${v.detail}`);
    });
  }
  lines.push("");
  return lines.join("\n");
}

import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import {
  investmentCatalog,
  InvestmentPurchase,
  previewInvestments,
  stageInvestments,
} from "./InvestmentPreview";
import { getTimeFromTimeline } from "./DateTime";
import { buildFacility, generateNewTimeline } from "../reducers/Game";
import gameReducer from "../reducers/Game";
import { TICKS_PER_YEAR } from "../Constants";
import { store } from "../Store";

const solar: InvestmentPurchase = {
  kind: "generator",
  name: "Solar PV",
  capacity: 1,
  financed: false,
};
const battery: InvestmentPurchase = {
  kind: "storage",
  name: "Battery",
  capacity: 1,
  financed: true,
};
function game() {
  const state = createGame({ scenarioId: 106, seed: 123 });
  getTimeFromTimeline(state.date.minute, state.timeline)!.cash = 1e10;
  return state;
}

test("stages mixed purchases through the real reducer without touching live state or dispatch", () => {
  const state = game();
  const original = cloneDeep(state);
  const dispatch = jest.spyOn(store, "dispatch");
  // Select the authored solar name instead of relying on a UI alias.
  solar.name = investmentCatalog(state, "generator", 1).find(
    (f) => f.fuel === "Sun",
  )!.name;
  const staged = stageInvestments(state, [solar, battery]);
  expect(staged.facilities).toHaveLength(state.facilities.length + 2);
  expect(
    staged.facilities.find(
      (f) => f.id === Math.max(...staged.facilities.map((f) => f.id)),
    ),
  ).toMatchObject({ name: "Battery", currentWh: 0 });
  expect(
    staged.facilities.find((f) => f.name === "Battery")!.loanAmountLeft,
  ).toBeGreaterThan(0);
  expect(state).toEqual(original);
  expect(dispatch).not.toHaveBeenCalled();
  dispatch.mockRestore();
});

test("baseline and planned cash/net worth match the actual forecast with construction and financing", () => {
  const state = game();
  const facility = investmentCatalog(state, "storage", 1).find(
    (f) => f.name === "Battery",
  )!;
  const built = gameReducer(state, buildFacility({ facility, financed: true }));
  const now = getTimeFromTimeline(built.date.minute, built.timeline)!;
  const timeline = generateNewTimeline(
    built,
    now.cash,
    now.customers,
    TICKS_PER_YEAR + 1,
  );
  const preview = previewInvestments(state, [battery], 1);
  expect(preview.after.cash).toBe(timeline[timeline.length - 1].cash);
  expect(preview.after.netWorth).toBe(timeline[timeline.length - 1].netWorth);
  // The transaction balance belongs in the cash minimum even though the
  // already-happened current tick must not contribute energy or emissions.
  expect(Math.min(...timeline.slice(1).map((t) => t.cash))).toBeGreaterThan(
    now.cash,
  );
  expect(preview.after.minimumCash).toBe(now.cash);
  expect(previewInvestments(state, [battery], 1)).toEqual(preview);
  expect(previewInvestments(state, [], 1).before).toEqual(
    previewInvestments(state, [], 1).after,
  );
});

test("rejects invalid horizons, capacities, unavailable facilities and unaffordable combined purchases", () => {
  const state = game();
  expect(investmentCatalog(state, "storage", NaN)).toEqual([]);
  expect(investmentCatalog(state, "generator", 0)).toEqual([]);
  expect(investmentCatalog(state, "generator", 10001)).toEqual([]);
  expect(() => previewInvestments(state, [], 2)).toThrow("horizon");
  expect(() => stageInvestments(state, Array(9).fill(battery))).toThrow(
    "8 purchases",
  );
  expect(() =>
    stageInvestments(state, [{ ...battery, name: "Missing" }]),
  ).toThrow("unavailable");
  const cashPurchase = { ...battery, financed: false };
  const price = investmentCatalog(state, "storage", 1).find(
    (f) => f.name === "Battery",
  )!.buildCost;
  getTimeFromTimeline(state.date.minute, state.timeline)!.cash = price * 1.5;
  expect(() => stageInvestments(state, [cashPurchase, cashPurchase])).toThrow(
    "Not enough cash",
  );
});

test("an unfinished reactor costs cash but cannot prevent shortages or change dispatch emissions", () => {
  const state = game();
  state.difficulty = "CEO";
  const reactor: InvestmentPurchase = {
    kind: "generator",
    name: "Nuclear",
    capacity: 1,
    financed: false,
  };
  const staged = stageInvestments(state, [reactor]);
  expect(staged.facilities[0].yearsToBuildLeft).toBeGreaterThan(1);
  const result = previewInvestments(state, [reactor], 1);
  expect(result.after.shortageWh).toBe(result.before.shortageWh);
  expect(result.after.kgco2e).toBe(result.before.kgco2e);
  expect(result.after.cash).toBeLessThan(result.before.cash);
});

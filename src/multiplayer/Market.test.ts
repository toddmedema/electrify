import { clearPeerMarket } from "./Market";
import type { PeerPlan } from "../Types";
import type { Edge } from "./Types";
const plan = (offerW: number, shortageW: number): PeerPlan => ({
  offerW,
  shortageW,
  pricePerMWh: 80,
  temperatureC: 20,
  solarIrradianceWM2: 0,
  emissionsAt: () => 400,
});
const edge = (a: string, b: string, capacityW = 1e9): Edge => ({
  id: a + b,
  a,
  b,
  capacityW,
  flowW: 0,
  ratingW: capacityW,
  annualOperatingCost: 0,
});

test("storage charging cannot take a constrained seller's power from customers", () => {
  const storage = { ...plan(0, 0), storageChargeW: 100 };
  const result = clearPeerMarket(
    ["seller", "customer", "storage"],
    [plan(100, 0), plan(0, 100), storage],
    [edge("seller", "customer", 100), edge("seller", "storage", 100)],
  );
  expect(result[1].importedW).toBeCloseTo(100, 2);
  expect(result[2].storageImportedW).toBeCloseTo(0, 2);
});

test("charging reroutes customer paths without reducing delivered customer power", () => {
  const result = clearPeerMarket(
    ["A", "B", "C", "D"],
    [
      plan(100, 0),
      plan(100, 0),
      plan(0, 100),
      { ...plan(0, 0), storageChargeW: 100 },
    ],
    [edge("A", "C", 100), edge("B", "C", 100), edge("A", "D", 100)],
  );
  expect(result[2].importedW).toBeCloseTo(100, 2);
  expect(result[2].storageImportedW).toBeCloseTo(0, 2);
  expect(result[3].storageImportedW).toBeCloseTo(100, 2);
  expect(result[0].exportedW + result[1].exportedW).toBeCloseTo(200, 2);
});

test("fractional rerouting never classifies a customer-only purchase as storage", () => {
  const customerW = 428571.4285714286;
  const chargeW = 153846.15384615384;
  const result = clearPeerMarket(
    ["A", "B", "C", "D"],
    [
      plan(customerW, 0),
      plan(chargeW, 0),
      plan(0, customerW),
      { ...plan(0, 0), storageChargeW: chargeW },
    ],
    [edge("A", "C"), edge("B", "C"), edge("A", "D")],
  );
  expect(result[2].importedW).toBeCloseTo(customerW, 5);
  expect(result[2].storageImportedW).toBe(0);
  expect(result[3].storageImportedW).toBeLessThanOrEqual(chargeW);
  expect(result[3].storageImportedW).toBeCloseTo(chargeW, 5);
});
test("one seller shares finite generation by shortage fraction and redistributes a full line", () => {
  const ids = ["a", "b", "c", "d"],
    plans = [plan(120e6, 0), plan(0, 60e6), plan(0, 90e6), plan(0, 150e6)];
  const edges = [edge("a", "b"), edge("a", "c"), edge("a", "d")];
  let settled = clearPeerMarket(ids, plans, edges);
  [24, 36, 60].forEach((mw, i) =>
    expect(settled[i + 1].importedW / 1e6).toBeCloseTo(mw, 4),
  );
  edges[2].capacityW = 50e6;
  settled = clearPeerMarket(ids, plans, edges);
  [28, 42, 50].forEach((mw, i) =>
    expect(settled[i + 1].importedW / 1e6).toBeCloseTo(mw, 4),
  );
});
test("residual paths reroute assignments so constrained buyers do not strand supply", () => {
  const ids = ["a", "b", "c", "d"];
  const settled = clearPeerMarket(
    ids,
    [plan(100, 0), plan(100, 0), plan(0, 100), plan(0, 100)],
    [edge("a", "c", 100), edge("a", "d", 100), edge("b", "c", 100)],
  );
  expect(settled[2].importedW).toBeCloseTo(100, 1);
  expect(settled[3].importedW).toBeCloseTo(100, 1);
});
test("a disconnected buyer does not prevent the rest being supplied; weather is shared", () => {
  const links = [edge("a", "b", 100), edge("a", "c", 0)];
  const settled = clearPeerMarket(
    ["a", "b", "c"],
    [{ ...plan(150, 0), temperatureC: 50 }, plan(0, 100), plan(0, 100)],
    links,
  );
  expect(settled[1].importedW).toBeCloseTo(90, 1);
  expect(settled[2].importedW).toBe(0);
  expect(links[0].ratingW).toBe(90);
});
test("an importing grid cannot relay or double-sell power; carbon follows the real supplier", () => {
  const settled = clearPeerMarket(
    ["a", "b", "c"],
    [{ ...plan(100, 0), emissionsAt: () => 321 }, plan(100, 50), plan(0, 100)],
    [edge("a", "b", 100), edge("b", "c", 100)],
  );
  expect(settled[1].exportedW).toBe(0);
  expect(settled[1].importEmissionsKgPerMWh).toBe(321);
  expect(settled[2].importedW).toBe(0);
});

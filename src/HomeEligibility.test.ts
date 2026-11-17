import { canStartLightweightHome } from "./HomeEligibility";
jest.mock("./WebAuth", () => ({
  hasStoredWebAccount: jest.fn().mockResolvedValue(false),
}));
const inventory = jest.fn();
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: { databases: inventory },
  });
  inventory.mockResolvedValue([]);
});
it("uses the small entry only for visitors with no local save database", async () => {
  expect(await canStartLightweightHome()).toBe(true);
  inventory.mockResolvedValue([{ name: "electrify-saves" }]);
  expect(await canStartLightweightHome()).toBe(false);
});
it("keeps direct game links, saved preferences and unavailable inventories on the full entry", async () => {
  window.history.replaceState(null, "", "/?scenario=107");
  expect(await canStartLightweightHome()).toBe(false);
  window.history.replaceState(null, "", "/");
  localStorage.setItem("interfaceScale", "1.5");
  expect(await canStartLightweightHome()).toBe(false);
  localStorage.clear();
  inventory.mockRejectedValue(new Error("denied"));
  expect(await canStartLightweightHome()).toBe(false);
});

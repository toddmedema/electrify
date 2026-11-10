import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HydroSite } from "../../data/HydroSites";
import RemainingSites, { sitesLargestFirst } from "./RemainingSites";

const site = (id: string, name: string, mw: number): HydroSite => ({
  id,
  name,
  maxPeakW: mw * 1e6,
  lat: 0,
  lon: 0,
});
// The inventory is smallest first, as getHydroAvailability returns it
const remaining = [
  site("a", "Small Creek", 12),
  site("b", "Middle Dam", 250),
  site("c", "Grand Dam", 1500),
];

it("lists the largest site first", () => {
  expect(sitesLargestFirst(remaining).map(({ id }) => id)).toEqual([
    "c",
    "b",
    "a",
  ]);
  // The caller's inventory is not reordered
  expect(remaining.map(({ id }) => id)).toEqual(["a", "b", "c"]);
});

it("shows every remaining site with its name and maximum size on hover and focus", async () => {
  render(<RemainingSites sites={remaining}>3 sites left</RemainingSites>);
  const trigger = screen.getByText("3 sites left");
  expect(screen.queryByRole("tooltip")).toBeNull();
  await userEvent.hover(trigger);
  const tooltip = await screen.findByRole("tooltip");
  const rows = within(
    within(tooltip).getByRole("list", { name: "Remaining hydro sites" }),
  ).getAllByRole("listitem");
  expect(rows.map((row) => row.textContent)).toEqual([
    "Grand Dam1.5GW",
    "Middle Dam250MW",
    "Small Creek12MW",
  ]);
  expect(tooltip).toHaveTextContent("3 sites left, largest first");
});

it("opens for keyboard users", async () => {
  render(<RemainingSites sites={remaining}>3 sites left</RemainingSites>);
  await userEvent.tab();
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Grand Dam");
});

it("renders only the figure when no site is left", () => {
  render(<RemainingSites sites={[]}>0 sites left</RemainingSites>);
  expect(screen.getByText("0 sites left")).not.toHaveAttribute("tabindex");
});

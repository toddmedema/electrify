import * as React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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

it("moves keyboard focus into the list and keeps the tooltip open", async () => {
  render(<RemainingSites sites={remaining}>3 sites left</RemainingSites>);
  await userEvent.tab();
  const tooltip = await screen.findByRole("tooltip");
  const list = within(tooltip).getByRole("list", {
    name: "Remaining hydro sites",
  });
  await userEvent.keyboard("{ArrowDown}");
  expect(list).toHaveFocus();
  // The figure lost focus, yet the list stays open past the tooltip's leave and fade timers
  await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
  expect(screen.getByRole("tooltip")).toBe(tooltip);
  expect(list).toHaveFocus();
  // Escape hands focus back to the figure and dismisses the tooltip
  await userEvent.keyboard("{Escape}");
  expect(screen.getByText("3 sites left")).toHaveFocus();
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});

it("keeps the tooltip open for keyboard focus even when the browser does not mark it focus-visible", async () => {
  // Material UI only keeps an interactive tooltip open for focus-visible content
  const matches = Element.prototype.matches;
  const spy = jest
    .spyOn(Element.prototype, "matches")
    .mockImplementation(function (this: Element, selector: string) {
      if (
        selector === ":focus-visible" &&
        this.getAttribute("aria-label") === "Remaining hydro sites"
      )
        return false;
      return matches.call(this, selector);
    });
  try {
    render(<RemainingSites sites={remaining}>3 sites left</RemainingSites>);
    await userEvent.tab();
    await screen.findByRole("tooltip");
    await userEvent.keyboard("{Enter}");
    const list = screen.getByRole("list", { name: "Remaining hydro sites" });
    expect(list).toHaveFocus();
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(screen.getByRole("tooltip")).toContainElement(list);
  } finally {
    spy.mockRestore();
  }
});

it("opens the list from the figure after the tooltip was dismissed", async () => {
  render(<RemainingSites sites={remaining}>3 sites left</RemainingSites>);
  await userEvent.tab();
  await screen.findByRole("tooltip");
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  expect(screen.getByText("3 sites left")).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  const list = await screen.findByRole("list", {
    name: "Remaining hydro sites",
  });
  expect(list).toHaveFocus();
});

it("returns to the figure when tabbing out of the list", async () => {
  render(
    <>
      <RemainingSites sites={remaining}>3 sites left</RemainingSites>
      <button type="button">Next control</button>
    </>,
  );
  await userEvent.tab();
  await screen.findByRole("tooltip");
  await userEvent.keyboard("{Enter}");
  expect(
    screen.getByRole("list", { name: "Remaining hydro sites" }),
  ).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole("button", { name: "Next control" })).toHaveFocus();
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  await userEvent.tab({ shift: true });
  await screen.findByRole("tooltip");
  await userEvent.keyboard("{ArrowDown}");
  await userEvent.tab({ shift: true });
  expect(screen.getByText("3 sites left")).toHaveFocus();
});

it("does not hold the tooltip open for a pointer click inside the list", async () => {
  render(<RemainingSites sites={remaining}>3 sites left</RemainingSites>);
  await userEvent.hover(screen.getByText("3 sites left"));
  const list = await screen.findByRole("list", {
    name: "Remaining hydro sites",
  });
  await userEvent.click(list);
  await userEvent.unhover(list);
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});

it("renders only the figure when no site is left", () => {
  render(<RemainingSites sites={[]}>0 sites left</RemainingSites>);
  expect(screen.getByText("0 sites left")).not.toHaveAttribute("tabindex");
});

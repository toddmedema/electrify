import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Manual, { clearManualMemory } from "./Manual";
import { MANUAL_ENTRY } from "../../data/Manual";
import { CONCEPT_LABELS, CONCEPT_NAMES } from "../base/ConceptIcon";

function renderManual(focusEntry?: string) {
  return render(<Manual onBack={() => undefined} focusEntry={focusEntry} />);
}

function entryHeader(title: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(title, "i") });
}

async function search(term: string) {
  const box = screen.getByLabelText("Search the manual");
  await userEvent.clear(box);
  await userEvent.type(box, term);
}

// The headers of every entry currently listed, in the order they're shown
function listedTitles(): string[] {
  return screen
    .getAllByRole("button", { expanded: undefined })
    .filter((el: HTMLElement) => el.id.startsWith("manual-"))
    .map((el: HTMLElement) => el.textContent || "");
}

describe("Manual", () => {
  beforeEach(() => {
    clearManualMemory();
  });

  it("pins How to Play above the grouped entries", () => {
    renderManual();
    const titles = listedTitles();
    expect(titles[0]).toContain(MANUAL_ENTRY.HOW_TO_PLAY);
    // Alphabetical ordering used to open on these two, which tell a new player nothing
    expect(titles[1]).not.toContain(MANUAL_ENTRY.BTU);
    expect(screen.getByText("Gameplay")).toBeInTheDocument();
    expect(screen.getByText("Physics & Units")).toBeInTheDocument();
  });

  // The old filter only looked at children that were plain strings, so any paragraph
  // containing an element (<strong>, a nested list, ...) was invisible to search
  it.each([
    ["merit order", MANUAL_ENTRY.FORECASTS],
    ["dispatch order", MANUAL_ENTRY.FORECASTS],
    ["peak shortage", MANUAL_ENTRY.FORECASTS],
    ["board of directors", MANUAL_ENTRY.BLACKOUTS],
    ["variable O&M", MANUAL_ENTRY.TOTAL_COST_OF_ENERGY],
  ])("finds %s inside mixed markup", async (term: string, title: string) => {
    renderManual();
    await search(term);
    expect(entryHeader(title)).toBeInTheDocument();
  });

  it("finds terms by keyword as well as by title", async () => {
    renderManual();
    await search("LCOE");
    expect(entryHeader(MANUAL_ENTRY.TOTAL_COST_OF_ENERGY)).toBeInTheDocument();
  });

  it("has entries for the terms the game shows on screen", async () => {
    renderManual();
    for (const term of [
      "capacity factor",
      "ramp rate",
      "peaker",
      "round-trip efficiency",
      "rates",
      "carbon fee",
    ]) {
      await search(term);
      expect(listedTitles().length).toBeGreaterThan(0);
    }
  });

  it("includes every shared game symbol in the symbol guide", async () => {
    renderManual();
    await userEvent.click(entryHeader(MANUAL_ENTRY.SYMBOLS));
    const legend = screen.getByTestId("concept-legend");
    CONCEPT_NAMES.forEach((concept) => {
      expect(
        within(legend).getByLabelText(CONCEPT_LABELS[concept]),
      ).toHaveAttribute("data-concept", concept);
    });
  });

  it("expands matched entries and highlights the match", async () => {
    renderManual();
    // Collapsed to start with, so the body isn't in the DOM at all
    expect(entryHeader(MANUAL_ENTRY.BLACKOUTS)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await search("rolling blackouts");
    expect(entryHeader(MANUAL_ENTRY.BLACKOUTS)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // The phrase is mid-paragraph, so only the highlight wrapper matches it exactly
    expect(screen.getByText("rolling blackouts").tagName).toBe("MARK");
  });

  it("lets the player collapse an auto-expanded result", async () => {
    renderManual();
    await search("rolling blackouts");
    await userEvent.click(entryHeader(MANUAL_ENTRY.BLACKOUTS));
    expect(entryHeader(MANUAL_ENTRY.BLACKOUTS)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("shows an empty state with somewhere to ask", async () => {
    renderManual();
    await search("hydrogen fuel cells");
    expect(listedTitles()).toHaveLength(0);
    expect(
      screen.getByText(/No entries match "hydrogen fuel cells"/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Let us know" })).toHaveAttribute(
      "href",
      "/about.html#feedback",
    );
  });

  it("clears the search from the adornment button", async () => {
    renderManual();
    await search("carbon");
    await userEvent.click(screen.getByLabelText("clear search"));
    expect(screen.getByLabelText("Search the manual")).toHaveValue("");
    // Back to the full list rather than the filtered one
    expect(entryHeader(MANUAL_ENTRY.BTU)).toBeInTheDocument();
  });

  it("has no clear button until there's something to clear", () => {
    renderManual();
    expect(screen.queryByLabelText("clear search")).not.toBeInTheDocument();
  });

  it("opens the entry a deep link points at, and nothing else", () => {
    renderManual(MANUAL_ENTRY.TOTAL_COST_OF_ENERGY);
    expect(entryHeader(MANUAL_ENTRY.TOTAL_COST_OF_ENERGY)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(entryHeader(MANUAL_ENTRY.BLACKOUTS)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("gives every entry a keyboard-reachable, labelled control", () => {
    renderManual();
    const header = entryHeader(MANUAL_ENTRY.SCORE);
    expect(header).toHaveAttribute("tabindex", "0");
    expect(header).toHaveAttribute("aria-expanded");
    expect(header).toHaveAttribute("aria-controls");
  });

  it("lists the point values in a column rather than as run-on text", async () => {
    renderManual();
    await userEvent.click(entryHeader(MANUAL_ENTRY.SCORE));
    const row = screen
      .getAllByRole("row")
      .find((r: HTMLElement) =>
        (r.textContent || "").includes("per TWh of blackouts"),
      );
    expect(row).toBeDefined();
    // The investor penalty, in its own cell rather than run together with the text
    expect(within(row as HTMLElement).getByText("-8")).toBeInTheDocument();
  });

  it("remembers the search term across visits", async () => {
    const view = renderManual();
    await search("carbon");
    view.unmount();

    renderManual();
    expect(screen.getByLabelText("Search the manual")).toHaveValue("carbon");
  });

  it("starts a deep link fresh rather than inside the last search", async () => {
    const view = renderManual();
    await search("carbon");
    view.unmount();

    renderManual(MANUAL_ENTRY.RAMP_RATE);
    expect(screen.getByLabelText("Search the manual")).toHaveValue("");
  });
});

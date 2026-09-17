import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MANUAL_ENTRY } from "../../data/Manual";
import { CONCEPT_LABELS, CONCEPT_NAMES } from "../base/ConceptIcon";
import Manual, { clearManualMemory } from "./Manual";

function renderManual(focusEntry?: string) {
  return render(<Manual onBack={() => undefined} focusEntry={focusEntry} />);
}

function entryHeader(title: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(title, "i") });
}

function search(term: string) {
  const box = screen.getByLabelText("Search the manual");
  fireEvent.change(box, { target: { value: term } });
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

  // The old filter only looked at children that were plain strings, so any paragraph
  // containing an element (<strong>, a nested list, ...) was invisible to search
  it("finds representative terms inside mixed markup", async () => {
    renderManual();
    for (const [term, title] of [
      ["merit order", MANUAL_ENTRY.FORECASTS],
      ["dispatch order", MANUAL_ENTRY.FORECASTS],
      ["peak shortage", MANUAL_ENTRY.FORECASTS],
      ["job security", MANUAL_ENTRY.BLACKOUTS],
      ["variable O&M", MANUAL_ENTRY.TOTAL_COST_OF_ENERGY],
    ]) {
      await search(term);
      expect(entryHeader(title)).toBeInTheDocument();
    }
  });

  it("finds terms by keyword as well as by title", async () => {
    renderManual();
    await search("LCOE");
    expect(entryHeader(MANUAL_ENTRY.TOTAL_COST_OF_ENERGY)).toBeInTheDocument();
  });

  it.each([
    ["megawatt", MANUAL_ENTRY.POWER_AND_ENERGY],
    ["megawatt-hour", MANUAL_ENTRY.POWER_AND_ENERGY],
    ["meaningful decisions", MANUAL_ENTRY.SCORE],
  ])("finds the right lesson when searching %s", (term, title) => {
    renderManual();
    search(term);
    expect(
      screen.getByRole("button", { name: title, expanded: true }),
    ).toBeVisible();
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
    await search("available supply");
    expect(entryHeader(MANUAL_ENTRY.BLACKOUTS)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // The phrase is mid-paragraph, so only the highlight wrapper matches it exactly
    screen.getAllByText("available supply").forEach((match) => {
      expect(match.tagName).toBe("MARK");
    });
  });

  it("lets the player collapse an auto-expanded result", async () => {
    renderManual();
    await search("available supply");
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

it("opens a related entry outside the search results and focuses its expanded heading", async () => {
  clearManualMemory();
  renderManual();
  search("round-trip");
  await userEvent.click(
    within(
      screen.getByRole("navigation", {
        name: "Related to Round-trip Efficiency",
      }),
    ).getByRole("button", { name: "Power and Energy" }),
  );
  expect(screen.getByLabelText("Search the manual")).toHaveValue("");
  const heading = screen.getByRole("button", {
    name: "Power and Energy",
    expanded: true,
  });
  expect(heading).toHaveAttribute("aria-expanded", "true");
  expect(heading).toHaveFocus();
  expect(
    screen.getByText(/Holding 80 MWh does not let it supply 80 MW/),
  ).toBeVisible();
});

it("refocuses and scrolls to the same related entry after search hid it", async () => {
  clearManualMemory();
  renderManual(MANUAL_ENTRY.POWER_AND_ENERGY);
  search("round-trip");
  const scrollIntoView = jest.fn();
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  try {
    await userEvent.click(
      within(
        screen.getByRole("navigation", {
          name: "Related to Round-trip Efficiency",
        }),
      ).getByRole("button", { name: "Power and Energy" }),
    );
    expect(screen.getByLabelText("Search the manual")).toHaveValue("");
    const heading = screen.getByRole("button", {
      name: "Power and Energy",
      expanded: true,
    });
    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(heading).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  } finally {
    HTMLElement.prototype.scrollIntoView = original;
  }
});

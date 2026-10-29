import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import {
  MANUAL_ENTRY,
  MANUAL_ENTRIES,
  ManualEntryTitleType,
} from "../base/ManualEntries";
import ManualEntryLink from "../base/ManualEntryLink";
import { CONCEPT_LABELS, CONCEPT_NAMES } from "../base/ConceptIcon";
import Manual, { clearManualMemory } from "./Manual";

function renderManual(
  focusEntry?: string,
  onFollowLink: (
    to: ManualEntryTitleType,
    from: ManualEntryTitleType,
  ) => void = () => undefined,
) {
  return render(
    <LinkedManual focusEntry={focusEntry} onFollowLink={onFollowLink} />,
  );
}

// Plays the container's part: a followed link becomes the next focus entry, as the card
// reducer makes it
function LinkedManual(props: {
  focusEntry?: string;
  onFollowLink: (to: ManualEntryTitleType, from: ManualEntryTitleType) => void;
}) {
  const [focus, setFocus] = React.useState({ entry: props.focusEntry, key: 0 });
  return (
    <Manual
      onBack={() => undefined}
      focusEntry={focus.entry}
      focusKey={focus.key}
      onFollowLink={(to, from) => {
        props.onFollowLink(to, from);
        setFocus((previous) => ({ entry: to, key: previous.key + 1 }));
      }}
    />
  );
}

// Every link an entry's prose makes, in order
function linkTargets(node: React.ReactNode): ManualEntryTitleType[] {
  if (Array.isArray(node)) return node.flatMap(linkTargets);
  if (!React.isValidElement(node)) return [];
  const props = node.props as {
    children?: React.ReactNode;
    to?: ManualEntryTitleType;
  };
  return node.type === ManualEntryLink && props.to
    ? [props.to, ...linkTargets(props.children)]
    : linkTargets(props.children);
}

function entryHeader(title: string): HTMLElement {
  return screen
    .getAllByRole("button", { name: new RegExp(title, "i") })
    .find((element) => element.hasAttribute("aria-expanded"))!;
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
  it("finds terms in mixed markup, keywords and hyphenated units", () => {
    renderManual();
    for (const [term, title] of [
      ["merit order", MANUAL_ENTRY.FORECASTS],
      ["dispatch order", MANUAL_ENTRY.FORECASTS],
      ["peak shortage", MANUAL_ENTRY.FORECASTS],
      ["job security", MANUAL_ENTRY.BLACKOUTS],
      ["variable O&M", MANUAL_ENTRY.TOTAL_COST_OF_ENERGY],
      ["LCOE", MANUAL_ENTRY.TOTAL_COST_OF_ENERGY],
      ["megawatt", MANUAL_ENTRY.POWER_AND_ENERGY],
      ["megawatt-hour", MANUAL_ENTRY.POWER_AND_ENERGY],
      ["scoring", MANUAL_ENTRY.SCORE],
    ]) {
      search(term);
      expect(
        screen.getByRole("button", { name: title, expanded: true }),
      ).toBeVisible();
    }
  });

  it("links weather damage from operating costs and finds it by hazard", () => {
    renderManual(MANUAL_ENTRY.OPERATING_COSTS);
    expect(
      screen.getByRole("link", { name: "weather damage" }),
    ).toHaveAttribute("href", "#manual-weather-damage");
    search("hail");
    expect(
      screen.getByRole("button", {
        name: MANUAL_ENTRY.WEATHER_DAMAGE,
        expanded: true,
      }),
    ).toBeVisible();
    expect(
      screen.getByText(/only offered where winters get cold enough to matter/),
    ).toBeVisible();
  });

  it("includes every shared game symbol in the symbol guide", async () => {
    renderManual();
    await userEvent.click(entryHeader(MANUAL_ENTRY.SYMBOLS));
    const legend = screen.getByTestId("concept-legend");
    expect(within(legend).getByText("Severe weather")).toBeInTheDocument();
    CONCEPT_NAMES.forEach((concept) => {
      expect(
        within(legend).getByLabelText(CONCEPT_LABELS[concept]),
      ).toHaveAttribute("data-concept", concept);
    });
  });

  it("expands and highlights search matches, then lets the player collapse them", async () => {
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
      "https://forms.gle/nSpkVzcFcXMQMMgb9",
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

it("links each entry to others inline, once per target and never to itself", () => {
  const titles = new Set<string>(MANUAL_ENTRIES.map((entry) => entry.title));
  for (const entry of MANUAL_ENTRIES) {
    const targets = linkTargets(entry.entry);
    targets.forEach((target) => expect(titles.has(target)).toBe(true));
    expect(targets).not.toContain(entry.title);
    expect(new Set(targets).size).toBe(targets.length);
  }
});

it("follows an inline link out of the search results and focuses its expanded heading", async () => {
  clearManualMemory();
  const onFollowLink = jest.fn();
  renderManual(undefined, onFollowLink);
  search("round-trip");
  await userEvent.click(screen.getByRole("link", { name: "power rating" }));
  expect(onFollowLink).toHaveBeenCalledWith(
    MANUAL_ENTRY.POWER_AND_ENERGY,
    MANUAL_ENTRY.ROUND_TRIP_EFFICIENCY,
  );
  expect(screen.getByLabelText("Search the manual")).toHaveValue("");
  const heading = screen.getByRole("button", {
    name: "Power and Energy",
    expanded: true,
  });
  expect(heading).toHaveFocus();
  expect(
    screen.getByText(/Holding 80 MWh does not let it supply 80 MW/),
  ).toBeVisible();
});

it("refocuses and scrolls to the entry already in focus after search hid it", async () => {
  clearManualMemory();
  renderManual(MANUAL_ENTRY.POWER_AND_ENERGY);
  search("round-trip");
  const scrollIntoView = jest.fn();
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  try {
    await userEvent.click(screen.getByRole("link", { name: "power rating" }));
    expect(screen.getByLabelText("Search the manual")).toHaveValue("");
    const heading = screen.getByRole("button", {
      name: "Power and Energy",
      expanded: true,
    });
    expect(heading).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  } finally {
    HTMLElement.prototype.scrollIntoView = original;
  }
});

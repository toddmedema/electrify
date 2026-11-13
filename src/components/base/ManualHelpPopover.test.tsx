import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ManualHelpPopover, { setManualHelpAnchor } from "./ManualHelpPopover";
import { MANUAL_ENTRY } from "./ManualEntries";
import {
  resetInputPresentation,
  updateInputPresentation,
} from "../../desktop/InputPresentation";

afterEach(() => {
  resetInputPresentation();
  setManualHelpAnchor(null);
  jest.restoreAllMocks();
});

it("anchors pointer help to its term and centers controller help independently of layout", () => {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  jest.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
    width: 40,
    height: 40,
    top: 120,
    bottom: 160,
    left: 80,
    right: 120,
    x: 80,
    y: 120,
    toJSON: () => undefined,
  });
  setManualHelpAnchor(anchor);
  const view = render(
    <ManualHelpPopover
      entry={MANUAL_ENTRY.POWER_AND_ENERGY}
      onClose={jest.fn()}
      onRelated={jest.fn()}
    />,
  );
  const help = screen.getByRole("dialog", { name: "Manual help" });
  expect(help).toHaveStyle({ top: "160px", left: "100px" });
  act(() => updateInputPresentation({ active: true }));
  expect(help).toHaveStyle({
    top: `${window.innerHeight / 2}px`,
    left: `${window.innerWidth / 2}px`,
  });
  act(() => updateInputPresentation({ active: false }));
  expect(help).toHaveStyle({ top: "160px", left: "100px" });
  view.unmount();
  anchor.remove();
});

describe("ManualHelpPopover", () => {
  it("shows one entry beside the term instead of the whole manual", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    setManualHelpAnchor(anchor);
    render(
      <ManualHelpPopover
        entry={MANUAL_ENTRY.POWER_AND_ENERGY}
        onClose={() => undefined}
        onRelated={() => undefined}
      />,
    );
    const help = screen.getByRole("dialog", { name: "Manual help" });
    expect(
      within(help).getByRole("heading", {
        name: MANUAL_ENTRY.POWER_AND_ENERGY,
      }),
    ).toBeInTheDocument();
    expect(help).toHaveTextContent("how fast electricity is produced");
    // No search box or list of other entries: this is a lookup, not the manual
    expect(
      within(help).queryByRole("textbox", { name: "Search the manual" }),
    ).toBeNull();
    anchor.remove();
  });

  it("opens linked entries in place and closes from its button", async () => {
    const onClose = jest.fn();
    const onRelated = jest.fn();
    render(
      <ManualHelpPopover
        entry={MANUAL_ENTRY.POWER_AND_ENERGY}
        onClose={onClose}
        onRelated={onRelated}
      />,
    );
    const help = screen.getByRole("dialog", { name: "Manual help" });
    await userEvent.click(
      within(help).getByRole("link", { name: "storage losses" }),
    );
    expect(onRelated).toHaveBeenCalledWith(MANUAL_ENTRY.ROUND_TRIP_EFFICIENCY);
    await userEvent.click(within(help).getByRole("button", { name: "close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing while closed", () => {
    render(
      <ManualHelpPopover
        onClose={() => undefined}
        onRelated={() => undefined}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

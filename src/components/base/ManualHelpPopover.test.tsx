import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MANUAL_ENTRY } from "./ManualEntries";
import ManualHelpPopover, { setManualHelpAnchor } from "./ManualHelpPopover";

describe("ManualHelpPopover", () => {
  afterEach(() => setManualHelpAnchor(null));

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

  it("opens related entries in place and closes from its button", async () => {
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
      within(
        within(help).getByRole("navigation", { name: /Related to/ }),
      ).getByRole("button", { name: MANUAL_ENTRY.ROUND_TRIP_EFFICIENCY }),
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

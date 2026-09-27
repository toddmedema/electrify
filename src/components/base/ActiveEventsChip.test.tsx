import { fireEvent, render, screen } from "@testing-library/react";
import ActiveEventsChip from "./ActiveEventsChip";
import { ActiveEventGroupType } from "../views/StoryEventSelectors";

const fire: ActiveEventGroupType = {
  key: "fire",
  title: "Wildfire emergency",
  concept: "danger",
  importance: "CRITICAL",
  count: 1,
  throughLabel: "through Mar 2026",
};
const hail: ActiveEventGroupType = {
  key: "hail",
  title: "Hail damage",
  importance: "CRITICAL",
  count: 4,
  throughLabel: "through Jan 2026",
};
const cold: ActiveEventGroupType = {
  key: "cold",
  title: "Extreme cold",
  importance: "NOTABLE",
  count: 1,
  throughLabel: "through Feb 2026",
};

describe("ActiveEventsChip", () => {
  it("renders nothing without active events", () => {
    const { container } = render(
      <ActiveEventsChip groups={[]} onOpen={() => undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names a single event and opens Events", () => {
    const onOpen = jest.fn();
    render(<ActiveEventsChip groups={[cold]} onOpen={onOpen} />);
    const chip = screen.getByRole("button", {
      name: "Active events: Extreme cold, through Feb 2026. Open Events.",
    });
    expect(chip).toHaveTextContent("Extreme cold");
    expect(chip).not.toHaveClass("activeEventsChip-critical");
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("leads with the first group and counts the rest", () => {
    render(
      <ActiveEventsChip groups={[fire, hail, cold]} onOpen={() => undefined} />,
    );
    const chip = screen.getByRole("button", { name: /^Active events:/ });
    expect(chip).toHaveClass("activeEventsChip-critical");
    expect(chip).toHaveTextContent("Wildfire emergency");
    expect(chip).toHaveTextContent("+2");
    // Shown instead of the title once the row is too narrow for it.
    expect(chip).toHaveTextContent("3 events");
    expect(chip).toHaveAccessibleName(
      expect.stringContaining(
        "Hail damage at 4 sites (critical), through Jan 2026",
      ),
    );
  });
});

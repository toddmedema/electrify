import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InsightEventRail from "./InsightEventRail";

it("identifies each event and its date before opening details", () => {
  render(
    <InsightEventRail
      events={[
        {
          key: "data-centers",
          title: "Data Centers coming online",
          label: "Expected Jan 2026",
          message: "Demand rising as new load connects.",
        },
        {
          key: "fee",
          title: "Carbon fee rising",
          label: "Expected Jan 2027",
          message: "Coal and gas will cost more to run.",
        },
      ]}
      onActiveChange={jest.fn()}
      onZoom={jest.fn()}
    />,
  );

  const events = screen.getByRole("region", {
    name: "Upcoming scenario events",
  });
  for (const [title, date] of [
    ["Data Centers coming online", "Jan 2026"],
    ["Carbon fee rising", "Jan 2027"],
  ]) {
    const chip = within(events).getByRole("button", {
      name: `Expected ${date}: ${title}`,
    });
    expect(within(chip).getByText(title)).toBeVisible();
    expect(within(chip).getByText(date)).toBeVisible();
    expect(chip).toHaveAttribute("aria-expanded", "false");
  }
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("restores the details anchor when a selected event returns to the viewport", () => {
  const event = {
    key: "one",
    title: "Supply change",
    label: "January 2026",
    message: "Demand rises.",
  };
  const props = {
    activeKey: "one",
    onActiveChange: jest.fn(),
    onZoom: jest.fn(),
  };
  const { rerender } = render(<InsightEventRail {...props} events={[event]} />);
  expect(screen.getByRole("dialog", { name: "Supply change" })).toBeVisible();
  rerender(<InsightEventRail {...props} events={[]} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  rerender(<InsightEventRail {...props} events={[event]} />);
  expect(screen.getByRole("dialog", { name: "Supply change" })).toBeVisible();
});

it("focuses event details and restores the trigger on Escape and Zoom", async () => {
  const user = userEvent.setup();
  const zoom = jest.fn();
  function Rail() {
    const [activeKey, onActiveChange] = React.useState<string>();
    return (
      <>
        <InsightEventRail
          events={[
            {
              key: "one",
              title: "Supply change",
              label: "January 2026",
              message: "Demand rises.",
            },
          ]}
          activeKey={activeKey}
          onActiveChange={onActiveChange}
          onZoom={zoom}
        />
        <button>Outside</button>
      </>
    );
  }
  render(<Rail />);
  const trigger = screen.getByRole("button", { name: /January 2026/ });
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("dialog")).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
  await user.keyboard("{Enter}");
  await user.tab();
  expect(screen.getByRole("button", { name: "Zoom to event" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(zoom).toHaveBeenCalledTimes(1);
  expect(trigger).toHaveFocus();
  await user.keyboard("{Enter}");
  await user.click(screen.getByRole("button", { name: "Outside" }));
  expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

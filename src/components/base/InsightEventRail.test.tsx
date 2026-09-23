import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InsightEventRail from "./InsightEventRail";

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

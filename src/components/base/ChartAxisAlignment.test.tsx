import * as React from "react";
import { render } from "@testing-library/react";
import {
  ChartAxisAlignment,
  ChartAxisAlignmentContext,
} from "./ChartAxisAlignment";

function alignment() {
  let value: React.ContextType<typeof ChartAxisAlignmentContext> = null;
  const Probe = () => {
    value = React.useContext(ChartAxisAlignmentContext);
    return null;
  };
  render(
    <ChartAxisAlignment>
      <Probe />
    </ChartAxisAlignment>,
  );
  return value!;
}

describe("ChartAxisAlignment", () => {
  it("lets a replaced plot finish a queued redraw without throwing", () => {
    // uPlot runs its queued commit after destroy, asking its axes for their size once more.
    const shared = alignment();
    const stale = shared.register(() => undefined);
    stale.destroy();
    expect(stale.measure(48)).toBe(48);
  });
});

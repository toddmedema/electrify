/* eslint-disable testing-library/no-node-access -- SVG marker geometry is part of point inspection. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import InteractiveSparkline from "./InteractiveSparkline";

it("announces keyboard selections through the single caption while focus stays on the chart", () => {
  render(
    <InteractiveSparkline
      label="Monthly water"
      ariaLabel="Water trend"
      values={[0.5, 0.1, 0.3]}
      defaultIndex={1}
      caption={(index) => `Month ${index + 1}: ${[50, 10, 30][index]}%`}
    />,
  );
  const group = screen.getByRole("group", { name: "Monthly water" });
  const readout = screen.getByRole("status");
  expect(readout).toHaveAttribute("aria-live", "polite");
  expect(readout).toHaveAttribute("aria-atomic", "true");
  expect(group).toHaveAttribute("aria-describedby", readout.id);
  act(() => group.focus());
  for (const [key, caption] of [
    ["Home", "Month 1: 50%"],
    ["ArrowRight", "Month 2: 10%"],
    ["End", "Month 3: 30%"],
  ]) {
    fireEvent.keyDown(group, { key });
    expect(readout).toHaveTextContent(caption);
    expect(group).toHaveAccessibleDescription(caption);
    expect(group).toHaveFocus();
  }
  const bounds = jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({ left: 10, width: 72 } as DOMRect);
  fireEvent(
    screen.getByRole("img", { name: "Water trend" }),
    new MouseEvent("pointermove", { bubbles: true, clientX: 10 }),
  );
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(readout).toHaveTextContent("Month 1: 50%");
  bounds.mockRestore();
});

it("inspects arbitrary-length series by pointer and keyboard and resets to its summary", () => {
  render(
    <InteractiveSparkline
      label="Monthly water"
      ariaLabel="Water trend"
      values={[0.5, 0.1, 0.3]}
      defaultIndex={1}
      caption={(index) => `Month ${index + 1}: ${[50, 10, 30][index]}%`}
      defaultCaption="Low month: 10%"
    />,
  );
  const group = screen.getByRole("group", { name: "Monthly water" });
  const chart = screen.getByRole("img", { name: "Water trend" });
  const bounds = jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({ left: 10, width: 72 } as DOMRect);
  expect(group).toHaveAccessibleDescription("Low month: 10%");
  for (const [x, month] of [
    [-100, 1],
    [46, 2],
    [200, 3],
  ]) {
    fireEvent(
      chart,
      new MouseEvent("pointermove", { bubbles: true, clientX: x }),
    );
    expect(group).toHaveAccessibleDescription(new RegExp(`Month ${month}:`));
    expect(chart.querySelector("circle")).toHaveAttribute(
      "cx",
      `${(month - 1) * 36}.0`,
    );
  }
  fireEvent.pointerLeave(group);
  expect(group).toHaveAccessibleDescription("Low month: 10%");
  fireEvent(
    chart,
    new MouseEvent("pointerdown", { bubbles: true, clientX: 10 }),
  );
  expect(group).toHaveAccessibleDescription("Month 1: 50%");
  fireEvent.pointerCancel(group);
  expect(group).toHaveAccessibleDescription("Low month: 10%");
  for (const [key, month] of [
    ["ArrowRight", 3],
    ["ArrowRight", 3],
    ["Home", 1],
    ["ArrowLeft", 1],
    ["End", 3],
    ["ArrowLeft", 2],
  ] as const) {
    fireEvent.keyDown(group, { key });
    expect(group).toHaveAccessibleDescription(new RegExp(`Month ${month}:`));
  }
  const vertical = new KeyboardEvent("keydown", {
    key: "ArrowDown",
    bubbles: true,
    cancelable: true,
  });
  fireEvent(group, vertical);
  expect(vertical.defaultPrevented).toBe(false);
  fireEvent.blur(group);
  expect(group).toHaveAccessibleDescription("Low month: 10%");
  bounds.mockRestore();
});

it("clamps selection when an inspected series shrinks, and omits non-trends", () => {
  const props = {
    label: "Prices",
    ariaLabel: "Price trend",
    defaultIndex: 11,
    caption: (index: number) => `Point ${index}`,
  };
  const { rerender } = render(
    <InteractiveSparkline {...props} values={Array(12).fill(1)} />,
  );
  fireEvent.keyDown(screen.getByRole("group"), { key: "End" });
  rerender(<InteractiveSparkline {...props} values={[1, 2]} />);
  expect(screen.getByRole("group")).toHaveAccessibleDescription("Point 1");
  rerender(<InteractiveSparkline {...props} values={[]} />);
  expect(screen.queryByRole("group")).not.toBeInTheDocument();
});

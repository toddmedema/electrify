import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import ProductionMixBar from "./ProductionMixBar";
import userEvent from "@testing-library/user-event";
import { fuelColors, setThemeMode } from "../../Theme";

afterEach(() => act(() => setThemeMode("light")));

it("shows only a proportional bar until inspected, including supply flows without counting loads", async () => {
  render(
    <ProductionMixBar
      tick={{
        supplyByFuel: { Wind: 30e6, Sun: 0, Uranium: 60e6 },
        storageDischargeW: 5e6,
        importedW: 5e6,
      }}
      fuelOrder={["Sun", "Wind", "Uranium"]}
    />,
  );
  await waitFor(() =>
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button")).not.toHaveTextContent(
    /Solar|Wind|Nuclear|MW/,
  );
  const segments = screen.getAllByTestId("production-mix-segment");
  expect(
    Array.from(segments).map((segment) => segment.getAttribute("style")),
  ).toEqual([
    expect.stringContaining("width: 30%"),
    expect.stringContaining("width: 60%"),
    expect.stringContaining("width: 5%"),
    expect.stringContaining("width: 5%"),
  ]);
  fireEvent.click(screen.getByRole("button"));
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip).toHaveTextContent(
    "Solar0WWind30MWNuclear60MWStorage discharge5MWImports5MW",
  );
  expect(within(tooltip).getByText("100MW")).toBeVisible();
});

it("supports keyboard inspection and dismissal", async () => {
  render(
    <ProductionMixBar
      tick={{ supplyByFuel: { Wind: 1e6 } }}
      fuelOrder={["Wind"]}
    />,
  );
  const button = screen.getByRole("button");
  await userEvent.setup().tab();
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Wind1MW");
  expect(button).toHaveAccessibleDescription(/Supply now.*Wind 1MW/);
  fireEvent.keyDown(button, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
  );
});

it("keeps the highlighted source under a stationary mouse as live production changes", async () => {
  const { rerender } = render(
    <ProductionMixBar
      tick={{ supplyByFuel: { Wind: 60e6, Uranium: 40e6 } }}
      fuelOrder={["Wind", "Uranium"]}
    />,
  );
  const button = screen.getByRole("button");
  jest.spyOn(button, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    right: 144,
    top: 0,
    bottom: 40,
    width: 144,
    height: 40,
    toJSON: () => ({}),
  });
  jest
    .spyOn(screen.getByTestId("production-mix-track"), "getBoundingClientRect")
    .mockReturnValue({
      x: 20,
      y: 0,
      left: 20,
      right: 120,
      top: 0,
      bottom: 40,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    });
  fireEvent.click(button);
  await screen.findByRole("tooltip");
  // jsdom has no PointerEvent; preserve the mouse type and coordinates React reads.
  fireEvent(
    button,
    Object.assign(
      new MouseEvent("pointermove", { bubbles: true, clientX: 60 }),
      { pointerType: "mouse" },
    ),
  );
  expect(screen.getAllByTestId("production-mix-source")[0]).toHaveClass(
    "isHovered",
  );
  expect(screen.getAllByTestId("production-mix-segment")[0]).toHaveClass(
    "isHovered",
  );

  rerender(
    <ProductionMixBar
      tick={{ supplyByFuel: { Wind: 20e6, Uranium: 80e6 } }}
      fuelOrder={["Wind", "Uranium"]}
    />,
  );
  expect(screen.getAllByTestId("production-mix-source")[0]).not.toHaveClass(
    "isHovered",
  );
  expect(screen.getAllByTestId("production-mix-source")[1]).toHaveClass(
    "isHovered",
  );
  expect(screen.getAllByTestId("production-mix-segment")[1]).toHaveClass(
    "isHovered",
  );

  // The disclosure cue is outside the proportional rail, so it must not select a fuel.
  fireEvent(
    button,
    Object.assign(
      new MouseEvent("pointermove", { bubbles: true, clientX: 130 }),
      { pointerType: "mouse" },
    ),
  );
  screen.getAllByTestId("production-mix-source").forEach((source) => {
    expect(source).not.toHaveClass("isHovered");
  });

  rerender(
    <ProductionMixBar
      tick={{ supplyByFuel: { Wind: 0, Uranium: 0 } }}
      fuelOrder={["Wind", "Uranium"]}
    />,
  );
  expect(screen.getAllByTestId("production-mix-source")[1]).not.toHaveClass(
    "isHovered",
  );
  expect(screen.queryAllByTestId("production-mix-segment")).toHaveLength(0);
});

it.each([null, { supplyByFuel: { Sun: 0 } }])(
  "keeps an empty track inspectable when production is absent: %s",
  async (tick) => {
    render(<ProductionMixBar tick={tick} fuelOrder={["Sun"]} />);
    expect(screen.queryAllByTestId("production-mix-segment")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      tick ? "No production now" : "Production unavailable",
    );
  },
);

it("updates the bar and its legend together when the palette changes", async () => {
  render(
    <ProductionMixBar
      tick={{ supplyByFuel: { Wind: 1e6 } }}
      fuelOrder={["Wind"]}
    />,
  );
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("tooltip");
  // Theme changes arrive through the same subscription as the canvas charts.
  act(() => setThemeMode("dark"));
  expect(screen.getByTestId("production-mix-segment")).toHaveStyle({
    backgroundColor: fuelColors().Wind,
  });
  expect(screen.getByTestId("production-mix-swatch")).toHaveStyle({
    backgroundColor: fuelColors().Wind,
  });
});

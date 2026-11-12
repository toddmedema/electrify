import * as React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  GameToolMemoryContext,
  useToolScroll,
  useToolFocusMemory,
} from "./GameToolMemory";

test("opening a detail remembers a scroll that has not dispatched its scroll event yet", () => {
  function Tool() {
    const [detail, setDetail] = React.useState(false);
    const ref = useToolScroll<HTMLDivElement>(detail ? "detail" : "list");
    return (
      <div ref={ref} role="region" aria-label="Tool">
        <button onClick={() => setDetail(!detail)}>
          {detail ? "Back" : "Open detail"}
        </button>
      </div>
    );
  }
  const memory = new Map<string, unknown>();
  render(
    <GameToolMemoryContext.Provider value={memory}>
      <Tool />
    </GameToolMemoryContext.Provider>,
  );
  const body = screen.getByRole("region", { name: "Tool" });
  // Browsers dispatch scroll asynchronously, including when clicking scrolls a target into view.
  body.scrollTop = 180;
  fireEvent.click(screen.getByRole("button", { name: "Open detail" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(body.scrollTop).toBe(180);
});

afterEach(() => delete document.documentElement.dataset.controllerInput);

test.each(["keyboard", "controller"])(
  "%s tools restore the same semantic control after remount and delayed readiness without a layout preference",
  async (device) => {
    const memory = new Map<string, unknown>();
    function Workspace({
      tool,
      loading = false,
    }: {
      tool: string;
      loading?: boolean;
    }) {
      const ref = React.useRef<HTMLDivElement>(null);
      useToolFocusMemory(ref, memory, tool);
      return (
        <div ref={ref}>
          <section data-game-tool={tool} key={tool}>
            <button>First</button>
            <button aria-label={`Inspect ${tool}`} disabled={loading}>
              Inspect
            </button>
          </section>
        </div>
      );
    }
    const view = render(<Workspace tool="BUILD_GENERATORS" />);
    if (device === "controller")
      document.documentElement.dataset.controllerInput = "true";
    else fireEvent.keyDown(document, { key: "Tab" });
    act(() =>
      screen.getByRole("button", { name: "Inspect BUILD_GENERATORS" }).focus(),
    );
    view.rerender(<Workspace tool="INSIGHTS" />);
    act(() => screen.getByRole("button", { name: "First" }).focus());
    view.rerender(<Workspace tool="BUILD_GENERATORS" loading />);
    expect(
      screen.getByRole("button", { name: "Inspect BUILD_GENERATORS" }),
    ).toBeDisabled();
    view.rerender(<Workspace tool="BUILD_GENERATORS" />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Inspect BUILD_GENERATORS" }),
      ).toHaveFocus(),
    );
  },
);

test("pointer tool changes and pointer input during a pending restore retain pointer focus", async () => {
  const memory = new Map<string, unknown>();
  function Workspace({ tool }: { tool: string }) {
    const ref = React.useRef<HTMLDivElement>(null);
    useToolFocusMemory(ref, memory, tool);
    return (
      <div ref={ref}>
        <button>Dock</button>
        <section key={tool} data-game-tool={tool}>
          <button>Inspect {tool}</button>
        </section>
      </div>
    );
  }
  const view = render(<Workspace tool="Build" />);
  screen.getByRole("button", { name: "Inspect Build" }).focus();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Dock" }));
  screen.getByRole("button", { name: "Dock" }).focus();
  view.rerender(<Workspace tool="Insights" />);
  view.rerender(<Workspace tool="Build" />);
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(screen.getByRole("button", { name: "Dock" })).toHaveFocus();

  fireEvent.keyDown(document, { key: "Tab" });
  view.rerender(<Workspace tool="Insights" />);
  view.rerender(<Workspace tool="Build" />);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Dock" }));
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(screen.getByRole("button", { name: "Dock" })).toHaveFocus();
});

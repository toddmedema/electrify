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

test("TV tools restore the same semantic control after remount and delayed readiness", async () => {
  const memory = new Map<string, unknown>();
  function Workspace({
    tool,
    loading = false,
  }: {
    tool: string;
    loading?: boolean;
  }) {
    const ref = React.useRef<HTMLDivElement>(null);
    useToolFocusMemory(ref, memory, tool, true);
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
});

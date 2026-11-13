import { render, screen } from "@testing-library/react";
import { revealControl } from "./RevealControl";

it("scrolls intentional surfaces without moving hidden shell tracks in any layout", () => {
  render(
    <div data-testid="shell" style={{ overflowY: "hidden" }}>
      <div data-testid="pane" style={{ overflowY: "auto" }}>
        <button>Purchase</button>
      </div>
    </div>,
  );
  const shell = screen.getByTestId("shell");
  const pane = screen.getByTestId("pane");
  const control = screen.getByRole("button");
  Object.defineProperty(pane, "clientHeight", { value: 200 });
  jest
    .spyOn(pane, "getBoundingClientRect")
    .mockReturnValue({ top: 20 } as DOMRect);
  jest
    .spyOn(control, "getBoundingClientRect")
    .mockReturnValue({ top: 260, bottom: 300 } as DOMRect);
  revealControl(control);
  expect(pane.scrollTop).toBe(80);
  expect(shell.scrollTop).toBe(0);
  jest.restoreAllMocks();
});

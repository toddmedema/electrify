import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { DialogTitle } from "@mui/material";
import CouchDialog from "./Dialog";
import { ControlsLegend } from "../desktop/InputHints";

it("updates legend clearance outside resize delivery to avoid ancestor resize feedback", async () => {
  let notify: ResizeObserverCallback = () => undefined;
  const observer = {
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  };
  const resize = jest
    .spyOn(window, "ResizeObserver")
    .mockImplementation((callback) => {
      notify = callback;
      return observer;
    });
  const view = render(
    <CouchDialog
      open
      data-testid="shared-dialog"
      controls={<div className="couchControlsLegend">Controls</div>}
    >
      <DialogTitle>Settings</DialogTitle>
    </CouchDialog>,
  );
  const root = screen.getByTestId("shared-dialog");
  const bounds = jest
    .spyOn(screen.getByText("Controls"), "getBoundingClientRect")
    .mockReturnValue({ height: 123.25 } as DOMRect);
  try {
    const before = root.style.getPropertyValue("--couch-controls-height");
    act(() => notify([], observer));
    expect(root.style.getPropertyValue("--couch-controls-height")).toBe(before);
    await waitFor(() =>
      expect(root).toHaveStyle({ "--couch-controls-height": "124px" }),
    );
  } finally {
    view.unmount();
    bounds.mockRestore();
    resize.mockRestore();
  }
});

it("keeps the control legend inside the active modal dialog's accessible scope", () => {
  render(
    <CouchDialog
      open
      aria-label="TV settings"
      controls={<ControlsLegend glyphs={{ back: { label: "B" } }} />}
    >
      <DialogTitle>Settings</DialogTitle>
    </CouchDialog>,
  );
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(
    within(dialog).getByRole("complementary", { name: "Controller controls" }),
  ).toBeVisible();
});

it("passes Escape through the same close handler as the shared dialog", () => {
  const onClose = jest.fn();
  render(
    <CouchDialog
      open
      aria-label="TV settings"
      onClose={onClose}
      controls={<ControlsLegend glyphs={{}} />}
    >
      <DialogTitle>Settings</DialogTitle>
    </CouchDialog>,
  );
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledWith(expect.anything(), "escapeKeyDown");
});

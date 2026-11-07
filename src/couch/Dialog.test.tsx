import { fireEvent, render, screen, within } from "@testing-library/react";
import { DialogTitle } from "@mui/material";
import CouchDialog from "./Dialog";
import { ControlsLegend } from "../desktop/InputHints";

it("keeps the control legend inside the active modal dialog's accessible scope", () => {
  render(
    <CouchDialog
      open
      aria-label="TV settings"
      controls={
        <ControlsLegend player="P2" glyphs={{ back: { label: "B" } }} />
      }
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
      controls={<ControlsLegend player="P1" glyphs={{}} />}
    >
      <DialogTitle>Settings</DialogTitle>
    </CouchDialog>,
  );
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledWith(expect.anything(), "escapeKeyDown");
});

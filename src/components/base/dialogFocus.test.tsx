import type { ReactElement } from "react";
import { act, render, screen } from "@testing-library/react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
} from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createAppTheme } from "../../Theme";

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

function show(ui: ReactElement) {
  render(<ThemeProvider theme={createAppTheme("light")}>{ui}</ThemeProvider>);
}

test("an opened dialog focuses its first action and leaves the title untabbable", () => {
  show(
    <Dialog open aria-labelledby="plant-title">
      <DialogTitle id="plant-title">Build a plant?</DialogTitle>
      <DialogContent>Coal is available.</DialogContent>
      <DialogActions>
        <Button>Cancel</Button>
        <Button variant="contained">Build</Button>
      </DialogActions>
    </Dialog>,
  );
  const title = screen.getByRole("heading", { name: "Build a plant?" });
  expect(title).not.toHaveAttribute("tabindex");
  expect(screen.getByRole("dialog")).toHaveFocus();
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(screen.getByRole("button", { name: "Build" })).toHaveFocus();
  expect(title).not.toHaveFocus();
});

test("navigation during the open animation keeps its target", () => {
  show(
    <Dialog open aria-labelledby="plant-title">
      <DialogTitle id="plant-title">Build a plant?</DialogTitle>
      <DialogActions>
        <Button>Cancel</Button>
        <Button variant="contained">Build</Button>
      </DialogActions>
    </Dialog>,
  );
  const cancel = screen.getByRole("button", { name: "Cancel" });
  act(() => {
    cancel.focus();
  });
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(cancel).toHaveFocus();
});

test("an enabled back control wins when every other action is disabled", () => {
  show(
    <Dialog open aria-labelledby="lobby-title">
      <DialogTitle id="lobby-title">
        <IconButton aria-label="Back">Back</IconButton>
        Play with friends
      </DialogTitle>
      <DialogActions>
        <Button disabled variant="contained">
          Host a game
        </Button>
      </DialogActions>
    </Dialog>,
  );
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(screen.getByRole("button", { name: "Back" })).toHaveFocus();
});

test("an explicit autofocus action wins over the first contained button", () => {
  show(
    <Dialog open aria-labelledby="delete-title">
      <DialogTitle id="delete-title">Delete run?</DialogTitle>
      <DialogActions>
        <Button autoFocus>Cancel</Button>
        <Button variant="contained">Delete</Button>
      </DialogActions>
    </Dialog>,
  );
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
});

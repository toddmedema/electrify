import { act, render, screen } from "@testing-library/react";
import RenameSaveDialog from "./RenameSaveDialog";

jest.mock("../../SaveSession", () => ({
  renameSavedGame: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it("focuses and selects the current save name when opened", async () => {
  render(
    <RenameSaveDialog
      save={{ id: "save-1", name: "My grid" }}
      onClose={jest.fn()}
    />,
  );
  const field = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Save name",
  });
  await act(async () => jest.advanceTimersByTime(1000));
  expect(field).toHaveFocus();
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(field.value.length);
});

it.each(["Cancel", "Rename"])(
  "preserves focus on %s when navigation precedes the end of the opening animation",
  async (name) => {
    render(
      <RenameSaveDialog
        save={{ id: "save-1", name: "My grid" }}
        onClose={jest.fn()}
      />,
    );
    const field = screen.getByRole("textbox", { name: "Save name" });
    expect(field).toHaveFocus();
    const action = screen.getByRole("button", { name });
    await act(async () => action.focus());
    expect(action).toHaveFocus();
    await act(async () => jest.advanceTimersByTime(1000));
    expect(action).toHaveFocus();
  },
);

import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MenuItem, Select } from "@mui/material";
import { moveInputFocus } from "../../desktop/InputNavigation";
import { listenForDropdownKeys } from "./DropdownKeys";

jest.mock("../../desktop/InputNavigation", () => ({
  moveInputFocus: jest.fn(),
}));

let stop: () => void;
beforeEach(() => {
  stop = listenForDropdownKeys();
});
afterEach(() => {
  stop();
  jest.clearAllMocks();
});

function Controls() {
  const [mode, setMode] = useState("one");
  return (
    <>
      <Select
        value={mode}
        inputProps={{ "aria-label": "Mode" }}
        onChange={(event) => setMode(event.target.value)}
      >
        <MenuItem value="one">One</MenuItem>
        <MenuItem value="two">Two</MenuItem>
      </Select>
      <select aria-label="Scale" defaultValue="1">
        <option value="1">100%</option>
        <option value="2">125%</option>
      </select>
      <input
        role="combobox"
        aria-label="Place"
        aria-autocomplete="list"
        aria-expanded="false"
        aria-controls="places"
      />
      <output>{mode}</output>
    </>
  );
}

test("arrow keys move focus past a closed MUI select instead of opening it", () => {
  render(<Controls />);
  const mode = screen.getByRole("combobox", { name: "Mode" });
  mode.focus();
  expect(fireEvent.keyDown(mode, { key: "ArrowDown" })).toBe(false);
  expect(moveInputFocus).toHaveBeenLastCalledWith("down");
  expect(fireEvent.keyDown(mode, { key: "ArrowUp" })).toBe(false);
  expect(moveInputFocus).toHaveBeenLastCalledWith("up");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

test("Enter and Space open a MUI select, and the arrows then choose within it", async () => {
  const user = userEvent.setup();
  render(<Controls />);
  const mode = screen.getByRole("combobox", { name: "Mode" });
  mode.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("listbox")).toBeVisible();
  // An open list belongs to its options: the arrows are theirs.
  await user.keyboard("{ArrowDown}{Enter}");
  expect(moveInputFocus).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("two");
  // Closed again with focus back on the select, the arrows carry on moving focus.
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(mode).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(moveInputFocus).toHaveBeenCalledWith("down");
  await user.keyboard(" ");
  expect(screen.getByRole("listbox")).toBeVisible();
});

/** jsdom marks every dispatched event untrusted, as a controller's synthetic keys are. */
function physicalKey(target: Element, key: string) {
  const add = jest.spyOn(document, "addEventListener");
  const off = listenForDropdownKeys();
  const listener = add.mock.calls.find(([type]) => type === "keydown")![1] as (
    event: Event,
  ) => void;
  add.mockRestore();
  const event = {
    key,
    target,
    isTrusted: true,
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  };
  listener(event as unknown as Event);
  off();
  return event;
}

describe("a native select's picker", () => {
  const showPicker = jest.fn();
  beforeEach(() => {
    Object.defineProperty(HTMLSelectElement.prototype, "showPicker", {
      configurable: true,
      value: showPicker,
    });
  });
  afterEach(() => {
    delete (HTMLSelectElement.prototype as { showPicker?: unknown }).showPicker;
    showPicker.mockClear();
  });

  test("keeps its value on the arrows and opens on a physical Enter", () => {
    render(<Controls />);
    const scale = screen.getByRole("combobox", { name: "Scale" });
    scale.focus();
    expect(fireEvent.keyDown(scale, { key: "ArrowDown" })).toBe(false);
    expect(moveInputFocus).toHaveBeenLastCalledWith("down");
    expect(scale).toHaveValue("1");
    expect(showPicker).not.toHaveBeenCalled();
    const enter = physicalKey(scale, "Enter");
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  test("never opens from a controller's synthetic Enter", () => {
    render(<Controls />);
    const scale = screen.getByRole("combobox", { name: "Scale" });
    // The system list cannot be driven by a controller, so Confirm must not strand the player in it.
    expect(fireEvent.keyDown(scale, { key: "Enter" })).toBe(true);
    expect(showPicker).not.toHaveBeenCalled();
    expect(scale).toHaveValue("1");
  });
});

test("Enter on a native select without a picker is harmless", () => {
  render(<Controls />);
  const scale = screen.getByRole("combobox", { name: "Scale" });
  expect(() => physicalKey(scale, "Enter")).not.toThrow();
});

test("modified keys keep their own handling", () => {
  render(<Controls />);
  const mode = screen.getByRole("combobox", { name: "Mode" });
  expect(fireEvent.keyDown(mode, { key: "ArrowDown", altKey: true })).toBe(
    false,
  );
  // MUI's own handler opened it: the shortcut was left alone.
  expect(moveInputFocus).not.toHaveBeenCalled();
  expect(screen.getByRole("listbox")).toBeVisible();
});

test("an editable combobox keeps its arrow keys", () => {
  render(<Controls />);
  const place = screen.getByRole("combobox", { name: "Place" });
  expect(fireEvent.keyDown(place, { key: "ArrowDown" })).toBe(true);
  expect(moveInputFocus).not.toHaveBeenCalled();
});

test("stops listening when removed", () => {
  stop();
  render(<Controls />);
  const scale = screen.getByRole("combobox", { name: "Scale" });
  expect(fireEvent.keyDown(scale, { key: "ArrowDown" })).toBe(true);
  expect(moveInputFocus).not.toHaveBeenCalled();
  stop = listenForDropdownKeys();
});

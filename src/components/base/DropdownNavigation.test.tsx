/* eslint-disable testing-library/no-node-access -- Which control focus reached is its place in the document. */
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  MenuItem,
  TextField,
} from "@mui/material";
import { createGame } from "../../testing/Simulator";
import ConstructionBuildHeader from "./ConstructionBuildHeader";
import DifficultyPicker from "./DifficultyPicker";
import { listenForDropdownKeys } from "./DropdownKeys";
import TerritoryBuildDestination from "./TerritoryBuildDestination";

/**
 * Every kind of dropdown the game uses, arrowed through with the real focus navigation. Arrow
 * keys pass over a closed dropdown to the next control, Enter opens it, choosing returns focus to
 * it, and the arrows then carry on, so a player can keep going down a page. The same holds when
 * a controller's directions arrive as these keys.
 */

let stop: () => void;
beforeEach(() => {
  stop = listenForDropdownKeys();
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{}] as unknown as DOMRectList);
  // JSDOM has no layout: stack the controls in document order.
  jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const index = Array.from(
        // eslint-disable-next-line testing-library/no-node-access -- JSDOM geometry follows document order.
        document.querySelectorAll(
          "button,input,select,textarea,summary,[tabindex]",
        ),
      ).indexOf(this);
      return {
        left: 0,
        right: 80,
        top: index * 60,
        bottom: index * 60 + 40,
        width: 80,
        height: 40,
      } as DOMRect;
    });
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia;
});
afterEach(() => {
  stop();
  jest.restoreAllMocks();
});

function Dropdowns() {
  const [region, setRegion] = useState("north");
  const [year, setYear] = useState("2030");
  const [game] = useState(() => createGame({ scenarioId: 116, seed: 12 }));
  return (
    <main className="base_main">
      <Button>First</Button>
      <DifficultyPicker variant="select" value="Manager" onChange={() => {}} />
      <TextField
        select
        label="Region"
        value={region}
        onChange={(event) => setRegion(event.target.value)}
      >
        <MenuItem value="north">North</MenuItem>
        <MenuItem value="south">South</MenuItem>
      </TextField>
      <TextField
        select
        label="Year"
        value={year}
        slotProps={{ select: { native: true } }}
        onChange={(event) => setYear(event.target.value)}
      >
        <option value="2030">2030</option>
        <option value="2040">2040</option>
      </TextField>
      <select aria-label="Scale" defaultValue="100">
        <option value="100">100%</option>
        <option value="125">125%</option>
      </select>
      <TerritoryBuildDestination
        game={game}
        value="champlain"
        onChange={() => {}}
        onTileChange={() => {}}
      />
      <ConstructionBuildHeader
        capacity="100 MW"
        sliderValue={50}
        sliderMin={0}
        sliderMax={100}
        sort="cost"
        sortOptions={[
          ["cost", "Cost"],
          ["size", "Size"],
        ]}
        onSliderChange={() => {}}
        onSortChange={() => {}}
      />
      <Button>Last</Button>
    </main>
  );
}

const readout = (dropdown: HTMLElement) =>
  dropdown instanceof HTMLSelectElement
    ? dropdown.value
    : (dropdown.textContent ?? "");

/** Document order of two controls: 1 when the second follows the first, -1 when it precedes. */
const orderOf = (from: HTMLElement, to: Element | null) =>
  from.compareDocumentPosition(to!) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;

test("arrows pass over every closed dropdown without opening or changing it", async () => {
  const user = userEvent.setup();
  render(<Dropdowns />);
  const dropdowns = screen.getAllByRole("combobox");
  expect(dropdowns.length).toBeGreaterThanOrEqual(7);
  for (const dropdown of dropdowns) {
    const before = readout(dropdown);
    dropdown.focus();
    await user.keyboard("{ArrowDown}");
    expect(dropdown).not.toHaveFocus();
    expect(orderOf(dropdown, document.activeElement)).toBe(1);
    dropdown.focus();
    await user.keyboard("{ArrowUp}");
    expect(dropdown).not.toHaveFocus();
    expect(orderOf(dropdown, document.activeElement)).toBe(-1);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(readout(dropdown)).toBe(before);
  }
});

test("Enter opens a dropdown, choosing closes it onto the dropdown, and the arrows carry on", async () => {
  const user = userEvent.setup();
  render(<Dropdowns />);
  const custom = screen
    .getAllByRole("combobox")
    .filter((dropdown) => !(dropdown instanceof HTMLSelectElement));
  // Difficulty, Region, Build destination, Build tile and Sort.
  expect(custom).toHaveLength(5);
  for (const dropdown of custom) {
    dropdown.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("listbox")).toBeVisible();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(dropdown).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(dropdown).not.toHaveFocus();
  }
});

test("Escape closes an opened dropdown onto the dropdown", async () => {
  const user = userEvent.setup();
  render(<Dropdowns />);
  for (const dropdown of screen.getAllByRole("combobox")) {
    if (dropdown instanceof HTMLSelectElement) continue;
    dropdown.focus();
    await user.keyboard(" ");
    expect(screen.getByRole("listbox")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(dropdown).toHaveFocus();
  }
});

test("a dropdown in a dialog hands arrows to the dialog's own controls", async () => {
  const user = userEvent.setup();
  render(
    <>
      <main className="base_main">
        <Button>Behind</Button>
      </main>
      <Dialog open>
        <DialogContent>
          <TextField label="Name" />
          <TextField select label="Region" defaultValue="north">
            <MenuItem value="north">North</MenuItem>
            <MenuItem value="south">South</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button>Cancel</Button>
        </DialogActions>
      </Dialog>
    </>,
  );
  const dialog = screen.getByRole("dialog");
  const region = within(dialog).getByRole("combobox", { name: "Region" });
  region.focus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  region.focus();
  await user.keyboard("{ArrowUp}");
  expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveFocus();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  region.focus();
  await user.keyboard("{Enter}{ArrowDown}{Enter}");
  expect(region).toHaveTextContent("South");
  expect(region).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
});

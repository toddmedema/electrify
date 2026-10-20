import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Button, Dialog, MenuItem, Select, Slider } from "@mui/material";
import ConfirmDialog from "../components/base/ConfirmDialog";
import {
  backInput,
  confirmInput,
  inputScope,
  moveInputFocus,
  visibleControls,
} from "./InputNavigation";

beforeEach(() => {
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{}] as unknown as DOMRectList);
});
afterEach(() => jest.restoreAllMocks());

it("uses real focus, skips unavailable controls, wraps and continues after a tool heading", () => {
  render(
    <main className="base_main">
      <button>Pause</button>
      <h2 tabIndex={-1}>Build</h2>
      <button hidden>Hidden</button>
      <button disabled>Disabled</button>
      <div aria-hidden="true">
        <button>Inaccessible</button>
      </div>
      <button style={{ visibility: "hidden" }}>Invisible</button>
      <button>Close Build</button>
      <button>Build solar</button>
    </main>,
  );
  screen.getByText("Build").focus();
  moveInputFocus("down");
  expect(screen.getByText("Close Build")).toHaveFocus();
  moveInputFocus("right");
  expect(screen.getByText("Build solar")).toHaveFocus();
  moveInputFocus("down");
  expect(screen.getByText("Pause")).toHaveFocus();
  moveInputFocus("up");
  expect(screen.getByText("Build solar")).toHaveFocus();
  expect(visibleControls(inputScope())).toHaveLength(3);
});

it("keeps movement and confirmation within the top popup, even when it has no actions", () => {
  const play = jest.fn();
  render(
    <>
      <main className="base_main">
        <button onClick={play}>Play</button>
      </main>
      <div role="dialog" aria-label="Outer">
        <button>Cancel</button>
      </div>
      <div role="dialog" aria-label="Forced choice" />
    </>,
  );
  screen.getByText("Play").focus();
  moveInputFocus("down");
  confirmInput();
  backInput();
  expect(inputScope()).toBe(
    screen.getByRole("dialog", { name: "Forced choice" }),
  );
  expect(play).not.toHaveBeenCalled();
});

it("keeps the covered compact fleet out of controller navigation and confirmation", () => {
  const pauseCoal = jest.fn();
  const inspect = jest.fn();
  const workspace = (layout: "sheet" | "side", toolOpen = true) => (
    <main className="base_main">
      <header>
        <button>Game menu</button>
      </header>
      <div className="gameStage" data-layout={layout}>
        <div className="gameFleet">
          <button onClick={pauseCoal}>Pause coal</button>
          <div
            role="img"
            aria-label="Fleet chart"
            tabIndex={0}
            onKeyDown={(event) => {
              event.preventDefault();
              inspect(event.key);
            }}
          />
        </div>
        <div className="gameToolTray">
          <section className="gameToolPanel" hidden={!toolOpen}>
            <button>Close Build</button>
            <button>Build solar</button>
          </section>
        </div>
      </div>
      <nav>
        <button>Build</button>
      </nav>
    </main>
  );
  const view = render(workspace("sheet"));
  screen.getByRole("button", { name: "Game menu" }).focus();
  moveInputFocus("down");
  expect(screen.getByRole("button", { name: "Close Build" })).toHaveFocus();
  moveInputFocus("down");
  expect(screen.getByRole("button", { name: "Build solar" })).toHaveFocus();
  moveInputFocus("down");
  expect(screen.getByRole("button", { name: /^Build$/ })).toHaveFocus();
  moveInputFocus("down");
  expect(screen.getByRole("button", { name: "Game menu" })).toHaveFocus();
  screen.getByRole("button", { name: "Pause coal" }).focus();
  confirmInput();
  expect(pauseCoal).not.toHaveBeenCalled();
  screen.getByRole("img").focus();
  moveInputFocus("right");
  expect(inspect).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Game menu" })).toHaveFocus();

  view.rerender(workspace("side"));
  screen.getByRole("button", { name: "Game menu" }).focus();
  moveInputFocus("down");
  expect(screen.getByRole("button", { name: "Pause coal" })).toHaveFocus();
  confirmInput();
  expect(pauseCoal).toHaveBeenCalledTimes(1);

  view.rerender(workspace("sheet", false));
  screen.getByRole("button", { name: "Game menu" }).focus();
  moveInputFocus("down");
  expect(screen.getByRole("button", { name: "Pause coal" })).toHaveFocus();
  moveInputFocus("down");
  moveInputFocus("right");
  expect(screen.getByRole("img")).toHaveFocus();
  expect(inspect).toHaveBeenCalledWith("ArrowRight");
});

it("includes the tutorial's sibling actions while skipping an outgoing inert screen", () => {
  const next = jest.fn();
  render(
    <div className="app_container">
      <main
        className="base_main"
        ref={(element) => element?.setAttribute("inert", "")}
      >
        <button>Previous screen</button>
      </main>
      <main className="base_main">
        <h2 tabIndex={-1}>Build</h2>
        <button>Close Build</button>
      </main>
      <section className="tutorialHud">
        <button onClick={next}>Next step</button>
      </section>
    </div>,
  );
  screen.getByText("Build").focus();
  confirmInput();
  expect(screen.getByText("Close Build")).toHaveFocus();
  moveInputFocus("down");
  confirmInput();
  expect(next).toHaveBeenCalledTimes(1);
  moveInputFocus("down");
  expect(screen.getByText("Close Build")).toHaveFocus();
});

it("routes portaled listbox keys through its combobox owner", () => {
  const choose = jest.fn();
  render(
    <>
      <main className="base_main">
        <input
          role="combobox"
          aria-label="Location"
          aria-controls="locations"
          aria-expanded="true"
          onKeyDown={(event) => {
            event.preventDefault();
            choose(event.key);
          }}
        />
      </main>
      <ul role="listbox" id="locations">
        <li role="option" aria-selected="false">
          Toronto
        </li>
      </ul>
    </>,
  );
  screen.getByRole("combobox").focus();
  moveInputFocus("down");
  confirmInput();
  expect(backInput()).toBe(true);
  expect(choose.mock.calls.flat()).toEqual(["ArrowDown", "Enter", "Escape"]);
  expect(screen.getByRole("combobox")).toHaveFocus();
});

it("respects widget-owned arrows and Enter without activating twice", () => {
  const inspect = jest.fn();
  const custom = jest.fn();
  render(
    <main className="base_main">
      <div
        role="img"
        aria-label="Demand chart"
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            ["ArrowLeft", "ArrowRight", "Enter", "Escape"].includes(event.key)
          ) {
            event.preventDefault();
            inspect(event.key);
          }
        }}
      />
      <button
        onClick={custom}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.click();
        }}
      >
        Custom action
      </button>
      <button>Next</button>
    </main>,
  );
  screen.getByRole("img").focus();
  moveInputFocus("right");
  confirmInput();
  expect(backInput()).toBe(true);
  expect(inspect.mock.calls.flat()).toEqual(["ArrowRight", "Enter", "Escape"]);
  expect(screen.getByRole("img")).toHaveFocus();
  moveInputFocus("down");
  confirmInput();
  expect(custom).toHaveBeenCalledTimes(1);
});

it("changes native values through React and leaves value controls vertically", () => {
  function Values() {
    const [volume, setVolume] = useState("0.5");
    const [mode, setMode] = useState("one");
    return (
      <main className="base_main">
        <input
          aria-label="Volume"
          type="range"
          min="0"
          max="1"
          step="0.25"
          value={volume}
          onChange={(event) => setVolume(event.target.value)}
        />
        <select
          aria-label="Mode"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="one">One</option>
          <option disabled>Unavailable</option>
          <option value="two">Two</option>
        </select>
        <output>
          {volume}/{mode}
        </output>
      </main>
    );
  }
  render(<Values />);
  screen.getByRole("slider").focus();
  act(() => moveInputFocus("right"));
  expect(screen.getByRole("status")).toHaveTextContent("0.75/one");
  moveInputFocus("down");
  expect(screen.getByRole("combobox")).toHaveFocus();
  act(() => moveInputFocus("right"));
  expect(screen.getByRole("status")).toHaveTextContent("0.75/two");
  moveInputFocus("up");
  expect(screen.getByRole("slider")).toHaveFocus();
});

it("preserves destructive Cancel focus", async () => {
  const cancel = jest.fn();
  const confirm = jest.fn();
  render(
    <ConfirmDialog
      open
      title="Delete save?"
      confirmLabel="Delete"
      destructive
      onCancel={cancel}
      onConfirm={confirm}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  act(() => confirmInput());
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
});

it("activates native buttons and checkboxes once without manufacturing a keyboard default", () => {
  const choose = jest.fn();
  render(
    <main className="base_main">
      <input type="checkbox" aria-label="Sound" />
      <button onClick={choose}>Start</button>
    </main>,
  );
  screen.getByRole("checkbox").focus();
  confirmInput();
  expect(screen.getByRole("checkbox")).toBeChecked();
  moveInputFocus("down");
  confirmInput();
  expect(choose).toHaveBeenCalledTimes(1);
});

it("gives MUI slider and select handlers their native semantic keys", async () => {
  function Widgets() {
    const [volume, setVolume] = useState(40);
    const [mode, setMode] = useState("one");
    return (
      <main className="base_main">
        <Slider
          aria-label="Effects volume"
          value={volume}
          onChange={(_event, value) => setVolume(value as number)}
        />
        <Select
          value={mode}
          inputProps={{ "aria-label": "Mode" }}
          onChange={(event) => setMode(event.target.value)}
        >
          <MenuItem value="one">One</MenuItem>
          <MenuItem value="two">Two</MenuItem>
        </Select>
        <Button>Next</Button>
        <output>
          {volume}/{mode}
        </output>
      </main>
    );
  }
  render(<Widgets />);
  await act(async () => {
    await Promise.resolve();
  });
  act(() => screen.getByRole("slider").focus());
  act(() => moveInputFocus("right"));
  expect(screen.getByRole("status")).toHaveTextContent("41/one");
  act(() => moveInputFocus("down"));
  expect(screen.getByRole("combobox")).toHaveFocus();
  await act(async () => moveInputFocus("down"));
  expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  await act(async () => moveInputFocus("up"));
  expect(screen.getByRole("combobox")).toHaveFocus();
  act(() => confirmInput());
  expect(screen.getByRole("listbox")).toBeVisible();
  act(() => moveInputFocus("down"));
  act(() => confirmInput());
  expect(screen.getByRole("status")).toHaveTextContent("41/two");
});

it("lets MUI own Back dismissal and does not choose a dialog action", () => {
  const close = jest.fn();
  render(
    <Dialog open onClose={close}>
      <button autoFocus>Continue</button>
    </Dialog>,
  );
  act(() => backInput());
  expect(close).toHaveBeenCalledTimes(1);
});

import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { useState } from "react";
import { Autocomplete, TextField } from "@mui/material";
import type {
  DesktopBridge,
  DesktopInputFrame,
  DesktopTextInputResult,
} from "../Desktop";
import { store, useAppSelector } from "../Store";
import { delta, setSpeed } from "../reducers/Game";
import { quit } from "../reducers/GameActions";
import { navigate } from "../reducers/Card";
import { getInputPresentation, startDesktopInput } from "./Input";
import { buildSpeedOptions } from "../components/base/SpeedControls";

let stop: () => void;
beforeEach(() => {
  jest.useFakeTimers();
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{}] as unknown as DOMRectList);
  store.dispatch(quit());
});
afterEach(() => {
  stop?.();
  store.dispatch(quit());
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const empty: DesktopInputFrame = {
  connected: true,
  actions: [],
  glyphs: { confirm: { label: "Cross" } },
};
function bridge() {
  let input: (frame: DesktopInputFrame) => void = () => {};
  let focus: (focused: boolean) => void = () => {};
  const unsubscribe = jest.fn();
  const desktop = {
    setInputContext: jest.fn().mockResolvedValue(empty),
    onInput: (callback: typeof input) => {
      input = callback;
      return unsubscribe;
    },
    onGameFocusChanged: (callback: typeof focus) => {
      focus = callback;
      return unsubscribe;
    },
    onBeforeQuit: () => unsubscribe,
  } as unknown as DesktopBridge;
  return {
    desktop,
    unsubscribe,
    emit: (frame: Partial<DesktopInputFrame>) =>
      act(() => input({ ...empty, ...frame })),
    focus: (focused: boolean) => focus(focused),
  };
}
function Game() {
  return (
    <main className="base_main">
      <div className="gameWorkspace">
        {buildSpeedOptions({
          speed: store.getState().game.speed,
          onSpeedChange: (speed) => {
            store.dispatch(setSpeed(speed));
          },
          desktop: false,
        })}
        <button className="gameMenuButton">Menu</button>
      </div>
    </main>
  );
}

function TextForm({ readonly = false, disabled = false } = {}) {
  const [value, setValue] = useState("Campaign one");
  return (
    <main className="base_main">
      <form onSubmit={(event) => event.preventDefault()}>
        <label>
          Save name
          <input
            value={value}
            maxLength={80}
            readOnly={readonly}
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <output aria-label="Saved name">{value}</output>
        <button>Rename</button>
      </form>
    </main>
  );
}

it.each(["submitted", "cancelled", "unavailable"] as const)(
  "controller text entry handles %s, preserves React state and restores focus",
  async (status) => {
    render(<TextForm />);
    const f = bridge();
    let complete!: (result: DesktopTextInputResult) => void;
    const showTextInput = jest.fn(
      () =>
        new Promise<DesktopTextInputResult>((resolve) => {
          complete = resolve;
        }),
    );
    f.desktop.showTextInput = showTextInput;
    stop = startDesktopInput(store, f.desktop);
    await act(async () => {
      await Promise.resolve();
    });
    const field = screen.getByRole("textbox", { name: "Save name" });
    field.focus();
    f.emit({ actions: ["confirm"] });
    expect(showTextInput).toHaveBeenCalledWith({
      description: "Save name",
      text: "Campaign one",
      maxLength: 80,
      multiline: false,
      password: false,
    });
    f.emit({ actions: ["down"] });
    f.emit({ actions: ["confirm"] });
    expect(field).toHaveFocus();
    expect(showTextInput).toHaveBeenCalledTimes(1);
    field.blur();
    await act(async () => {
      complete(
        status === "submitted"
          ? { status, text: "Électricité ⚡" }
          : { status },
      );
    });
    expect(field).toHaveFocus();
    expect(field).toHaveValue(
      status === "submitted" ? "Électricité ⚡" : "Campaign one",
    );
    expect(screen.getByLabelText("Saved name")).toHaveTextContent(
      status === "submitted" ? "Électricité ⚡" : "Campaign one",
    );
    f.emit({ actions: ["down"] });
    expect(screen.getByRole("button", { name: "Rename" })).toHaveFocus();
  },
);

it.each([{ readonly: true }, { disabled: true }])(
  "does not open text entry on unavailable fields: %j",
  async (props) => {
    render(<TextForm {...props} />);
    const f = bridge();
    f.desktop.showTextInput = jest.fn();
    stop = startDesktopInput(store, f.desktop);
    await act(async () => {
      await Promise.resolve();
    });
    screen.getByRole("textbox", { name: "Save name" }).focus();
    f.emit({ actions: ["confirm"] });
    expect(f.desktop.showTextInput).not.toHaveBeenCalled();
  },
);

it("does not write a dismissed keyboard into an obsolete surface", async () => {
  const view = render(<TextForm />);
  const f = bridge();
  let complete!: (result: DesktopTextInputResult) => void;
  f.desktop.showTextInput = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  stop = startDesktopInput(store, f.desktop);
  await act(async () => {
    await Promise.resolve();
  });
  const original = screen.getByRole("textbox", { name: "Save name" });
  original.focus();
  f.emit({ actions: ["confirm"] });
  view.rerender(
    <main className="base_main">
      <button>New screen</button>
    </main>,
  );
  await act(async () => {
    complete({ status: "submitted", text: "Obsolete result" });
  });
  expect(original).toHaveValue("Campaign one");
  expect(screen.getByRole("button", { name: "New screen" })).not.toHaveFocus();
});

it("submits text to the focused autocomplete field that owns a portaled listbox", async () => {
  const changed = jest.fn();
  render(
    <>
      <main className="base_main">
        <input
          role="combobox"
          aria-label="Search playable cities"
          aria-controls="city-options"
          aria-expanded="true"
          onChange={changed}
        />
      </main>
      <div role="listbox" id="city-options">
        <div role="option" aria-selected="false">
          San Francisco
        </div>
      </div>
    </>,
  );
  const f = bridge();
  f.desktop.showTextInput = jest
    .fn()
    .mockResolvedValue({ status: "submitted", text: "San Francisco" });
  stop = startDesktopInput(store, f.desktop);
  await act(async () => {
    await Promise.resolve();
  });
  const field = screen.getByRole("combobox");
  field.focus();
  await act(async () => {
    f.emit({ actions: ["confirm"] });
  });
  expect(field).toHaveValue("San Francisco");
  expect(changed).toHaveBeenCalledTimes(1);
  expect(field).toHaveFocus();
});

it("selects a highlighted city with Confirm after controller navigation instead of reopening the keyboard", async () => {
  const picked = jest.fn();
  render(
    <main className="base_main">
      <Autocomplete
        options={["Toronto", "Vancouver"]}
        openOnFocus
        autoHighlight
        onChange={(_event, value) => picked(value)}
        renderInput={(params) => <TextField {...params} label="City" />}
      />
    </main>,
  );
  const f = bridge();
  f.desktop.showTextInput = jest
    .fn()
    .mockResolvedValue({ status: "cancelled" });
  stop = startDesktopInput(store, f.desktop);
  await act(async () => Promise.resolve());
  act(() => screen.getByRole("combobox").focus());
  f.emit({ actions: ["down"] });
  f.emit({ actions: ["confirm"] });
  expect(picked).toHaveBeenCalledWith("Vancouver");
  expect(f.desktop.showTextInput).not.toHaveBeenCalled();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("opens text entry before accepting an auto-highlighted city and can confirm the submitted search", async () => {
  const picked = jest.fn();
  render(
    <main className="base_main">
      <Autocomplete
        options={["Toronto", "Vancouver"]}
        openOnFocus
        autoHighlight
        onChange={(_event, value) => picked(value)}
        renderInput={(params) => <TextField {...params} label="City" />}
      />
    </main>,
  );
  const f = bridge();
  f.desktop.showTextInput = jest.fn().mockResolvedValue({
    status: "submitted",
    text: "Vancouver",
  });
  stop = startDesktopInput(store, f.desktop);
  await act(async () => Promise.resolve());
  act(() => screen.getByRole("combobox").focus());
  await act(async () => f.emit({ actions: ["confirm"] }));
  expect(f.desktop.showTextInput).toHaveBeenCalledTimes(1);
  expect(picked).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox")).toHaveValue("Vancouver");
  f.emit({ actions: ["confirm"] });
  expect(picked).toHaveBeenCalledWith("Vancouver");
  expect(f.desktop.showTextInput).toHaveBeenCalledTimes(1);
});

it.each(["pause", "confirm"] as const)(
  "keeps disconnected runs paused until explicitly resumed with %s",
  async (action) => {
    store.dispatch(delta({ inGame: true, speed: "NORMAL" }));
    store.dispatch(navigate("FACILITIES"));
    const view = render(<Game />);
    const f = bridge();
    stop = startDesktopInput(store, f.desktop);
    await act(async () => {
      await Promise.resolve();
    });
    expect(f.desktop.setInputContext).toHaveBeenCalledWith("Gameplay");
    f.emit({ actions: ["down"] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(getInputPresentation().active).toBe(true);
    f.emit({ connected: false, disconnected: true });
    expect(getInputPresentation().active).toBe(false);
    expect(store.getState().game.speed).toBe("PAUSED");
    expect(getInputPresentation().pausedAfterDisconnect).toBe(true);
    // Dialog/focus restoration cannot silently restart the clock.
    store.dispatch(setSpeed("FAST"));
    expect(store.getState().game.speed).toBe("PAUSED");
    f.emit({ connected: true });
    expect(store.getState().game.speed).toBe("PAUSED");
    view.rerender(<Game />);
    if (action === "confirm")
      act(() => screen.getByRole("button", { name: "normal speed" }).focus());
    f.emit({ actions: [action] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(store.getState().game.speed).toBe("NORMAL");
    expect(getInputPresentation().pausedAfterDisconnect).toBe(false);
  },
);

it("contains forced dialogs and ignores background/obsolete context actions", async () => {
  const menu = jest.fn();
  const buy = jest.fn();
  render(
    <>
      <main className="base_main">
        <div className="gameWorkspace">
          <button className="gameMenuButton" onClick={menu}>
            Menu
          </button>
          <button id="buildNav" aria-expanded="false" onClick={buy}>
            Build
          </button>
        </div>
      </main>
      <div role="dialog" aria-label="Choose a policy">
        <button>Wait</button>
      </div>
    </>,
  );
  const f = bridge();
  stop = startDesktopInput(store, f.desktop);
  await Promise.resolve();
  expect(f.desktop.setInputContext).toHaveBeenCalledWith("Menu");
  f.emit({ actions: ["build"] });
  f.emit({ actions: ["back"] });
  expect(menu).not.toHaveBeenCalled();
  expect(buy).not.toHaveBeenCalled();
  f.focus(false);
  f.emit({ actions: ["down"] });
  expect(screen.getByText("Wait")).not.toHaveFocus();
  f.focus(true);
  f.emit({ actions: ["down"] });
  expect(screen.getByText("Wait")).toHaveFocus();
  expect(getInputPresentation().glyphs.confirm?.label).toBe("Cross");
  stop();
  expect(f.unsubscribe).toHaveBeenCalledTimes(3);
  f.emit({ actions: ["confirm"] });
  expect(getInputPresentation().active).toBe(false);
  stop = () => {};
});

it("waits for context activation and leaves older/native-unavailable editions usable", async () => {
  const activate = jest.fn();
  render(
    <main className="base_main">
      <button onClick={activate}>Play</button>
    </main>,
  );
  const f = bridge();
  let ready!: (frame: DesktopInputFrame) => void;
  (f.desktop.setInputContext as jest.Mock).mockReturnValue(
    new Promise<DesktopInputFrame>((resolve) => {
      ready = resolve;
    }),
  );
  stop = startDesktopInput(store, f.desktop);
  screen.getByText("Play").focus();
  f.emit({ actions: ["confirm"] });
  expect(activate).not.toHaveBeenCalled();
  await act(async () => ready(empty));
  f.emit({ actions: ["confirm"] });
  expect(activate).toHaveBeenCalledTimes(1);
  stop();
  stop = startDesktopInput(store, {} as DesktopBridge);
  expect(getInputPresentation().active).toBe(false);
});

it("reveals fleet charts before focusing them when a compact tool covers the fleet", async () => {
  store.dispatch(delta({ inGame: true }));
  store.dispatch(navigate("PROGRAMS"));
  function Surface() {
    const card = useAppSelector((state) => state.card.name);
    return (
      <main className="base_main">
        <div className="gameWorkspace">
          <div className="gameStage" data-layout="sheet">
            <div className="gameFleet">
              <div className="accessibleChart">
                <div role="img" aria-label="Supply chart" tabIndex={0} />
              </div>
            </div>
            <section
              className="gameToolPanel"
              data-game-tool="PROGRAMS"
              hidden={card === "FACILITIES"}
            >
              <button>Close Programs</button>
            </section>
          </div>
        </div>
      </main>
    );
  }
  render(
    <Provider store={store}>
      <Surface />
    </Provider>,
  );
  const f = bridge();
  stop = startDesktopInput(store, f.desktop);
  await Promise.resolve();
  f.emit({ actions: ["nextChart"] });
  expect(store.getState().card.name).toBe("FACILITIES");
  act(() => jest.advanceTimersByTime(20));
  expect(screen.getByRole("img", { name: "Supply chart" })).toHaveFocus();
});

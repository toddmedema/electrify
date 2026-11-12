import { act, fireEvent, render, screen } from "@testing-library/react";
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
import InputHints from "./InputHints";
import { dialogClose } from "../reducers/UI";
import { registerMultiplayerRuntime } from "../multiplayer/Registry";

let stop: () => void;
beforeEach(() => {
  jest.useFakeTimers();
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{}] as unknown as DOMRectList);
  store.dispatch(quit());
});
afterEach(() => {
  registerMultiplayerRuntime(undefined);
  delete window.electrifyCouch;
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

it.each(["pointerdown", "keydown"] as const)(
  "keeps controller help mounted through trusted %s activation and hands off outside the footer",
  async (eventType) => {
    const listeners = jest.spyOn(document, "addEventListener");
    render(
      <Provider store={store}>
        <main className="base_main">
          <button>Other action</button>
        </main>
        <InputHints />
      </Provider>,
    );
    const f = bridge();
    stop = startDesktopInput(store, f.desktop);
    await act(async () => {
      await Promise.resolve();
    });
    f.emit({ actions: ["down"] });
    const help = screen.getByRole("button", { name: "All controls" });
    const pointer = listeners.mock.calls.find(
      ([type]) => type === eventType,
    )![1] as EventListener;
    const trustedPointer = (target: Element) =>
      pointer({ isTrusted: true, target, key: "Enter" } as unknown as Event);
    act(() => trustedPointer(help));
    expect(getInputPresentation().active).toBe(true);
    expect(help).toBeInTheDocument();
    fireEvent.click(help);
    expect(store.getState().ui.dialog).toMatchObject({
      open: true,
      title: "Controller controls",
    });
    act(() =>
      trustedPointer(screen.getByRole("button", { name: "Other action" })),
    );
    expect(getInputPresentation().active).toBe(false);
    store.dispatch(dialogClose());
  },
);

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
    for (const [index, control] of [
      field,
      screen.getByRole("button", { name: "Rename" }),
    ].entries()) {
      jest.spyOn(control, "getBoundingClientRect").mockReturnValue({
        left: 0,
        right: 160,
        top: index * 60,
        bottom: index * 60 + 40,
        width: 160,
        height: 40,
      } as DOMRect);
    }
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

it.each(["seat", "online"])(
  "routes %s speed and readiness through the shared clock",
  async (role) => {
    Object.defineProperty(window, "electrifyCouch", {
      configurable: true,
      value: role === "seat" ? { role: "seat", seatId: "local-p2" } : undefined,
    });
    const clock = (
      selectedSpeed: "PAUSED" | "NORMAL" | "FAST",
      readyRequired = false,
    ) => {
      store.dispatch(
        delta({
          inGame: true,
          multiplayer: {
            seat: "local-p2",
            clock: {
              activeSpeed: "PAUSED",
              selectedSpeed,
              readyRequired,
              ready: !readyRequired,
              reason: "",
              players: [],
            },
          },
        }),
      );
    };
    clock("PAUSED", true);
    store.dispatch(navigate("FACILITIES"));
    const runtime = {
      command: jest.fn(),
      submit: jest.fn().mockResolvedValue(undefined),
      activity: jest.fn(),
      leave: jest.fn().mockResolvedValue(undefined),
    };
    registerMultiplayerRuntime(runtime);
    render(
      <main className="base_main">
        <div className="gameWorkspace">
          <button className="gameMenuButton">Menu</button>
        </div>
      </main>,
    );
    expect(
      screen.queryByRole("button", { name: /speed/i }),
    ).not.toBeInTheDocument();
    const f = bridge();
    stop = startDesktopInput(store, f.desktop);
    await act(async () => Promise.resolve());
    f.emit({ actions: ["pause"] });
    expect(runtime.command).toHaveBeenLastCalledWith({
      kind: "speed",
      speed: "NORMAL",
    });
    clock("NORMAL", true);
    f.emit({ actions: ["pause"] });
    expect(runtime.command).toHaveBeenLastCalledWith({
      kind: "speed",
      speed: "NORMAL",
    });
    clock("NORMAL");
    f.emit({ actions: ["speedUp"] });
    expect(runtime.command).toHaveBeenLastCalledWith({
      kind: "speed",
      speed: "FAST",
    });
    clock("FAST");
    f.emit({ actions: ["speedDown"] });
    expect(runtime.command).toHaveBeenLastCalledWith({
      kind: "speed",
      speed: "NORMAL",
    });
    clock("NORMAL");
    f.emit({ actions: ["pause"] });
    expect(runtime.command).toHaveBeenLastCalledWith({
      kind: "speed",
      speed: "PAUSED",
    });
  },
);

it.each(["menu", "menuAlt"] as const)(
  "opens the shared couch menu from %s even while a company dialog owns local focus",
  async (action) => {
    store.dispatch(delta({ inGame: true }));
    render(
      <main className="base_main">
        <div className="gameWorkspace" />
        <section role="dialog">
          <button>Company purchase</button>
        </section>
      </main>,
    );
    const post = jest.fn();
    window.electrifyCouch = {
      role: "seat",
      seatId: "local-p2",
      getGeneration: () => 1,
      ready: async () => {},
      onMessage: () => () => {},
      post,
    };
    const f = bridge();
    stop = startDesktopInput(store, f.desktop);
    await act(async () => {
      await Promise.resolve();
    });
    screen.getByRole("button", { name: "Company purchase" }).focus();
    const previousCrypto = Object.getOwnPropertyDescriptor(
      globalThis,
      "crypto",
    );
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { randomUUID: () => "menu-request" },
    });
    try {
      f.emit({ actions: [action] });
      expect(post).toHaveBeenCalledWith({
        kind: "global-menu",
        requestId: "menu-request",
      });
    } finally {
      if (previousCrypto)
        Object.defineProperty(globalThis, "crypto", previousCrypto);
      else Reflect.deleteProperty(globalThis, "crypto");
    }
    expect(f.desktop.setInputContext).toHaveBeenCalledWith("Menu");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  },
);

it("routes Start and Select to the shared shell event without a visible menu trigger", async () => {
  const toggle = jest.fn();
  const hiddenMenu = jest.fn();
  render(
    <>
      <div hidden>
        <button className="gameMenuButton" onClick={hiddenMenu}>
          Hidden company menu
        </button>
      </div>
      <main className="base_main" data-couch-shell="true" />
    </>,
  );
  window.addEventListener("electrify:couch-menu", toggle);
  try {
    const f = bridge();
    stop = startDesktopInput(store, f.desktop);
    await act(async () => {
      await Promise.resolve();
    });
    f.emit({ actions: ["confirm"] });
    expect(toggle).not.toHaveBeenCalled();
    f.emit({ actions: ["menu"] });
    f.emit({ actions: ["menuAlt"] });
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(hiddenMenu).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("electrify:couch-menu", toggle);
  }
});

it("keeps solo Select as local Back during gameplay", async () => {
  const back = jest.fn();
  store.dispatch(delta({ inGame: true, speed: "NORMAL" }));
  render(
    <main
      className="base_main"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          back();
        }
      }}
    >
      <div className="gameWorkspace" />
      <button>Fleet</button>
    </main>,
  );
  const f = bridge();
  stop = startDesktopInput(store, f.desktop);
  await act(async () => {
    await Promise.resolve();
  });
  f.emit({ actions: ["menuAlt"] });
  expect(back).toHaveBeenCalledTimes(1);
  expect(store.getState().game.speed).toBe("NORMAL");
});

it("keeps the solo Start binding as pause during gameplay", async () => {
  store.dispatch(delta({ speed: "NORMAL" }));
  render(<Game />);
  const f = bridge();
  stop = startDesktopInput(store, f.desktop);
  await act(async () => {
    await Promise.resolve();
  });
  expect(f.desktop.setInputContext).toHaveBeenCalledWith("Gameplay");
  f.emit({ actions: ["menu"] });
  expect(store.getState().game.speed).toBe("PAUSED");
});

it.each(["menu", "menuAlt"] as const)(
  "keeps solo %s as Back in the Menu action set",
  async (action) => {
    const back = jest.fn();
    render(
      <main className="base_main">
        <button aria-label="Back" onClick={back}>
          Back
        </button>
      </main>,
    );
    const f = bridge();
    stop = startDesktopInput(store, f.desktop);
    await act(async () => {
      await Promise.resolve();
    });
    expect(f.desktop.setInputContext).toHaveBeenCalledWith("Menu");
    f.emit({ actions: [action] });
    expect(back).toHaveBeenCalledTimes(1);
  },
);

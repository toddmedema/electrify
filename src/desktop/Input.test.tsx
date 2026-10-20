import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import type { DesktopBridge, DesktopInputFrame } from "../Desktop";
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

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { ReactNode, useLayoutEffect } from "react";
import { restoreMenuFocus, useMenuKeys } from "./useMenuKeys";

function Menu(props: {
  children: ReactNode;
  home?: boolean;
  settings?: boolean;
  onBack?: () => void;
}) {
  return (
    <div
      id={props.home ? "menuCard" : undefined}
      {...useMenuKeys(props.settings, props.onBack)}
    >
      {props.children}
    </div>
  );
}
beforeEach(() => {
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{}] as unknown as DOMRectList);
});
afterEach(() => {
  delete document.documentElement.dataset.controllerInput;
  jest.restoreAllMocks();
});

it("selects the first action before the menu can paint", () => {
  function ReturningMenu() {
    const menu = useMenuKeys();
    useLayoutEffect(() => {
      expect(screen.getByRole("button", { name: "Play" })).toHaveFocus();
    }, []);
    return (
      <div {...menu}>
        <button>Play</button>
        <button>Manual</button>
      </div>
    );
  }
  render(<ReturningMenu />);
});

it("starts at the first usable action, wraps arrows, and uses native Enter activation once", async () => {
  const select = jest.fn();
  const user = userEvent.setup();
  render(
    <Menu>
      <button disabled>Disabled</button>
      <button hidden>Hidden</button>
      <button style={{ visibility: "hidden" }}>Invisible</button>
      <button onClick={select}>Start</button>
      <button>Settings</button>
    </Menu>,
  );
  expect(screen.getByText("Start")).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(screen.getByText("Settings")).toHaveFocus();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(select).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByText("Start"), { key: "Enter", repeat: true });
  expect(select).toHaveBeenCalledTimes(1);
});

it("focuses the saved choice, moves within/between rows, and toggles switches with Enter", async () => {
  const choose = jest.fn();
  const user = userEvent.setup();
  render(
    <Menu settings>
      <div className="settingsRow">
        <button aria-pressed="false" onClick={choose}>
          Light
        </button>
        <button aria-pressed="true">Dark</button>
      </div>
      <div className="settingsRow">
        <input type="checkbox" aria-label="Sound" />
      </div>
      <div className="settingsKeyboardRow">
        <input type="range" aria-label="Music" />
      </div>
    </Menu>,
  );
  expect(screen.getByText("Dark")).toHaveFocus();
  await user.keyboard("{ArrowLeft}{Enter}");
  expect(choose).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Dark")).toHaveAttribute("aria-pressed", "true");
  await user.keyboard("{ArrowDown}{Enter}");
  expect(screen.getByRole("checkbox")).toBeChecked();
  fireEvent.keyDown(screen.getByRole("checkbox"), {
    key: "Enter",
    repeat: true,
  });
  expect(screen.getByRole("checkbox")).toBeChecked();
  await user.keyboard("{ArrowDown}");
  const slider = screen.getByRole("slider");
  expect(slider).toHaveFocus();
  expect(fireEvent.keyDown(slider, { key: "ArrowRight" })).toBe(true);
  expect(slider).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole("checkbox")).toHaveFocus();
});

it("leaves modifiers, native text/select arrows and dialogs in control, with Escape back only once", async () => {
  const back = jest.fn();
  const view = render(
    <Menu settings onBack={back}>
      <div className="settingsRow">
        <select aria-label="Resolution">
          <option>1280</option>
        </select>
      </div>
      <div className="settingsRow">
        <input aria-label="Name" />
      </div>
    </Menu>,
  );
  const select = screen.getByRole("combobox");
  expect(fireEvent.keyDown(select, { key: "ArrowDown" })).toBe(true);
  expect(fireEvent.keyDown(select, { key: "ArrowDown", altKey: true })).toBe(
    true,
  );
  fireEvent.keyDown(select, { key: "Escape" });
  fireEvent.keyDown(select, { key: "Escape", repeat: true });
  expect(back).toHaveBeenCalledTimes(1);
  const popup = document.createElement("div");
  popup.setAttribute("role", "dialog");
  document.body.appendChild(popup);
  fireEvent.keyDown(select, { key: "Escape" });
  expect(back).toHaveBeenCalledTimes(1);
  popup.remove();
  view.unmount();
});

it("selects a late Continue only before interaction and recovers when the focused action disappears", async () => {
  const view = render(
    <Menu>
      <button key="start">Start</button>
      <button key="sound">Sound</button>
    </Menu>,
  );
  view.rerender(
    <Menu>
      <button key="continue">Continue</button>
      <button key="start">Start</button>
      <button key="sound">Sound</button>
    </Menu>,
  );
  expect(screen.getByText("Continue")).toHaveFocus();
  await userEvent.keyboard("{ArrowUp}");
  expect(screen.getByText("Sound")).toHaveFocus();
  view.rerender(
    <Menu>
      <button key="continue">Continue</button>
      <button key="start">Start</button>
    </Menu>,
  );
  await waitFor(() => expect(screen.getByText("Continue")).toHaveFocus());
  await userEvent.keyboard("{ArrowDown}");
  view.rerender(
    <Menu>
      <button key="new">New first action</button>
      <button key="start">Start</button>
    </Menu>,
  );
  expect(screen.getByText("Start")).toHaveFocus();
});

it("does not steal footer or dialog focus when the catalog updates", async () => {
  const view = render(
    <>
      <Menu>
        <button key="start">Start</button>
      </Menu>
      <button>Footer</button>
    </>,
  );
  await userEvent.click(screen.getByText("Footer"));
  view.rerender(
    <>
      <Menu>
        <button key="continue">Continue</button>
        <button key="start">Start</button>
      </Menu>
      <button>Footer</button>
    </>,
  );
  expect(screen.getByText("Footer")).toHaveFocus();
  const dialog = document.createElement("button");
  dialog.setAttribute("role", "dialog");
  document.body.appendChild(dialog);
  dialog.focus();
  view.rerender(
    <>
      <Menu>
        <button>New action</button>
      </Menu>
      <button>Footer</button>
    </>,
  );
  expect(dialog).toHaveFocus();
  dialog.remove();
});

it("keeps the main menu at the top when a screen requests focus on its old trigger", () => {
  jest.useFakeTimers();
  try {
    render(
      <div id="menuCard">
        <Menu>
          <button data-main-action>Play</button>
          <button data-settings-trigger>Settings</button>
        </Menu>
      </div>,
    );
    restoreMenuFocus("[data-settings-trigger]");
    act(() => jest.advanceTimersByTime(350));
    expect(screen.getByText("Play")).toHaveFocus();
  } finally {
    jest.useRealTimers();
  }
});

it.each([false, true])(
  "lets controller directions follow rendered rows in menus and settings (%s) while physical keyboard keys stay linear",
  (settings) => {
    document.documentElement.dataset.controllerInput = "true";
    render(
      <Menu settings={settings}>
        <div className="settingsRow">
          <button>Play</button>
          <button>Settings</button>
        </div>
      </Menu>,
    );
    const play = screen.getByRole("button", { name: "Play" });
    fireEvent.keyDown(play, { key: "ArrowRight" });
    expect(play).toHaveFocus();
    delete document.documentElement.dataset.controllerInput;
    fireEvent.keyDown(play, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus();
  },
);

it("restores the first home action after background blur and window/page return", async () => {
  render(
    <Menu home>
      <button>Continue</button>
      <button>New game</button>
    </Menu>,
  );
  const first = screen.getByRole("button", { name: "Continue" });
  const newGame = screen.getByRole("button", { name: "New game" });
  newGame.focus();
  act(() => newGame.blur());
  await waitFor(() => expect(first).toHaveFocus());
  act(() => {
    first.blur();
    window.dispatchEvent(new Event("focus"));
  });
  expect(first).toHaveFocus();
  act(() => {
    first.blur();
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(first).toHaveFocus();
});

it("recovers home focus after a child removes the selected action, while leaving popups and deliberate focus alone", async () => {
  function Removable() {
    const [visible, setVisible] = React.useState(true);
    return visible ? (
      <button onClick={() => setVisible(false)}>Install</button>
    ) : null;
  }
  render(
    <>
      <Menu home>
        <button>Play</button>
        <Removable />
      </Menu>
      <button>Outside</button>
    </>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Install" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Play" })).toHaveFocus(),
  );
  const outside = screen.getByRole("button", { name: "Outside" });
  await userEvent.click(outside);
  fireEvent(window, new Event("focus"));
  expect(outside).toHaveFocus();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.appendChild(dialog);
  outside.blur();
  fireEvent(window, new Event("focus"));
  expect(document.body).toHaveFocus();
  dialog.remove();
});

it("keeps home controller traversal linear through footer links and wraps both ways", async () => {
  document.documentElement.dataset.controllerInput = "true";
  render(
    <Menu home>
      <button>Play</button>
      <button>Settings</button>
      <footer>
        <button>Manual</button>
        <a href="https://example.com">Community</a>
      </footer>
    </Menu>,
  );
  const user = userEvent.setup();
  await user.keyboard("{ArrowDown}{ArrowDown}");
  expect(screen.getByRole("button", { name: "Manual" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("link", { name: "Community" })).toHaveFocus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("button", { name: "Play" })).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(screen.getByRole("link", { name: "Community" })).toHaveFocus();
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("button", { name: "Manual" })).toHaveFocus();
});

it("always starts and recovers home at the first action even when a saved preference is pressed", async () => {
  render(
    <Menu home>
      <button>Continue</button>
      <button aria-pressed="true">Saved preference</button>
    </Menu>,
  );
  const first = screen.getByRole("button", { name: "Continue" });
  expect(first).toHaveFocus();
  const tv = screen.getByRole("button", { name: "Saved preference" });
  tv.focus();
  act(() => tv.blur());
  await waitFor(() => expect(first).toHaveFocus());
});

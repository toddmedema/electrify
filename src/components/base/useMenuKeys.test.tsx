import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode } from "react";
import { restoreMenuFocus, useMenuKeys } from "./useMenuKeys";

function Menu(props: {
  children: ReactNode;
  settings?: boolean;
  onBack?: () => void;
}) {
  return (
    <div {...useMenuKeys(props.settings, props.onBack)}>{props.children}</div>
  );
}
beforeEach(() => {
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{}] as unknown as DOMRectList);
});
afterEach(() => jest.restoreAllMocks());

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

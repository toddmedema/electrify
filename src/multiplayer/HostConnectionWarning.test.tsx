import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../Store";
import { dialogClose, dialogOpen } from "../reducers/UI";
import HostConnectionWarning, {
  HOST_WAITING_MESSAGE,
} from "./HostConnectionWarning";

beforeEach(() => store.dispatch(dialogClose()));
afterEach(() => store.dispatch(dialogClose()));

function warning(waiting = true) {
  const onReconnect = jest.fn();
  const ui = (active: boolean) => (
    <Provider store={store}>
      <HostConnectionWarning waiting={active} onReconnect={onReconnect} />
    </Provider>
  );
  const view = render(ui(waiting));
  return {
    ...view,
    waiting: (active: boolean) => view.rerender(ui(active)),
    onReconnect,
  };
}

test("a fresh host view releases the temporary warning and its blocking dialog", () => {
  const view = warning();
  expect(store.getState().ui.dialog).toMatchObject({
    open: true,
    message: HOST_WAITING_MESSAGE,
  });
  view.waiting(false);
  expect(store.getState().ui.dialog.open).toBe(false);
  expect(view.onReconnect).not.toHaveBeenCalled();
});

test("the player can dismiss one episode without the warning immediately reopening", () => {
  const view = warning();
  act(() => {
    store.dispatch(dialogClose());
  });
  view.waiting(true);
  expect(store.getState().ui.dialog.open).toBe(false);
  view.waiting(false);
  view.waiting(true);
  expect(store.getState().ui.dialog.open).toBe(true);
  render(
    <button onClick={store.getState().ui.dialog.action}>Reconnect</button>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  expect(view.onReconnect).toHaveBeenCalledTimes(1);
  expect(store.getState().ui.dialog.open).toBe(false);
});

test("a host warning waits for an existing game dialog and recovery leaves that dialog open", () => {
  store.dispatch(
    dialogOpen({
      open: true,
      title: "Construction",
      message: "Not enough cash",
    }),
  );
  const view = warning();
  expect(store.getState().ui.dialog.title).toBe("Construction");
  view.waiting(false);
  expect(store.getState().ui.dialog).toMatchObject({
    open: true,
    title: "Construction",
  });
  view.waiting(true);
  act(() => {
    store.dispatch(dialogClose());
  });
  expect(store.getState().ui.dialog.message).toBe(HOST_WAITING_MESSAGE);
});

test.each([
  "Not enough cash",
  "Disk full",
  "Connection lost. Reconnect to continue.",
  HOST_WAITING_MESSAGE,
])("a healthy connection preserves a newer actionable error: %s", (message) => {
  const view = warning();
  act(() => {
    store.dispatch(dialogOpen({ open: true, title: "Multiplayer", message }));
  });
  view.waiting(false);
  expect(store.getState().ui.dialog).toMatchObject({
    open: true,
    title: "Multiplayer",
    message,
  });
});

import { act, render, screen } from "@testing-library/react";
import { Dialog } from "@mui/material";
import { configureStore } from "@reduxjs/toolkit";
import * as React from "react";
import { Provider } from "react-redux";
import {
  BLACKOUT_OVER_TOAST,
  BLACKOUT_TOAST_PREFIX,
} from "../../helpers/BlackoutToast";
import gameReducer, { delta } from "../../reducers/Game";
import uiReducer, { snackbarOpen } from "../../reducers/UI";
import DeferredSnackbar from "./DeferredSnackbar";

const dialog = (
  <Dialog open>
    <span>Review</span>
  </Dialog>
);

function setup() {
  const store = configureStore({
    reducer: { game: gameReducer, ui: uiReducer },
    middleware: (defaults) =>
      defaults({ serializableCheck: false, immutableCheck: false }),
  });
  const ui = (children: React.ReactNode) => (
    <Provider store={store}>{children}</Provider>
  );
  return { store, ui };
}

function Toast({
  open = true,
  overModal,
  onClose,
}: {
  open?: boolean;
  overModal?: boolean;
  onClose?: () => void;
}) {
  return (
    <DeferredSnackbar
      open={open}
      overModal={overModal}
      message="Paused Coal"
      autoHideDuration={1000}
      onClose={onClose}
    />
  );
}

it("holds a toast while a dialog is open and shows it afterwards", async () => {
  const { ui } = setup();
  const view = render(ui(dialog));
  view.rerender(
    ui(
      <>
        {dialog}
        <Toast />
      </>,
    ),
  );
  expect(screen.queryByText("Paused Coal")).not.toBeInTheDocument();
  view.rerender(ui(<Toast />));
  expect(await screen.findByText("Paused Coal")).toBeInTheDocument();
});

it("starts the timer only once the toast shows", () => {
  jest.useFakeTimers();
  try {
    const { ui } = setup();
    const onClose = jest.fn();
    const view = render(ui(dialog));
    view.rerender(
      ui(
        <>
          {dialog}
          <Toast onClose={onClose} />
        </>,
      ),
    );
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(onClose).not.toHaveBeenCalled();
    view.rerender(ui(<Toast onClose={onClose} />));
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(onClose).toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

it("shows the dialog's own feedback straight away", () => {
  const { ui } = setup();
  const view = render(ui(dialog));
  view.rerender(
    ui(
      <>
        {dialog}
        <Toast overModal />
      </>,
    ),
  );
  expect(screen.getByText("Paused Coal")).toBeInTheDocument();
});

it("replaces a held blackout toast once the blackout has ended", () => {
  const { store, ui } = setup();
  store.dispatch(delta({ blackout: { startMinute: 0, unservedWh: 0 } }));
  const view = render(ui(dialog));
  view.rerender(
    ui(
      <>
        {dialog}
        <Toast />
      </>,
    ),
  );
  const message = `${BLACKOUT_TOAST_PREFIX} 31MW short.`;
  act(() => {
    store.dispatch(snackbarOpen({ message, open: true, timeout: 4000 }));
  });
  expect(store.getState().ui.snackbar.message).toBe(message);
  act(() => {
    store.dispatch(delta({ blackout: undefined }));
  });
  expect(store.getState().ui.snackbar.message).toBe(BLACKOUT_OVER_TOAST);
});

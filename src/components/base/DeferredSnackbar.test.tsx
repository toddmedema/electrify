import { act, render, screen, waitFor } from "@testing-library/react";
import { Dialog } from "@mui/material";
import DeferredSnackbar from "./DeferredSnackbar";
import TileWorkspaceSurface from "./TileWorkspaceSurface";

const dialog = (
  <Dialog open>
    <span>Review</span>
  </Dialog>
);

function Toast({
  overModal,
  onClose,
  message = "Paused Coal",
}: {
  overModal?: boolean;
  onClose?: () => void;
  message?: string;
}) {
  return (
    <DeferredSnackbar
      open={!!message}
      overModal={overModal}
      message={message}
      autoHideDuration={1000}
      onClose={onClose}
    />
  );
}

function TileFeedback({
  tileOpen,
  message = "",
  onClose,
}: {
  tileOpen: boolean;
  message?: string;
  onClose?: () => void;
}) {
  return (
    <>
      <main>
        {tileOpen && (
          <TileWorkspaceSurface title="Natural Gas CC" onClose={() => {}}>
            <button type="button">Resume</button>
            <button type="button">Sell</button>
          </TileWorkspaceSurface>
        )}
      </main>
      <Toast message={message} onClose={onClose} />
    </>
  );
}

it("holds feedback for a nested tile dialog opened after the snackbar mounts", async () => {
  const view = render(<TileFeedback tileOpen={false} />);
  view.rerender(<TileFeedback tileOpen message="Paused Natural Gas CC" />);
  await waitFor(() => {
    expect(screen.queryByText("Paused Natural Gas CC")).not.toBeInTheDocument();
  });
  expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Sell" })).toBeEnabled();
  view.rerender(
    <TileFeedback tileOpen={false} message="Paused Natural Gas CC" />,
  );
  expect(await screen.findByText("Paused Natural Gas CC")).toBeInTheDocument();
});

it("keeps the latest tile feedback pending with a full timer after the dialog closes", async () => {
  jest.useFakeTimers();
  try {
    const onClose = jest.fn();
    const view = render(
      <TileFeedback
        tileOpen
        message="Paused Natural Gas CC"
        onClose={onClose}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(onClose).not.toHaveBeenCalled();
    view.rerender(
      <TileFeedback
        tileOpen
        message="Resumed Natural Gas CC"
        onClose={onClose}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Resumed Natural Gas CC"),
    ).not.toBeInTheDocument();
    view.rerender(
      <TileFeedback
        tileOpen={false}
        message="Resumed Natural Gas CC"
        onClose={onClose}
      />,
    );
    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    expect(screen.getByText("Resumed Natural Gas CC")).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(999);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Paused Natural Gas CC")).not.toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});

it("holds a toast while a dialog is open and shows it afterwards", async () => {
  const view = render(dialog);
  view.rerender(
    <>
      {dialog}
      <Toast />
    </>,
  );
  expect(screen.queryByText("Paused Coal")).not.toBeInTheDocument();
  view.rerender(<Toast />);
  expect(await screen.findByText("Paused Coal")).toBeInTheDocument();
});

it("shows the latest pending feedback after a MUI dialog closes and accepts new feedback", async () => {
  const feedback = (dialogOpen: boolean, message: string) => (
    <>
      {dialogOpen && dialog}
      <Toast message={message} />
    </>
  );
  const view = render(feedback(true, "Paused Coal"));
  await waitFor(() => {
    expect(screen.queryByText("Paused Coal")).not.toBeInTheDocument();
  });
  view.rerender(feedback(true, "Resumed Coal"));
  expect(screen.queryByText("Resumed Coal")).not.toBeInTheDocument();
  view.rerender(feedback(false, "Resumed Coal"));
  expect(await screen.findByText("Resumed Coal")).toBeInTheDocument();
  expect(screen.queryByText("Paused Coal")).not.toBeInTheDocument();
  view.rerender(feedback(false, "Sold Coal"));
  expect(screen.getByText("Sold Coal")).toBeInTheDocument();
  expect(screen.queryByText("Resumed Coal")).not.toBeInTheDocument();
});

it("starts the timer only once the toast shows", () => {
  jest.useFakeTimers();
  try {
    const onClose = jest.fn();
    const view = render(dialog);
    view.rerender(
      <>
        {dialog}
        <Toast onClose={onClose} />
      </>,
    );
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(onClose).not.toHaveBeenCalled();
    view.rerender(<Toast onClose={onClose} />);
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(onClose).toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

it("shows the dialog's own feedback straight away, clear of its actions", () => {
  const view = render(dialog);
  view.rerender(
    <>
      {dialog}
      <Toast overModal />
    </>,
  );
  const toast = screen.getByText("Paused Coal");
  // eslint-disable-next-line testing-library/no-node-access
  expect(toast.closest(".MuiSnackbar-root")).toHaveClass(
    "MuiSnackbar-anchorOriginTopCenter",
  );
});

it("sits below open menus and popovers unless it is a dialog's own feedback", () => {
  /* eslint-disable testing-library/no-node-access */
  const view = render(<Toast />);
  const layer = () =>
    getComputedStyle(
      screen.getByText("Paused Coal").closest(".MuiSnackbar-root")!,
    ).zIndex;
  expect(layer()).toBe("1260");
  view.rerender(<Toast overModal />);
  expect(layer()).toBe("1400");
  /* eslint-enable testing-library/no-node-access */
});

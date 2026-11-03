import { act, render, screen } from "@testing-library/react";
import { Dialog } from "@mui/material";
import DeferredSnackbar from "./DeferredSnackbar";

const dialog = (
  <Dialog open>
    <span>Review</span>
  </Dialog>
);

function Toast({
  overModal,
  onClose,
}: {
  overModal?: boolean;
  onClose?: () => void;
}) {
  return (
    <DeferredSnackbar
      open
      overModal={overModal}
      message="Paused Coal"
      autoHideDuration={1000}
      onClose={onClose}
    />
  );
}

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

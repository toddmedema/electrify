import { render, screen } from "@testing-library/react";
import { Dialog } from "@mui/material";
import DeferredSnackbar from "./DeferredSnackbar";

const dialog = (
  <Dialog open>
    <span>Review</span>
  </Dialog>
);

it("holds a toast while a dialog is open and shows it afterwards", async () => {
  const view = render(dialog);
  expect(screen.getByText("Review")).toBeInTheDocument();
  view.rerender(
    <>
      {dialog}
      <DeferredSnackbar open message="Paused Coal" />
    </>,
  );
  expect(screen.queryByText("Paused Coal")).not.toBeInTheDocument();
  view.rerender(<DeferredSnackbar open message="Paused Coal" />);
  expect(await screen.findByText("Paused Coal")).toBeInTheDocument();
});

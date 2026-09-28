import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import ConfirmDialog from "./ConfirmDialog";
import InfoDialog from "./InfoDialog";

describe("ConfirmDialog", () => {
  it("cancels and confirms through its two buttons", () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    render(
      <ConfirmDialog
        open
        title="Sell it?"
        confirmLabel="Sell"
        onCancel={onCancel}
        onConfirm={onConfirm}
      >
        You will receive $1M.
      </ConfirmDialog>,
    );
    expect(screen.getByText("You will receive $1M.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    const confirm = screen.getByText("Sell");
    expect(confirm).toHaveFocus();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("keeps its clicks from reaching a clickable row behind it", () => {
    const onRowClick = jest.fn();
    render(
      <div onClick={onRowClick}>
        <ConfirmDialog
          open
          isolateClicks
          title="Sell it?"
          cancelLabel="Nevermind"
          confirmLabel="Sell"
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />
      </div>,
    );
    fireEvent.click(screen.getByText("Nevermind"));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("disables the confirm action on request", () => {
    render(
      <ConfirmDialog
        open
        title="Retrofit?"
        confirmLabel="Pay $5M"
        confirmDisabled
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByText("Pay $5M")).toBeDisabled();
  });
});

describe("InfoDialog", () => {
  it("defaults to a single Close button", () => {
    const onClose = jest.fn();
    render(
      <InfoDialog open title="Carbon fee" onClose={onClose}>
        A fee on emissions.
      </InfoDialog>,
    );
    expect(screen.getByText("Carbon fee")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("replaces the Close button with custom actions", () => {
    render(
      <InfoDialog
        open
        title="Install"
        onClose={() => undefined}
        actions={<button type="button">Got it</button>}
      >
        Steps.
      </InfoDialog>,
    );
    expect(screen.queryByText("Close")).not.toBeInTheDocument();
    expect(screen.getByText("Got it")).toBeInTheDocument();
  });
});

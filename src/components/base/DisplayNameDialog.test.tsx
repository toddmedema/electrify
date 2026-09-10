import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DisplayNameDialog, { Props } from "./DisplayNameDialog";

function renderDialog(overrides: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    onSave: async () => undefined,
    onClose: () => undefined,
    ...overrides,
  };
  render(<DisplayNameDialog {...props} />);
}

function nameField(): HTMLInputElement {
  return screen.getByLabelText("Name") as HTMLInputElement;
}

describe("DisplayNameDialog", () => {
  it("seeds a first name from the one Google knows", () => {
    renderDialog({ googleDisplayName: "Ada Lovelace" });
    expect(nameField().value).toBe("Ada Lovelace");
    expect(
      screen.getByText("Choose your leaderboard name"),
    ).toBeInTheDocument();
  });

  it("starts from the current name when changing it", () => {
    renderDialog({ currentName: "Ada", googleDisplayName: "Ada Lovelace" });
    expect(nameField().value).toBe("Ada");
    expect(screen.getByText("Change your name")).toBeInTheDocument();
  });

  it("saves a valid name and closes", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    renderDialog({ onSave, onClose });

    await userEvent.type(nameField(), "Grace");
    await userEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith("Grace");
  });

  // Local rules first, so an obviously bad name never costs a round trip to Firestore and back
  it("refuses an invalid name without asking the server", async () => {
    const onSave = jest.fn();
    renderDialog({ onSave });

    await userEvent.type(nameField(), "Ada!");
    await userEvent.click(screen.getByText("Save"));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/letters, numbers/)).toBeInTheDocument();
  });

  /** A failed profile write must leave the dialog open so the player can retry. */
  it("stays open and explains itself when saving fails", async () => {
    const onClose = jest.fn();
    renderDialog({
      onSave: async () => "Couldn't save that name. Please try again.",
      onClose,
    });

    await userEvent.type(nameField(), "Ada");
    await userEvent.click(screen.getByText("Save"));

    expect(await screen.findByText(/try again/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(nameField().value).toBe("Ada");
  });

  // Being held at a form before having played anything is a good way to lose a new player
  it("can be dismissed without picking a name", async () => {
    const onClose = jest.fn();
    renderDialog({ onClose });

    await userEvent.click(screen.getByText("Not now"));
    expect(onClose).toHaveBeenCalled();
  });

  it("saves on Enter", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    renderDialog({ onSave });

    await userEvent.type(nameField(), "Grace{Enter}");
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Grace"));
  });
});

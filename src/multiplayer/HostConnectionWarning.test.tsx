import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { backInput, inputScope } from "../desktop/InputNavigation";
import HostConnectionWarning from "./HostConnectionWarning";

function warning() {
  const onReconnect = jest.fn().mockResolvedValue(undefined);
  const onReturnToMenu = jest.fn().mockResolvedValue(undefined);
  const ui = (
    props: Partial<React.ComponentProps<typeof HostConnectionWarning>> = {},
  ) => (
    <HostConnectionWarning
      open
      rollback={false}
      waiting
      onReconnect={onReconnect}
      onReturnToMenu={onReturnToMenu}
      {...props}
    />
  );
  const view = render(ui());
  return {
    update: (props: Parameters<typeof ui>[0]) => view.rerender(ui(props)),
    onReconnect,
    onReturnToMenu,
  };
}

test("a blocked player must choose an action to reconnect or leave", async () => {
  const user = userEvent.setup();
  const view = warning();
  const dialog = screen.getByRole("dialog");
  const title = screen.getByRole("heading");
  await waitFor(() => expect(title).toHaveFocus());
  await user.keyboard("{Escape}");
  expect(dialog).toBeVisible();
  expect(screen.queryByRole("button", { name: "OK" })).not.toBeInTheDocument();
  expect(view.onReturnToMenu).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Return to main menu" }));
  expect(view.onReturnToMenu).toHaveBeenCalledTimes(1);
  expect(view.onReconnect).not.toHaveBeenCalled();
});

test("controller Back stays within the interruption dialog", async () => {
  const rects = jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{}] as unknown as DOMRectList);
  try {
    const { onReturnToMenu, onReconnect } = warning();
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(screen.getByRole("heading")).toHaveFocus());
    expect(inputScope()).toBe(dialog);
    act(() => {
      backInput();
    });
    expect(dialog).toBeVisible();
    expect(onReturnToMenu).not.toHaveBeenCalled();
    expect(onReconnect).not.toHaveBeenCalled();
  } finally {
    rects.mockRestore();
  }
});

test("retry keeps focus and the same dialog until synchronization completes", async () => {
  const user = userEvent.setup();
  const view = warning();
  let finishRetry!: () => void;
  view.onReconnect.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishRetry = resolve;
    }),
  );
  const dialog = screen.getByRole("dialog");
  const reconnect = screen.getByRole("button", { name: "Reconnect" });
  const description = dialog.getAttribute("aria-describedby");

  await user.click(reconnect);
  expect(reconnect).toHaveFocus();
  expect(reconnect).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByRole("status")).toHaveTextContent("Reconnecting");
  await user.keyboard("{Enter}");
  expect(view.onReconnect).toHaveBeenCalledTimes(1);

  view.update({ waiting: false, synchronizing: true });
  await act(async () => finishRetry());
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(screen.getByRole("status")).toHaveTextContent("Synchronizing");
  expect(reconnect).toHaveFocus();
  expect(reconnect).toHaveAttribute("aria-disabled", "true");
  expect(dialog).toHaveAttribute("aria-describedby", description);

  view.update({ open: false });
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
});

test("a checkpoint-only interruption offers only the main menu route", async () => {
  const user = userEvent.setup();
  const view = warning();
  await user.click(screen.getByRole("button", { name: "Reconnect" }));
  view.update({ endReason: "checkpoint", rollback: true });
  const dialog = screen.getByRole("dialog", {
    name: "Multiplayer session ended",
  });
  expect(dialog).toHaveAccessibleDescription(
    /Play with friends → Multiplayer saves.*Changes since that save will be lost/,
  );
  expect(screen.getByRole("heading")).toHaveFocus();
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "Return to main menu" }),
  ).toBeVisible();
});

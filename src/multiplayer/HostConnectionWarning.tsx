import { useEffect, useRef } from "react";
import { store, useAppSelector } from "../Store";
import { dialogClose, dialogOpen } from "../reducers/UI";

export const HOST_WAITING_MESSAGE =
  "Waiting for the host. Reconnect if the connection was lost.";
export const HOST_SYNCHRONIZING_MESSAGE = "Synchronizing with host…";

/** A recovered connection releases only its own transient notice, never another game dialog. */
export default function HostConnectionWarning({
  waiting,
  synchronizing = false,
  onReconnect,
  onDisconnect,
}: {
  waiting: boolean;
  synchronizing?: boolean;
  onReconnect: () => void;
  /** Leaves the match, for a host that is not coming back. */
  onDisconnect: () => void;
}) {
  const dialog = useAppSelector((state) => state.ui.dialog);
  const ownedAction = useRef<() => void>();
  useEffect(() => {
    if (!waiting && !synchronizing) {
      if (
        ownedAction.current &&
        dialog.open &&
        dialog.action === ownedAction.current
      )
        store.dispatch(dialogClose());
      ownedAction.current = undefined;
      return;
    }
    const message = waiting ? HOST_WAITING_MESSAGE : HOST_SYNCHRONIZING_MESSAGE;
    if (
      ownedAction.current &&
      dialog.open &&
      dialog.action === ownedAction.current &&
      dialog.message !== message
    ) {
      store.dispatch(dialogOpen({ ...dialog, message }));
      return;
    }
    // Do not replace another notification or reopen after the player dismissed this episode.
    if (ownedAction.current || dialog.open) return;
    ownedAction.current = () => {
      store.dispatch(dialogClose());
      onReconnect();
    };
    store.dispatch(
      dialogOpen({
        open: true,
        title: "Multiplayer",
        message,
        closeText: "OK",
        actionLabel: "Reconnect",
        action: ownedAction.current,
        secondaryLabel: "Disconnect",
        secondaryAction: onDisconnect,
      }),
    );
  }, [waiting, synchronizing, dialog, onReconnect, onDisconnect]);
  return null;
}

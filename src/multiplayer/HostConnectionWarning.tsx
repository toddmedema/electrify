import { useEffect, useRef } from "react";
import { store, useAppSelector } from "../Store";
import { dialogClose, dialogOpen } from "../reducers/UI";

export const HOST_WAITING_MESSAGE =
  "Waiting for the host. Reconnect if the connection was lost.";

/** A recovered connection releases only its own transient notice, never another game dialog. */
export default function HostConnectionWarning({
  waiting,
  onReconnect,
}: {
  waiting: boolean;
  onReconnect: () => void;
}) {
  const dialog = useAppSelector((state) => state.ui.dialog);
  const ownedAction = useRef<() => void>();
  useEffect(() => {
    if (!waiting) {
      if (
        ownedAction.current &&
        dialog.open &&
        dialog.action === ownedAction.current
      )
        store.dispatch(dialogClose());
      ownedAction.current = undefined;
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
        message: HOST_WAITING_MESSAGE,
        closeText: "OK",
        actionLabel: "Reconnect",
        action: ownedAction.current,
      }),
    );
  }, [waiting, dialog, onReconnect]);
  return null;
}

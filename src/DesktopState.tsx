import { useEffect, useState } from "react";
import { DesktopState, getDesktop } from "./Desktop";

export const useDesktopState =
  process.env.REACT_APP_DESKTOP === "true"
    ? function useDesktopState(): DesktopState | undefined {
        const [state, setState] = useState<DesktopState>();
        useEffect(() => {
          const desktop = getDesktop();
          if (!desktop) return;
          let live = true;
          const update = (next: DesktopState) => {
            if (live) setState(next);
          };
          const unsubscribe = desktop.onStateChanged(update);
          void desktop
            .getState()
            .then(update)
            .catch(() => undefined);
          return () => {
            live = false;
            unsubscribe();
          };
        }, []);
        return state;
      }
    : function useDesktopState(): DesktopState | undefined {
        return undefined;
      };

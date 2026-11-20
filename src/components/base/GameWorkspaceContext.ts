import { createContext, useContext, type RefObject } from "react";
import type { WorkspaceLayout } from "../../WorkspaceLayout";

/** Prevent embedded game views from creating their own app bar and navigation. */
export const GameWorkspaceContext = createContext(false);

/** Close an embedded tool without clearing the other desktop rail. */
export const GameToolCloseContext = createContext<(() => void) | undefined>(
  undefined,
);

/** Finish a build purchase, revealing the fleet when Build is an overlay. */
export const GameBuildCompleteContext = createContext<(() => void) | undefined>(
  undefined,
);

/** Shared rendered layout: supporting evidence follows the visible fleet, not a device preset. */
export const GameWorkspaceLayoutContext = createContext<
  (WorkspaceLayout & { fleetVisible: boolean }) | undefined
>(undefined);
export const useGameWorkspaceLayout = () =>
  useContext(GameWorkspaceLayoutContext);

export type MapTileWindow = {
  tray: RefObject<HTMLDivElement>;
  stackingIndex: number;
  front: boolean;
  raise: () => void;
};

/** Share tile activation and exclusive project navigation with the map workspace. */
export const MapWorkspacePanelContext = createContext<
  | {
      open: boolean;
      returnToMap: () => void;
      showTile?: (close: () => void) => void;
      hideTile?: () => void;
      tileWindow?: MapTileWindow;
      projectRequested?: boolean;
      onProjectBusyChange?: (busy: boolean) => void;
    }
  | undefined
>(undefined);

// Embedded decisions defer Escape and focus ownership to the containing map window.
export const MapWindowFrontContext = createContext<boolean | undefined>(
  undefined,
);

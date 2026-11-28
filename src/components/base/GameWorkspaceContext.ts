import { createContext, useContext, type RefObject } from "react";
import type { CardNameType, FacilityShoppingType } from "../../Types";
import type { WorkspaceLayout } from "../../WorkspaceLayout";

/** Close a tool while leaving the other map windows open. */
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

export type MapBuildCatalogue = {
  open: boolean;
  onOpen: () => void;
  onChoose: (selection: FacilityShoppingType) => void;
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
      buildCategory?: CardNameType;
      setBuildCategory?: (category: CardNameType) => void;
      buildCatalogue?: MapBuildCatalogue;
      showProject?: (close: () => void) => void;
      hideProject?: () => void;
      onProjectBusyChange?: (busy: boolean) => void;
    }
  | undefined
>(undefined);

// Embedded decisions defer Escape and focus ownership to the containing map window.
export const MapWindowFrontContext = createContext<boolean | undefined>(
  undefined,
);

import { createContext, useContext } from "react";
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

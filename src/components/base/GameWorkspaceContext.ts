import { createContext } from "react";

/** Prevent embedded game views from creating their own app bar and navigation. */
export const GameWorkspaceContext = createContext(false);

/** Embedded purchase flows close their tool without clearing the other desktop rail. */
export const GameToolCloseContext = createContext<(() => void) | undefined>(
  undefined,
);

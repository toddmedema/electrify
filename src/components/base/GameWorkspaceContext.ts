import { createContext } from "react";

/** Prevent embedded game views from creating their own app bar and navigation. */
export const GameWorkspaceContext = createContext(false);

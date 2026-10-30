import { createContext } from "react";
import { UtilityAreaId } from "../../Types";

/** Shared by generator and storage catalogs so changing technology preserves the chosen area. */
export const BuildOperatingAreaContext = createContext<
  UtilityAreaId | undefined
>(undefined);

import * as React from "react";
import { useAppSelector } from "../../Store";
import { UnitSystemType } from "../../Types";
import { DEFAULT_UNIT_SYSTEM } from "../../helpers/Units";

/**
 * The unit system every label in the game reads itself out in.
 *
 * A context rather than a prop, because the things that show a unit are leaves - a chart axis,
 * a row in the build list, a paragraph of the manual - sitting under components that block
 * re-renders on purpose (Compositor, Finances and Forecasts all have a shouldComponentUpdate
 * that ignores everything but the clock and the card). Context updates go through those
 * regardless, so changing the setting repaints the labels without loosening any of them.
 *
 * Defaulting to metric rather than throwing also means a component can be rendered on its own,
 * outside the store, and still read in the units it would have started in.
 */
export const UnitsContext =
  React.createContext<UnitSystemType>(DEFAULT_UNIT_SYSTEM);

export function useUnits(): UnitSystemType {
  return React.useContext(UnitsContext);
}

export default function UnitsProvider(props: {
  children: React.ReactNode;
}): React.JSX.Element {
  const units = useAppSelector((state) => state.settings.units);
  return (
    <UnitsContext.Provider value={units}>
      {props.children}
    </UnitsContext.Provider>
  );
}

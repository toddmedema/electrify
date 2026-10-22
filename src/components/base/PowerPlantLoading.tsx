import * as React from "react";
import { useMediaQuery } from "@mui/material";
import { ModFacilityNameType } from "../../Types";

const PLANTS: ModFacilityNameType[] = [
  "Coal",
  "Wind",
  "Nuclear",
  "Solar",
  "Natural Gas Peaker",
  "Hydro",
  "Biomass",
  "Offshore Wind",
  "Oil",
  "Geothermal",
  "Battery",
  "Airborne Wind",
  "Natural Gas CC",
  "Enhanced Geothermal",
  "Pumped Hydro",
];

// A closed, smooth crossing keeps each icon upright through both lobes.
const FIGURE_EIGHT =
  "M300 120 C392 24 576 24 576 120 C576 216 392 216 300 120 C208 24 24 24 24 120 C24 216 208 216 300 120";
const LAP_SECONDS = 24;

export default function PowerPlantLoading(): React.JSX.Element {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)", {
    noSsr: true,
  });

  return (
    <svg
      className="loadingPlants"
      viewBox="0 0 600 240"
      aria-hidden="true"
      focusable="false"
    >
      {PLANTS.map((name, index) => {
        const phase = (index / PLANTS.length) * 2 * Math.PI;
        return (
          <g
            key={name}
            transform={
              reducedMotion
                ? `translate(${300 + 276 * Math.sin(phase)} ${120 - 72 * Math.sin(2 * phase)})`
                : undefined
            }
          >
            {!reducedMotion && (
              <animateMotion
                path={FIGURE_EIGHT}
                dur={`${LAP_SECONDS}s`}
                begin={`${(-index / PLANTS.length) * LAP_SECONDS}s`}
                repeatCount="indefinite"
                calcMode="paced"
              />
            )}
            <image
              href={`/images/${name.toLowerCase()}.svg`}
              x="-24"
              y="-24"
              width="48"
              height="48"
            />
          </g>
        );
      })}
    </svg>
  );
}

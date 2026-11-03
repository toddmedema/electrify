import * as React from "react";
import { Button } from "@mui/material";
import { PRICED_FUELS } from "../../Constants";
import { PricedFuelNameType } from "../../Types";
import { fuelColors, fuelDashArrays } from "../../Theme";

export default function FuelPriceFilter({
  selectedFuel,
  onChange,
}: {
  selectedFuel?: PricedFuelNameType;
  onChange: (fuel: PricedFuelNameType | undefined) => void;
}) {
  return (
    <div className="fuelPriceFilter" role="group" aria-label="Show fuel prices">
      <span className="fuelPriceFilterLabel">Show</span>
      <div className="fuelPriceFilterOptions">
        {[undefined, ...PRICED_FUELS].map((fuel) => (
          <Button
            key={fuel || "all"}
            size="small"
            aria-pressed={selectedFuel === fuel}
            variant={selectedFuel === fuel ? "outlined" : "text"}
            onClick={() => onChange(fuel)}
          >
            {fuel && (
              <svg viewBox="0 0 40 6" aria-hidden="true">
                <line
                  x1="0"
                  y1="3"
                  x2="40"
                  y2="3"
                  stroke={fuelColors()[fuel]}
                  strokeWidth="3"
                  strokeDasharray={fuelDashArrays[fuel]}
                />
              </svg>
            )}
            <span>{fuel || "All fuels"}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

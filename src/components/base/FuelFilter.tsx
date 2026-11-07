import * as React from "react";
import { Button } from "@mui/material";
import { FuelNameType } from "../../Types";

/**
 * How a chart draws a series, so its key looks like the thing it names: a line carries the
 * dash pattern that tells it apart from its neighbours, a stacked band a block of its fill.
 */
export type FuelSampleType =
  | { kind: "line"; color: string; dash?: string | undefined }
  | { kind: "fill"; color: string };

export interface Props<F extends FuelNameType> {
  /** Names the group for assistive technology, eg "Show fuel prices" */
  label: string;
  fuels: readonly F[];
  /** The one fuel the chart is narrowed to; undefined shows them all */
  selectedFuel?: F | undefined;
  onChange: (fuel: F | undefined) => void;
  sample: (fuel: F) => FuelSampleType;
  /**
   * A series drawn over every fuel, such as demand. It is named here so the chart never
   * carries an unlabelled line, but it can't be chosen: it stays whichever fuel is selected.
   */
  overlay?: { name: string; sample: FuelSampleType };
}

function Sample({ sample }: { sample: FuelSampleType }) {
  if (sample.kind === "fill") {
    return (
      <span
        className="fuelFilterFill"
        style={{ backgroundColor: sample.color }}
        aria-hidden="true"
      />
    );
  }
  return (
    <svg viewBox="0 0 40 6" aria-hidden="true">
      <line
        x1="0"
        y1="3"
        x2="40"
        y2="3"
        stroke={sample.color}
        strokeWidth="3"
        strokeDasharray={sample.dash}
      />
    </svg>
  );
}

/**
 * The key to a chart's fuels, and the way to narrow it to one: "All fuels" or a single fuel
 * pressed in. One control for every fuel chart, so choosing a fuel works the same wherever
 * the player meets it.
 */
export default function FuelFilter<F extends FuelNameType>({
  label,
  fuels,
  selectedFuel,
  onChange,
  sample,
  overlay,
}: Props<F>) {
  return (
    <div className="fuelFilter" role="group" aria-label={label}>
      <span className="fuelFilterLabel">Show</span>
      <div className="fuelFilterOptions">
        {[undefined, ...fuels].map((fuel) => (
          <Button
            key={fuel || "all"}
            size="small"
            aria-pressed={selectedFuel === fuel}
            variant={selectedFuel === fuel ? "outlined" : "text"}
            onClick={() => onChange(fuel)}
          >
            {fuel && <Sample sample={sample(fuel)} />}
            <span>{fuel || "All fuels"}</span>
          </Button>
        ))}
        {overlay && (
          <span className="fuelFilterOverlay">
            <Sample sample={overlay.sample} />
            <span>{overlay.name}</span>
          </span>
        )}
      </div>
    </div>
  );
}

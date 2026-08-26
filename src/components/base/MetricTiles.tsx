import * as React from "react";
import { Typography } from "@mui/material";
import Sparkline from "./Sparkline";
import { chartPalette } from "../../Theme";

/**
 * The Finances metric picker on a screen with room for one: every headline metric drawn at once,
 * with the one being plotted promoted to the big chart above.
 *
 * A dropdown is what you reach for when there is only room for one number at a time -- it hides
 * five of the six answers behind a click, and gives no hint which of them is worth looking at.
 * Six sparklines side by side say "expenses are climbing while revenue is flat" without the
 * player having to go looking for it, and clicking one is the same gesture the dropdown was.
 */

export interface MetricTileType {
  metricKey: string;
  label: string;
  /** The metric's latest value, already formatted */
  value: string;
  /** Every month on the chart, oldest first, so the tile trends over the same span */
  values: number[];
}

export interface Props {
  tiles: MetricTileType[];
  selectedKey: string;
  onSelect: (metricKey: string) => void;
  // How the walkthrough addresses the metric picker, whichever form it is taking
  id?: string;
}

export default function MetricTiles(props: Props): React.JSX.Element {
  const { tiles, selectedKey, onSelect } = props;
  return (
    <div
      id={props.id}
      className="metricTiles"
      role="group"
      aria-label="Plotted metric"
    >
      {tiles.map((tile: MetricTileType) => {
        const selected = tile.metricKey === selectedKey;
        return (
          <button
            key={tile.metricKey}
            type="button"
            className={selected ? "metricTile selected" : "metricTile"}
            // Named, because the tile reads as "Profit $6.79M" plus a picture of a line, and
            // what the button does is plot it
            aria-label={`Plot ${tile.label}`}
            aria-pressed={selected}
            onClick={() => onSelect(tile.metricKey)}
          >
            <Typography
              variant="body2"
              color="textSecondary"
              className="metricTileLabel"
            >
              {tile.label}
            </Typography>
            <Typography variant="body2" className="metricTileValue">
              {tile.value}
            </Typography>
            <Sparkline
              values={tile.values}
              color={
                selected ? chartPalette().interactive : chartPalette().muted
              }
              width={80}
              height={18}
              ariaLabel={`${tile.label} trend`}
            />
          </button>
        );
      })}
    </div>
  );
}

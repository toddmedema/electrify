import * as React from "react";
import {
  createContainer,
  LineSegment,
  VictoryCursorContainerProps,
  VictoryTooltip,
  VictoryVoronoiContainerProps,
} from "victory";
import { cursorColor } from "../../Theme";

// Voronoi puts one tooltip on screen covering every series at the hovered x; cursor draws the
// vertical line marking which x that is, so the numbers in the tooltip are tied to a place on
// the chart rather than floating near the pointer.
// Cursor first, voronoi second: the combined container appends each behaviour's elements in
// the order given, and SVG paints in document order, so this keeps the tooltip above the line
// rather than letting the line strike through it.
// createContainer's return type is too loose for TSX to accept as a component, so it is
// asserted to one taking the union of the two behaviours' props -- which is what the combined
// container actually accepts.
const CursorVoronoiContainer = createContainer(
  "cursor",
  "voronoi",
) as React.ComponentType<
  VictoryCursorContainerProps & VictoryVoronoiContainerProps
>;

interface Props<Datum> {
  // Victory hands the callback the whole point; every chart here only reads the datum, which
  // is one entry of whatever array it passed as `data`.
  labels: (point: { datum: Datum }) => string;
  // Series that shouldn't raise their own tooltip, because one tooltip already reports them all
  voronoiBlacklist?: string[];
  // What this chart shows, read by screen readers instead of the raw SVG path data
  ariaLabel: string;
}

// Shared hover behaviour for every chart in the game
export function chartTooltipContainer<Datum>({
  labels,
  voronoiBlacklist,
  ariaLabel,
}: Props<Datum>) {
  return (
    <CursorVoronoiContainer
      role="img"
      aria-label={ariaLabel}
      voronoiDimension="x"
      cursorDimension="x"
      voronoiBlacklist={voronoiBlacklist}
      labels={labels}
      cursorComponent={
        <LineSegment
          style={{
            stroke: cursorColor,
            strokeWidth: 1,
            strokeDasharray: "3,2",
            pointerEvents: "none",
          }}
        />
      }
      labelComponent={
        <VictoryTooltip
          cornerRadius={2}
          constrainToVisibleArea
          flyoutStyle={{ fill: "white" }}
          style={{ textAnchor: "end" }}
        />
      }
    />
  );
}

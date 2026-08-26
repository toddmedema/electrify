import * as React from "react";

/**
 * The key to a chart's series, as plain HTML below or beside the plot rather than something
 * drawn inside it -- so it wraps on a narrow screen, and a screen reader can read it.
 *
 * `inline` puts it in the chart's own header instead of on a row of its own, which is what the
 * stacked forecasts use: five charts each giving up a row to a legend is five rows that could
 * have been plot.
 */

export interface LegendItemType {
  name: string;
  color: string;
  /** SVG dash pattern, for series told apart by their line style as well as their colour */
  dash?: string | undefined;
  /** Drawn as a rule rather than a block, for a series that is a line over the others */
  rule?: boolean;
  /** Faded back, for a series the chart itself is currently drawing faded back */
  muted?: boolean;
}

export interface Props {
  items: LegendItemType[];
  inline?: boolean;
}

export default function ChartLegend(props: Props): React.JSX.Element {
  return (
    <div
      className={"chartLegend" + (props.inline ? " chartLegend-inline" : "")}
    >
      {props.items.map((item) => (
        <span
          key={item.name}
          className={
            "chartLegendItem" + (item.muted ? " chartLegendItem-muted" : "")
          }
        >
          {item.dash ? (
            <svg
              className="chartLegendSwatch chartLegendSwatch-line"
              viewBox="0 0 20 4"
              aria-hidden="true"
            >
              <line
                x1="0"
                y1="2"
                x2="20"
                y2="2"
                stroke={item.color}
                strokeWidth="3"
                strokeDasharray={item.dash}
              />
            </svg>
          ) : item.rule ? (
            <span className="chartLegendSwatch chartLegendSwatch-demand" />
          ) : (
            <span
              className="chartLegendSwatch"
              style={{ backgroundColor: item.color }}
            />
          )}
          {item.name}
        </span>
      ))}
    </div>
  );
}

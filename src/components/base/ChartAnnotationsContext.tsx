import * as React from "react";

export interface ChartEventMarker {
  key: string;
  x: number;
  number: number;
  /** The event's name, shown when a badge is hovered. */
  title?: string;
}

export interface ChartAnnotationsValue {
  events: ChartEventMarker[];
  activeEventKey?: string;
}

export const ChartAnnotationsContext =
  React.createContext<ChartAnnotationsValue>({ events: [] });

import * as React from "react";

export interface ChartEventMarker {
  key: string;
  x: number;
  number: number;
}

export interface ChartAnnotationsValue {
  events: ChartEventMarker[];
  activeEventKey?: string;
}

export const ChartAnnotationsContext =
  React.createContext<ChartAnnotationsValue>({ events: [] });

import * as React from "react";
import { Typography } from "@mui/material";
import {
  formatLargeMassValueConcise,
  largeMassUnit,
} from "../../helpers/Units";
import { UnitSystemType } from "../../Types";
export default function BuildMetric(props: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="buildOptionMetric">
      <Typography variant="caption" color="textSecondary" component="div">
        {props.label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ fontWeight: 600 }}>
        {props.value}
      </Typography>
    </div>
  );
}

/**
 * What building this emits, and over how long. Shown on every build card because the number is
 * otherwise invisible for the technologies that emit nothing while running -- which is exactly
 * where it changes the comparison.
 */
export function ConstructionEmissionsMetric(props: {
  kgco2eTotal: number;
  yearsToBuild: number;
  units: UnitSystemType;
}): React.JSX.Element {
  const months = Math.round(props.yearsToBuild * 12);
  const over =
    months >= 24
      ? `${Math.round(props.yearsToBuild)} yr`
      : `${Math.max(1, months)} mo`;
  return (
    <BuildMetric
      label="Building emits"
      value={`${formatLargeMassValueConcise(props.kgco2eTotal, props.units)} ${largeMassUnit(props.units)} over ${over}`}
    />
  );
}

import * as React from "react";
import { Typography } from "@mui/material";
import ConceptIcon, {
  CONCEPT_LABELS,
  CONCEPT_NAMES,
  ConceptNameType,
} from "./ConceptIcon";

/**
 * The visible key for the vocabulary introduced by the first missions. Keeping the legend driven
 * by the same names and labels as every in-game glyph means adding a concept cannot leave the
 * Manual's explanation silently out of date.
 */
export default function ConceptLegend(): React.JSX.Element {
  return (
    <div className="conceptLegend" data-testid="concept-legend">
      {CONCEPT_NAMES.map((concept: ConceptNameType) => (
        <div className="conceptLegendItem" key={concept}>
          <ConceptIcon concept={concept} fontSize="large" />
          <Typography variant="body2">{CONCEPT_LABELS[concept]}</Typography>
        </div>
      ))}
    </div>
  );
}

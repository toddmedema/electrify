import * as React from "react";
import { Typography } from "@mui/material";
import ConceptIcon, { ConceptNameType } from "./ConceptIcon";

export interface DecisionImpactFactType {
  concept: ConceptNameType;
  label: string;
  value: string;
  detail?: string;
}

export interface DecisionImpactPreviewProps {
  facts: DecisionImpactFactType[];
}

/** A common before-commit grammar: action first, exact delta second, explanation last. */
export default function DecisionImpactPreview({
  facts,
}: DecisionImpactPreviewProps): React.JSX.Element {
  return (
    <section className="decisionImpact" aria-label="Expected impact">
      <Typography variant="overline" component="h3">
        What changes
      </Typography>
      <div className="decisionImpactFacts">
        {facts.map((fact) => (
          <div className="decisionImpactFact" key={fact.label}>
            <ConceptIcon concept={fact.concept} fontSize="small" />
            <div>
              <Typography variant="caption" component="div">
                {fact.label}
              </Typography>
              <Typography variant="body2" component="div">
                <strong>{fact.value}</strong>
              </Typography>
              {fact.detail && (
                <Typography variant="caption" color="textSecondary">
                  {fact.detail}
                </Typography>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

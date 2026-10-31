import * as React from "react";
import { Typography } from "@mui/material";
import ConceptIcon, { ConceptNameType } from "./ConceptIcon";

export interface DecisionImpactFactType {
  concept: ConceptNameType;
  label: string;
  value: string;
  detail?: string;
  help?: React.ReactNode;
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
      <div className="decisionImpactFacts">
        {facts.map((fact) => (
          <div
            className={`decisionImpactFact${fact.help ? " decisionImpactFactWithHelp" : ""}`}
            key={fact.label}
          >
            <ConceptIcon concept={fact.concept} fontSize="small" />
            <div className="decisionImpactFactContent">
              <Typography
                className="decisionImpactFactLabel"
                variant="caption"
                component="div"
              >
                {fact.label}
              </Typography>
              <Typography
                className="decisionImpactFactValue"
                variant="body2"
                component="div"
              >
                <strong>{fact.value}</strong>
              </Typography>
              {fact.detail && (
                <Typography
                  className="decisionImpactFactDetail"
                  variant="caption"
                  color="textSecondary"
                >
                  {fact.detail}
                </Typography>
              )}
            </div>
            {fact.help && (
              <div className="decisionImpactFactHelp">{fact.help}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

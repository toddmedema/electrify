import * as React from "react";
import { Typography } from "@mui/material";
import ConceptIcon, { ConceptNameType } from "./ConceptIcon";
import ManualLink from "./ManualLink";
import type { ManualEntryTitleType } from "./ManualEntries";

export interface DecisionImpactFactType {
  concept: ConceptNameType;
  label: string;
  value: string;
  detail?: string;
  /** Lets a control point at this explanation with aria-describedby */
  detailId?: string;
  entry?: ManualEntryTitleType;
  helpLabel?: string;
}

export interface DecisionImpactPreviewProps {
  label?: string;
  facts: DecisionImpactFactType[];
}

/** A common before-commit grammar: action first, exact delta second, explanation last. */
export default function DecisionImpactPreview({
  label = "Expected impact",
  facts,
}: DecisionImpactPreviewProps): React.JSX.Element {
  return (
    <section className="decisionImpact" aria-label={label}>
      <div className="decisionImpactFacts">
        {facts.map((fact) => (
          <div
            className={`decisionImpactFact${fact.entry ? " manual-help-region" : ""}${fact.concept === "money" ? " decisionImpactFactMoney" : ""}`}
            key={fact.label}
          >
            {fact.concept !== "money" && (
              <ConceptIcon concept={fact.concept} fontSize="small" />
            )}
            <div className="decisionImpactFactContent">
              <Typography
                className="decisionImpactFactLabel"
                variant="caption"
                component="div"
              >
                {fact.entry ? (
                  <ManualLink
                    entry={fact.entry}
                    label={fact.helpLabel || fact.label.toLowerCase()}
                    region
                  >
                    {fact.label}
                  </ManualLink>
                ) : (
                  fact.label
                )}
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
                  id={fact.detailId}
                  className="decisionImpactFactDetail"
                  variant="caption"
                  color="textSecondary"
                >
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

import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import { Typography } from "@mui/material";
import * as React from "react";
import ConceptIcon, { ConceptNameType } from "./ConceptIcon";

export interface TutorialPromptProps {
  // The idea, told in symbols: a large icon row read left to right, arrows between
  concepts: ConceptNameType[];
  // At most one short sentence - the symbols carry the teaching, the words only confirm it
  text?: string;
  // For gated steps: the deed being asked for, as a "do this" chip matching the pulsing
  // affordance in the tooltip footer
  action?: ConceptNameType[];
}

export default function TutorialPrompt({
  concepts,
  text,
  action,
}: TutorialPromptProps): React.JSX.Element {
  return (
    <div className="tutorialPrompt">
      <div className="tutorialPromptConcepts">
        {concepts.map((concept, i) => (
          <React.Fragment key={i}>
            {i > 0 && (
              <ArrowForwardIcon
                className="tutorialPromptArrow"
                fontSize="small"
                aria-hidden
              />
            )}
            <ConceptIcon concept={concept} fontSize="large" />
          </React.Fragment>
        ))}
      </div>
      {text && <Typography variant="body2">{text}</Typography>}
      {action && (
        <div className="tutorialPromptAction">
          <TouchAppIcon fontSize="small" color="primary" aria-hidden />
          {action.map((concept, i) => (
            <ConceptIcon key={i} concept={concept} fontSize="small" />
          ))}
        </div>
      )}
    </div>
  );
}

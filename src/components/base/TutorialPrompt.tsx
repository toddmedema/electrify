import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import { Box, Stack, Typography } from "@mui/material";
import * as React from "react";
import ConceptIcon, { CONCEPT_LABELS, ConceptNameType } from "./ConceptIcon";

export interface TutorialPromptProps {
  // The idea, told in symbols: a large icon row read left to right, arrows between
  concepts: ConceptNameType[];
  // At most one short sentence - the symbols carry the teaching, the words only confirm it
  text?: string;
  // For gated steps: the deed being asked for, as a "do this" chip matching the pulsing
  // affordance in the objective HUD
  action?: ConceptNameType[];
}

export default function TutorialPrompt({
  concepts,
  text,
  action,
}: TutorialPromptProps): React.JSX.Element {
  const actionLabel = action
    ?.map((concept) => CONCEPT_LABELS[concept].toLowerCase())
    .join(" then ");

  return (
    <Stack
      className="tutorialPrompt"
      spacing={1.25}
      sx={{ textAlign: "left", minWidth: 0 }}
    >
      <Box
        className="tutorialPromptConcepts"
        sx={{
          alignSelf: "stretch",
          borderRadius: 2,
          bgcolor: "action.hover",
          py: 1.25,
          px: 1.5,
        }}
        aria-label={`Tutorial concepts: ${concepts
          .map((concept) => CONCEPT_LABELS[concept])
          .join(", ")}`}
      >
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
      </Box>
      {text && (
        <Typography variant="body1" sx={{ lineHeight: 1.45 }}>
          {text}
        </Typography>
      )}
      {action && (
        <Box
          className="tutorialPromptAction"
          role="status"
          aria-label={`Required action: ${actionLabel}`}
          sx={{
            alignSelf: "stretch",
            justifyContent: "flex-start",
            bgcolor: "action.selected",
            borderColor: "primary.main !important",
          }}
        >
          <TouchAppIcon fontSize="small" color="primary" aria-hidden />
          <Typography
            variant="caption"
            component="span"
            sx={{ fontWeight: 700, mr: 0.5 }}
          >
            Do this to continue:
          </Typography>
          {action.map((concept, i) => (
            <ConceptIcon key={i} concept={concept} fontSize="small" />
          ))}
          <Typography variant="caption" component="span">
            {actionLabel}
          </Typography>
        </Box>
      )}
    </Stack>
  );
}

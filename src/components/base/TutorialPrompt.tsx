import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { Box, Stack, Typography } from "@mui/material";
import * as React from "react";
import ConceptIcon, { CONCEPT_LABELS, ConceptNameType } from "./ConceptIcon";

export interface TutorialPromptProps {
  // The idea, told in symbols: a large icon row read left to right, arrows between
  concepts: ConceptNameType[];
  // At most one short sentence - the symbols carry the teaching, the words only confirm it
  text?: string;
}

export default function TutorialPrompt({
  concepts,
  text,
}: TutorialPromptProps): React.JSX.Element {
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
    </Stack>
  );
}

import { Typography } from "@mui/material";
import * as React from "react";

export interface TutorialPromptProps {
  // The whole step, in at most one short sentence
  text: string;
}

export default function TutorialPrompt({
  text,
}: TutorialPromptProps): React.JSX.Element {
  // A stable hook for the HUD's type scale, which MUI's generated class names can't give
  return (
    <Typography className="tutorialPrompt" variant="body1">
      {text}
    </Typography>
  );
}

import { Typography } from "@mui/material";
import * as React from "react";

export interface TutorialPromptProps {
  // The whole step, in at most one short sentence
  text: string;
}

export default function TutorialPrompt({
  text,
}: TutorialPromptProps): React.JSX.Element {
  return <Typography variant="body1">{text}</Typography>;
}

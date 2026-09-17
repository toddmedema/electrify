import { Typography } from "@mui/material";
import * as React from "react";
import { ConceptNameType } from "./ConceptIcon";

export interface TutorialPromptProps {
  // Retained from the icon-led design for the game's symbol vocabulary, but deliberately not
  // rendered: the tutorial teaches with its words alone, and the symbols meet the player in
  // events, dialogs and the Manual, where the legend introduces them in context.
  concepts: ConceptNameType[];
  // The whole step, in at most one short sentence
  text: string;
}

export default function TutorialPrompt({
  text,
}: TutorialPromptProps): React.JSX.Element {
  return <Typography variant="body1">{text}</Typography>;
}

import * as React from "react";

export interface TutorialPromptProps {
  // The whole step, in at most one short sentence
  text: string;
}

export default function TutorialPrompt({
  text,
}: TutorialPromptProps): React.JSX.Element {
  // Scenarios also import these prompts in forecasting workers. Keep their markup independent
  // of the component library so workers don't ship its styling runtime just to hold a sentence.
  return <p className="tutorialPrompt">{text}</p>;
}

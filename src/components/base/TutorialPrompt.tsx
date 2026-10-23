import * as React from "react";
import { useControllerInput } from "../../desktop/InputPresentation";

/** Authored touch wording follows the current input without changing tutorial rules. */
export function tutorialInputText(
  text: string,
  controllerInput: boolean,
): string {
  return controllerInput
    ? text.replace(/\btap\b/gi, (word) =>
        word[0] === "T" ? "Select" : "select",
      )
    : text;
}

export interface TutorialPromptProps {
  // The whole step, in at most one short sentence
  text: string;
}

export default function TutorialPrompt({
  text,
}: TutorialPromptProps): React.JSX.Element {
  // Scenarios also import these prompts in forecasting workers. Keep their markup independent
  // of the component library so workers don't ship its styling runtime just to hold a sentence.
  const controllerInput = useControllerInput();
  return (
    <p className="tutorialPrompt">{tutorialInputText(text, controllerInput)}</p>
  );
}

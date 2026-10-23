import * as React from "react";
import { useControllerInput } from "../../desktop/InputPresentation";

/** Authored touch wording follows the current input without changing tutorial rules. */
export function tutorialInputText(
  text: string,
  controllerInput: boolean,
): string {
  if (!controllerInput) return text;
  // A controller moves sliders with directions rather than dragging them.
  const words: Record<string, string> = { tap: "select", drag: "move" };
  return text.replace(/\b(tap|drag)\b/gi, (word) => {
    const replacement = words[word.toLowerCase()];
    return word[0] === word[0].toUpperCase()
      ? replacement[0].toUpperCase() + replacement.slice(1)
      : replacement;
  });
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

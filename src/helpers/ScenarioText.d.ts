export function scenarioTextError(
  text: unknown,
  allowEvent?: boolean,
): string | undefined;
export function renderScenarioText(
  text: string,
  startingYear: number,
  eventMonth?: number,
): string;

export function scenarioTextLength(text: string, allowEvent?: boolean): number;

import * as React from "react";

/**
 * What a row in the facilities list says while it is still being built. Plants and interties
 * both read from here, so the two rows can never word the same state differently.
 */
export function constructionStatus(
  builtFraction: number,
  yearsToBuildLeft: number,
): { reading: string; detail: string; label: string } {
  const monthsLeft = Math.ceil(yearsToBuildLeft * 12);
  const reading = `Building ${Math.round(builtFraction * 100)}%`;
  const detail = `${monthsLeft} ${monthsLeft === 1 ? "month" : "months"} left`;
  // The two halves as one phrase, for a row's accessible name
  return { reading, detail, label: `${reading} · ${detail}` };
}

/**
 * The full-width meter along the bottom edge of a row that is being built or upgraded. It
 * anchors to the row header (see `.facilityRowHeader`), not to the text beside it. The
 * percentage is already in the status text, so this only makes it glanceable and stays hidden
 * from assistive technology. While the clock is paused the sweep over the fill stops too.
 */
export default function ConstructionProgressBar(props: {
  builtFraction: number;
  paused: boolean;
}): React.JSX.Element {
  return (
    <span
      className="constructionProgress"
      data-paused={props.paused}
      aria-hidden
    >
      <span
        className="constructionProgressFill"
        style={{ width: `${props.builtFraction * 100}%` }}
      />
    </span>
  );
}

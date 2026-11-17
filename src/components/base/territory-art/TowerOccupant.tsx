import * as React from "react";

type Props = {
  className?: string;
  platform?: boolean;
};

// The lower box hides the wire terminal at (250, 350). Both variants share
// source (250, 365) as their ground anchor. Empty sites use a deliberately
// smaller, quieter structure than occupied cities and facilities.
export default function TowerOccupant({ className, platform = false }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 500 500"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="#CFD8DC"
      fillOpacity={0.4}
      stroke="#000"
      strokeOpacity={0.4}
      strokeWidth={12}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g transform="translate(100 146) scale(0.6)">
        <path d="M220 115H280L325 365H300L270 145H230L200 365H175Z" />
        <path d="M170 220H330" fill="none" />
        {platform && <path d="M175 345H325V365H175Z" />}
        <path d="M225 330H275V365H225Z" fillOpacity={1} />
      </g>
    </svg>
  );
}

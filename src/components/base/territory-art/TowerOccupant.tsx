import * as React from "react";

type Props = {
  className?: string;
  platform?: boolean;
};

// The lower box hides the wire terminal at (250, 350). Both variants share
// source (250, 365) as their ground anchor and retain the same painted bounds.
export default function TowerOccupant({ className, platform = false }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 500 500"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="#CFD8DC"
      stroke="#000"
      strokeWidth={20}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M220 115H280L325 365H300L270 145H230L200 365H175Z" />
      <path d="M190 200H310M170 270H330" fill="none" />
      <path d="M215 300L285 325" fill="none" strokeWidth={10} />
      {platform && <path d="M175 345H325V365H175Z" />}
      <path d="M225 330H275V365H225Z" />
    </svg>
  );
}

import React from "react";
import FrostGround from "./FrostGround";

type HillsTerrainProps = {
  className?: string;
  frostFill?: string;
};

export default function HillsTerrain({
  className,
  frostFill,
}: HillsTerrainProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 500 500"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M250 0 500 125V375L250 500 0 375V125Z"
        fill="var(--terrain-frost-field, #B8D9C3)"
      />
      <path
        d="M0 330C20 250 45 175 105 170 185 163 210 305 300 335 365 357 430 325 500 305V500H0Z"
        fill="var(--terrain-frost-field-shade, #A5CBB3)"
      />
      <path
        d="M0 390C110 430 200 390 275 300 330 234 365 175 420 195 465 211 495 280 500 330V500H0Z"
        fill="var(--terrain-frost-field, #B8D9C3)"
      />
      <path
        d="M0 430C55 370 110 335 165 350 230 367 265 420 335 425 400 430 450 390 500 365V500H0Z"
        fill="var(--terrain-frost-field-shade, #A5CBB3)"
      />
      <path
        d="M65 410C130 390 185 420 250 435 315 450 380 430 435 405L500 375V500H0V375Z"
        fill="var(--terrain-frost-bank, #C6B493)"
      />
      <FrostGround fill={frostFill} />
      <g
        fill="none"
        stroke="#000000"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d="M20 268C27 247 35 227 45 211M463 239C475 261 485 286 492 308"
          strokeWidth="6"
        />
        <path
          d="M82 406C105 402 127 403 150 409M350 439C373 434 395 425 417 414"
          strokeWidth="6"
        />
      </g>
    </svg>
  );
}

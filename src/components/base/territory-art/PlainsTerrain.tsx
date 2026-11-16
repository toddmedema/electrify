import React from "react";

type PlainsTerrainProps = {
  className?: string;
};

export default function PlainsTerrain({ className }: PlainsTerrainProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 500 500"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M250 0 500 125V375L250 500 0 375V125Z" fill="#B8D9C3" />
      <path
        d="M0 170C130 130 305 230 500 185V260C300 300 125 205 0 245Z"
        fill="#A5CBB3"
      />
      <path
        d="M0 365C170 325 300 420 500 365V430C305 480 160 385 0 430Z"
        fill="#A5CBB3"
      />
      <g
        fill="none"
        stroke="#000"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M65 286Q76 271 88 290Q89 274 103 268" />
        <path d="M397 325Q408 310 420 329Q425 311 438 307" />
        <path d="M186 430Q198 415 211 434Q215 418 228 413" />
      </g>
    </svg>
  );
}

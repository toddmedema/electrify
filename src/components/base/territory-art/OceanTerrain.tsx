import React from "react";

type OceanTerrainProps = {
  className?: string;
};

export default function OceanTerrain({ className }: OceanTerrainProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 500 500"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M250 0 500 125V375L250 500 0 375V125Z" fill="#4B929F" />
      <g fill="#7FC8CE">
        <path d="M34 203C63 166 105 156 143 174 106 168 70 180 43 211Z" />
        <path d="M357 288C388 256 430 245 466 258 431 257 393 271 365 297Z" />
        <path d="M166 426C210 441 275 444 332 419 285 452 215 456 166 438Z" />
      </g>
    </svg>
  );
}

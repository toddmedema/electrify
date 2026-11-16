import React from "react";

type LakeTerrainProps = {
  className?: string;
};

export default function LakeTerrain({ className }: LakeTerrainProps) {
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
        d="M132 111C190 76 285 92 345 122 403 136 444 182 440 248 437 309 405 346 360 390 318 431 256 456 202 432 157 412 138 382 100 362 64 343 52 298 64 254 78 208 77 144 132 111Z"
        fill="#7FC8CE"
        stroke="#000000"
        strokeWidth="20"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g fill="none" stroke="#4B929F" strokeWidth="10" strokeLinecap="round">
        <path d="M100 244Q90 272 102 296" />
        <path d="M245 412Q283 423 318 403" />
      </g>
    </svg>
  );
}

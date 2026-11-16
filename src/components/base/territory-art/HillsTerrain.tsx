import React from "react";

type HillsTerrainProps = {
  className?: string;
};

export default function HillsTerrain({ className }: HillsTerrainProps) {
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
        d="M0 300C26 246 48 152 105 145 164 138 178 260 260 286 338 311 394 280 500 300V375L250 500 0 375Z"
        fill="#A5CBB3"
      />
      <path
        d="M0 360C110 390 210 350 295 307 370 272 391 215 439 223 471 229 490 262 500 296V375L250 500 0 375Z"
        fill="#B8D9C3"
      />
      <path
        d="M65 408C105 385 135 376 173 385 240 408 274 432 339 432 384 432 412 420 435 408L250 500Z"
        fill="#A5CBB3"
      />
      <path
        d="M65 408C160 420 183 454 276 462 341 468 395 430 435 408L250 500Z"
        fill="#C6B493"
      />
      <g
        fill="none"
        stroke="#000000"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d="M14 271C40 207 60 150 105 145 126 142 142 156 155 177M359 269C390 242 411 218 439 223 460 227 476 244 487 266"
          strokeWidth="20"
        />
        <path
          d="M90 397C118 384 145 379 173 385 203 395 226 410 252 419"
          strokeWidth="10"
        />
      </g>
    </svg>
  );
}

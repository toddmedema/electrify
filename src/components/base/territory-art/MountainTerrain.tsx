import React from "react";

type MountainTerrainProps = {
  className?: string;
};

export default function MountainTerrain({ className }: MountainTerrainProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 500 500"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M250 0 500 125V375L250 500 0 375V125Z" fill="#A8B4B8" />
      <path
        d="M0 278 83 236 185 270 286 237 402 264 500 223V375L250 500 0 375Z"
        fill="#89979C"
        opacity="0.35"
      />
      <path
        d="M0 354 106 317 225 352 331 313 431 335 500 313V375L250 500 0 375Z"
        fill="#A8B4B8"
      />
      <g stroke="#000000" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M20 326 43 244 87 114 120 179 146 276 161 326 99 349Z"
          fill="#A8B4B8"
          stroke="none"
        />
        <path
          d="M87 114 120 179 146 276 161 326 109 301Z"
          fill="#89979C"
          stroke="none"
        />
        <path
          d="M68 171 87 114 114 167 98 157 88 175 79 162Z"
          fill="#FFF8E1"
          strokeWidth="10"
        />
        <path
          d="M20 326 43 244 87 114 120 179 146 276 161 326 99 349Z"
          fill="none"
          strokeWidth="20"
        />
        <path
          d="M361 325 384 254 417 190 452 249 480 325 423 350Z"
          fill="#A8B4B8"
          stroke="none"
        />
        <path
          d="M417 190 452 249 480 325 429 308Z"
          fill="#89979C"
          stroke="none"
        />
        <path
          d="M361 325 384 254 417 190 452 249 480 325 423 350Z"
          fill="none"
          strokeWidth="20"
        />
        <path
          d="M130 421 177 394 230 419 278 401 332 432 393 418 339 446 283 463 218 461 162 446Z"
          fill="#A8B4B8"
          stroke="none"
        />
        <path
          d="M230 419 278 401 283 463 218 461 162 446 130 421 177 440Z"
          fill="#89979C"
          stroke="none"
        />
        <path
          d="M130 421 177 394 230 419 278 401 332 432 393 418 339 446 283 463 218 461 162 446Z"
          fill="none"
          strokeWidth="20"
        />
        <path
          d="M50 284 74 261 101 277M376 304 398 284 421 296M177 394V440L218 461M278 401 283 463M332 432 339 446"
          fill="none"
          strokeWidth="10"
        />
      </g>
    </svg>
  );
}

import React from "react";

type ForestTerrainProps = {
  className?: string;
};

export default function ForestTerrain({ className }: ForestTerrainProps) {
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
        d="M0 168C94 126 147 141 220 179S382 217 500 169V375L250 500 0 375Z"
        fill="#587F69"
        opacity="0.2"
      />
      <path
        d="M0 342C85 302 135 334 216 370S383 404 500 333V375L250 500 0 375Z"
        fill="#587F69"
        opacity="0.2"
      />
      <g stroke="#000000" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M39 304C17 287 18 252 40 239 21 218 28 183 56 175 41 149 61 119 89 121 94 91 132 85 151 110 179 108 191 140 175 161 193 184 180 213 157 220 176 245 160 273 135 277 147 303 125 330 101 324 87 348 50 337 39 304Z"
          fill="#587F69"
          strokeWidth="20"
        />
        <path
          d="M358 210C345 181 365 159 390 164 400 139 436 139 449 166 477 167 488 199 471 219 491 240 483 272 462 281 481 304 464 333 440 335 442 362 414 380 391 365 366 379 339 357 345 333 319 323 318 289 340 274 322 252 332 220 358 210Z"
          fill="#587F69"
          strokeWidth="20"
        />
        <path
          d="M111 405C119 384 146 378 163 391 183 376 212 387 215 410 241 408 258 432 246 452L199 474 134 442C119 440 108 424 111 405Z"
          fill="#587F69"
          strokeWidth="20"
        />
        <path
          d="M45 232C66 224 85 230 95 248M92 166C115 155 139 167 140 187M68 289C83 275 107 279 117 291M360 270C382 258 405 267 409 284M404 209C423 199 444 208 450 222M388 326C405 315 427 321 435 336M153 418C169 407 192 413 198 428"
          fill="none"
          strokeWidth="10"
        />
      </g>
      <path
        d="M49 351C79 347 108 358 130 371M350 397C374 388 405 391 425 403"
        fill="none"
        stroke="#587F69"
        strokeWidth="10"
        strokeLinecap="round"
      />
    </svg>
  );
}

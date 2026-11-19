import type { TileDisaster } from "../../../helpers/TerritoryDisasters";
import React from "react";

/** Small static silhouettes read as well paused as they do at high game speed. */
export default function DisasterArtwork({ ground, hail }: TileDisaster) {
  return (
    <>
      {ground === "burning" && (
        <g data-disaster="fire" strokeLinejoin="round">
          <path
            d="M29 356l49-13 33 10 47-17 38 8 46 23-43 26-50-9-43 12-55-17Z"
            fill="#713b32"
            opacity=".79"
          />
          <path
            d="M51 362l45-6 29 9 38-13 41 19-39 10-32-6-43 8Z"
            fill="#f99d49"
          />
          <path
            d="M96 366c-20-26 3-47 3-73 19 8 21 24 21 33 20-27 26-46 20-71 41 24 54 63 29 102-19 29-52 37-73 9Z"
            fill="#e85b30"
            stroke="#73312e"
            strokeWidth="8"
          />
          <path
            d="M121 366c-7-15 4-27 11-31 2 13 11 11 15-8 17 18 13 36 0 42-7 3-17 4-26-3Z"
            fill="#ffda82"
          />
          <path
            d="M173 374c-6-14 3-27 13-36 0 11 13 10 13 25-2 16-20 19-26 11Z"
            fill="#fa8c44"
            stroke="#73312e"
            strokeWidth="5"
          />
          <path
            d="M54 359c-13-13 3-27 0-41 14 4 14 15 17 20l9-13c14 14 12 29 1 37-8 7-20 6-27-3Z"
            fill="#ff7841"
            stroke="#73312e"
            strokeWidth="6"
          />
          <path d="m63 353 11-12 5 11-7 7Z" fill="#ffda82" />
          <circle cx="168" cy="275" r="5" fill="#ffda82" />
          <circle cx="113" cy="292" r="4" fill="#ffda82" />
        </g>
      )}
      {hail === "impact" && (
        <g data-disaster="hail" stroke="#2c4d60" strokeWidth="7" fill="#f5fcff">
          <circle cx="325" cy="272" r="17" />
          <circle cx="382" cy="284" r="14" />
          <circle cx="353" cy="314" r="16" />
          <path
            d="M325 344q13-13 25-5m15-3 12-8"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      )}
      {hail === "damage" && (
        <g
          data-disaster="hail-repairs"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="m324 350 25-6 10-31 21 33 27-9m-48-24 21-11"
            stroke="#2f4657"
            strokeWidth="19"
          />
          <path
            d="m324 350 25-6 10-31 21 33 27-9m-48-24 21-11"
            stroke="#e0eef6"
            strokeWidth="9"
          />
        </g>
      )}
    </>
  );
}

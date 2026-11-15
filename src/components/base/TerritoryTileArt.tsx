import * as React from "react";

export type TerritoryTileArtKind =
  "town" | "industry" | "lake" | "plains" | "hills";

type Props = {
  kind: TerritoryTileArtKind;
  built?: boolean;
  className?: string;
};

const mint = "var(--territory-art-mint, #64ffda)";
const cream = "var(--territory-art-cream, #fff8e1)";
const steel = "var(--territory-art-steel, #cfd8dc)";
const grass = "var(--territory-art-grass, #b8d9c3)";
const water = "var(--territory-art-water, #7fc8ce)";

function feature(kind: TerritoryTileArtKind, built: boolean) {
  switch (kind) {
    case "town":
      return (
        <>
          <path d="M270 270H410V410H270Z" fill={cream} />
          <path d="M250 270L340 190L430 270Z" fill={steel} />
          <path d="M90 240H290V410H90Z" fill={cream} />
          <path d="M70 240L190 130L310 240Z" fill={mint} />
          <path d="M170 410V330H220V410" fill={steel} />
          <path d="M120 280H160M230 280H270M320 310H360" strokeWidth={10} />
        </>
      );
    case "industry":
      return (
        <>
          <path d="M330 270V130H390V270" fill={steel} />
          <path d="M80 410V270L180 200V270L280 200V270H420V410Z" fill={cream} />
          <path d="M80 270L180 200V270L280 200V270" fill={mint} />
          <path d="M300 410V340H370V410" fill={steel} />
          <path d="M120 320H250M185 320V360" strokeWidth={10} />
        </>
      );
    case "lake":
      return (
        <>
          <path
            d="M70 340C70 290 170 250 270 270S430 300 430 350S330 420 230 410S70 390 70 340Z"
            fill={water}
          />
          {built ? (
            <>
              <path d="M140 240H350L390 350H100Z" fill={steel} />
              <path d="M140 240L170 200H380L350 240Z" fill={cream} />
              <path
                d="M190 280L170 350M260 280V350M330 280L350 350"
                strokeWidth={10}
              />
            </>
          ) : (
            <path d="M140 330H260M260 370H360" strokeWidth={10} />
          )}
        </>
      );
    case "plains":
      return (
        <>
          <path d="M70 410L130 350H420L360 410Z" fill={grass} />
          <circle cx="350" cy="140" r="50" fill={cream} />
          <path
            d="M350 50V70M260 140H280M420 140H440M285 75L300 90M400 90L415 75"
            strokeWidth={10}
          />
          {built ? (
            <>
              <path d="M170 330V380M350 330V380" />
              <path d="M100 240H330L400 330H170Z" fill={mint} />
              <path
                d="M135 285H365M175 240L245 330M255 240L325 330"
                strokeWidth={10}
              />
            </>
          ) : (
            <path
              d="M150 360L190 390M250 360L290 390M350 360L380 385"
              strokeWidth={10}
            />
          )}
        </>
      );
    case "hills":
      return (
        <>
          <path
            d="M60 410Q110 240 200 320Q280 170 360 300Q410 350 440 410Z"
            fill={grass}
          />
          {built ? (
            <>
              <path
                d="M220 400L235 170H260L280 400Q250 420 220 400Z"
                fill={cream}
              />
              <path d="M225 175C180 140 170 80 195 40L265 155Z" fill={mint} />
              <path
                d="M225 175C180 140 170 80 195 40L265 155Z"
                transform="rotate(120 245 175)"
                fill={mint}
              />
              <path
                d="M225 175C180 140 170 80 195 40L265 155Z"
                transform="rotate(240 245 175)"
                fill={mint}
              />
              <ellipse cx="245" cy="175" rx="24" ry="30" fill={mint} />
            </>
          ) : (
            <>
              <path d="M150 350H235Q260 350 260 330Q260 310 240 310" />
              <path d="M210 390H340Q370 390 370 365" />
            </>
          )}
        </>
      );
  }
}

export default function TerritoryTileArt({
  kind,
  built = false,
  className,
}: Props) {
  return (
    <svg
      viewBox="0 0 500 500"
      aria-hidden="true"
      focusable="false"
      className={`territoryTileArt${className ? ` ${className}` : ""}`}
    >
      <g
        fill="none"
        stroke="#000"
        strokeWidth={20}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {feature(kind, built)}
      </g>
    </svg>
  );
}

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
          <path d="M110 240H390V410H110Z" fill={cream} />
          <path d="M80 240L250 100L420 240Z" fill={mint} />
          <path d="M225 410V325H275V410" fill={steel} />
          <path
            d="M155 280H195V320H155ZM305 280H345V320H305Z"
            fill={mint}
            strokeWidth={10}
          />
        </>
      );
    case "industry":
      return (
        <>
          <path d="M330 270V110H390V270" fill={steel} />
          <path d="M80 410V270L180 190V270L280 190V270H420V410Z" fill={cream} />
          <path d="M300 410V340H370V410" fill={steel} />
          <path d="M120 310H250V350H120Z" fill={mint} strokeWidth={10} />
          <path d="M185 310V350" strokeWidth={10} />
        </>
      );
    case "lake":
      return (
        <>
          <path
            d="M60 330C60 270 150 240 250 260S440 290 440 350S330 425 230 410S60 385 60 330Z"
            fill={water}
          />
          {built ? (
            <>
              <path d="M135 240H365L410 360H90Z" fill={steel} />
              <path d="M135 240L170 200H400L365 240Z" fill={cream} />
              <path d="M195 280L175 360M305 280L325 360" strokeWidth={10} />
            </>
          ) : (
            <path d="M130 320H250M260 365H370" strokeWidth={10} />
          )}
        </>
      );
    case "plains":
      return (
        <>
          <path d="M70 410L150 330H430L350 410Z" fill={grass} />
          <circle cx="350" cy="140" r="55" fill={cream} />
          <path
            d="M350 45V65M255 140H275M425 140H445M280 70L295 85M405 85L420 70"
            strokeWidth={10}
          />
          {built ? (
            <>
              <path d="M175 340V390M355 340V390" />
              <path d="M90 245H330L410 340H170Z" fill={mint} />
              <path
                d="M130 295H370M170 245L250 340M250 245L330 340"
                strokeWidth={10}
              />
            </>
          ) : (
            <path
              d="M145 365L180 400M245 365L280 400M345 365L365 385"
              strokeWidth={10}
            />
          )}
        </>
      );
    case "hills":
      return (
        <>
          <path
            d="M60 410Q110 280 200 335Q280 240 360 325Q410 350 440 410Z"
            fill={grass}
          />
          {built ? (
            <>
              <path d="M225 410L240 190H260L275 410Z" fill={cream} />
              <path d="M235 180Q200 130 235 55L255 45L265 180Z" fill={mint} />
              <path
                d="M235 180Q200 130 235 55L255 45L265 180Z"
                transform="rotate(120 250 190)"
                fill={mint}
              />
              <path
                d="M235 180Q200 130 235 55L255 45L265 180Z"
                transform="rotate(240 250 190)"
                fill={mint}
              />
              <circle cx="250" cy="190" r="25" fill={mint} />
            </>
          ) : (
            <path
              d="M100 225H320Q355 225 355 190Q355 155 320 155H305V125H320Q385 125 385 190Q385 255 320 255H100Z"
              fill={cream}
            />
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

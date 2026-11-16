import * as React from "react";

export type GeneratorOccupantVariant =
  | "wind"
  | "offshore-wind"
  | "airborne-wind"
  | "solar"
  | "nuclear"
  | "thermal"
  | "hydro"
  | "geothermal"
  | "biomass";

type Props = {
  variant: GeneratorOccupantVariant;
  className?: string;
};

function WindStructure({ offshore }: { offshore: boolean }) {
  return (
    <>
      <path d="M235 365L245 205H255L265 365Z" fill="#FFF8E1" />
      {offshore ? (
        <>
          <path
            d="M215 345L235 300M285 345L265 300"
            fill="none"
            strokeWidth={10}
          />
          <path d="M195 345H305L325 365H175Z" fill="#CFD8DC" />
        </>
      ) : (
        <path d="M225 335H275V365H225Z" fill="#CFD8DC" />
      )}
      <path
        d="M240 205C225 180 235 135 250 115C263 145 268 176 260 200Z"
        fill="#64DFC5"
      />
      <path
        d="M260 200C295 190 335 225 365 250C327 249 289 235 252 220Z"
        fill="#64DFC5"
      />
      <path
        d="M245 215C230 249 181 260 135 250C162 225 205 200 240 198Z"
        fill="#64DFC5"
      />
      <circle cx="250" cy="205" r="20" fill="#FFF8E1" />
    </>
  );
}

function structure(variant: GeneratorOccupantVariant): React.ReactNode {
  switch (variant) {
    case "wind":
    case "offshore-wind":
      return <WindStructure offshore={variant === "offshore-wind"} />;
    case "airborne-wind":
      return (
        <>
          <path d="M250 210Q220 270 250 325" fill="none" strokeWidth={10} />
          <path
            d="M135 180L225 115L250 145L275 115L365 180L295 235L250 210L205 235Z"
            fill="#64DFC5"
          />
          <path
            d="M135 180L250 145L365 180M250 145V210"
            fill="none"
            strokeWidth={10}
          />
          <path d="M205 335L225 310H275L295 335V365H205Z" fill="#CFD8DC" />
          <circle cx="250" cy="338" r="18" fill="#FFF8E1" strokeWidth={10} />
        </>
      );
    case "solar":
      return (
        <>
          <path d="M195 295V365M315 295V365" fill="none" />
          <path d="M215 335H285V365H215Z" fill="#CFD8DC" />
          <path d="M135 190H315L365 305H185Z" fill="#64DFC5" />
          <path d="M160 247H340M225 190L275 305" fill="none" strokeWidth={10} />
        </>
      );
    case "nuclear":
      return (
        <>
          <path d="M265 365V285C265 225 365 225 365 285V365Z" fill="#CFD8DC" />
          <path
            d="M160 165H270C240 235 245 295 295 365H135C185 295 190 235 160 165Z"
            fill="#FFF8E1"
          />
          <ellipse cx="215" cy="165" rx="55" ry="15" fill="#CFD8DC" />
          <path d="M320 290V335" fill="none" strokeWidth={10} />
        </>
      );
    case "thermal":
      return (
        <>
          <path d="M295 255V125H340V255Z" fill="#CFD8DC" />
          <path d="M295 165H340" fill="none" strokeWidth={10} />
          <path
            d="M135 365V275Q135 235 175 235H325Q365 235 365 275V365Z"
            fill="#FFF8E1"
          />
          <path d="M140 280H360" fill="none" strokeWidth={10} />
          <path d="M170 310H330V340H170Z" fill="#64DFC5" strokeWidth={10} />
        </>
      );
    case "hydro":
      return (
        <>
          <path d="M145 180H355L365 365H135Z" fill="#FFF8E1" />
          <path d="M135 180L165 150H335L365 180Z" fill="#CFD8DC" />
          <path d="M180 220H225L210 365H155Z" fill="#7FC8CE" />
          <path d="M275 220H320L345 365H290Z" fill="#7FC8CE" />
        </>
      );
    case "geothermal":
      return (
        <>
          <path
            d="M165 180C135 160 195 145 175 115M315 175C285 155 345 140 325 115"
            fill="none"
            strokeWidth={10}
          />
          <path
            d="M135 365V245Q135 210 170 210H215V240H170V365Z"
            fill="#CFD8DC"
          />
          <path d="M280 285V205H320V285Z" fill="#CFD8DC" />
          <path d="M210 265H335L365 295V365H210Z" fill="#FFF8E1" />
          <circle cx="285" cy="315" r="30" fill="#64DFC5" strokeWidth={10} />
          <path d="M270 315H300" fill="none" strokeWidth={10} />
        </>
      );
    case "biomass":
      return (
        <>
          <path
            d="M310 185C260 185 245 150 265 115C310 120 335 150 310 185Z"
            fill="#7CB342"
          />
          <path d="M275 140L310 185" fill="none" strokeWidth={10} />
          <path d="M300 290V195H340V290Z" fill="#CFD8DC" />
          <path d="M195 365V275L225 245H335L365 275V365Z" fill="#FFF8E1" />
          <path d="M135 230H200V365H135Z" fill="#FFF8E1" />
          <path d="M135 230L150 195H185L200 230Z" fill="#CFD8DC" />
          <path d="M135 285H200M135 330H200" fill="none" strokeWidth={10} />
          <path d="M235 295H330V325H235Z" fill="#64DFC5" strokeWidth={10} />
        </>
      );
  }
}

// Every structure covers (250, 350), hiding its incoming network terminal.
// Root places source (250, 365) at the tile's uniformly scaled ground anchor.
export default function GeneratorOccupant({ variant, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 500 500"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="#FFF8E1"
      stroke="#000"
      strokeWidth={20}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {structure(variant)}
    </svg>
  );
}

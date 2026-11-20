import * as React from "react";
import { useFacilityAnimation } from "../useFacilityMapMotion";

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
  active?: boolean;
  hailDamaged?: boolean;
};

function WindStructure({ offshore }: { offshore: boolean }) {
  return (
    <>
      <path d="M235 365L245 225H255L265 365Z" fill="#FFF8E1" />
      {offshore ? (
        <>
          <path
            d="M215 345L235 300M285 345L265 300"
            fill="none"
            strokeWidth={6}
          />
          <path d="M195 345H305L325 365H175Z" fill="#CFD8DC" />
        </>
      ) : (
        <path d="M225 335H275V365H225Z" fill="#CFD8DC" />
      )}
      <g className="mapWindRotor" fill="#64DFC5">
        {[0, 120, 240].map((angle) => (
          <path
            key={angle}
            transform={`rotate(${angle} 250 225)`}
            d="M242 225C228 200 239 145 250 115C263 155 267 198 258 223Z"
          />
        ))}
      </g>
      <circle cx="250" cy="225" r="20" fill="#FFF8E1" />
    </>
  );
}

function SolarOccupant({ damaged }: { damaged: boolean }) {
  return (
    <>
      <path d="M225 325H275V365H225Z" fill="#CFD8DC" />
      {[0, 65, 130].map((offset) => (
        <g key={offset} transform={`translate(0 ${offset})`}>
          <path d="M155 200V235M315 200V235" fill="none" strokeWidth={6} />
          <path d="M135 200H335L365 160H165Z" fill="#3F78A8" stroke="none" />
          <path
            d="M185 200L215 160M235 200L265 160M285 200L315 160M150 180H350"
            fill="none"
            stroke="#CFD8DC"
            strokeWidth={6}
          />
          {damaged && offset > 0 && (
            <g
              data-solar-damage=""
              transform={offset === 65 ? "translate(-37 0)" : "translate(49 0)"}
              stroke="none"
            >
              <path
                d="M226 162H291L281 174L290 180L270 197H205L216 185L212 177Z"
                fill="#182b3a"
              />
              <path d="M228 163H273L247 177L226 174L212 180Z" fill="#76aaca" />
              <path
                d="M282 179L267 196H220L237 187L246 190L255 179Z"
                fill="#557d9e"
              />
              <path d="M234 186L245 179L251 181L243 188Z" fill="#d4ecfa" />
            </g>
          )}
          <path d="M135 200H335L365 160H165Z" fill="none" />
        </g>
      ))}
    </>
  );
}

function structure(
  variant: GeneratorOccupantVariant,
  hailDamaged: boolean,
): React.ReactNode {
  switch (variant) {
    case "wind":
    case "offshore-wind":
      return <WindStructure offshore={variant === "offshore-wind"} />;
    case "airborne-wind":
      return (
        <>
          <path d="M250 210Q220 270 250 325" fill="none" strokeWidth={6} />
          <g className="mapAirborneWing">
            <path
              d="M135 180L225 115L250 145L275 115L365 180L295 235L250 210L205 235Z"
              fill="#64DFC5"
            />
            <path
              d="M135 180L250 145L365 180M250 145V210"
              fill="none"
              strokeWidth={6}
            />
          </g>
          <path d="M205 335L225 310H275L295 335V365H205Z" fill="#CFD8DC" />
          <circle cx="250" cy="338" r="18" fill="#FFF8E1" strokeWidth={6} />
        </>
      );
    case "solar":
      return <SolarOccupant damaged={hailDamaged} />;
    case "nuclear":
      return (
        <>
          <path d="M265 365V285C265 225 365 225 365 285V365Z" fill="#CFD8DC" />
          <path
            d="M160 165H270C240 235 245 295 295 365H135C185 295 190 235 160 165Z"
            fill="#FFF8E1"
          />
          <ellipse cx="215" cy="165" rx="55" ry="15" fill="#CFD8DC" />
          <path d="M320 290V335" fill="none" strokeWidth={6} />
        </>
      );
    case "thermal":
      return (
        <>
          <path d="M295 255V125H340V255Z" fill="#CFD8DC" />
          <path d="M295 165H340" fill="none" strokeWidth={6} />
          <path
            d="M135 365V275Q135 235 175 235H325Q365 235 365 275V365Z"
            fill="#FFF8E1"
          />
          <path d="M140 280H360" fill="none" strokeWidth={6} />
          <path d="M170 310H330V340H170Z" fill="#64DFC5" strokeWidth={6} />
        </>
      );
    case "hydro":
      return (
        <>
          <path d="M150 205Q250 115 350 205L330 245H170Z" fill="#7FC8CE" />
          <path d="M150 220Q250 190 350 220L365 365H135Z" fill="#FFF8E1" />
          <path
            d="M150 205Q250 175 350 205V225Q250 195 150 225Z"
            fill="#CFD8DC"
          />
          <path d="M135 205H170V365H135ZM330 205H365V365H330Z" fill="#CFD8DC" />
          <path d="M215 230H285L295 365H205Z" fill="#7FC8CE" strokeWidth={6} />
          <path d="M135 305L155 285H205V365H135Z" fill="#FFF8E1" />
          <path d="M151 322H191V350H151Z" fill="#64DFC5" strokeWidth={6} />
        </>
      );
    case "geothermal":
      return (
        <>
          <g className="mapGeothermalVapor">
            <path
              d="M165 180C135 160 195 145 175 115M315 175C285 155 345 140 325 115"
              fill="none"
              strokeWidth={6}
            />
          </g>
          <path
            d="M135 365V245Q135 210 170 210H215V240H170V365Z"
            fill="#CFD8DC"
          />
          <path d="M280 285V205H320V285Z" fill="#CFD8DC" />
          <path d="M210 265H335L365 295V365H210Z" fill="#FFF8E1" />
          <circle cx="285" cy="315" r="30" fill="#64DFC5" strokeWidth={6} />
          <path d="M270 315H300" fill="none" strokeWidth={6} />
        </>
      );
    case "biomass":
      return (
        <>
          <path
            d="M310 185C260 185 245 150 265 115C310 120 335 150 310 185Z"
            fill="#7CB342"
          />
          <path d="M275 140L310 185" fill="none" strokeWidth={6} />
          <path d="M300 290V195H340V290Z" fill="#CFD8DC" />
          <path d="M195 365V275L225 245H335L365 275V365Z" fill="#FFF8E1" />
          <path d="M135 230H200V365H135Z" fill="#FFF8E1" />
          <path d="M135 230L150 195H185L200 230Z" fill="#CFD8DC" />
          <path d="M135 285H200M135 330H200" fill="none" strokeWidth={6} />
          <path d="M235 295H330V325H235Z" fill="#64DFC5" strokeWidth={6} />
        </>
      );
  }
}

function Exhaust({ x, y }: { x: number; y: number }) {
  return (
    <g
      transform={`translate(${x} ${y})`}
      fill="#FFF8E1"
      stroke="#70838A"
      strokeWidth={6}
    >
      {[0, 1].map((phase) => (
        <path
          key={phase}
          className={`mapFacilityExhaust mapFacilityExhaust-${phase}`}
          d="M-20 0C-30-16-7-29 3-19C19-29 36-10 24 5C13 18-12 17-20 0Z"
        />
      ))}
    </g>
  );
}

function WorkingEffects({ variant }: { variant: GeneratorOccupantVariant }) {
  switch (variant) {
    case "thermal":
      return <Exhaust x={318} y={125} />;
    case "biomass":
      return <Exhaust x={320} y={195} />;
    case "nuclear":
      return <Exhaust x={215} y={155} />;
    case "geothermal":
      return <Exhaust x={300} y={205} />;
    case "solar":
      return (
        <g
          className="mapSolarFlow"
          fill="none"
          stroke="#FFF8E1"
          strokeWidth={6}
          strokeDasharray="16 84"
        >
          {[0, 65, 130].map((offset) => (
            <path key={offset} d={`M155 ${190 + offset}H335`} />
          ))}
        </g>
      );
    case "hydro":
      return (
        <g
          className="mapHydroFlow"
          fill="none"
          stroke="#FFF8E1"
          strokeWidth={6}
          strokeDasharray="18 30"
        >
          <path d="M239 248L233 343M266 248L273 343" />
        </g>
      );
    default:
      return null;
  }
}

// The ground anchor stays (250,365); elevated facade cable entries remain static.
export default function GeneratorOccupant({
  variant,
  className,
  active = false,
  hailDamaged = false,
}: Props) {
  const { ref, moving } = useFacilityAnimation(active, variant);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 500 500"
      ref={ref}
      className={`${className ?? ""} mapFacilityArtwork`.trim()}
      data-facility-motion={moving ? "active" : undefined}
      aria-hidden="true"
      focusable="false"
      fill="#FFF8E1"
      stroke="#000"
      strokeWidth={12}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {structure(variant, hailDamaged)}
      <g className="mapFacilityEffect">
        {!hailDamaged && <WorkingEffects variant={variant} />}
      </g>
    </svg>
  );
}

import React from "react";

export type StorageOccupantVariant = "battery" | "iron-air" | "pumped-hydro";

type StorageOccupantProps = {
  className?: string;
  variant: StorageOccupantVariant;
};

export default function StorageOccupant({
  className,
  variant,
}: StorageOccupantProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 500 500"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="#000" strokeLinejoin="round" strokeLinecap="round">
        {variant === "battery" && (
          <>
            <path
              d="M155 165V135H210V165M290 165V135H345V165"
              fill="#CFD8DC"
              strokeWidth="20"
            />
            <path
              d="M135 165H230V365H135ZM270 165H365V365H270Z"
              fill="#FFF8E1"
              strokeWidth="20"
            />
            <path
              d="M160 220H205V270H160ZM295 220H340V270H295Z"
              fill="#64DFC5"
              strokeWidth="10"
            />
            <path d="M160 305H205M295 305H340" fill="none" strokeWidth="10" />
            <path d="M135 340H365V365H135Z" fill="#CFD8DC" strokeWidth="20" />
          </>
        )}
        {variant === "iron-air" && (
          <>
            <path d="M135 155H365V365H135Z" fill="#FFF8E1" strokeWidth="20" />
            <path d="M135 115H365V165H135Z" fill="#CFD8DC" strokeWidth="20" />
            <path d="M160 200H340V270H160Z" fill="#CFD8DC" strokeWidth="10" />
            <path
              d="M205 200V270M250 200V270M295 200V270"
              fill="none"
              strokeWidth="10"
            />
            <path
              d="M160 300H225V340H160ZM275 300H340V340H275Z"
              fill="#64DFC5"
              strokeWidth="10"
            />
            <path d="M135 340H365V365H135Z" fill="#CFD8DC" strokeWidth="20" />
          </>
        )}
        {variant === "pumped-hydro" && (
          <>
            <path d="M235 210V275H190V330H255" fill="none" strokeWidth="20" />
            <path
              d="M235 210V275H190V330H255"
              fill="none"
              stroke="#CFD8DC"
              strokeWidth="10"
            />
            <path d="M135 115H270V230H135Z" fill="#FFF8E1" strokeWidth="20" />
            <path d="M155 135H250V185H155Z" fill="#7FC8CE" strokeWidth="10" />
            <path d="M230 250H365V365H230Z" fill="#FFF8E1" strokeWidth="20" />
            <path d="M250 270H345V320H250Z" fill="#7FC8CE" strokeWidth="10" />
            <path d="M135 275H225V365H135Z" fill="#CFD8DC" strokeWidth="20" />
            <circle cx="180" cy="320" r="20" fill="#64DFC5" strokeWidth="10" />
          </>
        )}
      </g>
    </svg>
  );
}

import React from "react";
import { useFacilityAnimation } from "../useFacilityMapMotion";

export type StorageOccupantVariant = "battery" | "iron-air" | "pumped-hydro";

type StorageOccupantProps = {
  className?: string;
  variant: StorageOccupantVariant;
  active?: boolean;
};

export default function StorageOccupant({
  className,
  variant,
  active = false,
}: StorageOccupantProps) {
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
    >
      <g stroke="#000" strokeLinejoin="round" strokeLinecap="round">
        {variant === "battery" && (
          <>
            <path
              d="M155 165V135H210V165M290 165V135H345V165"
              fill="#CFD8DC"
              strokeWidth="12"
            />
            <path
              d="M135 165H230V365H135ZM270 165H365V365H270Z"
              fill="#FFF8E1"
              strokeWidth="12"
            />
            <path
              d="M160 220H205V270H160ZM295 220H340V270H295Z"
              fill="#64DFC5"
              strokeWidth="6"
            />
            <path d="M160 305H205M295 305H340" fill="none" strokeWidth="6" />
            <path d="M135 340H365V365H135Z" fill="#CFD8DC" strokeWidth="12" />
          </>
        )}
        {variant === "iron-air" && (
          <>
            <path d="M135 155H365V365H135Z" fill="#FFF8E1" strokeWidth="12" />
            <path d="M135 115H365V165H135Z" fill="#CFD8DC" strokeWidth="12" />
            <path d="M160 200H340V270H160Z" fill="#CFD8DC" strokeWidth="6" />
            <path
              d="M205 200V270M250 200V270M295 200V270"
              fill="none"
              strokeWidth="6"
            />
            <path
              d="M160 300H225V340H160ZM275 300H340V340H275Z"
              fill="#64DFC5"
              strokeWidth="6"
            />
            <path d="M135 340H365V365H135Z" fill="#CFD8DC" strokeWidth="12" />
          </>
        )}
        {variant === "pumped-hydro" && (
          <>
            <path
              d="M265 170H310V245H185V320M210 335H250"
              fill="none"
              strokeWidth="12"
            />
            <path
              d="M265 170H310V245H185V320M210 335H250"
              fill="none"
              stroke="#CFD8DC"
              strokeWidth="6"
            />
            <path d="M135 155H240V210H135Z" fill="#FFF8E1" strokeWidth="12" />
            <path
              d="M240 155L265 115V170L240 210Z"
              fill="#CFD8DC"
              strokeWidth="12"
            />
            <path
              d="M135 155L160 115H265L240 155Z"
              fill="#7FC8CE"
              strokeWidth="12"
            />
            <path d="M240 310H340V365H240Z" fill="#FFF8E1" strokeWidth="12" />
            <path
              d="M340 310L365 270V325L340 365Z"
              fill="#CFD8DC"
              strokeWidth="12"
            />
            <path
              d="M240 310L265 270H365L340 310Z"
              fill="#7FC8CE"
              strokeWidth="12"
            />
            <path d="M135 285H215V365H135Z" fill="#CFD8DC" strokeWidth="12" />
            <circle cx="175" cy="325" r="20" fill="#64DFC5" strokeWidth="6" />
          </>
        )}
      </g>
      <g
        className="mapFacilityEffect"
        fill="none"
        stroke="#FFF8E1"
        strokeWidth={6}
      >
        <path
          className="mapStorageFlow"
          strokeDasharray="18 28"
          d={
            variant === "pumped-hydro"
              ? "M287 178V245H185V285"
              : variant === "iron-air"
                ? "M172 320H213M287 320H328"
                : "M182 260V230M317 260V230"
          }
        />
      </g>
    </svg>
  );
}

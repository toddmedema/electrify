import * as React from "react";
import { TOWER_ART_TRANSFORM, TOWER_CROSSARM } from "../TerritoryHexGeometry";

type Props = {
  className?: string;
};

// Land towers keep a small footprint; the network helper shares their true crossarm anchors.
export default function TowerOccupant({ className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 500 500"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="#CFD8DC"
      fillOpacity={0.4}
      stroke="#000"
      strokeOpacity={0.4}
      strokeWidth={12}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g
        transform={`translate(${TOWER_ART_TRANSFORM.x} ${TOWER_ART_TRANSFORM.y}) scale(${TOWER_ART_TRANSFORM.scale})`}
      >
        <path d="M220 115H280L325 365H300L270 145H230L200 365H175Z" />
        <path
          d={`M${TOWER_CROSSARM.left} ${TOWER_CROSSARM.y}H${TOWER_CROSSARM.right}`}
          fill="none"
        />
        <path
          d="M214 265L295 330M286 265L205 330"
          fill="none"
          strokeWidth={6}
        />
        {[TOWER_CROSSARM.left, TOWER_CROSSARM.right].map((x) => (
          <circle
            key={x}
            cx={x}
            cy={TOWER_CROSSARM.y}
            r={6}
            fill="#FFF8E1"
            fillOpacity={0.8}
            strokeWidth={6}
          />
        ))}
      </g>
    </svg>
  );
}

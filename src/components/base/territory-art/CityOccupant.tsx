import * as React from "react";
import type { CitySizeType } from "../../../Types";

type Props = {
  size: CitySizeType;
  className?: string;
};

function Block({
  x,
  top,
  width,
  floors,
  roof = "#71858A",
}: {
  x: number;
  top: number;
  width: number;
  floors: number;
  roof?: string;
}) {
  return (
    <g>
      <path
        d={`M${x + width} ${top}L${x + width + 16} ${top - 12}V328L${x + width} 340Z`}
        fill="#CFD8DC"
      />
      <rect x={x} y={top} width={width} height={340 - top} />
      <path
        d={`M${x} ${top}L${x + 16} ${top - 12}H${x + width + 16}L${x + width} ${top}Z`}
        fill={roof}
      />
      {Array.from({ length: floors }, (_, floor) => (
        <path
          key={floor}
          d={`M${x + 16} ${top + 24 + floor * 42}H${x + width - 16}`}
          fill="none"
          stroke="#64DFC5"
          strokeWidth={10}
          strokeLinecap="butt"
        />
      ))}
    </g>
  );
}

function Townhouse({ x, roof = "#587F69" }: { x: number; roof?: string }) {
  return (
    <g>
      <path d={`M${x} 282H${x + 60}V340H${x}Z`} />
      <path d={`M${x - 6} 282L${x + 30} 246L${x + 66} 282Z`} fill={roof} />
      <path
        d={`M${x + 12} 306H${x + 24}M${x + 38} 306H${x + 50}`}
        stroke="#64DFC5"
        strokeWidth={10}
      />
      <path
        d={`M${x + 26} 340V318H${x + 38}V340`}
        fill="#796B56"
        strokeWidth={10}
      />
    </g>
  );
}

// Every size shares the ground anchor (250, 365) and covers the wire terminal (250, 350).
export default function CityOccupant({ size = "medium", className }: Props) {
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
      <path d="M85 328H390L420 365H115Z" fill="#CFD8DC" />
      <path d="M103 343H402L413 356H114Z" fill="#71858A" stroke="none" />
      <path
        d="M133 350H163M207 350H237M281 350H311M355 350H385"
        stroke="#FFF8E1"
        strokeWidth={10}
      />
      <path
        d="M319 306L354 287L400 315L365 335Z"
        fill="#B8D9C3"
        strokeWidth={10}
      />
      <path d="M367 302V258" fill="none" stroke="#796B56" strokeWidth={10} />
      <path
        d="M344 273L350 242L373 231L392 251L390 275L365 286Z"
        fill="#739A77"
        strokeWidth={10}
      />
      {size === "small" ? (
        <>
          <Townhouse x={115} />
          <Townhouse x={190} roof="#796B56" />
          <Block x={265} top={208} width={64} floors={3} />
        </>
      ) : size === "medium" ? (
        <>
          <Block x={125} top={180} width={64} floors={3} roof="#587F69" />
          <Block x={218} top={140} width={72} floors={4} />
          <Townhouse x={108} roof="#796B56" />
          <Block x={280} top={236} width={58} floors={2} />
        </>
      ) : (
        <>
          <Block x={123} top={125} width={68} floors={5} roof="#587F69" />
          <Block x={219} top={72} width={76} floors={6} />
          <Block x={293} top={188} width={58} floors={3} roof="#587F69" />
          <Townhouse x={100} roof="#796B56" />
          <Block x={185} top={236} width={64} floors={2} />
        </>
      )}
    </svg>
  );
}

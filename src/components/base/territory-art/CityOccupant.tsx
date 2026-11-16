import * as React from "react";

export type CityOccupantVariant = "residential" | "industrial";

type Props = {
  variant: CityOccupantVariant;
  className?: string;
};

// Both connected facades cover the shared wire terminal at (250, 350)
// and finish at the common ground anchor (250, 365).
export default function CityOccupant({ variant, className }: Props) {
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
      {variant === "residential" ? (
        <>
          <path d="M135 245L175 205L215 245V115H295V245H365V365H135Z" />
          <path d="M135 245L175 205L215 245Z" fill="#64DFC5" />
          <path d="M215 245V365M295 245V365" fill="none" strokeWidth={10} />
          <path d="M235 155H275V260H235Z" fill="#64DFC5" strokeWidth={10} />
          <path d="M235 205H275" fill="none" strokeWidth={10} />
          <path d="M155 280H195V320H155Z" fill="#64DFC5" strokeWidth={10} />
          <path d="M315 305H345V365H315Z" fill="#CFD8DC" strokeWidth={10} />
        </>
      ) : (
        <>
          <path d="M150 260V115H200V260Z" fill="#CFD8DC" />
          <path d="M150 160H200" fill="none" strokeWidth={10} />
          <path d="M135 260L195 215V260L255 215V260L315 215V260H365V365H135Z" />
          <path d="M160 295H340V335H160Z" fill="#64DFC5" strokeWidth={10} />
          <path d="M220 295V335M280 295V335" fill="none" strokeWidth={10} />
        </>
      )}
    </svg>
  );
}

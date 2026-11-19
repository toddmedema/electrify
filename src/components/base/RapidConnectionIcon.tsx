import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";

/** A quiet transmission tower with a detached add action, sized for map controls. */
export default function RapidConnectionIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path strokeWidth="2" d="M5 20.5 8 4.5h3l3 16M4.5 8.5h10M2.5 12.5h14" />
        <path strokeWidth="1.2" d="M6.5 12.5l6.75 4M12.5 12.5l-6.75 4" />
        <path strokeWidth="2" d="M15.5 5.5h7M19 2v7" />
      </g>
    </SvgIcon>
  );
}

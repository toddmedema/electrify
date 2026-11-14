import * as React from "react";
import { Typography } from "@mui/material";
import Sparkline, { Props as SparklineProps } from "./Sparkline";

interface Props extends Omit<SparklineProps, "markerIndex"> {
  label: string;
  defaultIndex: number;
  caption: (index: number) => React.ReactNode;
  defaultCaption?: React.ReactNode;
  className?: string;
  chartClassName?: string;
  captionClassName?: string;
  captionFirst?: boolean;
  chartFooter?: React.ReactNode;
}

/** Shared point inspection for monthly trends, measured against the actual SVG width. */
export default function InteractiveSparkline({
  label,
  defaultIndex,
  caption,
  defaultCaption,
  className = "",
  chartClassName = "",
  captionClassName = "",
  captionFirst,
  chartFooter,
  ...sparkline
}: Props): React.JSX.Element | null {
  const [inspectedIndex, setInspectedIndex] = React.useState<number | null>(
    null,
  );
  const chartRef = React.useRef<HTMLDivElement>(null);
  const captionId = React.useId();
  const lastIndex = sparkline.values.length - 1;
  const clamp = (index: number) => Math.max(0, Math.min(lastIndex, index));
  const index = clamp(inspectedIndex ?? defaultIndex);
  const inspecting = inspectedIndex !== null;
  const reset = () => setInspectedIndex(null);
  const inspectPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = chartRef.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    setInspectedIndex(
      clamp(
        Math.round(((event.clientX - bounds.left) / bounds.width) * lastIndex),
      ),
    );
  };
  if (lastIndex < 1) return null;

  const readout = (
    <Typography
      id={captionId}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      variant="caption"
      color="textSecondary"
      component="div"
      className={`interactiveSparklineCaption ${captionClassName}`}
    >
      {inspecting ? caption(index) : (defaultCaption ?? caption(index))}
    </Typography>
  );
  return (
    <div
      className={`interactiveSparkline ${className}`}
      role="group"
      tabIndex={0}
      aria-label={label}
      aria-describedby={captionId}
      aria-keyshortcuts="ArrowLeft ArrowRight Home End"
      onPointerMove={inspectPointer}
      onPointerDown={inspectPointer}
      onPointerLeave={(event) => {
        // Touch leaves when the finger lifts; keep the tapped month readable.
        if (event.pointerType !== "touch") reset();
      }}
      onPointerCancel={reset}
      onBlur={reset}
      onKeyDown={(event) => {
        let nextIndex: number;
        switch (event.key) {
          case "ArrowLeft":
            nextIndex = index - 1;
            break;
          case "ArrowRight":
            nextIndex = index + 1;
            break;
          case "Home":
            nextIndex = 0;
            break;
          case "End":
            nextIndex = lastIndex;
            break;
          default:
            return;
        }
        event.preventDefault();
        setInspectedIndex(clamp(nextIndex));
      }}
    >
      {captionFirst && readout}
      <div className={chartClassName}>
        <div className="interactiveSparklineChart" ref={chartRef}>
          <Sparkline {...sparkline} lowMarker markerIndex={index} />
        </div>
        {chartFooter}
      </div>
      {!captionFirst && readout}
    </div>
  );
}

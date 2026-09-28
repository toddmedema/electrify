import * as React from "react";
import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import PauseIcon from "@mui/icons-material/Pause";
import { TICK_MS } from "../../Constants";
import { SpeedType } from "../../Types";

export interface SpeedOptionsProps {
  speed: SpeedType;
  onSpeedChange: (speed: SpeedType) => void;
  desktop: boolean;
}

/**
 * The speeds, in the order the clock runs them, labelled with how many times faster than SLOW
 * each one is. Derived from the tick rate rather than written down beside it, so the labels
 * cannot drift from what the clock actually does -- and a player picking a speed can see what
 * they are picking rather than inferring it from the number of chevrons on an icon.
 */
const RUNNING_SPEEDS: SpeedType[] = ["SLOW", "NORMAL", "FAST"];
// Only where there's room for a fifth control and, typically, a display fast enough to show it:
// at 24x a phone spends most of each frame simulating rather than drawing.
const DESKTOP_SPEEDS: SpeedType[] = [...RUNNING_SPEEDS, "ULTRA"];

function speedMultiplier(speed: SpeedType): string {
  return Math.round(TICK_MS.SLOW / TICK_MS[speed]) + "×";
}

const SPEED_ARIA_LABELS: { [k in SpeedType]: string } = {
  PAUSED: "pause",
  SLOW: "slow speed",
  NORMAL: "normal speed",
  FAST: "fast speed",
  ULTRA: "ultra speed",
};

// Pulled out of the component so it can be memoised on the handful of things it actually
// depends on, rather than rebuilt on every tick along with the cash readout beside it
export function buildSpeedOptions({
  speed,
  onSpeedChange,
  desktop,
}: SpeedOptionsProps): React.JSX.Element {
  // Keep every speed one tap away at every viewport width. The selected treatment says where
  // the clock is now without turning the current speed into a misleading disabled control.
  return (
    <ToggleButtonGroup
      className="speedToggles"
      exclusive
      size="small"
      value={speed}
      onChange={(_e: React.MouseEvent<HTMLElement>, next: SpeedType | null) => {
        // Null is the group reporting that the button already selected was clicked again.
        // The clock is always running at some speed, so there is nothing to deselect to.
        if (next) {
          onSpeedChange(next);
        }
      }}
      aria-label="game speed"
    >
      <ToggleButton value="PAUSED" aria-label={SPEED_ARIA_LABELS.PAUSED}>
        <PauseIcon fontSize="small" />
      </ToggleButton>
      {(desktop ? DESKTOP_SPEEDS : RUNNING_SPEEDS).map((s: SpeedType) => (
        <ToggleButton key={s} value={s} aria-label={SPEED_ARIA_LABELS[s]}>
          {speedMultiplier(s)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

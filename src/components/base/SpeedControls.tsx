import * as React from "react";
import { Box, ToggleButton, ToggleButtonGroup } from "@mui/material";
import PauseIcon from "@mui/icons-material/Pause";
import PersonIcon from "@mui/icons-material/Person";
import { TICK_MS } from "../../Constants";
import { GameType, SpeedType } from "../../Types";

export interface SpeedOptionsProps {
  speed: SpeedType;
  onSpeedChange: (speed: SpeedType) => void;
  desktop: boolean;
  multiplayer?: MultiplayerSpeedOptionsProps;
}

export interface MultiplayerSpeedOptionsProps {
  activeSpeed: SpeedType;
  players: {
    id: string;
    name: string;
    selectedSpeed: SpeedType;
    pauseReason?: string;
  }[];
  selfId: string;
  reason?: string;
  readyRequired?: boolean;
  ready?: boolean;
}

/** Labels follow the real clock instead of drifting from its tick intervals. */
const RUNNING_SPEEDS: SpeedType[] = ["SLOW", "NORMAL", "FAST"];
const DESKTOP_SPEEDS: SpeedType[] = [...RUNNING_SPEEDS, "ULTRA"];
const selectionLabel = (speed: SpeedType) =>
  speed === "PAUSED"
    ? "Paused"
    : `${Math.round(TICK_MS.SLOW / TICK_MS[speed])}×`;
const SPEED_ARIA_LABELS: Record<SpeedType, string> = {
  PAUSED: "pause",
  SLOW: "slow speed",
  NORMAL: "normal speed",
  FAST: "fast speed",
  ULTRA: "ultra speed",
};

/** The shared clock's speed controls for a co-op grid, or undefined outside a match. */
export function sharedClockSpeedProps(
  multiplayer: GameType["multiplayer"],
): MultiplayerSpeedOptionsProps | undefined {
  return multiplayer?.clock
    ? { ...multiplayer.clock, selfId: multiplayer.seat }
    : undefined;
}

/** Spoken summary of the shared clock: the running speed, then every player's choice. */
function describeSharedClock(
  multiplayer: MultiplayerSpeedOptionsProps,
  speed: SpeedType,
  resume: boolean,
): string {
  const players = multiplayer.players
    .map((player) => {
      const you = player.id === multiplayer.selfId ? " (you)" : "";
      const paused = player.pauseReason
        ? `; paused: ${player.pauseReason}`
        : "";
      return `${player.name}${you} selected ${selectionLabel(player.selectedSpeed)}${paused}`;
    })
    .join(". ");
  const reason = multiplayer.reason ? `${multiplayer.reason}. ` : "";
  return `Game speed: ${selectionLabel(multiplayer.activeSpeed)}. Your selection: ${selectionLabel(speed)}. ${reason}${players}.${resume ? " Select a speed to resume." : ""}`;
}

function speedOptions(
  { speed, onSpeedChange, desktop, multiplayer }: SpeedOptionsProps,
  descriptionId?: string,
): React.JSX.Element {
  const resume = !!multiplayer?.readyRequired && !multiplayer.ready;
  const description = multiplayer
    ? describeSharedClock(multiplayer, speed, resume)
    : undefined;
  return (
    <>
      <ToggleButtonGroup
        className={
          multiplayer ? "speedToggles multiplayerSpeedToggles" : "speedToggles"
        }
        exclusive
        size="small"
        value={speed}
        onChange={(_event, next: SpeedType | null) => {
          if (next) onSpeedChange(next);
          else if (resume && speed !== "PAUSED") onSpeedChange(speed);
        }}
        aria-label={multiplayer ? "your game speed" : "game speed"}
        aria-describedby={descriptionId}
        title={description}
        data-active-speed={multiplayer?.activeSpeed}
        sx={
          multiplayer
            ? { "& .MuiToggleButton-root": { position: "relative" } }
            : undefined
        }
      >
        {(
          [
            "PAUSED",
            ...(desktop || multiplayer ? DESKTOP_SPEEDS : RUNNING_SPEEDS),
          ] as SpeedType[]
        ).map((option) => {
          const peers =
            multiplayer?.players.filter(
              (player) =>
                player.id !== multiplayer.selfId &&
                (player.selectedSpeed === option ||
                  (option === "PAUSED" && !!player.pauseReason)),
            ) || [];
          return (
            <ToggleButton
              key={option}
              value={option}
              aria-label={SPEED_ARIA_LABELS[option]}
              aria-describedby={descriptionId}
              title={description}
              data-active-speed={
                multiplayer?.activeSpeed === option ? "true" : undefined
              }
              aria-current={
                multiplayer?.activeSpeed === option ? "true" : undefined
              }
            >
              {peers.length > 0 && (
                <Box
                  component="span"
                  className="multiplayerSpeedPeers"
                  aria-hidden="true"
                  sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}
                >
                  {/* One neutral marker per other player, filling slots from the left on a
                      12 px pitch about the centre, so the side slots clear the active ring.
                      Who chose what is in the title and description, not marker colour. */}
                  {peers.map((player, slot) => (
                    <PersonIcon
                      key={player.id}
                      data-player-id={player.id}
                      data-slot={slot}
                      data-testid={`speed-peer-${option}-${player.id}`}
                      sx={{
                        position: "absolute",
                        bottom: 1,
                        left: `calc(50% + ${(slot - 1) * 12}px)`,
                        transform: "translateX(-50%)",
                        width: 12,
                        height: 12,
                      }}
                    />
                  ))}
                </Box>
              )}
              <Box
                component="span"
                className={multiplayer ? "multiplayerSpeedLabel" : undefined}
                sx={
                  multiplayer
                    ? {
                        position: "relative",
                        zIndex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                      }
                    : { display: "contents" }
                }
              >
                {option === "PAUSED" ? (
                  <PauseIcon fontSize="small" />
                ) : (
                  selectionLabel(option)
                )}
              </Box>
            </ToggleButton>
          );
        })}
      </ToggleButtonGroup>
      {description && (
        <span className="srOnly" id={descriptionId}>
          {description}
        </span>
      )}
    </>
  );
}

function MultiplayerSpeedControls(props: SpeedOptionsProps) {
  const id = React.useId();
  return speedOptions(props, `${id}-clock`);
}

// Construct once per control-state change, independent of the live cash/date render.
export function buildSpeedOptions(props: SpeedOptionsProps): React.JSX.Element {
  return props.multiplayer ? (
    <MultiplayerSpeedControls {...props} />
  ) : (
    speedOptions(props)
  );
}

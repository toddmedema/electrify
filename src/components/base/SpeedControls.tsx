import * as React from "react";
import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import PauseIcon from "@mui/icons-material/Pause";
import { TICK_MS } from "../../Constants";
import { GameType, SpeedType } from "../../Types";
import "./SpeedControls.scss";

export interface SpeedOptionsProps {
  speed: SpeedType;
  onSpeedChange: (speed: SpeedType) => void;
  desktop: boolean;
  disabled?: boolean;
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
  return `Game speed: ${selectionLabel(multiplayer.activeSpeed)}. Your selection: ${selectionLabel(speed)}. The slowest player sets the game speed. Any paused player pauses everyone. ${reason}${players}.${resume ? " Select a speed to resume." : ""}`;
}

/** What a screen reader hears when the shared clock stops or waits for you: pauses and the
 * resume prompt only, never every speed change. Empty while the game is simply running. */
function describeClockStatus(
  multiplayer: MultiplayerSpeedOptionsProps,
  resume: boolean,
): string {
  if (resume) return "Select a speed to resume.";
  if (multiplayer.activeSpeed !== "PAUSED") return "";
  return multiplayer.reason
    ? `Game paused: ${multiplayer.reason}.`
    : "Game paused.";
}

/** Hovering a shared-clock speed names every player at it, by their Steam name. */
function playersAtSpeed(
  multiplayer: MultiplayerSpeedOptionsProps,
  option: SpeedType,
): string {
  const names = multiplayer.players
    .filter(
      (player) =>
        (player.pauseReason ? "PAUSED" : player.selectedSpeed) === option,
    )
    .map((player) => {
      const you = player.id === multiplayer.selfId ? " (you)" : "";
      const why =
        option === "PAUSED" && player.pauseReason
          ? `: ${player.pauseReason}`
          : "";
      return `${player.name}${you}${why}`;
    });
  return `${selectionLabel(option)}: ${names.length ? names.join(", ") : "nobody"}`;
}

/** Keep a player's requested selection distinct from the clock's effective running speed.
 * Shared-clock reselections are emitted too, preserving quick reversals and explicit readiness.
 *
 * The group is a recessed track with one thumb under the speed the game is really running at,
 * driven by --speed-index. Single-player's thumb follows the selection, since the two are the
 * same thing there. In co-op a ring marks your own request whenever the thumb is elsewhere. */
function speedOptions(
  { speed, onSpeedChange, desktop, multiplayer, disabled }: SpeedOptionsProps,
  descriptionId?: string,
): React.JSX.Element {
  const resume = !!multiplayer?.readyRequired && !multiplayer.ready;
  const description = multiplayer
    ? describeSharedClock(multiplayer, speed, resume)
    : undefined;
  const options = [
    "PAUSED",
    ...(desktop || multiplayer ? DESKTOP_SPEEDS : RUNNING_SPEEDS),
  ] as SpeedType[];
  const thumbSpeed = multiplayer ? multiplayer.activeSpeed : speed;
  const thumbIndex = options.indexOf(thumbSpeed);
  return (
    <>
      <ToggleButtonGroup
        className={
          multiplayer ? "speedToggles multiplayerSpeedToggles" : "speedToggles"
        }
        exclusive
        disabled={disabled}
        size="small"
        value={speed}
        onChange={(_event, next: SpeedType | null) => {
          if (next) onSpeedChange(next);
          // A host snapshot can still show an earlier selection while a different choice
          // is in flight. Send reselections too, so a quick reversal is never dropped.
          else if (multiplayer) onSpeedChange(speed);
        }}
        aria-label={multiplayer ? "your game speed" : "game speed"}
        aria-describedby={descriptionId}
        title={description}
        data-active-speed={multiplayer?.activeSpeed}
        // Still on your earlier pick, but the clock is waiting for you to confirm it.
        data-resume={resume ? "true" : undefined}
        data-disabled={disabled ? "true" : undefined}
        data-no-thumb={thumbIndex < 0 ? "true" : undefined}
        style={
          {
            "--speed-index": Math.max(thumbIndex, 0),
            "--speed-count": options.length,
          } as React.CSSProperties
        }
      >
        {options.map((option) => {
          const peers =
            multiplayer?.players.filter(
              (player) =>
                player.id !== multiplayer.selfId &&
                (player.pauseReason ? "PAUSED" : player.selectedSpeed) ===
                  option,
            ) || [];
          return (
            <ToggleButton
              key={option}
              value={option}
              // The thumb's slide is the feedback; a Material ripple would fight it.
              disableRipple
              aria-label={SPEED_ARIA_LABELS[option]}
              aria-describedby={descriptionId}
              title={
                multiplayer ? playersAtSpeed(multiplayer, option) : description
              }
              // The button the thumb sits under, so its label can take the thumb's ink.
              data-thumb={option === thumbSpeed ? "true" : undefined}
              data-active-speed={
                multiplayer?.activeSpeed === option ? "true" : undefined
              }
              aria-current={
                multiplayer?.activeSpeed === option ? "true" : undefined
              }
            >
              {peers.length > 0 && (
                <span className="multiplayerSpeedPeers" aria-hidden="true">
                  {/* One neutral pip per other player, centred along the bottom of the
                      segment. Who chose what is in the title and description, not in colour. */}
                  {peers.map((player, slot) => (
                    <svg
                      key={player.id}
                      className="multiplayerSpeedPip"
                      viewBox="0 0 6 6"
                      focusable="false"
                      data-player-id={player.id}
                      data-slot={slot}
                      data-testid={`speed-peer-${option}-${player.id}`}
                      style={
                        {
                          "--slot": slot,
                          "--peers": peers.length,
                        } as React.CSSProperties
                      }
                    >
                      <path d="M0 3a3 3 0 1 0 6 0a3 3 0 1 0-6 0z" />
                    </svg>
                  ))}
                </span>
              )}
              <span
                className={multiplayer ? "multiplayerSpeedLabel" : "speedLabel"}
              >
                {option === "PAUSED" ? (
                  <PauseIcon fontSize="small" />
                ) : (
                  selectionLabel(option)
                )}
              </span>
            </ToggleButton>
          );
        })}
      </ToggleButtonGroup>
      {description && (
        <span className="srOnly" id={descriptionId}>
          {description}
        </span>
      )}
      {multiplayer && (
        <span className="srOnly" role="status">
          {describeClockStatus(multiplayer, resume)}
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

import * as React from "react";
import { Button, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import PlayCircleIcon from "@mui/icons-material/PlayCircleOutlined";
import { coopControls } from "../../multiplayer/Registry";
import type { CoopSelectionType } from "../../Types";

/**
 * Says who is choosing a co-op game and who is ready. Hosts drive the selection screens; guests
 * follow them read-only, so the bar names the host and keeps every state in words.
 */
export default function CoopBrowseBar({
  coop,
}: {
  coop?: CoopSelectionType;
}): React.JSX.Element | null {
  if (!coop) return null;
  const guests = coop.players.filter((player) => !player.host);
  const ready = guests.filter((player) => player.ready).length;
  const host = coop.role === "host";
  const title = coop.starting
    ? "Starting the game for everyone…"
    : host
      ? `You're choosing for ${coop.players.length} players`
      : `Following ${coop.hostName}`;
  const detail = coop.starting
    ? undefined
    : host
      ? `${ready} of ${guests.length} ready`
      : coop.viewing
        ? `${coop.hostName} is looking at ${coop.viewing}. Mark Ready when you're happy with it.`
        : `${coop.hostName} is browsing games.`;
  return (
    <section className="coopBrowseBar" aria-label="Playing together">
      <div className="coopBrowseStatus" role="status" aria-live="polite">
        <Typography component="p" variant="subtitle2">
          {title}
        </Typography>
        {detail && (
          <Typography component="p" variant="body2" color="textSecondary">
            {detail}
          </Typography>
        )}
      </div>
      <ul className="coopBrowseRoster" aria-label="Players">
        {coop.players.map((player) => (
          <li key={player.id}>
            <span className="coopBrowseName">{player.name}</span>
            <span className="coopBrowseState">
              {player.host
                ? "Host"
                : !player.connected
                  ? "Reconnecting"
                  : player.ready
                    ? "Ready"
                    : "Reviewing"}
            </span>
          </li>
        ))}
      </ul>
      {!coop.starting && (
        <Button size="small" onClick={() => coopControls()?.back()}>
          {host ? "Lobby" : "Leave"}
        </Button>
      )}
    </section>
  );
}

/**
 * A co-op lobby's one action on a selection screen: the host starts the game for everyone,
 * and each guest marks Ready for exactly what the host is showing.
 */
export function CoopStartButton({
  coop,
  onStart,
  className,
  disabled,
}: {
  coop: CoopSelectionType;
  onStart: () => void;
  className?: string;
  /** The selection can't be played as it stands, such as an unbuildable custom fleet. */
  disabled?: boolean;
}): React.JSX.Element {
  if (coop.role === "host")
    return (
      <Button
        className={className}
        size="large"
        variant="contained"
        color="primary"
        disabled={coop.starting || disabled}
        onClick={onStart}
        startIcon={<PlayCircleIcon />}
      >
        {coop.starting ? "Starting…" : "Start for everyone"}
      </Button>
    );
  return (
    <Button
      className={className}
      size="large"
      variant={coop.ready ? "outlined" : "contained"}
      color="primary"
      disabled={coop.starting || disabled}
      aria-pressed={coop.ready}
      onClick={() => coopControls()?.ready(!coop.ready)}
      startIcon={coop.ready ? <CheckIcon /> : undefined}
    >
      {coop.ready ? "Ready" : "I'm ready"}
    </Button>
  );
}

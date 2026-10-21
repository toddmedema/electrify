import * as React from "react";
import { Button, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import FolderOpenIcon from "@mui/icons-material/FolderOpenOutlined";
import PersonAddIcon from "@mui/icons-material/PersonAddAlt1";
import PlayCircleIcon from "@mui/icons-material/PlayCircleOutlined";
import { coopControls } from "../../multiplayer/Registry";
import type { CoopSelectionType } from "../../Types";

/**
 * Says who is choosing a co-op game and who is ready. Hosts drive the selection screens and
 * invite friends from here; guests follow them read-only, so the bar names the host and keeps
 * every state in words. Friends may join or leave until the host starts.
 */
export default function CoopBrowseBar({
  coop,
  offerSaves,
}: {
  coop?: CoopSelectionType;
  /** Show the host's multiplayer saves as an alternative to choosing a new game. */
  offerSaves?: boolean;
}): React.JSX.Element | null {
  if (!coop) return null;
  const guests = coop.players.filter((player) => !player.host);
  const ready = guests.filter((player) => player.ready).length;
  const host = coop.role === "host";
  const alone = !guests.length;
  const title = coop.starting
    ? "Starting the game for everyone…"
    : host
      ? alone
        ? "Invite friends to play"
        : `You're choosing for ${coop.players.length} players`
      : `Following ${coop.hostName}`;
  const detail = coop.starting
    ? undefined
    : host
      ? alone
        ? "Friends can join until you start."
        : `${ready} of ${guests.length} ready`
      : coop.viewing
        ? coop.viewing
        : "Choosing a game…";
  return (
    <>
      {host && offerSaves && coop.hasSaves && !coop.starting && (
        <Button
          className="coopSavesBar"
          fullWidth
          startIcon={<FolderOpenIcon />}
          onClick={() => coopControls()?.openSaves()}
        >
          Load multiplayer save
        </Button>
      )}
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
                    ? "Connecting"
                    : player.ready
                      ? "Ready"
                      : "Reviewing"}
              </span>
            </li>
          ))}
        </ul>
        {!coop.starting && (
          <div className="coopBrowseActions">
            {host && (
              <>
                <Button
                  variant={alone ? "contained" : "outlined"}
                  startIcon={<PersonAddIcon />}
                  onClick={() => coopControls()?.invite()}
                >
                  Invite friends
                </Button>
                {coop.lobbyId && (
                  <Button onClick={() => coopControls()?.copyCode()}>
                    Copy invite code
                  </Button>
                )}
              </>
            )}
            <Button onClick={() => coopControls()?.back()}>Leave</Button>
          </div>
        )}
      </section>
    </>
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
  if (coop.role === "host") {
    // A friend still connecting, or nobody here yet, would leave a company without a player.
    const waiting =
      coop.players.length < 2 || coop.players.some((p) => !p.connected);
    return (
      <Button
        className={className}
        size="large"
        variant="contained"
        color="primary"
        disabled={coop.starting || disabled || waiting}
        onClick={onStart}
        startIcon={<PlayCircleIcon />}
      >
        {coop.starting
          ? "Starting…"
          : coop.players.length < 2
            ? "Invite a friend to start"
            : "Start for everyone"}
      </Button>
    );
  }
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

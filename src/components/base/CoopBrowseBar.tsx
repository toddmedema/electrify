import { CouchPlayerText } from "../../couch/PlayerColor";
import * as React from "react";
import { TransitionGroup } from "react-transition-group";
import RemovalCollapse from "./RemovalCollapse";
import { Button, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HourglassIcon from "@mui/icons-material/HourglassEmpty";
import StarIcon from "@mui/icons-material/StarBorder";
import SyncIcon from "@mui/icons-material/Sync";
import FolderOpenIcon from "@mui/icons-material/FolderOpenOutlined";
import PlayCircleIcon from "@mui/icons-material/PlayCircleOutlined";
import { coopControls } from "../../multiplayer/Registry";
import type { CoopSelectionType } from "../../Types";
import CoopInviteCode from "./CoopInviteCode";
import UtilityLogoPicker from "./UtilityLogoPicker";
import {
  claimedUtilityLogo,
  type UtilityLogoId,
} from "../../data/UtilityLogos";

/** State labels stay visible alongside the roster icons. */
function PlayerState({
  player,
}: {
  player: CoopSelectionType["players"][number];
}): React.JSX.Element {
  const state = player.host
    ? "Host"
    : !player.connected
      ? "Connecting"
      : player.ready
        ? "Ready"
        : "Reviewing";
  const Icon = {
    Host: StarIcon,
    Connecting: SyncIcon,
    Ready: CheckCircleIcon,
    Reviewing: HourglassIcon,
  }[state];
  const colorClass =
    state === "Ready"
      ? " coopBrowseReady"
      : state === "Connecting"
        ? " coopBrowseConnecting"
        : "";
  return (
    <>
      <Icon className={"coopBrowseState" + colorClass} titleAccess={state} />
      <span className="coopBrowseStateLabel" aria-hidden="true">
        {state}
      </span>
    </>
  );
}

/** The host removes a guest by hovering their chip, then clicking it. */
function RosterPlayer({
  player,
  canKick,
  onKick,
}: {
  player: CoopSelectionType["players"][number];
  canKick: boolean;
  onKick: (id: string, trigger: HTMLButtonElement) => void;
}): React.JSX.Element {
  const [armed, setArmed] = React.useState(false);
  // Set only by a hover or a previous tap. Focus and the tap's own mouseenter
  // must not count, or the first press removes the guest immediately.
  const prompted = React.useRef(false);
  const confirmGesture = React.useRef(false);
  const touchGesture = React.useRef(false);
  const reveal = () => {
    prompted.current = true;
    setArmed(true);
  };
  const hide = () => {
    prompted.current = false;
    setArmed(false);
  };
  const hideUnlessFocused = (target: EventTarget) => {
    if (target === document.activeElement) return;
    hide();
  };
  const identity = (
    <CouchPlayerText className="coopBrowseName" seatId={player.id}>
      {player.name}
    </CouchPlayerText>
  );
  if (!canKick)
    return (
      <div className="coopBrowsePlayer">
        {identity}
        <PlayerState player={player} />
      </div>
    );
  return (
    <div className="coopBrowsePlayer">
      <button
        type="button"
        className="coopBrowseKickTarget"
        aria-label={`Kick ${player.name}`}
        onPointerDown={(event) => {
          touchGesture.current = event.pointerType !== "mouse";
          confirmGesture.current = prompted.current;
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") reveal();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse") return;
          hideUnlessFocused(event.currentTarget);
        }}
        onMouseEnter={() => {
          // A tap's compatibility mouseenter follows pointerdown. Ignore it.
          if (touchGesture.current) return;
          reveal();
        }}
        onMouseLeave={(event) => {
          if (touchGesture.current) return;
          hideUnlessFocused(event.currentTarget);
        }}
        onFocus={() => setArmed(true)}
        onBlur={hide}
        onClick={(event) => {
          const wasTouch = touchGesture.current;
          touchGesture.current = false;
          // Keyboard activation follows focus, which already showed Kick?.
          // A mouse click confirms a hover. A second tap confirms the first.
          if (
            event.detail === 0 ||
            confirmGesture.current ||
            (prompted.current && !wasTouch)
          ) {
            onKick(player.id, event.currentTarget);
            return;
          }
          reveal();
        }}
      >
        {identity}
        {armed ? (
          <span className="coopBrowseKick">Kick?</span>
        ) : (
          <PlayerState player={player} />
        )}
      </button>
    </div>
  );
}

/**
 * Who is choosing a co-op game together and who is ready. Hosts drive the selection screens and
 * invite friends from here; guests follow them read-only, so the bar names the host. Friends
 * may join or leave until the host starts.
 */
export default function CoopBrowseBar({
  coop,
  offerSaves,
}: {
  coop?: CoopSelectionType;
  /** Show the host's multiplayer saves as an alternative to choosing a new game. */
  offerSaves?: boolean;
}): React.JSX.Element | null {
  const kicked = React.useRef<string>();
  if (!coop) return null;
  const pickUtilityLogo = coopControls()?.pickUtilityLogo;
  const choices = coop.utilityLogos ?? {};
  const taken = new Map<UtilityLogoId, string>();
  for (const player of coop.players) {
    const logo = claimedUtilityLogo(choices, player.id);
    if (logo && player.id !== coop.selfId) taken.set(logo, player.name);
  }
  const guests = coop.players.filter((player) => !player.host);
  const ready = guests.filter((player) => player.ready).length;
  const host = coop.role === "host";
  const alone = !guests.length;
  // The host reads the roster's icons; guests need to know whose screen they follow.
  const title = coop.starting
    ? "Starting the game for everyone…"
    : host
      ? undefined
      : `Following ${coop.hostName}`;
  const detail =
    coop.starting || host ? undefined : coop.viewing || "Choosing a game…";
  return (
    <>
      {host && offerSaves && coop.hasSaves && !coop.starting && (
        <div className="coopSavesBar">
          <div className="coopBarColumn">
            <Button
              startIcon={<FolderOpenIcon />}
              onClick={() => coopControls()?.openSaves()}
            >
              Load multiplayer save
            </Button>
          </div>
        </div>
      )}
      <section className="coopBrowseBar" aria-label="Playing together">
        <div className="coopBarColumn">
          <div className="coopBrowseStatus" role="status" aria-live="polite">
            {title && (
              <Typography component="p" variant="subtitle2">
                {title}
              </Typography>
            )}
            {detail && (
              <Typography component="p" variant="body2" color="textSecondary">
                {detail}
              </Typography>
            )}
            {host && !coop.starting && !alone && (
              <span className="srOnly">
                {ready} of {guests.length} ready
              </span>
            )}
          </div>
          <TransitionGroup
            component="ul"
            className="coopBrowseRoster"
            aria-label="Players"
            childFactory={(
              child: React.ReactElement<
                React.ComponentProps<typeof RemovalCollapse>
              >,
            ) =>
              React.cloneElement(child, {
                animate: child.props.id === kicked.current,
              })
            }
          >
            {coop.players.map((player) => (
              <RemovalCollapse
                orientation="horizontal"
                component="li"
                key={player.id}
                id={player.id}
              >
                <RosterPlayer
                  player={player}
                  canKick={
                    host &&
                    !coop.starting &&
                    !player.host &&
                    !!coopControls()?.kick
                  }
                  onKick={(id, trigger) => {
                    kicked.current = id;
                    const actions = trigger
                      .closest(".coopBarColumn")
                      ?.querySelectorAll<HTMLButtonElement>(
                        ".coopBrowseKickTarget, .coopBrowseActions button",
                      );
                    Array.from(actions ?? [])
                      .find(
                        (button) =>
                          button !== trigger && !button.closest("[inert]"),
                      )
                      ?.focus();
                    coopControls()?.kick?.(id);
                  }}
                />
              </RemovalCollapse>
            ))}
          </TransitionGroup>
          {coop.selfId && pickUtilityLogo && (
            <UtilityLogoPicker
              logo={claimedUtilityLogo(choices, coop.selfId)}
              onChange={pickUtilityLogo}
              taken={taken}
              disabled={coop.starting || coop.ready || coop.utilityLogoPending}
            />
          )}
          {coop.utilityLogoPending && (
            <span className="srOnly" role="status">
              Confirming logo…
            </span>
          )}
          {coop.utilityLogoError && (
            <Typography variant="body2" color="error" role="status">
              {coop.utilityLogoError}
            </Typography>
          )}
          {!coop.starting && host && coop.inviteCode && (
            <div className="coopBrowseActions">
              <CoopInviteCode
                code={coop.inviteCode}
                prominent={alone}
                onCopy={() => coopControls()?.copyCode()}
                onCopyLink={
                  coop.hasInviteLink ? coopControls()?.copyLink : undefined
                }
              />
            </div>
          )}
        </div>
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
    // Online guests mark Ready. Local couch has no ready step, so connection is enough.
    const needsReady = !!coop.inviteCode || !!coop.modSummary;
    const waiting =
      coop.players.length < 2 ||
      coop.players.some(
        (p) => !p.connected || (needsReady && !p.host && !p.ready),
      );
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
            : waiting
              ? "Waiting for players"
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
      disabled={
        coop.starting ||
        disabled ||
        coop.receivingScenario ||
        coop.utilityLogoPending
      }
      aria-pressed={coop.ready}
      onClick={() => coopControls()?.ready(!coop.ready)}
      startIcon={coop.ready ? <CheckIcon /> : undefined}
    >
      {coop.receivingScenario
        ? "Receiving scenario…"
        : coop.ready
          ? "Ready"
          : "I'm ready"}
    </Button>
  );
}

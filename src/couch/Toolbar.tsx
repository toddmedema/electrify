import { Toolbar, Typography } from "@mui/material";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { CouchPlayerText } from "./PlayerColor";
import { GameDate, YearProgressBar } from "../components/base/GameCalendar";
import { speedSelectionLabel } from "../components/base/SpeedControls";
import CouchMenu from "./Menu";
import MissionSummary from "../components/base/MissionSummary";
import type {
  ActiveEventGroupType,
  UpcomingStoryEventType,
} from "../components/views/StoryEventSelectors";
import type { EvidenceTargetType, GameType } from "../Types";
import type { CouchSummary } from "./Protocol";
import "./Toolbar.scss";

type SharedClock = Pick<
  CouchSummary,
  | "speed"
  | "players"
  | "reason"
  | "systemBlockers"
  | "readyRequired"
  | "ready"
  | "complete"
>;

function pauseHolders(clock: SharedClock) {
  if (clock.speed !== "PAUSED") return [];
  const systemReasons = clock.complete
    ? ["Match complete"]
    : [
        ...new Set([
          ...clock.systemBlockers,
          ...(clock.readyRequired && clock.reason && clock.reason !== "Paused"
            ? [clock.reason]
            : []),
        ]),
      ];
  const holders: {
    label: string;
    name?: string;
    seatId?: string;
    reasons: string[];
  }[] = [];
  if (systemReasons.length)
    holders.push({ label: "System", reasons: systemReasons });
  clock.players.forEach((player, index) => {
    if (player.retired) return;
    const reasons = [];
    if (player.pendingChoice)
      reasons.push(`Choosing a response for ${player.pendingChoice}`);
    if (player.pauseReason) reasons.push(player.pauseReason);
    if (clock.readyRequired && !clock.ready.includes(player.id))
      reasons.push("Select a running speed to resume");
    if (player.selectedSpeed === "PAUSED") reasons.push("Selected pause");
    if (reasons.length)
      holders.push({
        label: `P${index + 1}`,
        name: player.name,
        seatId: player.id,
        reasons,
      });
  });
  if (!holders.length)
    holders.push({
      label: "System",
      reasons: [clock.reason || "Clock paused"],
    });
  return holders;
}

export interface CouchToolbarProps {
  game: GameType;
  clock: SharedClock;
  /** Native seat zoom; shell and seats already share the explicit interface scale. */
  statusScale?: number;
  menuOpen: boolean;
  menuFooter?: ReactNode;
  upcoming?: UpcomingStoryEventType[];
  activeEvents?: ActiveEventGroupType[];
  onMenuClose: () => void;
  onManual: () => void;
  onSettings: () => void;
  onSaveQuit: () => void;
  onEvidence?: (target: EvidenceTargetType) => void;
}

/** One calendar/menu serves the match; company controls live in each player's pane. */
export default function CouchToolbar({
  game,
  clock,
  statusScale = 1,
  menuOpen,
  menuFooter,
  upcoming,
  activeEvents,
  onMenuClose,
  onManual,
  onSettings,
  onSaveQuit,
  onEvidence,
}: CouchToolbarProps) {
  const statusStyle = { "--couch-status-scale": statusScale } as CSSProperties;
  const pauses = pauseHolders(clock);
  const speedSetters = clock.players.flatMap((player, index) =>
    !player.retired && player.selectedSpeed === clock.speed
      ? [{ label: `P${index + 1}`, seatId: player.id }]
      : [],
  );
  const clockOwners = clock.speed === "PAUSED" ? pauses : speedSetters;
  return (
    <>
      <div id="appbar" className="couchSharedToolbar" style={statusStyle}>
        <div id="topbar">
          <Toolbar>
            <Typography variant="h6" className="gameStatus couchCalendar">
              <GameDate date={game.date} showTime />
            </Typography>
            <div className="gameStatusBar couchSharedMission">
              <MissionSummary
                game={game}
                upcoming={upcoming}
                activeEvents={activeEvents}
                onActiveEvents={() => onEvidence?.({ card: "EVENTS" })}
                onEvidence={onEvidence}
                eventsOnly
              />
            </div>
          </Toolbar>
        </div>
        <YearProgressBar date={game.date} />
      </div>
      <CouchMenu
        open={menuOpen}
        controls={menuFooter}
        clockStyle={statusStyle}
        clockDetails={
          <>
            <div className="couchClock" role="group" aria-label="Shared clock">
              <strong>Clock {speedSelectionLabel(clock.speed)}</strong>
              {clock.players.map((player, index) => (
                <CouchPlayerText key={player.id} seatId={player.id}>
                  P{index + 1}{" "}
                  {player.retired
                    ? "Retired"
                    : speedSelectionLabel(player.selectedSpeed)}
                </CouchPlayerText>
              ))}
              <span>
                {clock.speed === "PAUSED" ? "Held by " : "Set by "}
                {clockOwners.map(({ label, seatId }, index) => (
                  <Fragment key={label}>
                    {index > 0 && ", "}
                    <CouchPlayerText seatId={seatId}>{label}</CouchPlayerText>
                  </Fragment>
                ))}
              </span>
            </div>
            {!!pauses.length && (
              <ul className="couchClockReasons" aria-label="Pause reasons">
                {pauses.map(({ label, name, seatId, reasons }) => (
                  <li key={label}>
                    <strong>
                      <CouchPlayerText seatId={seatId}>
                        {name ? `${label} · ${name}` : label}
                      </CouchPlayerText>
                    </strong>
                    <ul>
                      {reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </>
        }
        onClose={onMenuClose}
        onManual={onManual}
        onSettings={onSettings}
        onQuit={onSaveQuit}
      />
    </>
  );
}

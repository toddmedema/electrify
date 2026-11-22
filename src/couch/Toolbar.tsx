import { Toolbar, Typography } from "@mui/material";
import type { CSSProperties, ReactNode } from "react";
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
    : [...new Set(clock.systemBlockers)];
  const holders: { label: string; name?: string; reasons: string[] }[] = [];
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
    else if (player.selectedSpeed === "PAUSED") reasons.push("Selected pause");
    if (reasons.length)
      holders.push({ label: `P${index + 1}`, name: player.name, reasons });
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
      ? [`P${index + 1}`]
      : [],
  );
  return (
    <>
      <div id="appbar" className="couchSharedToolbar" style={statusStyle}>
        <div id="topbar">
          <Toolbar>
            <Typography variant="h6" className="gameStatus couchCalendar">
              <GameDate date={game.date} showTime />
            </Typography>
            <div className="couchClock" role="group" aria-label="Shared clock">
              <strong>Clock {speedSelectionLabel(clock.speed)}</strong>
              {clock.players.map((player, index) => (
                <span key={player.id}>
                  P{index + 1}{" "}
                  {player.retired
                    ? "Retired"
                    : speedSelectionLabel(player.selectedSpeed)}
                </span>
              ))}
              <span>
                {clock.speed === "PAUSED"
                  ? `Held by ${pauses.map(({ label }) => label).join(", ")}`
                  : `Set by ${speedSetters.join(", ")}`}
              </span>
            </div>
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
          pauses.length ? (
            <ul className="couchClockReasons" aria-label="Pause reasons">
              {pauses.map(({ label, name, reasons }) => (
                <li key={label}>
                  <strong>{name ? `${label} · ${name}` : label}</strong>
                  <ul>
                    {reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <span>Clock running at {speedSelectionLabel(clock.speed)}.</span>
          )
        }
        onClose={onMenuClose}
        onManual={onManual}
        onSettings={onSettings}
        onQuit={onSaveQuit}
      />
    </>
  );
}

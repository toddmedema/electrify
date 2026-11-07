import { Toolbar, Typography } from "@mui/material";
import type { CSSProperties, ReactNode } from "react";
import { GameDate, YearProgressBar } from "../components/base/GameCalendar";
import CouchMenu from "./Menu";
import MissionSummary from "../components/base/MissionSummary";
import type {
  ActiveEventGroupType,
  UpcomingStoryEventType,
} from "../components/views/StoryEventSelectors";
import type { EvidenceTargetType, GameType } from "../Types";
import "./Toolbar.scss";

export interface CouchToolbarProps {
  game: GameType;
  /** Native seat zoom relative to the shell's applied TV display scale. */
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
  return (
    <>
      <div
        id="appbar"
        className="couchSharedToolbar"
        style={{ "--couch-status-scale": statusScale } as CSSProperties}
      >
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
        onClose={onMenuClose}
        onManual={onManual}
        onSettings={onSettings}
        onQuit={onSaveQuit}
      />
    </>
  );
}

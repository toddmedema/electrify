import { MenuItem, Toolbar, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { GameDate, YearProgressBar } from "../components/base/GameCalendar";
import GameMenu from "../components/base/GameMenu";
import { useOnline } from "../components/base/OnlineStatus";
import MissionSummary from "../components/base/MissionSummary";
import type {
  ActiveEventGroupType,
  UpcomingStoryEventType,
} from "../components/views/StoryEventSelectors";
import type { EvidenceTargetType, GameType } from "../Types";
import "./Toolbar.scss";

export interface CouchToolbarProps {
  game: GameType;
  menuOpen: boolean;
  menuFooter?: ReactNode;
  online?: boolean;
  upcoming?: UpcomingStoryEventType[];
  activeEvents?: ActiveEventGroupType[];
  onMenuOpen: () => void;
  onMenuClose: () => void;
  onManual: () => void;
  onSettings: () => void;
  onSaveQuit: () => void;
  onEvidence?: (target: EvidenceTargetType) => void;
}

/** One calendar/menu serves the match; company controls live in each player's pane. */
export default function CouchToolbar({
  game,
  menuOpen,
  menuFooter,
  online,
  upcoming,
  activeEvents,
  onMenuOpen,
  onMenuClose,
  onManual,
  onSettings,
  onSaveQuit,
  onEvidence,
}: CouchToolbarProps) {
  const connected = useOnline();
  return (
    <div id="appbar" className="couchSharedToolbar">
      <div id="topbar">
        <Toolbar>
          <GameMenu
            open={menuOpen}
            online={online ?? connected}
            onOpen={menuOpen ? onMenuClose : onMenuOpen}
            onClose={onMenuClose}
            footer={menuFooter}
          >
            <MenuItem onClick={onManual}>Manual</MenuItem>
            <MenuItem onClick={onSettings}>Settings</MenuItem>
            <MenuItem onClick={onSaveQuit}>Save &amp; Quit</MenuItem>
          </GameMenu>
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
  );
}

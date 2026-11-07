import { MenuItem, Toolbar, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { GameDate, YearProgressBar } from "../components/base/GameCalendar";
import GameMenu from "../components/base/GameMenu";
import { useOnline } from "../components/base/OnlineStatus";
import MissionSummary from "../components/base/MissionSummary";
import { buildSpeedOptions } from "../components/base/SpeedControls";
import type {
  ActiveEventGroupType,
  UpcomingStoryEventType,
} from "../components/views/StoryEventSelectors";
import type { EvidenceTargetType, GameType, SpeedType } from "../Types";
import type { CouchSummary } from "./Protocol";
import "./Toolbar.scss";

export interface CouchToolbarProps {
  game: GameType;
  players: CouchSummary["players"];
  effectiveSpeed: SpeedType;
  readyRequired: boolean;
  ready: string[];
  reason: string;
  menuOpen: boolean;
  menuFooter?: ReactNode;
  online?: boolean;
  upcoming?: UpcomingStoryEventType[];
  activeEvents?: ActiveEventGroupType[];
  onMenuOpen: () => void;
  onMenuClose: () => void;
  onSpeed: (seatId: string, speed: SpeedType) => void;
  onManual: () => void;
  onSettings: () => void;
  onSaveQuit: () => void;
  onEvidence?: (target: EvidenceTargetType) => void;
}

/** One calendar/menu serves the match; each player's speed remains an independent selection. */
export default function CouchToolbar({
  game,
  players,
  effectiveSpeed,
  readyRequired,
  ready,
  reason,
  menuOpen,
  menuFooter,
  online,
  upcoming,
  activeEvents,
  onMenuOpen,
  onMenuClose,
  onSpeed,
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
          <div className="couchPlayerSpeeds">
            {players.map((player, index) => (
              <div
                key={player.id}
                className="couchPlayerSpeed"
                role="group"
                aria-label={`P${index + 1} speed controls`}
                data-seat-id={player.id}
              >
                <span className="couchSpeedPlayer" title={player.name}>
                  P{index + 1}
                  {player.retired ? " · Retired" : ""}
                </span>
                {buildSpeedOptions({
                  speed: player.selectedSpeed,
                  desktop: true,
                  disabled: player.retired || menuOpen,
                  onSpeedChange: (speed) => onSpeed(player.id, speed),
                  multiplayer: {
                    activeSpeed: effectiveSpeed,
                    players: players.filter((seat) => !seat.retired),
                    selfId: player.id,
                    reason,
                    readyRequired,
                    ready: ready.includes(player.id),
                  },
                })}
              </div>
            ))}
          </div>
        </Toolbar>
      </div>
      <YearProgressBar date={game.date} />
    </div>
  );
}

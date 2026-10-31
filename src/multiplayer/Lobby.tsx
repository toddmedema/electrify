import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import PersonAddIcon from "@mui/icons-material/PersonAddAlt1";
import type { MultiplayerSession } from "./Session";
import { seatAssignments } from "./Slots";
import "./Lobby.css";

/**
 * Friends host or join here. A guest waits here until the host shows a game, and the whole lobby
 * gathers here to pick companies before resuming a multiplayer save.
 */
export default function Lobby({
  session,
  onHosted,
  onChooseNew,
  onCopyCode,
  onClose,
  onLeave,
}: {
  session: MultiplayerSession;
  /** The host's new lobby goes straight to choosing a game. */
  onHosted: () => void;
  /** Host: set the multiplayer save aside and choose a new game. */
  onChooseNew: () => void;
  onCopyCode: () => void;
  onClose: () => void;
  onLeave: () => void;
}) {
  const { lobby, pendingCampaign, busy, error } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
  );
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<string>();
  const title = useRef<HTMLHeadingElement>(null);
  const mode = !lobby.lobbyId
    ? "entry"
    : pendingCampaign
      ? "campaign"
      : "waiting";
  useEffect(() => title.current?.focus(), [mode]);
  const host = lobby.selfId === lobby.hostId;
  const hostName =
    lobby.members.find((member) => member.id === lobby.hostId)?.name ||
    "the host";
  const connected = (id: string) =>
    id === lobby.selfId || lobby.connected.includes(id);
  const run = (action: () => Promise<unknown>) => {
    setFailure(undefined);
    void action().catch((error) =>
      setFailure(error instanceof Error ? error.message : "Try again."),
    );
  };
  const notice = failure || error || lobby.error;
  return (
    <Dialog
      className="coopLobby"
      open
      fullWidth
      maxWidth="sm"
      onClose={
        busy
          ? undefined
          : mode === "entry"
            ? onClose
            : mode === "campaign" && host
              ? onChooseNew
              : undefined
      }
      aria-labelledby="multiplayer-lobby-title"
      slotProps={{
        transition: {
          onEntered: () => {
            // Replace MUI's container autofocus, preserving navigation during the animation.
            if (
              document.activeElement ===
              title.current?.closest('[role="dialog"]')
            )
              title.current?.focus();
          },
        },
      }}
    >
      <DialogTitle
        component="div"
        // Only the heading inside names the dialog, not the Back button beside it.
        id="multiplayer-lobby-header"
        className={mode === "entry" ? "coopLobbyHeader" : undefined}
      >
        {mode === "entry" && (
          <IconButton
            aria-label="Back"
            edge="start"
            color="primary"
            disabled={busy}
            onClick={onClose}
          >
            <ChevronLeftIcon />
          </IconButton>
        )}
        <Typography
          component="h2"
          variant="h6"
          id="multiplayer-lobby-title"
          ref={title}
          tabIndex={-1}
          sx={{ outline: "none", overflowWrap: "anywhere", minWidth: 0 }}
        >
          {pendingCampaign ? "Pick your company" : "Play with friends"}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {notice && (
            <Alert
              severity="warning"
              onClose={() => {
                setFailure(undefined);
                session.dismissError();
              }}
            >
              {notice}
            </Alert>
          )}
          {mode === "entry" && (
            <>
              <Button
                variant="contained"
                size="large"
                disabled={!lobby.available || busy}
                onClick={() =>
                  run(async () => {
                    await session.create();
                    onHosted();
                  })
                }
              >
                Host a game
              </Button>
              <Divider>or join a friend</Divider>
              <div className="coopJoinRow">
                <TextField
                  label="Invite code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.trim())}
                  slotProps={{
                    htmlInput: { inputMode: "numeric", maxLength: 20 },
                  }}
                />
                <Button
                  variant="outlined"
                  disabled={
                    !lobby.available || busy || !/^[0-9]{17,20}$/.test(code)
                  }
                  onClick={() => run(() => session.join(code))}
                >
                  Join
                </Button>
              </div>
            </>
          )}
          {mode === "waiting" && (
            <Stack
              direction="row"
              spacing={1}
              role="status"
              sx={{ alignItems: "center" }}
            >
              <CircularProgress size={20} />
              <Typography>
                {host
                  ? "Opening your lobby…"
                  : connected(lobby.hostId!)
                    ? `Waiting for ${hostName} to choose a game…`
                    : `Connecting to ${hostName}…`}
              </Typography>
            </Stack>
          )}
          {mode === "campaign" && pendingCampaign && (
            <CampaignSlots
              session={session}
              host={host}
              hostName={hostName}
              onCopyCode={onCopyCode}
              onFailure={setFailure}
            />
          )}
          {busy && mode !== "waiting" && (
            <CircularProgress size={20} aria-label="Loading multiplayer" />
          )}
        </Stack>
      </DialogContent>
      {mode !== "entry" && (
        <DialogActions>
          {mode === "campaign" && host && (
            <Button disabled={busy} onClick={onChooseNew}>
              Choose a new game
            </Button>
          )}
          <Button disabled={busy} onClick={onLeave}>
            Leave lobby
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}

/**
 * Each saved company, labelled with the player who saved it. Whoever is in the lobby takes an
 * open company; a returning player keeps their own unless they pick another.
 */
function CampaignSlots({
  session,
  host,
  hostName,
  onCopyCode,
  onFailure,
}: {
  session: MultiplayerSession;
  host: boolean;
  hostName: string;
  onCopyCode: () => void;
  onFailure: (message?: string) => void;
}) {
  const { lobby, pendingCampaign, busy } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
  );
  const campaign = pendingCampaign!;
  const { bySeat } = seatAssignments(campaign, lobby.members);
  const blocker = session.resumeBlocker();
  const connected = (id: string) =>
    id === lobby.selfId || lobby.connected.includes(id);
  const run = (action: () => Promise<unknown>) => {
    onFailure(undefined);
    void action().catch((error) =>
      onFailure(error instanceof Error ? error.message : "Try again."),
    );
  };
  return (
    <>
      <ul className="coopLobbyRoster coopSlots" aria-label="Companies">
        {campaign.players.map((player) => {
          const retired = !campaign.requiredPlayerIds.includes(player.id);
          const occupant = bySeat.get(player.id);
          const mine = occupant?.id === lobby.selfId;
          const canTake = !occupant && (!retired || player.id === lobby.selfId);
          return (
            <li key={player.id} aria-label={`${player.name}'s company`}>
              <span className="coopSlotName">
                <Typography component="span" variant="subtitle2">
                  {player.name}
                </Typography>
                <Typography
                  component="span"
                  variant="body2"
                  color="text.secondary"
                >
                  {retired ? "Retired company" : "Saved company"}
                </Typography>
              </span>
              <span className="coopSlotState">
                {canTake ? (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={busy}
                    aria-label={`Take ${player.name}'s company`}
                    onClick={() => run(() => session.claimSlot(player.id))}
                  >
                    Take
                  </Button>
                ) : (
                  <Typography
                    component="span"
                    variant="body2"
                    color={
                      occupant || retired ? "text.secondary" : "warning.main"
                    }
                  >
                    {occupant
                      ? `${mine ? "You" : occupant.name}${connected(occupant.id) ? "" : " · Connecting…"}`
                      : retired
                        ? "Not needed"
                        : "Open"}
                  </Typography>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {blocker && (
        <Typography role="status" variant="body2" color="text.secondary">
          {blocker}
        </Typography>
      )}
      {host ? (
        <>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Button
              variant="outlined"
              startIcon={<PersonAddIcon />}
              disabled={busy}
              onClick={() => run(() => session.invite())}
            >
              Invite friends
            </Button>
            <Button disabled={busy} onClick={onCopyCode}>
              Copy invite code
            </Button>
          </Stack>
          <Button
            variant="contained"
            size="large"
            disabled={busy || !!blocker}
            onClick={() =>
              run(() => session.start({ saved: true, id: campaign.id }))
            }
          >
            Resume game
          </Button>
        </>
      ) : (
        <Typography role="status" color="text.secondary">
          Waiting for {hostName} to resume…
        </Typography>
      )}
    </>
  );
}

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
import type { MultiplayerSession } from "./Session";
import { seatAssignments } from "./Slots";
import { parseCrossplayInvite } from "./CrossplayInvite";
import CoopInviteCode from "../components/base/CoopInviteCode";
import "./Lobby.css";

/**
 * Friends host or join here. A guest waits here until the host shows a game, and the whole lobby
 * gathers here to pick companies before resuming a multiplayer save.
 */
export default function Lobby({
  session,
  onHosted,
  onAuthorize,
  onJoined,
  onChooseGame,
  onOpenSaves,
  onCopyLink,
  canAuthenticate = true,
  onChooseNew,
  onCopyCode,
  onClose,
  onLeave,
  onLocalPlay,
  initialInviteCode,
}: {
  session: MultiplayerSession;
  /** The host's new lobby goes straight to choosing a game. */
  onHosted?: () => void;
  onAuthorize?: () => Promise<void>;
  onJoined?: () => void;
  onChooseGame?: () => void;
  onOpenSaves?: () => void;
  onCopyLink?: () => void;
  canAuthenticate?: boolean;
  /** Host: set the multiplayer save aside and choose a new game. */
  onChooseNew: () => void;
  onCopyCode: () => void;
  onClose: () => void;
  onLeave: () => void;
  onLocalPlay?: () => void;
  initialInviteCode?: string;
}) {
  const { lobby, pendingCampaign, busy, entryOperation, error } =
    useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [code, setCode] = useState(initialInviteCode ?? "");
  const [failure, setFailure] = useState<string>();
  const [entryAttempt, setEntryAttempt] = useState<"host" | "join">();
  const title = useRef<HTMLHeadingElement>(null);
  const mode =
    !lobby.lobbyId || entryOperation === "join"
      ? "entry"
      : pendingCampaign
        ? "campaign"
        : "waiting";
  useEffect(() => title.current?.focus(), [mode]);
  useEffect(() => {
    if (initialInviteCode) setCode(initialInviteCode);
  }, [initialInviteCode]);
  const host = !!lobby.selfId && lobby.selfId === lobby.hostId;
  const hostName =
    lobby.members.find((member) => member.id === lobby.hostId)?.name ||
    "the host";
  const connected = (id: string) =>
    id === lobby.selfId || lobby.connected.includes(id);
  const run = (action: () => Promise<unknown>, attempt: "host" | "join") => {
    setEntryAttempt(attempt);
    setFailure(undefined);
    void action().catch((error) =>
      setFailure(error instanceof Error ? error.message : "Try again."),
    );
  };
  const notice = failure || error || lobby.error;
  const invite = session.onlineCampaigns
    ? parseCrossplayInvite(code)
    : /^[0-9]{6}$/.test(code)
      ? code
      : undefined;
  const canJoin = canAuthenticate && lobby.available && !busy && invite;
  const joinFailed = entryAttempt === "join" && !!failure;
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
              id="coop-lobby-notice"
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
              {session.onlineCampaigns && (
                <Typography variant="body2" color="text.secondary">
                  Private games are unranked. Approved players receive the full
                  simulation and can keep a copy of the campaign.
                </Typography>
              )}
              {(!lobby.available || !canAuthenticate) && !notice && (
                <Typography variant="body2" color="text.secondary">
                  Connect to Steam or open Electrify in your browser to play
                  online.
                </Typography>
              )}
              <Button
                variant="contained"
                size="large"
                disabled={!canAuthenticate || !lobby.available || busy}
                onClick={() =>
                  run(async () => {
                    await onAuthorize?.();
                    await session.create();
                    onHosted?.();
                  }, "host")
                }
              >
                Host a game
              </Button>
              <Divider>Join a friend</Divider>
              <form
                className="coopJoinRow"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (canJoin)
                    run(async () => {
                      await onAuthorize?.();
                      await session.join(invite);
                      onJoined?.();
                    }, "join");
                }}
              >
                <TextField
                  label={
                    session.onlineCampaigns
                      ? "Invite code"
                      : "6-digit invite code"
                  }
                  value={code}
                  disabled={busy}
                  error={joinFailed}
                  onChange={(event) => {
                    if (joinFailed) setFailure(undefined);
                    setCode(
                      session.onlineCampaigns
                        ? event.target.value.slice(0, 160)
                        : event.target.value.replace(/[\s-]/g, "").slice(0, 6),
                    );
                  }}
                  autoComplete="off"
                  slotProps={{
                    htmlInput: {
                      inputMode: session.onlineCampaigns ? "text" : "numeric",
                      autoCapitalize: "off",
                      spellCheck: false,
                      "aria-describedby": joinFailed
                        ? "coop-lobby-notice"
                        : undefined,
                    },
                  }}
                />
                <Button type="submit" variant="outlined" disabled={!canJoin}>
                  Join
                </Button>
              </form>
              {onOpenSaves && (
                <Button
                  disabled={!canAuthenticate || busy}
                  onClick={() =>
                    run(async () => {
                      await onAuthorize?.();
                      onOpenSaves();
                    }, "join")
                  }
                >
                  Multiplayer saves
                </Button>
              )}
            </>
          )}
          {mode === "waiting" &&
            host &&
            session.onlineCampaigns &&
            !lobby.campaignLocked && (
              <>
                {lobby.inviteCode && (
                  <CoopInviteCode code={lobby.inviteCode} onCopy={onCopyCode} />
                )}
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ flexWrap: "wrap" }}
                >
                  {lobby.inviteToken && (
                    <Button onClick={onCopyLink}>Copy invite link</Button>
                  )}
                  <Button
                    onClick={() => run(() => session.rotateInvite(), "host")}
                  >
                    Replace invite
                  </Button>
                </Stack>
                {lobby.pendingApprovals?.map((request) => (
                  <Stack key={request.id} spacing={1}>
                    <Typography sx={{ overflowWrap: "anywhere" }}>
                      {request.name} asked to join
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="contained"
                        onClick={() =>
                          run(() => session.approve(request.id, true), "host")
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        onClick={() =>
                          run(() => session.approve(request.id, false), "host")
                        }
                      >
                        Decline
                      </Button>
                    </Stack>
                  </Stack>
                ))}
                {lobby.members.map((member) => (
                  <Typography key={member.id} sx={{ overflowWrap: "anywhere" }}>
                    {member.name} ·{" "}
                    {member.id === lobby.selfId
                      ? "Host"
                      : connected(member.id)
                        ? "Connected"
                        : "Connecting"}
                  </Typography>
                ))}
                <Button
                  variant="contained"
                  disabled={
                    busy ||
                    !lobby.members.some(
                      (member) =>
                        member.id !== lobby.selfId && connected(member.id),
                    )
                  }
                  onClick={onChooseGame}
                >
                  Choose a game
                </Button>
              </>
            )}
          {mode === "waiting" && lobby.campaignLocked && (
            <>
              <Typography>
                {lobby.sharedAt
                  ? `Online save confirmed ${new Date(lobby.sharedAt).toLocaleString()}`
                  : "Waiting for the confirmed online save."}
              </Typography>
              <Typography>
                The campaign resumes with its original players.
              </Typography>
              {host && lobby.recoveryAvailable ? (
                <Button
                  variant="contained"
                  disabled={!session.canRecover()}
                  onClick={() => run(() => session.recover(), "host")}
                >
                  Resume campaign
                </Button>
              ) : (
                <Button onClick={() => run(() => session.reconnect(), "join")}>
                  Reconnect
                </Button>
              )}
            </>
          )}
          {mode === "waiting" &&
            !lobby.campaignLocked &&
            (!host || !session.onlineCampaigns) && (
              <Stack
                direction="row"
                spacing={1}
                role="status"
                sx={{ alignItems: "center" }}
              >
                <CircularProgress size={20} />
                <Typography>
                  {lobby.joinPending
                    ? "Waiting for the host to approve your request…"
                    : host
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
          {busy && mode === "entry" && (
            <Stack
              direction="row"
              spacing={1}
              role="status"
              sx={{ alignItems: "center" }}
            >
              <CircularProgress size={20} aria-hidden="true" />
              <Typography variant="body2">
                {entryOperation === "join"
                  ? "Finding game…"
                  : "Creating lobby…"}
              </Typography>
            </Stack>
          )}
          {busy && mode === "campaign" && (
            <CircularProgress size={20} aria-label="Loading multiplayer" />
          )}
        </Stack>
      </DialogContent>
      {mode === "entry" && onLocalPlay && (
        <DialogActions>
          <Button size="large" disabled={busy} onClick={onLocalPlay}>
            Local Co-op
          </Button>
        </DialogActions>
      )}
      {mode !== "entry" && (
        <DialogActions>
          {mode === "waiting" &&
            host &&
            session.onlineCampaigns &&
            !lobby.campaignLocked && <Button onClick={onClose}>Close</Button>}
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
          {lobby.inviteCode && (
            <CoopInviteCode
              code={lobby.inviteCode}
              onCopy={onCopyCode}
              prominent={!!blocker}
              disabled={busy}
            />
          )}
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

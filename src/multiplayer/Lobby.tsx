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
import { crossplayFailure } from "./CrossplayApi";
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
  onDiscardInvite,
  onOpenSaves,
  onCopyLink,
  canAuthenticate = true,
  onChooseNew,
  onContinueSetup,
  onCopyCode,
  onClose,
  onLeave,
  onLocalPlay,
  initialInviteCode,
  steamInvite,
}: {
  session: MultiplayerSession;
  /** The host's new lobby goes straight to choosing a game. */
  onHosted?: () => void;
  onAuthorize?: () => Promise<void>;
  onJoined?: () => void;
  onDiscardInvite?: () => void;
  onOpenSaves?: () => void;
  onCopyLink?: () => void;
  canAuthenticate?: boolean;
  /** Host: set the multiplayer save aside and choose a new game. */
  onChooseNew: () => void;
  /** Host: reopen Custom setup for the room that is already open. */
  onContinueSetup?: () => void;
  onCopyCode: () => void;
  onClose: () => void;
  onLeave: () => void;
  onLocalPlay?: () => void;
  initialInviteCode?: string;
  steamInvite?: string;
}) {
  const { lobby, pendingCampaign, busy, entryOperation, error } =
    useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<string>();
  const [entryAttempt, setEntryAttempt] = useState<"host" | "join">();
  const entryVersion = useRef(0);
  const [authorizing, setAuthorizing] = useState(false);
  useEffect(
    () => () => {
      entryVersion.current++;
    },
    [],
  );
  useEffect(() => {
    entryVersion.current++;
    setAuthorizing(false);
  }, [initialInviteCode]);
  async function authorized(action: () => Promise<void> | void) {
    const attempt = ++entryVersion.current;
    setAuthorizing(true);
    try {
      await onAuthorize?.();
      if (attempt === entryVersion.current) await action();
    } finally {
      if (attempt === entryVersion.current) setAuthorizing(false);
    }
  }
  function dismissEntry() {
    entryVersion.current++;
    onClose();
  }
  const title = useRef<HTMLHeadingElement>(null);
  const mode =
    !lobby.lobbyId || entryOperation === "join"
      ? "entry"
      : pendingCampaign
        ? "campaign"
        : "waiting";
  useEffect(() => title.current?.focus(), [mode]);
  const host = !!lobby.selfId && lobby.selfId === lobby.hostId;
  const hostName =
    lobby.members.find((member) => member.id === lobby.hostId)?.name ||
    "the host";
  const connected = (id: string) =>
    id === lobby.selfId || lobby.connected.includes(id);
  const run = (action: () => Promise<unknown>, attempt: "host" | "join") => {
    setEntryAttempt(attempt);
    setFailure(undefined);
    void action().catch((error) => {
      setFailure(crossplayFailure(error, "Try again."));
    });
  };
  const notice = failure || error || lobby.error;
  const invite = session.onlineCampaigns
    ? parseCrossplayInvite(initialInviteCode ?? code)
    : /^[0-9]{6}$/.test(code)
      ? code
      : undefined;
  const canJoin =
    canAuthenticate && lobby.available && !busy && !authorizing && invite;
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
            ? dismissEntry
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
            onClick={dismissEntry}
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
              {(!lobby.available || !canAuthenticate) && !notice && (
                <Typography variant="body2" color="text.secondary">
                  Connect to Steam or open Electrify in your browser to play
                  online.
                </Typography>
              )}
              {!initialInviteCode && (
                <>
                  <Button
                    variant="contained"
                    size="large"
                    disabled={
                      !canAuthenticate ||
                      !lobby.available ||
                      busy ||
                      authorizing
                    }
                    onClick={() =>
                      run(
                        () =>
                          authorized(async () => {
                            await session.create();
                            onHosted?.();
                          }),
                        "host",
                      )
                    }
                  >
                    Host a game
                  </Button>
                  <Divider>Join a friend</Divider>
                </>
              )}
              <form
                className={initialInviteCode ? undefined : "coopJoinRow"}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (canJoin)
                    run(
                      () =>
                        authorized(async () => {
                          await session.join(invite);
                          onJoined?.();
                        }),
                      "join",
                    );
                }}
              >
                {!initialInviteCode && (
                  <TextField
                    label={
                      session.onlineCampaigns
                        ? "Invite code"
                        : "6-digit invite code"
                    }
                    placeholder={
                      session.onlineCampaigns ? "6 characters" : undefined
                    }
                    value={code}
                    disabled={busy || authorizing}
                    error={joinFailed}
                    onChange={(event) => {
                      if (joinFailed) setFailure(undefined);
                      setCode(
                        session.onlineCampaigns
                          ? event.target.value.slice(0, 160)
                          : event.target.value
                              .replace(/[\s-]/g, "")
                              .slice(0, 6),
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
                )}
                <Button
                  type="submit"
                  variant={initialInviteCode ? "contained" : "outlined"}
                  fullWidth={!!initialInviteCode}
                  disabled={!canJoin}
                >
                  Join
                </Button>
              </form>
              {steamInvite && (
                <Button onClick={() => window.location.assign(steamInvite)}>
                  Open in Steam
                </Button>
              )}
              {initialInviteCode && joinFailed && (
                <Button
                  onClick={() => {
                    setCode("");
                    setFailure(undefined);
                    onDiscardInvite?.();
                  }}
                >
                  Enter another code
                </Button>
              )}
              {!initialInviteCode && onOpenSaves && (
                <Button
                  disabled={!canAuthenticate || busy || authorizing}
                  onClick={() => run(() => authorized(onOpenSaves), "join")}
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
                  <CoopInviteCode
                    code={lobby.inviteCode}
                    onCopy={onCopyCode}
                    onCopyLink={lobby.inviteToken ? onCopyLink : undefined}
                  />
                )}
                {lobby.members.map((member) => (
                  <Stack
                    key={member.id}
                    direction="row"
                    spacing={1}
                    sx={{
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Typography sx={{ overflowWrap: "anywhere" }}>
                      {member.name} ·{" "}
                      {member.id === lobby.selfId
                        ? "Host"
                        : connected(member.id)
                          ? "Connected"
                          : "Connecting"}
                    </Typography>
                    {member.id !== lobby.selfId && (
                      <Button
                        aria-label={`Remove ${member.name}`}
                        onClick={() =>
                          run(() => session.removePlayer(member.id), "host")
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </Stack>
                ))}
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
              {host &&
              lobby.recoveryAvailable &&
              session.hasOnlineAuthority() ? (
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
                  {host
                    ? "Opening your lobby…"
                    : connected(lobby.hostId!)
                      ? `Waiting for ${hostName} to share the custom setup…`
                      : `Connecting to ${hostName}…`}
                </Typography>
              </Stack>
            )}
          {mode === "waiting" &&
            session.onlineCampaigns &&
            !lobby.campaignLocked &&
            !session.hasOnlineAuthority() && (
              <Button
                variant="outlined"
                onClick={() => run(() => session.reconnect(), "join")}
              >
                Reconnect
              </Button>
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
      {mode === "entry" && !initialInviteCode && onLocalPlay && (
        <DialogActions>
          <Button
            size="large"
            disabled={busy || authorizing}
            onClick={onLocalPlay}
          >
            Local Co-op
          </Button>
        </DialogActions>
      )}
      {mode !== "entry" && (
        <DialogActions>
          {mode === "waiting" &&
            host &&
            session.onlineCampaigns &&
            !lobby.campaignLocked && (
              <>
                {onContinueSetup && (
                  <Button variant="contained" onClick={onContinueSetup}>
                    Continue setup
                  </Button>
                )}
                <Button onClick={onClose}>Close</Button>
              </>
            )}
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
      onFailure(crossplayFailure(error, "Try again.")),
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

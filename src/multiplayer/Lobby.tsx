import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import type { MultiplayerSession } from "./Session";
import type { SharedSaveLibrary } from "./Native";
import "./Lobby.css";

/** Friends gather here before choosing a new game or resuming a shared campaign. */
export default function Lobby({
  session,
  choosing,
  onChoose,
  onClose,
  onLeave,
}: {
  session: MultiplayerSession;
  choosing: boolean;
  onChoose: () => void;
  onClose: () => void;
  onLeave: () => void;
}) {
  const { lobby, pendingCampaign, busy, error } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
  );
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<string>();
  const [library, setLibrary] = useState<SharedSaveLibrary>();
  const [search, setSearch] = useState("");
  const [loadingSaves, setLoadingSaves] = useState(false);
  const [menu, setMenu] = useState<{
    anchor: HTMLElement;
    id: string;
    name: string;
  }>();
  const [deleting, setDeleting] = useState<{ id: string; name: string }>();
  const title = useRef<HTMLHeadingElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const deleteReturn = useRef<HTMLElement>();
  const deleted = useRef(false);
  const libraryButton = useRef<HTMLButtonElement>(null);
  const previouslyShowingLibrary = useRef(false);
  const libraryRequest = useRef(0);
  const showingLibrary = !!library || loadingSaves;
  useEffect(() => {
    (!showingLibrary && previouslyShowingLibrary.current
      ? libraryButton
      : title
    ).current?.focus();
    previouslyShowingLibrary.current = showingLibrary;
  }, [showingLibrary]);
  const loadSaves = async (action = () => session.sharedSaves(true)) => {
    const request = ++libraryRequest.current;
    setLoadingSaves(true);
    try {
      const next = await action();
      if (request === libraryRequest.current) setLibrary(next);
    } catch (error) {
      if (request === libraryRequest.current) throw error;
    } finally {
      if (request === libraryRequest.current) setLoadingSaves(false);
    }
  };
  const host = lobby.selfId === lobby.hostId;
  const hostName =
    lobby.members.find((member) => member.id === lobby.hostId)?.name ||
    "The host";
  const connected = (id: string) =>
    id === lobby.selfId || lobby.connected.includes(id);
  const everyoneHere =
    lobby.members.length >= 2 &&
    lobby.members.every((member) => connected(member.id));
  const canBegin = pendingCampaign ? session.canResumeCampaign() : everyoneHere;
  const roster = [
    ...lobby.members,
    ...(pendingCampaign?.players.filter(
      (player) =>
        pendingCampaign.requiredPlayerIds.includes(player.id) &&
        !lobby.members.some((member) => member.id === player.id),
    ) || []),
  ];
  const run = (action: () => Promise<unknown>) => {
    setFailure(undefined);
    void action().catch((error) =>
      setFailure(error instanceof Error ? error.message : "Please try again."),
    );
  };
  const closeLibrary = () => {
    ++libraryRequest.current;
    setLoadingSaves(false);
    setLibrary(undefined);
    setSearch("");
    setMenu(undefined);
    setDeleting(undefined);
  };
  const resume = (id: string, name: string) =>
    run(async () => {
      await session.prepareResume(id, name);
      closeLibrary();
      window.setTimeout(() => title.current?.focus(), 0);
    });
  const showSearch = (library?.slots.length || 0) > 3;
  const query = showSearch ? search.trim().toLocaleLowerCase() : "";
  const campaigns = library?.slots.filter((slot) =>
    `${slot.name} ${slot.players.join(" ")}`
      .toLocaleLowerCase()
      .includes(query),
  );
  return (
    <>
      <Dialog
        className="coopLobby"
        open
        fullWidth
        maxWidth="sm"
        onClose={
          busy
            ? undefined
            : showingLibrary
              ? closeLibrary
              : choosing || !lobby.lobbyId
                ? onClose
                : onLeave
        }
        aria-labelledby="multiplayer-lobby-title"
      >
        <DialogTitle
          id="multiplayer-lobby-title"
          ref={title}
          tabIndex={-1}
          sx={{ outline: "none", overflowWrap: "anywhere" }}
        >
          {showingLibrary
            ? "Shared campaigns"
            : pendingCampaign?.name || "Play with friends"}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {(failure || error || lobby.error) && !deleting && (
              <Alert
                severity="warning"
                onClose={() => {
                  setFailure(undefined);
                  session.dismissError();
                }}
              >
                {failure || error || lobby.error}
              </Alert>
            )}
            {!showingLibrary && (
              <>
                {!lobby.lobbyId ? (
                  <>
                    <Button
                      variant="contained"
                      disabled={!lobby.available || busy}
                      onClick={() => run(() => session.create())}
                    >
                      Host a Steam lobby
                    </Button>
                    <Divider>or join friends</Divider>
                    <TextField
                      label="Lobby code"
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
                      Join lobby
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant={host && !canBegin ? "contained" : "outlined"}
                      disabled={busy}
                      onClick={() => run(() => session.invite())}
                    >
                      Invite Steam friends
                    </Button>
                    <ul className="coopLobbyRoster" aria-label="Players">
                      {roster.map((member) => {
                        const expected =
                          !pendingCampaign ||
                          pendingCampaign.players.some(
                            (player) => player.id === member.id,
                          );
                        return (
                          <li key={member.id}>
                            <span>
                              {member.name}
                              {member.id === lobby.selfId ? " (you)" : ""}
                            </span>
                            <Typography
                              component="span"
                              variant="body2"
                              color={
                                expected ? "text.secondary" : "warning.main"
                              }
                            >
                              {!expected
                                ? "Not in this campaign"
                                : !lobby.members.some(
                                      (present) => present.id === member.id,
                                    )
                                  ? "Not joined"
                                  : member.id === lobby.hostId
                                    ? "Host"
                                    : connected(member.id)
                                      ? "Connected"
                                      : "Connecting…"}
                            </Typography>
                          </li>
                        );
                      })}
                    </ul>
                    <TextField
                      label="Lobby code"
                      value={lobby.lobbyId}
                      size="small"
                      slotProps={{ input: { readOnly: true } }}
                    />
                    {host ? (
                      <Button
                        variant={canBegin ? "contained" : "outlined"}
                        size="large"
                        disabled={busy || !canBegin}
                        onClick={
                          pendingCampaign
                            ? () =>
                                run(() =>
                                  session.start({
                                    saved: true,
                                    id: pendingCampaign.id,
                                  }),
                                )
                            : onChoose
                        }
                      >
                        {pendingCampaign
                          ? "Resume campaign"
                          : choosing
                            ? "Back to choosing"
                            : "Choose a game together"}
                      </Button>
                    ) : (
                      <Typography role="status" color="text.secondary">
                        Waiting for {hostName}…
                      </Typography>
                    )}
                  </>
                )}
                {(!lobby.lobbyId || host) && (
                  <Button
                    ref={libraryButton}
                    disabled={busy || loadingSaves}
                    onClick={() => run(() => loadSaves())}
                  >
                    {pendingCampaign ? "Change campaign" : "Shared campaigns"}
                  </Button>
                )}
              </>
            )}
            {showingLibrary && (
              <Stack spacing={2} className="savedGames coopCampaigns">
                {library?.warning && (
                  <Alert severity="warning">{library.warning}</Alert>
                )}
                {library?.cloudState === "failed" && (
                  <Alert severity="warning">
                    Steam Cloud could not sync. Local campaigns are available.
                  </Alert>
                )}
                {showSearch && (
                  <TextField
                    fullWidth
                    size="small"
                    label="Search campaigns"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                )}
                {loadingSaves && !library && (
                  <Stack
                    direction="row"
                    spacing={1}
                    role="status"
                    sx={{ alignItems: "center" }}
                  >
                    <CircularProgress size={20} />
                    <Typography>Loading shared campaigns…</Typography>
                  </Stack>
                )}
                {library && !library.slots.length && (
                  <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
                    <Typography component="h2" variant="h6">
                      No shared campaigns yet
                    </Typography>
                    {!lobby.lobbyId && (
                      <Button
                        variant="contained"
                        disabled={!lobby.available || busy}
                        sx={{ mt: 2 }}
                        onClick={() =>
                          run(async () => {
                            await session.create();
                            closeLibrary();
                          })
                        }
                      >
                        Host a Steam lobby
                      </Button>
                    )}
                  </Paper>
                )}
                {!!library?.slots.length && !campaigns?.length && (
                  <Typography role="status">
                    No campaigns match “{search}”.
                  </Typography>
                )}
                {campaigns?.map((campaign) => {
                  const savedAt = new Date(campaign.updatedAt);
                  const timestamp = savedAt.toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  });
                  return (
                    <Paper
                      key={campaign.id}
                      variant="outlined"
                      component="article"
                      className="saveEntry"
                      aria-label={campaign.name}
                    >
                      <Box className="coopCampaignHeading">
                        <Typography component="h2" variant="h6">
                          {campaign.name}
                        </Typography>
                        <IconButton
                          aria-label={`Actions for ${campaign.name}`}
                          aria-haspopup="menu"
                          aria-expanded={menu?.id === campaign.id || undefined}
                          disabled={busy || loadingSaves}
                          onClick={(event) => {
                            deleteReturn.current = event.currentTarget;
                            deleted.current = false;
                            setMenu({
                              anchor: event.currentTarget,
                              id: campaign.id,
                              name: campaign.name,
                            });
                          }}
                        >
                          <MoreVertIcon />
                        </IconButton>
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        {campaign.players.join(", ")}
                      </Typography>
                      <Typography
                        component="div"
                        variant="caption"
                        color="text.secondary"
                        sx={{ mt: 0.5 }}
                      >
                        <time
                          dateTime={savedAt.toISOString()}
                          title={timestamp}
                          aria-label={`Saved ${timestamp}`}
                        >
                          Saved {timestamp}
                        </time>
                      </Typography>
                      <Box className="coopCampaignResume">
                        <Button
                          variant="contained"
                          disabled={busy || loadingSaves}
                          onClick={() => resume(campaign.id, campaign.name)}
                        >
                          Resume campaign
                        </Button>
                      </Box>
                    </Paper>
                  );
                })}
              </Stack>
            )}
            {busy && !loadingSaves && (
              <CircularProgress size={20} aria-label="Loading multiplayer" />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          {showingLibrary ? (
            <Button disabled={busy} onClick={closeLibrary}>
              {lobby.lobbyId ? "Back to lobby" : "Back"}
            </Button>
          ) : (
            <>
              {lobby.lobbyId && (
                <Button disabled={busy} onClick={onLeave}>
                  Leave lobby
                </Button>
              )}
              {(choosing || !lobby.lobbyId) && (
                <Button disabled={busy} onClick={onClose}>
                  {choosing ? "Close" : "Back"}
                </Button>
              )}
            </>
          )}
        </DialogActions>
      </Dialog>
      <Menu
        anchorEl={menu?.anchor}
        open={!!menu}
        onClose={() => setMenu(undefined)}
        disableRestoreFocus={!!deleting}
      >
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={() => {
            if (menu) setDeleting({ id: menu.id, name: menu.name });
            setFailure(undefined);
            setMenu(undefined);
          }}
        >
          Delete
        </MenuItem>
      </Menu>
      <Dialog
        open={!!deleting}
        fullWidth
        maxWidth="xs"
        onClose={loadingSaves ? undefined : () => setDeleting(undefined)}
        aria-labelledby="delete-campaign-title"
        aria-describedby="delete-campaign-message"
        slotProps={{
          transition: {
            onEntered: () => cancelDelete.current?.focus(),
            onExited: () =>
              (deleted.current ? title.current : deleteReturn.current)?.focus(),
          },
        }}
      >
        <DialogTitle id="delete-campaign-title">
          Delete shared campaign?
        </DialogTitle>
        <DialogContent>
          <Typography
            id="delete-campaign-message"
            sx={{ overflowWrap: "anywhere" }}
          >
            “{deleting?.name}” will be permanently deleted.
          </Typography>
          {failure && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {failure}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            autoFocus
            ref={cancelDelete}
            disabled={loadingSaves}
            onClick={() => setDeleting(undefined)}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={loadingSaves}
            onClick={() => {
              if (deleting)
                run(async () => {
                  await loadSaves(() => session.deleteSharedSave(deleting.id));
                  deleted.current = true;
                  setDeleting(undefined);
                });
            }}
          >
            {loadingSaves ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

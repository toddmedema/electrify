import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { MultiplayerSession } from "./Session";
import type { SharedSaveLibrary } from "./Native";
import "./Lobby.css";

/**
 * Gathering friends. Once everyone is here the host chooses a game in the normal scenario
 * screens, and everyone else follows along there.
 */
export default function Lobby({
  session,
  choosing,
  onChoose,
  onClose,
  onLeave,
}: {
  session: MultiplayerSession;
  /** The host has already started choosing; closing returns to the scenario screens. */
  choosing: boolean;
  onChoose: () => void;
  onClose: () => void;
  onLeave: () => void;
}) {
  const { lobby, busy, error } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
  );
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<string>();
  const [library, setLibrary] = useState<SharedSaveLibrary>();
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [loadingSaves, setLoadingSaves] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const deleteConfirmation = useRef<HTMLDivElement>(null);
  const libraryButton = useRef<HTMLButtonElement>(null);
  const previouslyShowingLibrary = useRef(false);
  const pendingFocus = useRef<"rename" | "title" | "library" | undefined>(
    undefined,
  );
  const libraryRequest = useRef(0);
  const showingLibrary = !!library;
  useEffect(() => {
    (!showingLibrary && previouslyShowingLibrary.current
      ? libraryButton
      : title
    ).current?.focus();
    previouslyShowingLibrary.current = showingLibrary;
  }, [showingLibrary]);
  useEffect(() => {
    if (loadingSaves && !showingLibrary) title.current?.focus();
  }, [loadingSaves, showingLibrary]);
  useEffect(() => {
    if (!loadingSaves && pendingFocus.current) {
      (pendingFocus.current === "rename"
        ? renameButton
        : pendingFocus.current === "library"
          ? libraryButton
          : title
      ).current?.focus();
      pendingFocus.current = undefined;
    }
  }, [editingName, loadingSaves]);
  useEffect(() => {
    if (confirmDelete) {
      keepButton.current?.focus({ preventScroll: true });
      deleteConfirmation.current?.scrollIntoView({ block: "nearest" });
    }
  }, [confirmDelete]);
  const loadSaves = async (action = () => session.sharedSaves(true)) => {
    const request = ++libraryRequest.current;
    setLoadingSaves(true);
    try {
      const next = await action();
      if (request !== libraryRequest.current) return;
      setLibrary(next);
      const slot = next.slots.find((s) => s.id === selected) || next.slots[0];
      setSelected(slot?.id || "");
      setName(slot?.name || "");
      setConfirmDelete(false);
      setEditingName(false);
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
  const run = (action: () => Promise<unknown>) => {
    setFailure(undefined);
    void action().catch((e) => setFailure(e.message));
  };
  const campaign = library?.slots.find((slot) => slot.id === selected);
  const closeRename = () => {
    pendingFocus.current = "rename";
    setEditingName(false);
  };
  const closeLibrary = () => {
    pendingFocus.current = "library";
    ++libraryRequest.current;
    setLoadingSaves(false);
    setLibrary(undefined);
    setEditingName(false);
    setConfirmDelete(false);
  };
  return (
    <Dialog
      className="coopLobby"
      open
      fullWidth
      maxWidth="sm"
      onClose={
        library || loadingSaves
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
        sx={{ outline: "none" }}
      >
        {library ? "Shared campaigns" : "Play with friends"}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {(failure || error || lobby.error) && (
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
          {!library && (
            <>
              <Typography color="textSecondary">
                Run neighboring electricity companies in any scenario or custom
                game. Each company starts with a tier 1 intertie to every other
                player.
              </Typography>
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
                    onChange={(e) => setCode(e.target.value.trim())}
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
                  <TextField
                    label="Lobby code"
                    value={lobby.lobbyId}
                    slotProps={{ input: { readOnly: true } }}
                  />
                  {/* Until a friend arrives, inviting is the host's next step. */}
                  <Button
                    variant={host && !everyoneHere ? "contained" : "text"}
                    onClick={() => run(() => session.invite())}
                  >
                    Invite Steam friends
                  </Button>
                  <ul className="coopLobbyRoster" aria-label="Players">
                    {lobby.members.map((member) => (
                      <li key={member.id}>
                        <span>
                          {member.name}
                          {member.id === lobby.selfId ? " (you)" : ""}
                        </span>
                        <Typography
                          component="span"
                          variant="body2"
                          color="textSecondary"
                        >
                          {member.id === lobby.hostId
                            ? "Host"
                            : connected(member.id)
                              ? "Connected"
                              : "Connecting…"}
                        </Typography>
                      </li>
                    ))}
                  </ul>
                  {host ? (
                    <>
                      <Button
                        variant="contained"
                        size="large"
                        disabled={busy || !everyoneHere}
                        onClick={onChoose}
                      >
                        {choosing
                          ? "Back to choosing"
                          : "Choose a game together"}
                      </Button>
                      {!everyoneHere && (
                        <Typography role="status" variant="body2">
                          Waiting for a friend to join…
                        </Typography>
                      )}
                      <Button
                        disabled={busy}
                        onClick={() =>
                          run(() => session.start({ saved: true }))
                        }
                      >
                        Resume last shared save
                      </Button>
                    </>
                  ) : (
                    <Typography role="status">
                      {hostName} will choose a game.
                    </Typography>
                  )}
                </>
              )}
              {(!lobby.lobbyId || host) && (
                <Button
                  ref={libraryButton}
                  variant="outlined"
                  disabled={busy || loadingSaves}
                  onClick={() => run(() => loadSaves())}
                >
                  Shared campaigns
                </Button>
              )}
            </>
          )}
          {library && (
            <Stack spacing={2} aria-label="Shared campaigns">
              {library.warning && (
                <Alert severity="warning">{library.warning}</Alert>
              )}
              {library.cloudState === "failed" && (
                <Alert severity="warning">
                  Steam Cloud could not sync. Local campaigns are available.
                </Alert>
              )}
              {library.cloudState === "offline" && (
                <Typography variant="body2" color="textSecondary">
                  Steam Cloud is offline. Campaigns are saved on this computer.
                </Typography>
              )}
              {library.cloudState === "ready" && (
                <Typography variant="body2" color="textSecondary">
                  Saved on this computer and synced with Steam Cloud.
                </Typography>
              )}
              {library.cloudState === "disabled" && (
                <Typography variant="body2" color="textSecondary">
                  Saved on this computer. Steam Cloud is turned off.
                </Typography>
              )}
              {library.slots.length ? (
                <>
                  <TextField
                    select
                    label="Campaign"
                    value={selected}
                    onChange={(event) => {
                      setSelected(event.target.value);
                      setName(
                        library.slots.find((s) => s.id === event.target.value)
                          ?.name || "",
                      );
                      setConfirmDelete(false);
                      setEditingName(false);
                    }}
                    slotProps={{
                      select: {
                        MenuProps: {
                          slotProps: {
                            paper: { sx: { maxWidth: "calc(100vw - 32px)" } },
                          },
                        },
                      },
                    }}
                  >
                    {library.slots.map((slot) => (
                      <MenuItem
                        key={slot.id}
                        value={slot.id}
                        sx={{ whiteSpace: "normal", overflowWrap: "anywhere" }}
                      >
                        {slot.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Stack spacing={0.5} className="coopCampaignDetails">
                    <Typography variant="body2">
                      {campaign?.players.join(", ")}
                    </Typography>
                    {campaign && (
                      <Typography variant="body2" color="textSecondary">
                        Saved{" "}
                        {new Date(campaign.updatedAt).toLocaleString(
                          undefined,
                          { dateStyle: "medium", timeStyle: "short" },
                        )}
                      </Typography>
                    )}
                  </Stack>
                  <Button
                    variant="contained"
                    disabled={busy || loadingSaves || !host || !everyoneHere}
                    onClick={() =>
                      run(() => session.start({ saved: true, id: selected }))
                    }
                  >
                    Resume campaign
                  </Button>
                  {!lobby.lobbyId && (
                    <Typography variant="body2" color="textSecondary">
                      Host a lobby and invite this campaign’s players to resume.
                    </Typography>
                  )}
                  <Divider />
                  {editingName && (
                    <Stack spacing={1}>
                      <TextField
                        autoFocus
                        label="Campaign name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        slotProps={{ htmlInput: { maxLength: 80 } }}
                      />
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ justifyContent: "flex-end" }}
                      >
                        <Button onClick={closeRename}>Cancel</Button>
                        <Button
                          variant="contained"
                          disabled={
                            busy ||
                            loadingSaves ||
                            !name.trim() ||
                            name.trim() === campaign?.name
                          }
                          onClick={() =>
                            run(async () => {
                              pendingFocus.current = "rename";
                              await loadSaves(() =>
                                session.renameSharedSave(selected, name),
                              );
                            })
                          }
                        >
                          Save name
                        </Button>
                      </Stack>
                    </Stack>
                  )}
                  {!editingName && (
                    <Stack
                      direction="row"
                      spacing={1}
                      useFlexGap
                      className="coopCampaignActions"
                    >
                      <Button
                        ref={renameButton}
                        disabled={busy || loadingSaves}
                        onClick={() => {
                          setName(campaign?.name || "");
                          setEditingName(true);
                          setConfirmDelete(false);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        aria-label="Export campaign"
                        disabled={busy || loadingSaves}
                        onClick={() =>
                          run(() => session.exportSharedSave(selected))
                        }
                      >
                        Export
                      </Button>
                      <Button
                        ref={deleteButton}
                        aria-label="Delete campaign"
                        color="error"
                        disabled={busy || loadingSaves}
                        onClick={() => {
                          setConfirmDelete(true);
                          setEditingName(false);
                        }}
                      >
                        Delete
                      </Button>
                    </Stack>
                  )}
                  {confirmDelete && (
                    <Alert severity="warning" ref={deleteConfirmation}>
                      Delete “
                      {library.slots.find((s) => s.id === selected)?.name}” from
                      your library? Export it first to keep a portable backup.
                      <Stack
                        className="coopCampaignDeleteActions"
                        direction={{ xs: "column-reverse", sm: "row" }}
                        spacing={1}
                        sx={{ mt: 1 }}
                      >
                        <Button
                          ref={keepButton}
                          variant="outlined"
                          color="inherit"
                          onClick={() => {
                            setConfirmDelete(false);
                            deleteButton.current?.focus();
                          }}
                        >
                          Keep campaign
                        </Button>
                        <Button
                          variant="outlined"
                          color="error"
                          disabled={loadingSaves}
                          onClick={() =>
                            run(() => {
                              pendingFocus.current = "title";
                              return loadSaves(() =>
                                session.deleteSharedSave(selected),
                              );
                            })
                          }
                        >
                          Confirm delete
                        </Button>
                      </Stack>
                    </Alert>
                  )}
                </>
              ) : (
                <Stack spacing={1} className="coopCampaignEmpty">
                  <Typography
                    component="h3"
                    variant="subtitle1"
                    sx={{ fontWeight: 600 }}
                  >
                    No shared campaigns saved yet.
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Your campaigns appear here when you save a game with
                    friends. You can also import a campaign from a file.
                  </Typography>
                </Stack>
              )}
              <Button
                variant="outlined"
                disabled={busy || loadingSaves}
                onClick={() =>
                  run(() => loadSaves(() => session.importSharedSave()))
                }
              >
                Import campaign
              </Button>
              <Typography variant="body2" color="textSecondary">
                Differing Steam Cloud checkpoints appear as separate copies.
                Every player must select a speed before a restored match
                continues.
              </Typography>
            </Stack>
          )}
          {busy && (
            <Typography role="status">Preparing the shared grids…</Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {library ? (
          <Button onClick={closeLibrary}>Back to lobby</Button>
        ) : (
          <>
            {lobby.lobbyId && <Button onClick={onLeave}>Leave lobby</Button>}
            {(choosing || !lobby.lobbyId) && (
              <Button onClick={onClose}>{choosing ? "Close" : "Back"}</Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

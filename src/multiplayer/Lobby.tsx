import { useState, useSyncExternalStore } from "react";
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
  const [loadingSaves, setLoadingSaves] = useState(false);
  const loadSaves = async (action = () => session.sharedSaves(true)) => {
    setLoadingSaves(true);
    try {
      const next = await action();
      setLibrary(next);
      const slot = next.slots.find((s) => s.id === selected) || next.slots[0];
      setSelected(slot?.id || "");
      setName(slot?.name || "");
      setConfirmDelete(false);
    } finally {
      setLoadingSaves(false);
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
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={choosing || !lobby.lobbyId ? onClose : onLeave}
      aria-labelledby="multiplayer-lobby-title"
    >
      <DialogTitle id="multiplayer-lobby-title">Play with friends</DialogTitle>
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
          <Typography>
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
                variant={host && !everyoneHere ? "outlined" : "text"}
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
                    {choosing ? "Back to choosing" : "Choose a game together"}
                  </Button>
                  {!everyoneHere && (
                    <Typography role="status" variant="body2">
                      Waiting for a friend to join…
                    </Typography>
                  )}
                  <Button
                    disabled={busy}
                    onClick={() => run(() => session.start({ saved: true }))}
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
            <>
              <Button
                disabled={busy || loadingSaves}
                onClick={() => run(() => loadSaves())}
              >
                Shared campaigns
              </Button>
              {library && (
                <Stack spacing={2} aria-label="Shared campaigns">
                  <Divider>Saved campaigns</Divider>
                  {library.warning && (
                    <Alert severity="warning">{library.warning}</Alert>
                  )}
                  {library.cloudState === "failed" && (
                    <Alert severity="warning">
                      Steam Cloud could not sync. Local campaigns are available.
                    </Alert>
                  )}
                  {library.cloudState === "offline" && (
                    <Typography variant="body2">
                      Steam Cloud is offline. Campaigns are saved on this
                      computer.
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
                            library.slots.find(
                              (s) => s.id === event.target.value,
                            )?.name || "",
                          );
                          setConfirmDelete(false);
                        }}
                      >
                        {library.slots.map((slot) => (
                          <MenuItem key={slot.id} value={slot.id}>
                            {slot.name} ·{" "}
                            {new Date(slot.updatedAt).toLocaleString()}
                          </MenuItem>
                        ))}
                      </TextField>
                      <Typography variant="body2">
                        {library.slots
                          .find((s) => s.id === selected)
                          ?.players.join(", ")}
                      </Typography>
                      <Button
                        variant="contained"
                        disabled={
                          busy || loadingSaves || !host || !everyoneHere
                        }
                        onClick={() =>
                          run(() =>
                            session.start({ saved: true, id: selected }),
                          )
                        }
                      >
                        Resume campaign
                      </Button>
                      {!lobby.lobbyId && (
                        <Typography variant="body2">
                          Host a lobby and invite this campaign’s players to
                          resume.
                        </Typography>
                      )}
                      <TextField
                        label="Campaign name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        slotProps={{ htmlInput: { maxLength: 80 } }}
                      />
                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{ flexWrap: "wrap" }}
                      >
                        <Button
                          disabled={busy || loadingSaves || !name.trim()}
                          onClick={() =>
                            run(() =>
                              loadSaves(() =>
                                session.renameSharedSave(selected, name),
                              ),
                            )
                          }
                        >
                          Rename
                        </Button>
                        <Button
                          disabled={busy || loadingSaves}
                          onClick={() =>
                            run(() => session.exportSharedSave(selected))
                          }
                        >
                          Export campaign
                        </Button>
                        <Button
                          color="error"
                          disabled={busy || loadingSaves}
                          onClick={() => setConfirmDelete(true)}
                        >
                          Delete campaign
                        </Button>
                      </Stack>
                      {confirmDelete && (
                        <Alert severity="warning">
                          Delete “
                          {library.slots.find((s) => s.id === selected)?.name}”
                          from your library? Export it first to keep a portable
                          backup.
                          <Stack direction="row" spacing={1}>
                            <Button
                              color="error"
                              disabled={loadingSaves}
                              onClick={() =>
                                run(() =>
                                  loadSaves(() =>
                                    session.deleteSharedSave(selected),
                                  ),
                                )
                              }
                            >
                              Confirm delete
                            </Button>
                            <Button onClick={() => setConfirmDelete(false)}>
                              Keep campaign
                            </Button>
                          </Stack>
                        </Alert>
                      )}
                    </>
                  ) : (
                    <Typography>No shared campaigns saved yet.</Typography>
                  )}
                  <Button
                    disabled={busy || loadingSaves}
                    onClick={() =>
                      run(() => loadSaves(() => session.importSharedSave()))
                    }
                  >
                    Import campaign
                  </Button>
                  <Typography variant="body2">
                    Differing Steam Cloud checkpoints appear as separate copies.
                    Every player must select a speed before a restored match
                    continues.
                  </Typography>
                </Stack>
              )}
            </>
          )}
          {busy && (
            <Typography role="status">Preparing the shared grids…</Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {lobby.lobbyId && <Button onClick={onLeave}>Leave lobby</Button>}
        {(choosing || !lobby.lobbyId) && (
          <Button onClick={onClose}>{choosing ? "Close" : "Back"}</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

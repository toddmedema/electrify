import { useState, useSyncExternalStore } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { MultiplayerSession } from "./Session";

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

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { focusInitialDialogAction } from "../components/base/dialogFocus";
import { crossplayFailure } from "./CrossplayApi";
import type { MultiplayerSession } from "./Session";
import "./Lobby.css";

/** The host's multiplayer saves: resume one with this lobby, or delete it. */
export default function SavesDialog({
  session,
  onClose,
}: {
  session: MultiplayerSession;
  onClose: () => void;
}) {
  const { library, loadingSaves, busy } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
  );
  const [failure, setFailure] = useState<string>();
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<{
    anchor: HTMLElement;
    id: string;
  }>();
  const [loaded, setLoaded] = useState(false);
  const run = (action: () => Promise<unknown>) => {
    setFailure(undefined);
    return action().catch((error) =>
      setFailure(crossplayFailure(error, "Try again.")),
    );
  };
  useEffect(() => {
    // Opening the list syncs Steam Cloud, so a save made on another computer appears.
    void run(() => session.refreshSaves(true)).finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
  const resume = (id: string, name: string) =>
    run(async () => {
      await session.prepareResume(id, name);
      onClose();
    });
  const remove = (id: string) =>
    run(async () => {
      await session.deleteSharedSave(id);
      // The row that held focus is gone; start again from the dialog's first action.
      focusInitialDialogAction(
        document
          .getElementById("multiplayer-saves-title")
          ?.closest<HTMLElement>('[role="dialog"]') ?? null,
        { force: true },
      );
    });
  const showSearch = (library?.slots.length || 0) > 3;
  const query = showSearch ? search.trim().toLocaleLowerCase() : "";
  const saves = library?.slots.filter((slot) =>
    slot.players.join(" ").toLocaleLowerCase().includes(query),
  );
  const loading = loadingSaves && !loaded;
  return (
    <>
      <Dialog
        className="coopLobby"
        open
        fullWidth
        maxWidth="sm"
        onClose={busy ? undefined : onClose}
        aria-labelledby="multiplayer-saves-title"
        slotProps={{
          transition: {
            onEntered: (node: HTMLElement) => {
              // Replace MUI's container autofocus, preserving navigation during the animation.
              focusInitialDialogAction(node);
            },
          },
        }}
      >
        <DialogTitle id="multiplayer-saves-title">
          Multiplayer saves
        </DialogTitle>
        <DialogContent>
          <Stack
            spacing={2}
            sx={{ pt: 1 }}
            className="savedGames coopCampaigns"
          >
            {failure && (
              <Alert severity="warning" onClose={() => setFailure(undefined)}>
                {failure}
              </Alert>
            )}
            {library?.warning && (
              <Alert severity="warning">{library.warning}</Alert>
            )}
            {library?.cloudState === "failed" && (
              <Alert severity="warning">
                Steam Cloud could not sync. Saves on this computer are
                available.
              </Alert>
            )}
            {showSearch && (
              <TextField
                fullWidth
                size="small"
                label="Search saves"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            )}
            {loading && (
              <Stack
                direction="row"
                spacing={1}
                role="status"
                sx={{ alignItems: "center" }}
              >
                <CircularProgress size={20} />
                <Typography>Loading multiplayer saves…</Typography>
              </Stack>
            )}
            {!loading && library && !library.slots.length && (
              <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
                <Typography component="h2" variant="h6">
                  No multiplayer saves yet
                </Typography>
              </Paper>
            )}
            {!!library?.slots.length && !saves?.length && (
              <Typography role="status">No saves match “{search}”.</Typography>
            )}
            {saves?.map((save) => {
              const savedAt = new Date(save.updatedAt);
              const timestamp = savedAt.toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              });
              // Every multiplayer save is named for its scenario, so the players tell them apart.
              const players = save.players.join(", ");
              return (
                <Paper
                  key={save.id}
                  variant="outlined"
                  component="article"
                  className="saveEntry"
                  aria-label={players}
                >
                  <Box className="coopCampaignHeading">
                    <Typography component="h2" variant="h6">
                      {players}
                    </Typography>
                    <IconButton
                      aria-label={`Actions for ${players}`}
                      aria-haspopup="menu"
                      aria-expanded={menu?.id === save.id || undefined}
                      disabled={busy || loadingSaves}
                      onClick={(event) =>
                        setMenu({ anchor: event.currentTarget, id: save.id })
                      }
                    >
                      <MoreVertIcon />
                    </IconButton>
                  </Box>
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
                      onClick={() => void resume(save.id, save.name)}
                    >
                      Load
                    </Button>
                  </Box>
                </Paper>
              );
            })}
            {busy && (
              <CircularProgress size={20} aria-label="Loading multiplayer" />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={onClose}>
            Back
          </Button>
        </DialogActions>
      </Dialog>
      <Menu
        anchorEl={menu?.anchor}
        open={!!menu}
        onClose={() => setMenu(undefined)}
      >
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={() => {
            if (menu) void remove(menu.id);
            setMenu(undefined);
          }}
        >
          Delete
        </MenuItem>
      </Menu>
    </>
  );
}

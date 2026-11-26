import {
  cloneElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { TransitionGroup } from "react-transition-group";
import RemovalCollapse from "../components/base/RemovalCollapse";
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
  const [withdrawalFailure, setWithdrawalFailure] = useState<string>();
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<{
    anchor: HTMLElement;
    id: string;
    name: string;
  }>();
  const [deleting, setDeleting] = useState<{ id: string; name: string }>();
  const [loaded, setLoaded] = useState(false);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const deleteReturn = useRef<HTMLElement>();
  const deleted = useRef(false);
  const exiting = useRef<string>();
  type Campaign = NonNullable<typeof library>["slots"][number];
  const [retained, setRetained] = useState<{ save: Campaign; index: number }>();
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
  const displayedSlots = library?.slots.slice() ?? [];
  if (retained && !displayedSlots.some(({ id }) => id === retained.save.id))
    displayedSlots.splice(retained.index, 0, retained.save);
  const showSearch = displayedSlots.length > 3;
  const query = showSearch ? search.trim().toLocaleLowerCase() : "";
  const saves = displayedSlots.filter((slot) =>
    `${slot.name} ${slot.players.join(" ")}`
      .toLocaleLowerCase()
      .includes(query),
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
            {failure && !deleting && (
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
            {!loading && library && !displayedSlots.length && (
              <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
                <Typography component="h2" variant="h6">
                  No multiplayer saves yet
                </Typography>
              </Paper>
            )}
            {!!displayedSlots.length && !saves.length && (
              <Typography role="status">No saves match “{search}”.</Typography>
            )}
            <TransitionGroup
              component={null}
              childFactory={(
                child: React.ReactElement<
                  React.ComponentProps<typeof RemovalCollapse>
                >,
              ) =>
                cloneElement(child, {
                  animate: child.props.id === exiting.current,
                })
              }
            >
              {saves.map((save) => {
                const savedAt = new Date(save.updatedAt);
                const timestamp = savedAt.toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                });
                return (
                  <RemovalCollapse
                    key={save.id}
                    id={save.id}
                    sx={{ "&&": { marginTop: 0 } }}
                  >
                    <Box sx={{ pt: 2 }}>
                      <Paper
                        variant="outlined"
                        component="article"
                        className="saveEntry"
                        aria-label={save.name}
                      >
                        <Box className="coopCampaignHeading">
                          <Typography component="h2" variant="h6">
                            {save.name}
                          </Typography>
                          <IconButton
                            aria-label={`Actions for ${save.name}`}
                            aria-haspopup="menu"
                            aria-expanded={menu?.id === save.id || undefined}
                            disabled={busy || loadingSaves}
                            onClick={(event) => {
                              deleteReturn.current = event.currentTarget;
                              deleted.current = false;
                              setMenu({
                                anchor: event.currentTarget,
                                id: save.id,
                                name: save.name,
                              });
                            }}
                          >
                            <MoreVertIcon />
                          </IconButton>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          {save.players.join(", ")}
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
                            onClick={() => void resume(save.id, save.name)}
                          >
                            Load save
                          </Button>
                        </Box>
                      </Paper>
                    </Box>
                  </RemovalCollapse>
                );
              })}
            </TransitionGroup>
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
        disableRestoreFocus={!!deleting}
      >
        {session.onlineCampaigns && (
          <MenuItem
            onClick={() => {
              if (menu) void run(() => session.exportSave(menu.id));
              setMenu(undefined);
            }}
          >
            Download confirmed save
          </MenuItem>
        )}
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={() => {
            if (menu) setDeleting({ id: menu.id, name: menu.name });
            setWithdrawalFailure(undefined);
            setMenu(undefined);
          }}
        >
          {session.onlineCampaigns ? "Withdraw from campaign" : "Delete"}
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
            onExited: () => {
              setRetained(undefined);
              if (!deleted.current) {
                deleteReturn.current?.focus();
                return;
              }
              requestAnimationFrame(() =>
                focusInitialDialogAction(
                  document
                    .getElementById("multiplayer-saves-title")
                    ?.closest<HTMLElement>('[role="dialog"]') ?? null,
                  { force: true },
                ),
              );
            },
          },
        }}
      >
        <DialogTitle id="delete-campaign-title">
          {session.onlineCampaigns
            ? "Withdraw from this campaign?"
            : "Delete multiplayer save?"}
        </DialogTitle>
        <DialogContent>
          <Typography
            id="delete-campaign-message"
            sx={{ overflowWrap: "anywhere" }}
          >
            {session.onlineCampaigns
              ? `You will lose access to “${deleting?.name}”. The original roster may be unable to resume without you.`
              : `“${deleting?.name}” will be permanently deleted.`}
          </Typography>
          {withdrawalFailure && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {withdrawalFailure}
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
              if (!deleting) return;
              const index = displayedSlots.findIndex(
                (save) => save.id === deleting.id,
              );
              if (index >= 0)
                setRetained({ save: displayedSlots[index], index });
              void session.deleteSharedSave(deleting.id).then(
                () => {
                  deleted.current = true;
                  exiting.current = deleting.id;
                  setDeleting(undefined);
                },
                (error) => {
                  setRetained(undefined);
                  setWithdrawalFailure(crossplayFailure(error, "Try again."));
                },
              );
            }}
          >
            {loadingSaves
              ? "Working…"
              : session.onlineCampaigns
                ? "Withdraw"
                : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

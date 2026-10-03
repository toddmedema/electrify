import * as React from "react";
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
import { useAppDispatch, useAppSelector } from "../../Store";
import { navigate, navigateBack } from "../../reducers/Card";
import { isResumableStatus, sortSaves } from "../../SaveModel";
import {
  deleteSavedGame,
  exportCurrentSave,
  exportSaveRecovery,
  readSavedGame,
  refreshSavedGames,
  resumeSavedGame,
  retryCurrentSave,
} from "../../SaveSession";
import { SaveMetadata, SavedRunResult, SaveStatus } from "../../Types";
import ScreenHeader from "../base/ScreenHeader";
import RenameSaveDialog from "../base/RenameSaveDialog";
import SavedResultDialog from "../base/SavedResultDialog";
import { savedTime } from "../../helpers/SaveDisplay";
import CloudSaveStatus from "../base/CloudSaveStatus";
import ShareSaveDialog from "../base/ShareSaveDialog";

const STATUS_LABELS: Record<SaveStatus, string> = {
  inProgress: "In progress",
  completed: "Completed",
  bankrupt: "Bankrupt",
  fired: "Fired",
};

export default function SavedGames(): React.JSX.Element {
  const dispatch = useAppDispatch();
  const saves = useAppSelector((state) => state.saves);
  const inGame = useAppSelector((state) => state.game.inGame);
  const [search, setSearch] = React.useState("");
  const [sharing, setSharing] = React.useState<string>();
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [menu, setMenu] = React.useState<{
    anchor: HTMLElement;
    save: SaveMetadata;
  }>();
  const [rename, setRename] = React.useState<{ id: string; name: string }>();
  const [deleting, setDeleting] = React.useState<{
    id: string;
    name: string;
    pending?: boolean;
  }>();
  const [historical, setHistorical] = React.useState<{
    name: string;
    result: SavedRunResult;
  }>();
  const [unavailable, setUnavailable] = React.useState<Record<string, string>>(
    {},
  );
  const deleteCancel = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    void refreshSavedGames();
  }, []);
  const perform = async (
    operation: () => Promise<unknown>,
  ): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      await operation();
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Couldn't complete this action. Please try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const viewResult = (save: SaveMetadata) => {
    void perform(async () => {
      try {
        const record = await readSavedGame(save.id);
        if (!record.result)
          throw new Error("This saved game has no result to view.");
        setHistorical({ name: record.metadata.name, result: record.result });
      } catch (failure) {
        setUnavailable((previous) => ({
          ...previous,
          [save.id]: "Result unavailable",
        }));
        throw failure;
      }
    });
  };
  const loadSave = (save: SaveMetadata) => {
    void perform(async () => {
      await resumeSavedGame(save.id);
      if (save.id === saves.activeId && inGame) focusGameMenu();
    });
  };
  const onBack = () => {
    dispatch(navigateBack());
    window.setTimeout(
      () =>
        document.querySelector<HTMLElement>("[data-saves-trigger]")?.focus(),
      350,
    );
  };
  const focusGameMenu = () => {
    window.setTimeout(
      () => document.querySelector<HTMLElement>(".gameMenuButton")?.focus(),
      350,
    );
  };
  const loadUnsavedGame = () => {
    dispatch(navigate("FACILITIES"));
    focusGameMenu();
  };
  const pending =
    saves.activeId &&
    inGame &&
    !saves.entries.some((entry) => entry.id === saves.activeId);
  const entries = sortSaves(saves.entries);
  const showSearch = entries.length > 3;
  const query = showSearch ? search.trim().toLocaleLowerCase() : "";
  const filtered = entries.filter((entry) =>
    `${entry.name} ${entry.scenarioName}`.toLocaleLowerCase().includes(query),
  );
  return (
    <div className="flexContainer" id="gameCard">
      <ScreenHeader title="Saved games" onBack={onBack} />
      <Box
        className="scrollable"
        sx={{ width: "100%", overflowY: "auto", bgcolor: "var(--bg-sunken)" }}
      >
        <Stack
          spacing={2}
          className="savedGames"
          sx={{
            width: "100%",
            maxWidth: 760,
            mx: "auto",
            p: { xs: 2, sm: 3 },
            boxSizing: "border-box",
            pb: "max(24px, env(safe-area-inset-bottom))",
          }}
        >
          <CloudSaveStatus />
          {showSearch && (
            <TextField
              fullWidth
              size="small"
              label="Search saves"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
          {error && !deleting && (
            <Alert severity="error" role="alert" onClose={() => setError("")}>
              {error}
            </Alert>
          )}
          {saves.error && (
            <Alert
              severity="error"
              action={
                <Button onClick={() => void refreshSavedGames()}>Retry</Button>
              }
            >
              {saves.error}
            </Alert>
          )}
          {saves.saveState === "failed" && !pending && (
            <Alert severity="warning">
              <Typography sx={{ fontWeight: 600 }}>Save failed</Typography>
              <Typography variant="body2">
                {saves.saveError || "Your latest progress hasn't been saved."}
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                sx={{ mt: 1, flexWrap: "wrap" }}
              >
                <Button
                  disabled={busy}
                  onClick={() => void perform(retryCurrentSave)}
                >
                  Retry save
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void perform(exportCurrentSave)}
                >
                  Export current game
                </Button>
              </Stack>
            </Alert>
          )}
          {pending && (
            <Paper
              variant="outlined"
              component="article"
              className="saveEntry"
              aria-label="Unsaved current game"
            >
              <Stack spacing={1}>
                <Typography
                  component="h2"
                  variant="h6"
                  sx={{ overflowWrap: "anywhere" }}
                >
                  {saves.pendingName || "Current game"}
                </Typography>
                <Typography color="warning.main" variant="body2">
                  Unsaved
                </Typography>
                <Typography
                  variant="body2"
                  role={saves.saveState === "failed" ? "alert" : undefined}
                >
                  {saves.saveError ||
                    "Keep this game open while saving is unavailable."}
                </Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <Button variant="contained" onClick={loadUnsavedGame}>
                    Load
                  </Button>
                  <Button
                    onClick={() => void perform(retryCurrentSave)}
                    disabled={busy}
                  >
                    Retry save
                  </Button>
                  <Button
                    onClick={() => void perform(exportCurrentSave)}
                    disabled={busy}
                  >
                    Export current game
                  </Button>
                  <Button
                    color="error"
                    onClick={() => {
                      setError("");
                      setDeleting({
                        id: saves.activeId!,
                        name: saves.pendingName || "Current game",
                        pending: true,
                      });
                    }}
                    disabled={busy}
                  >
                    Discard and leave
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          )}
          {saves.loading && !entries.length && (
            <Stack
              direction="row"
              spacing={1}
              role="status"
              sx={{ alignItems: "center" }}
            >
              <CircularProgress size={20} />
              <Typography>Loading saved games…</Typography>
            </Stack>
          )}
          {!saves.loading && !entries.length && !pending && !saves.error && (
            <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
              <Typography component="h2" variant="h6">
                No saved games yet
              </Typography>
              <Typography color="text.secondary" sx={{ my: 1 }}>
                Games save automatically when you start playing. Sign in to
                restore cloud backups from another device.
              </Typography>
              <Button
                variant="contained"
                onClick={() => dispatch(navigate("NEW_GAME"))}
              >
                Start a new game
              </Button>
            </Paper>
          )}
          {entries.length > 0 && !filtered.length && (
            <Typography role="status">No saves match “{search}”.</Typography>
          )}
          {filtered.map((save) => {
            const current = save.id === saves.activeId && inGame;
            const resumable = isResumableStatus(save.status);
            const timestamp = new Date(save.savedAt).toLocaleString();
            return (
              <Paper
                key={save.id}
                variant="outlined"
                component="article"
                className="saveEntry"
                data-save-id={save.id}
                data-current-save={current || undefined}
                aria-label={save.name}
              >
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    alignItems: "start",
                    columnGap: 1,
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      component="h2"
                      variant="h6"
                      sx={{ fontWeight: 600, overflowWrap: "anywhere" }}
                    >
                      {save.name}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.5 }}
                    >
                      {save.scenarioName} · {save.locationName} ·{" "}
                      {save.difficulty}
                    </Typography>
                  </Box>
                  <IconButton
                    aria-label={`Actions for ${save.name}`}
                    aria-haspopup="menu"
                    aria-expanded={menu?.save.id === save.id ? true : undefined}
                    disabled={busy}
                    onClick={(event) =>
                      setMenu({ anchor: event.currentTarget, save })
                    }
                  >
                    <MoreVertIcon />
                  </IconButton>
                </Box>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  sx={{
                    mt: 1.5,
                    justifyContent: "space-between",
                    alignItems: { xs: "stretch", sm: "center" },
                  }}
                >
                  <Box>
                    <Typography variant="body2">
                      {save.date.month} {save.date.year} ·{" "}
                      <Box
                        component="span"
                        color={resumable ? "text.primary" : "error.main"}
                      >
                        {STATUS_LABELS[save.status]}
                      </Box>
                    </Typography>
                    <Typography
                      component="div"
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 0.5 }}
                    >
                      <time
                        dateTime={save.savedAt}
                        title={timestamp}
                        aria-label={`Saved ${timestamp}`}
                      >
                        {current && saves.saveState === "saving"
                          ? "Saving…"
                          : `Saved ${savedTime(save.savedAt)}`}
                      </time>
                    </Typography>
                    {(saves.unavailable?.[save.id]?.message ||
                      unavailable[save.id]) && (
                      <Typography variant="body2" color="error.main">
                        {saves.unavailable?.[save.id]?.message ||
                          unavailable[save.id]}
                      </Typography>
                    )}
                  </Box>
                  <Button
                    variant="contained"
                    disabled={
                      busy || (!current && !!saves.unavailable?.[save.id])
                    }
                    onClick={() =>
                      resumable ? loadSave(save) : viewResult(save)
                    }
                  >
                    {resumable ? "Load" : "View result"}
                  </Button>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      </Box>
      <Menu
        anchorEl={menu?.anchor}
        open={!!menu}
        onClose={() => setMenu(undefined)}
        disableRestoreFocus={!!deleting || !!rename || !!historical}
      >
        <MenuItem
          onClick={() => {
            setRename(menu?.save);
            setMenu(undefined);
          }}
        >
          Rename
        </MenuItem>
        <MenuItem
          onClick={() => {
            const id = menu?.save.id;
            setMenu(undefined);
            if (id)
              if (saves.unavailable?.[id])
                void perform(() => exportSaveRecovery(id));
              else setSharing(id);
          }}
        >
          {menu && saves.unavailable?.[menu.save.id]
            ? "Download recovery data"
            : "Share"}
        </MenuItem>
        {menu?.save.status === "completed" &&
          !saves.unavailable?.[menu.save.id] && (
            <MenuItem
              onClick={() => {
                const save = menu.save;
                setMenu(undefined);
                viewResult(save);
              }}
            >
              View result
            </MenuItem>
          )}
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={() => {
            setError("");
            setDeleting(menu?.save);
            setMenu(undefined);
          }}
        >
          Delete
        </MenuItem>
      </Menu>
      <RenameSaveDialog save={rename} onClose={() => setRename(undefined)} />
      <ShareSaveDialog id={sharing} onClose={() => setSharing(undefined)} />
      <Dialog
        open={!!deleting}
        onClose={busy ? undefined : () => setDeleting(undefined)}
        fullWidth
        maxWidth="xs"
        aria-labelledby="delete-save-title"
        aria-describedby="delete-save-message"
        slotProps={{
          transition: { onEntered: () => deleteCancel.current?.focus() },
        }}
      >
        <DialogTitle id="delete-save-title">
          {deleting?.pending ? "Discard this game?" : "Delete saved game?"}
        </DialogTitle>
        <DialogContent>
          <Typography
            id="delete-save-message"
            sx={{ overflowWrap: "anywhere" }}
          >
            {deleting?.pending
              ? `“${deleting.name}” has never been saved. Its progress will be permanently discarded.`
              : `“${deleting?.name}” will be permanently deleted.${deleting?.id === saves.activeId ? " This will also close the current game." : ""}`}
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            autoFocus
            ref={deleteCancel}
            disabled={busy}
            onClick={() => setDeleting(undefined)}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            onClick={() => {
              if (deleting)
                void perform(() => deleteSavedGame(deleting.id)).then(
                  (success) => {
                    if (success) setDeleting(undefined);
                  },
                );
            }}
          >
            {busy
              ? "Deleting…"
              : deleting?.pending
                ? "Discard and leave"
                : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
      <SavedResultDialog
        result={historical?.result}
        name={historical?.name}
        onClose={() => setHistorical(undefined)}
      />
    </div>
  );
}

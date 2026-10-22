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
  FormControlLabel,
  Link,
  Paper,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { getDesktop } from "../../Desktop";
import { useDesktopState } from "../../DesktopState";
import { useAppDispatch, useAppSelector } from "../../Store";
import { navigateBack } from "../../reducers/Card";
import { snackbarOpen } from "../../reducers/UI";
import { launchCustomScenario } from "../../reducers/Game";
import { POLICIES } from "../../data/Policies";
import { modIssue, modScenario } from "../../mods/ModScenario";
import type { ModPackage, ModProgramId } from "../../mods/ModSchema";
import type { InstalledMod, ModLibrary, ModRequest } from "../../mods/Types";
import type { DifficultyType } from "../../Types";
import ScreenPage from "../base/ScreenPage";
import DifficultyPicker from "../base/DifficultyPicker";
import { useMenuKeys } from "../base/useMenuKeys";
import { startWithSaveGuard } from "./StartGame";

const FACTOR_LABELS = {
  buildCost: "build cost",
  annualOperatingCost: "running cost",
  yearsToBuild: "build time",
} as const;
const percent = (factor: number) => {
  const change = Math.round((factor - 1) * 100);
  return change === 0
    ? "unchanged"
    : `${change > 0 ? "+" : "−"}${Math.abs(change)}%`;
};
/** "Solar build cost −20% · Efficiency rebates cost −20%" */
export function modifierSummary(pack: ModPackage): string {
  return [
    ...Object.entries(pack.facilities || {}).flatMap(([name, values]) =>
      Object.entries(values || {}).map(
        ([key, factor]) =>
          `${name} ${FACTOR_LABELS[key as keyof typeof FACTOR_LABELS]} ${percent(factor)}`,
      ),
    ),
    ...Object.entries(pack.programs || {}).map(
      ([id, factor]) =>
        `${POLICIES[id as ModProgramId].name} cost ${percent(factor)}`,
    ),
  ].join(" · ");
}
const versionLabel = (version: string) => `v${version.replace(/^v/i, "")}`;
const primarySelector = (key: string) =>
  `[data-mod-key="${CSS.escape(key)}"] [data-mod-primary]`;

/** Installed scenario mods: play them, get more, and share your own. */
export default function Mods(): React.JSX.Element {
  const dispatch = useAppDispatch();
  const coop = useAppSelector((state) => state.ui.coop);
  const chosenDifficulty = useAppSelector(
    (state) => state.ui.previewDifficulty ?? state.game.difficulty,
  );
  const steamOnline = !!useDesktopState()?.steam.online;
  const [library, setLibrary] = React.useState<ModLibrary>({ entries: [] });
  const [loaded, setLoaded] = React.useState(false);
  const [pending, setPending] = React.useState<string>();
  const busy = React.useRef(false);
  const [removing, setRemoving] = React.useState<InstalledMod>();
  const [publishing, setPublishing] = React.useState<InstalledMod>();
  const [playing, setPlaying] = React.useState<InstalledMod>();
  const [difficulty, setDifficulty] =
    React.useState<DifficultyType>(chosenDifficulty);
  const [focusTarget, setFocusTarget] = React.useState<string>();
  const removeCancel = React.useRef<HTMLButtonElement>(null);
  const publishCancel = React.useRef<HTMLButtonElement>(null);
  const autoRefreshed = React.useRef(false);
  const entries = library.entries;
  const issues = React.useMemo(
    () => new Map(entries.map((entry) => [entry.key, modIssue(entry.pack)])),
    [entries],
  );

  // Focus moves once the list has re-rendered, after any closing dialog has let go of it.
  React.useEffect(() => {
    if (!focusTarget) return;
    setFocusTarget(undefined);
    window.setTimeout(
      () => document.querySelector<HTMLElement>(focusTarget)?.focus(),
      0,
    );
  }, [focusTarget]);

  /** One mod request at a time; a repeated click while busy is ignored, never disabled. */
  const request = React.useCallback(
    async (id: string, input: ModRequest): Promise<ModLibrary | undefined> => {
      if (busy.current) return undefined;
      busy.current = true;
      setPending(id);
      try {
        const bridge = getDesktop()?.mods;
        const result: ModLibrary = bridge
          ? await bridge(input)
          : { entries: [], error: "Mods need the Electrify desktop app." };
        setLibrary(result);
        return result;
      } catch {
        const result = {
          entries: [],
          error: "Mods couldn't be loaded. Restart Electrify and try again.",
        };
        setLibrary(result);
        return result;
      } finally {
        busy.current = false;
        setPending(undefined);
        setLoaded(true);
      }
    },
    [],
  );
  const reset = () =>
    void request("reset", { kind: "reset" }).then(
      (result) => result && report(result),
    );
  const report = (result: ModLibrary, quiet = false) => {
    // The shared system has one toast slot: keep warnings and results in the same message.
    const message = [
      result.error,
      result.warning,
      quiet && result.message === "Workshop mods are up to date."
        ? undefined
        : result.message,
    ]
      .filter(Boolean)
      .join(" ");
    if (!message) return;
    const published = result.published;
    const action = result.unreadable
      ? { actionLabel: "Reset mod library", action: reset }
      : published
        ? {
            actionLabel: "Open on Steam",
            action: () =>
              act("browse", {
                kind: "browse",
                workshopId: published.workshopId,
              }),
          }
        : {};
    dispatch(snackbarOpen({ open: true, message, timeout: 10000, ...action }));
  };
  const act = (id: string, input: ModRequest) =>
    void request(id, input).then((result) => result && report(result));

  React.useEffect(() => {
    void request("list", { kind: "list" }).then(
      (result) => result && (result.error ? report(result) : undefined),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  React.useEffect(() => {
    // Pick up finished Workshop downloads whenever the screen opens with Steam running.
    if (!loaded || !steamOnline || autoRefreshed.current) return;
    autoRefreshed.current = true;
    void request("refresh", { kind: "refresh" }).then(
      (result) => result && report(result, true),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, steamOnline, request]);

  const onBack = () => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    dispatch(navigateBack());
    window.setTimeout(
      () => document.querySelector<HTMLElement>("[data-mods-trigger]")?.focus(),
      350,
    );
  };
  const menuKeys = useMenuKeys(true, onBack);

  const importMod = () =>
    void request("import", { kind: "import" }).then((result) => {
      if (!result) return;
      report(result);
      if (result.focusKey) setFocusTarget(primarySelector(result.focusKey));
    });
  const confirmRemove = () => {
    if (!removing) return;
    const index = entries.findIndex((e) => e.key === removing.key);
    const next = entries[index + 1] || entries[index - 1];
    void request(`remove:${removing.key}`, {
      kind: "remove",
      key: removing.key,
    }).then((result) => {
      if (!result) return;
      if (result.error) {
        report(result);
        return;
      }
      setRemoving(undefined);
      report(result);
      setFocusTarget(
        next
          ? primarySelector(next.key)
          : steamOnline
            ? "#mods-browse"
            : "#mods-import",
      );
    });
  };
  const confirmPublish = () => {
    if (!publishing) return;
    void request(`publish:${publishing.key}`, {
      kind: "publish",
      key: publishing.key,
    }).then((result) => {
      if (!result) return;
      if (result.error) {
        report(result);
        return;
      }
      setPublishing(undefined);
      report(result);
    });
  };
  const startPlaying = () => {
    if (!playing) return;
    let scenario;
    try {
      scenario = modScenario(playing.pack, playing.workshopId);
    } catch (error) {
      dispatch(
        snackbarOpen(
          error instanceof Error ? error.message : "This mod can't start.",
        ),
      );
      return;
    }
    setPlaying(undefined);
    startWithSaveGuard(dispatch, () =>
      launchCustomScenario(dispatch, scenario, difficulty),
    );
  };

  const workshopEntries = entries.some((e) => e.source === "workshop");
  const localEntries = entries.filter((e) => e.source === "local");
  const uploading = pending?.startsWith("publish:");
  return (
    <ScreenPage
      className="keyboardMenu"
      id="gameCard"
      {...menuKeys}
      title="Mods"
      onBack={onBack}
    >
      <Box className="scrollable" sx={{ width: "100%", overflowY: "auto" }}>
        <Stack
          spacing={3}
          className="modsScreen"
          sx={{
            width: "100%",
            pt: { xs: 2, sm: 3 },
            boxSizing: "border-box",
            pb: "max(24px, env(safe-area-inset-bottom))",
          }}
        >
          <Typography color="text.secondary">
            Community scenarios with their own rules and events. Modded runs are
            unranked and don&apos;t earn achievements.
          </Typography>
          {coop && (
            <Alert severity="info" role="status">
              Leave co-op to play a modded scenario.
            </Alert>
          )}
          {library.uploading && !uploading && (
            <Alert severity="info" role="status">
              A Workshop upload is in progress.
            </Alert>
          )}
          <Box component="section" aria-labelledby="mods-installed">
            <Typography
              id="mods-installed"
              component="h2"
              variant="overline"
              className="sectionLabel"
            >
              Installed Mods
            </Typography>
            {!loaded && (
              <Stack
                direction="row"
                spacing={1}
                role="status"
                sx={{ alignItems: "center" }}
              >
                <CircularProgress size={20} />
                <Typography>Loading mods…</Typography>
              </Stack>
            )}
            {loaded && !entries.length && !library.unreadable && (
              <Typography color="text.secondary">
                Install your first mod below
              </Typography>
            )}
            <Stack
              component="ul"
              spacing={1.5}
              sx={{ listStyle: "none", m: 0, p: 0 }}
            >
              {entries.map((entry) => {
                const p = entry.pack;
                const issue = issues.get(entry.key);
                const summary = modifierSummary(p);
                const playable = entry.enabled && !issue;
                const offlineWorkshop =
                  entry.source === "workshop" && !steamOnline;
                return (
                  <Paper
                    key={entry.key}
                    component="li"
                    variant="outlined"
                    className="modEntry"
                    data-mod-key={entry.key}
                    aria-labelledby={`mod-title-${entry.key}`}
                  >
                    <Typography
                      id={`mod-title-${entry.key}`}
                      component="h3"
                      variant="h6"
                      sx={{ fontWeight: 600, overflowWrap: "anywhere" }}
                    >
                      {p.title}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ overflowWrap: "anywhere" }}
                    >
                      by {p.creator} · {versionLabel(p.version)} ·{" "}
                      {entry.source === "workshop" ? "Workshop" : "Local file"}
                      {!entry.enabled && " · Disabled"}
                    </Typography>
                    {summary && (
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        {summary}
                      </Typography>
                    )}
                    {issue && (
                      <Alert severity="warning" sx={{ mt: 1 }}>
                        {issue}
                      </Alert>
                    )}
                    {offlineWorkshop && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 0.5 }}
                      >
                        Connect to Steam to unsubscribe. You can disable it now.
                      </Typography>
                    )}
                    <Stack
                      className="settingsKeyboardRow"
                      direction="row"
                      spacing={1}
                      useFlexGap
                      sx={{ mt: 1.5, flexWrap: "wrap", alignItems: "center" }}
                    >
                      {playable && (
                        <Button
                          variant="contained"
                          data-mod-primary
                          aria-label={`Play ${p.title}`}
                          disabled={!!coop}
                          onClick={() => {
                            setDifficulty(chosenDifficulty);
                            setPlaying(entry);
                          }}
                        >
                          Play
                        </Button>
                      )}
                      <FormControlLabel
                        label="Enabled"
                        control={
                          <Switch
                            checked={entry.enabled}
                            slotProps={{
                              input: {
                                "aria-label": `${p.title} enabled`,
                                ...(playable
                                  ? {}
                                  : { "data-mod-primary": true }),
                              } as React.InputHTMLAttributes<HTMLInputElement>,
                            }}
                            onChange={(_, enabled) =>
                              act(`enable:${entry.key}`, {
                                kind: "enable",
                                key: entry.key,
                                enabled,
                              })
                            }
                          />
                        }
                      />
                      {!offlineWorkshop && (
                        <Button
                          aria-label={`${entry.source === "workshop" ? "Unsubscribe from" : "Remove"} ${p.title}`}
                          onClick={() => {
                            setRemoving(entry);
                          }}
                        >
                          {entry.source === "workshop"
                            ? "Unsubscribe"
                            : "Remove"}
                        </Button>
                      )}
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
            {!entries.length && library.unreadable && (
              <Typography color="text.secondary">
                Reset the library to install mods again.
              </Typography>
            )}
            <Stack spacing={1.5} sx={{ mt: 2 }}>
              <Stack
                className="settingsKeyboardRow"
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ flexWrap: "wrap" }}
              >
                <Button
                  id="mods-browse"
                  variant="contained"
                  disabled={!steamOnline}
                  onClick={() => act("browse", { kind: "browse" })}
                >
                  Browse Workshop
                </Button>
                <Button id="mods-import" variant="outlined" onClick={importMod}>
                  {pending === "import" ? "Importing…" : "Import mod"}
                </Button>
                {workshopEntries && (
                  <Button
                    disabled={!steamOnline}
                    onClick={() => act("refresh", { kind: "refresh" })}
                  >
                    {pending === "refresh" ? "Checking…" : "Check for updates"}
                  </Button>
                )}
              </Stack>
              {!steamOnline && (
                <Typography variant="body2" color="text.secondary">
                  Workshop needs Steam. Local mods still work offline.
                </Typography>
              )}
              <Typography variant="body2" color="text.secondary">
                Updates apply to new games. Your saves always keep the version
                they started with.
              </Typography>
            </Stack>
          </Box>

          <Box component="section" aria-labelledby="mods-create">
            <Typography
              id="mods-create"
              component="h2"
              variant="overline"
              className="sectionLabel"
            >
              Create a mod
            </Typography>
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                Save the template, edit it in a text editor, then choose Import
                mod.{" "}
                <Link
                  href="https://github.com/toddmedema/electrify#modding"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Read the modding guide
                </Link>
                .
              </Typography>
              <Stack
                className="settingsKeyboardRow"
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ flexWrap: "wrap" }}
              >
                <Button onClick={() => act("template", { kind: "template" })}>
                  {pending === "template"
                    ? "Saving…"
                    : "Save authoring template"}
                </Button>
                {localEntries.map((entry) => (
                  <Button
                    key={entry.key}
                    disabled={!steamOnline || !!issues.get(entry.key)}
                    onClick={() => {
                      setPublishing(entry);
                    }}
                  >
                    {entry.workshopId
                      ? `Update ${entry.pack.title} on Workshop`
                      : `Publish ${entry.pack.title}`}
                  </Button>
                ))}
              </Stack>
            </Stack>
          </Box>
        </Stack>
      </Box>

      <Dialog
        open={!!playing}
        onClose={() => setPlaying(undefined)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="mod-play-title"
      >
        <DialogTitle id="mod-play-title">
          Play {playing?.pack.title}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Modded run · unranked · no achievements
          </Typography>
          <DifficultyPicker
            variant="toggle"
            value={difficulty}
            onChange={setDifficulty}
            showDescription
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPlaying(undefined)}>Cancel</Button>
          <Button variant="contained" onClick={startPlaying}>
            Start
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!removing}
        onClose={pending ? undefined : () => setRemoving(undefined)}
        fullWidth
        maxWidth="xs"
        aria-labelledby="mod-remove-title"
        aria-describedby="mod-remove-message"
        slotProps={{
          transition: { onEntered: () => removeCancel.current?.focus() },
        }}
      >
        <DialogTitle id="mod-remove-title" sx={{ overflowWrap: "anywhere" }}>
          {removing?.source === "workshop"
            ? `Unsubscribe from “${removing.pack.title}”?`
            : `Remove “${removing?.pack.title}”?`}
        </DialogTitle>
        <DialogContent>
          <Typography id="mod-remove-message">
            {removing?.source === "workshop"
              ? "This unsubscribes on Steam. Existing saves keep working."
              : "Existing saves keep working. Import the file again to reinstall."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            autoFocus
            ref={removeCancel}
            onClick={() => !pending && setRemoving(undefined)}
          >
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={confirmRemove}>
            {pending?.startsWith("remove:")
              ? removing?.source === "workshop"
                ? "Unsubscribing…"
                : "Removing…"
              : removing?.source === "workshop"
                ? "Unsubscribe"
                : "Remove"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!publishing}
        onClose={uploading ? undefined : () => setPublishing(undefined)}
        fullWidth
        maxWidth="xs"
        aria-labelledby="mod-publish-title"
        aria-describedby="mod-publish-message"
        slotProps={{
          transition: { onEntered: () => publishCancel.current?.focus() },
        }}
      >
        <DialogTitle id="mod-publish-title" sx={{ overflowWrap: "anywhere" }}>
          {publishing?.workshopId
            ? `Update “${publishing.pack.title}” on Workshop?`
            : `Publish “${publishing?.pack.title}” to Workshop?`}
        </DialogTitle>
        <DialogContent>
          <Typography id="mod-publish-message">
            {publishing?.workshopId
              ? "This uploads your current file to the existing Workshop item."
              : "This shares the scenario and your creator name publicly on Steam Workshop. Only publish content you have the right to share."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            autoFocus
            ref={publishCancel}
            onClick={() => !uploading && setPublishing(undefined)}
          >
            Cancel
          </Button>
          <Button variant="contained" onClick={confirmPublish}>
            {uploading
              ? "Uploading…"
              : publishing?.workshopId
                ? "Upload update"
                : "Publish publicly"}
          </Button>
        </DialogActions>
      </Dialog>
    </ScreenPage>
  );
}

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
import { delta as uiDelta, snackbarOpen } from "../../reducers/UI";
import { launchCustomScenario } from "../../reducers/Game";
import { POLICIES } from "../../data/Policies";
import {
  modScenario,
  modValidationDiagnostics,
  prepareModStartingPeak,
} from "../../mods/ModScenario";
import {
  modDiagnostics,
  type ModPackage,
  type ModProgramId,
} from "../../mods/ModSchema";
import type {
  InstalledMod,
  ModImportConflict,
  ModLibrary,
  ModRequest,
} from "../../mods/Types";
import { useWorkshopRefresh } from "../../mods/useWorkshopRefresh";
import {
  buildModAuthorReport,
  buildModPublication,
  modPlayerDiagnostics,
} from "../../mods/ModAuthoring";
import CoopModPreview from "./CoopModPreview";
import CoopBrowseBar from "../base/CoopBrowseBar";
import ModDetails, { ModFacts } from "../base/ModDetails";
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
type PeakPreparation = {
  digest: string;
  status: "loading" | "ready" | "error";
  error?: string;
};

/** Installed scenario mods: play them, get more, and share your own. */
export default function Mods(): React.JSX.Element {
  const coop = useAppSelector((state) => state.ui.coop);
  return coop && (coop.role === "guest" || coop.modScenario?.mod) ? (
    <CoopModPreview coop={coop} />
  ) : (
    <ModsLibrary />
  );
}
function ModsLibrary(): React.JSX.Element {
  const dispatch = useAppDispatch();
  const coop = useAppSelector((state) => state.ui.coop);
  const chosenDifficulty = useAppSelector(
    (state) => state.ui.previewDifficulty ?? state.game.difficulty,
  );
  const steam = useDesktopState()?.steam;
  const steamOnline = !!steam?.online;
  const steamAvailable = !!steam?.available;
  const [library, setLibrary] = React.useState<ModLibrary>({ entries: [] });
  const [loaded, setLoaded] = React.useState(false);
  const [pending, setPending] = React.useState<string>();
  const busy = React.useRef(false);
  const generation = React.useRef(0);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [notices, setNotices] = React.useState<
    Record<string, { result: ModLibrary; request: ModRequest }>
  >({});
  const [agreements, setAgreements] = React.useState<string[]>([]);
  const [recoveryDismissed, setRecoveryDismissed] = React.useState(false);
  const [conflict, setConflict] = React.useState<ModImportConflict>();
  const libraryRef = React.useRef(library);
  libraryRef.current = library;
  const [removing, setRemoving] = React.useState<InstalledMod>();
  const [publishing, setPublishing] = React.useState<InstalledMod>();
  const [playing, setPlaying] = React.useState<InstalledMod>();
  const [authoring, setAuthoring] = React.useState<InstalledMod>();
  const [authorDifficulty, setAuthorDifficulty] =
    React.useState<DifficultyType>("Employee");
  const [difficulty, setDifficulty] =
    React.useState<DifficultyType>(chosenDifficulty);
  const [focusTarget, setFocusTarget] = React.useState<string>();
  const removeCancel = React.useRef<HTMLButtonElement>(null);
  const publishCancel = React.useRef<HTMLButtonElement>(null);
  const entries = library.entries;
  const [peakPreparation, setPeakPreparation] = React.useState<
    Record<string, PeakPreparation>
  >({});
  const [peakRetry, setPeakRetry] = React.useState(0);
  const preparationRef = React.useRef(peakPreparation);
  preparationRef.current = peakPreparation;
  const structuralByEntry = React.useMemo(
    () =>
      new Map(entries.map((entry) => [entry.key, modDiagnostics(entry.pack)])),
    [entries],
  );
  const peakReadyByEntry = React.useMemo(
    () =>
      new Map(
        entries.map((entry) => [
          entry.key,
          structuralByEntry
            .get(entry.key)
            ?.some((diagnostic) => diagnostic.severity === "error") ||
            (peakPreparation[entry.key]?.digest ===
              JSON.stringify(entry.pack) &&
              peakPreparation[entry.key]?.status === "ready"),
        ]),
      ),
    [entries, peakPreparation, structuralByEntry],
  );
  React.useEffect(() => {
    let cancelled = false;
    const prepare = async () => {
      for (const entry of entries) {
        const digest = JSON.stringify(entry.pack);
        if (cancelled) return;
        if (
          structuralByEntry
            .get(entry.key)
            ?.some((diagnostic) => diagnostic.severity === "error")
        )
          continue;
        if (
          preparationRef.current[entry.key]?.digest === digest &&
          preparationRef.current[entry.key]?.status === "ready"
        )
          continue;
        setPeakPreparation((previous) => ({
          ...previous,
          [entry.key]: { digest, status: "loading" },
        }));
        try {
          await prepareModStartingPeak(entry.pack);
          if (cancelled) return;
          setPeakPreparation((previous) => ({
            ...previous,
            [entry.key]: { digest, status: "ready" },
          }));
        } catch (error) {
          if (cancelled) return;
          setPeakPreparation((previous) => ({
            ...previous,
            [entry.key]: {
              digest,
              status: "error",
              error:
                error instanceof Error
                  ? error.message
                  : "The scenario data could not be loaded.",
            },
          }));
        }
      }
    };
    void prepare();
    return () => {
      cancelled = true;
    };
  }, [entries, peakRetry, structuralByEntry]);
  const diagnosticsByEntry = React.useMemo(
    () =>
      new Map(
        entries.map((entry) => [
          entry.key,
          peakReadyByEntry.get(entry.key)
            ? modValidationDiagnostics(entry.pack)
            : (structuralByEntry.get(entry.key) ?? []),
        ]),
      ),
    [entries, peakReadyByEntry, structuralByEntry],
  );
  const issues = React.useMemo(
    () =>
      new Map(
        entries.map((entry) => [
          entry.key,
          diagnosticsByEntry
            .get(entry.key)
            ?.filter((d) => d.severity === "error")
            .map((d) => d.message)
            .join("\n") || undefined,
        ]),
      ),
    [entries, diagnosticsByEntry],
  );
  const playingDetails = React.useMemo(() => {
    if (!playing) return undefined;
    try {
      return {
        scenario: modScenario(playing.pack, playing.workshopId, difficulty),
      };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "This mod cannot be resolved.",
      };
    }
  }, [playing, difficulty]);
  const authorReport = React.useMemo(
    () => authoring && buildModAuthorReport(authoring.pack),
    [authoring],
  );
  const authorFacts = React.useMemo(
    () =>
      authorReport && {
        ...authorReport,
        sections: [
          ...(authorReport.difficulties[authorDifficulty]?.sections ?? []),
          // Inherited JSON and aggregate validity belong to the whole package.
          ...authorReport.sections.filter((section) =>
            ["inherited", "difficulties"].includes(section.id),
          ),
        ],
      },
    [authorReport, authorDifficulty],
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

  /** Mutations are serialized; listing and opening Steam remain available during uploads. */
  const request = React.useCallback(
    async (id: string, input: ModRequest): Promise<ModLibrary | undefined> => {
      const independent = input.kind === "list" || input.kind === "browse";
      if (!independent && busy.current) return undefined;
      const startedWhileBusy = busy.current;
      if (!independent) {
        generation.current++;
        busy.current = true;
        setPending(id);
      }
      const requestGeneration = generation.current;
      const category =
        input.kind === "refresh" || input.kind === "subscribe"
          ? "workshop"
          : input.kind === "import" || input.kind === "resolveImport"
            ? "import"
            : input.kind === "list" || input.kind === "reset"
              ? "library"
              : input.kind;
      try {
        const bridge = getDesktop()?.mods;
        const result: ModLibrary = bridge
          ? await bridge(input)
          : {
              ...libraryRef.current,
              error: "Mods need the Electrify desktop app.",
            };
        if (!mounted.current) return result;
        // A read-only response cannot overwrite a newer mutation or dismiss its actions.
        const fresh =
          !independent ||
          (!startedWhileBusy &&
            !busy.current &&
            requestGeneration === generation.current);
        if (fresh)
          setLibrary((previous) => ({
            ...result,
            ...(result.downloads === undefined &&
            input.kind !== "reset" &&
            previous.downloads
              ? { downloads: previous.downloads }
              : {}),
          }));
        const failed =
          result.error ||
          result.warning ||
          result.unreadable ||
          result.diagnostics?.length;
        setNotices((previous) => {
          const next = { ...previous };
          const key = result.unreadable ? "library" : category;
          if (failed) next[key] = { result, request: input };
          else if (fresh) delete next[key];
          return next;
        });
        if (result.agreements && fresh) setAgreements(result.agreements);
        else if (result.published?.agreement)
          setAgreements((previous) =>
            Array.from(new Set([...previous, result.published!.workshopId])),
          );
        if (result.importConflict) setConflict(result.importConflict);
        return result;
      } catch {
        const result = {
          ...libraryRef.current,
          error: "Mods couldn't be loaded. Check the connection and Retry.",
        };
        if (mounted.current) {
          setNotices((previous) => ({
            ...previous,
            [category]: { result, request: input },
          }));
        }
        return result;
      } finally {
        if (!independent) busy.current = false;
        if (mounted.current) {
          if (!independent) setPending(undefined);
          setLoaded(true);
        }
      }
    },
    [],
  );
  const refresh = React.useCallback(
    () => request("refresh", { kind: "refresh" }),
    [request],
  );
  const canRefresh = React.useCallback(() => !busy.current, []);
  const downloads = useWorkshopRefresh(
    loaded && steamOnline && !library.unreadable,
    refresh,
    canRefresh,
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
  const resolveImport = (action: "update" | "copy" | "cancel") => {
    if (!conflict) return;
    void request("resolveImport", {
      kind: "resolveImport",
      token: conflict.token,
      action,
    }).then((result) => {
      if (!result) return;
      report(result);
      if (!result.error) setConflict(undefined);
      if (result.focusKey) setFocusTarget(primarySelector(result.focusKey));
    });
  };
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
    let publication;
    try {
      publication = buildModPublication(publishing.pack);
    } catch (error) {
      dispatch(
        snackbarOpen(
          error instanceof Error
            ? error.message
            : "This mod cannot be published.",
        ),
      );
      return;
    }
    void request(`publish:${publishing.key}`, {
      kind: "publish",
      key: publishing.key,
      packageDigest: publication.packageDigest,
      rulesDescription: publication.description,
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
      scenario = modScenario(playing.pack, playing.workshopId, difficulty);
    } catch (error) {
      dispatch(
        snackbarOpen(
          error instanceof Error ? error.message : "This mod can't start.",
        ),
      );
      return;
    }
    setPlaying(undefined);
    if (coop?.role === "host") {
      dispatch(
        uiDelta({
          previewDifficulty: difficulty,
          coop: { ...coop, modScenario: scenario },
        }),
      );
      return;
    }
    startWithSaveGuard(dispatch, () =>
      launchCustomScenario(dispatch, scenario, difficulty),
    );
  };

  const localEntries = entries.filter((e) => e.source === "local");
  const uploading = pending?.startsWith("publish:");
  return (
    <ScreenPage
      className="keyboardMenu"
      id="gameCard"
      {...menuKeys}
      title={coop ? "Community scenarios" : "Mods"}
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
          <CoopBrowseBar coop={coop} />
          <Typography color="text.secondary">
            Community scenarios with their own rules and events. Modded runs are
            unranked and don&apos;t earn achievements.
          </Typography>
          {Object.entries(notices).map(
            ([key, { result, request: retryRequest }]) => (
              <Alert
                key={key}
                severity={result.error ? "error" : "warning"}
                onClose={() =>
                  setNotices((previous) => {
                    const next = { ...previous };
                    delete next[key];
                    return next;
                  })
                }
                sx={{ overflowWrap: "anywhere" }}
              >
                {[result.error, result.warning].filter(Boolean).join(" ")}
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  className="settingsKeyboardRow"
                  sx={{ flexWrap: "wrap", mt: 1 }}
                >
                  {result.unreadable ? (
                    <Button disabled={!!pending} onClick={reset}>
                      Reset mod library
                    </Button>
                  ) : (
                    <Button
                      disabled={
                        !!pending ||
                        (retryRequest.kind === "refresh" &&
                          !downloads.available)
                      }
                      onClick={() =>
                        retryRequest.kind === "refresh"
                          ? downloads.check()
                          : act(
                              "retry",
                              retryRequest.kind === "resolveImport"
                                ? { kind: "import" }
                                : retryRequest,
                            )
                      }
                    >
                      Retry
                    </Button>
                  )}
                </Stack>
              </Alert>
            ),
          )}
          {library.recovered && !recoveryDismissed && (
            <Alert
              severity="warning"
              onClose={() => setRecoveryDismissed(true)}
            >
              Recovered the previous mod library. Your healthy mods and
              publication records were kept.
            </Alert>
          )}
          {agreements.map((workshopId) => (
            <Alert
              key={workshopId}
              severity="warning"
              onClose={
                pending
                  ? undefined
                  : () =>
                      act("dismissAgreement", {
                        kind: "dismissAgreement",
                        workshopId,
                      })
              }
            >
              Accept the Steam Workshop agreement to make your upload visible.
              <Box className="settingsKeyboardRow">
                <Button
                  onClick={() => act("browse", { kind: "browse", workshopId })}
                >
                  Open on Steam
                </Button>
              </Box>
            </Alert>
          ))}
          {downloads.timedOut && (
            <Alert severity="warning">
              Steam is still downloading after two minutes. Check your
              connection, then retry.
              <Box className="settingsKeyboardRow">
                <Button
                  disabled={!steamOnline || !!pending}
                  onClick={downloads.check}
                >
                  Retry downloads
                </Button>
              </Box>
            </Alert>
          )}
          {library.downloads
            ?.filter((item) => item.status !== "skipped")
            .map((item) => (
              <Typography key={item.id} role="status">
                Workshop item {item.id}:{" "}
                {item.status === "queued" ? "Queued" : "Downloading…"}
              </Typography>
            ))}
          {Object.values(notices)
            .flatMap((notice) => notice.result.diagnostics || [])
            .map((diagnostic, index) => (
              <Alert
                key={`${diagnostic.path}:${index}`}
                severity={diagnostic.severity}
              >
                <strong>{diagnostic.path}</strong>:{" "}
                <span>{diagnostic.message}</span>
              </Alert>
            ))}
          {coop && (
            <Alert severity="info" role="status">
              Choose an enabled scenario for everyone. Friends receive its rules
              automatically.
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
            {loaded &&
              !entries.length &&
              !library.unreadable &&
              !Object.values(notices).some((notice) => notice.result.error) && (
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
                const diagnostics = modPlayerDiagnostics(
                  diagnosticsByEntry.get(entry.key) || [],
                );
                const summary = modifierSummary(p);
                const peakReady = peakReadyByEntry.get(entry.key);
                const preparation = peakPreparation[entry.key];
                const preparationError =
                  preparation?.digest === JSON.stringify(p) &&
                  preparation.status === "error"
                    ? preparation.error
                    : undefined;
                const playable = entry.enabled && !issue && peakReady;
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
                    {!peakReady &&
                      (preparationError ? (
                        <Alert severity="error" sx={{ mt: 1 }}>
                          {preparationError}
                          <Box className="settingsKeyboardRow">
                            <Button
                              onClick={() => setPeakRetry((value) => value + 1)}
                            >
                              Retry preparation
                            </Button>
                          </Box>
                        </Alert>
                      ) : (
                        <Stack
                          direction="row"
                          spacing={1}
                          role="status"
                          sx={{ mt: 1, alignItems: "center" }}
                        >
                          <CircularProgress size={20} />
                          <Typography>Preparing scenario…</Typography>
                        </Stack>
                      ))}
                    {diagnostics.map((diagnostic, index) => (
                      <Alert
                        key={`${diagnostic.path}:${index}`}
                        severity={diagnostic.severity}
                        sx={{ mt: 1 }}
                      >
                        <strong>{diagnostic.path}</strong>:{" "}
                        <span>{diagnostic.message}</span>
                      </Alert>
                    ))}
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
                          onClick={() => {
                            setDifficulty(chosenDifficulty);
                            setPlaying(entry);
                          }}
                        >
                          {coop ? "Choose" : "Play"}
                        </Button>
                      )}
                      {entry.source === "local" && (
                        <Button
                          disabled={!peakReady && !preparationError}
                          aria-label={`Author validation report for ${p.title}`}
                          onClick={() => {
                            setAuthorDifficulty("Employee");
                            setAuthoring(entry);
                          }}
                        >
                          Author report
                        </Button>
                      )}
                      <FormControlLabel
                        label="Enabled"
                        control={
                          <Switch
                            checked={entry.enabled}
                            disabled={!!pending}
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
                          disabled={!!pending}
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
                <Button
                  id="mods-import"
                  variant="outlined"
                  disabled={!!pending || library.unreadable}
                  onClick={importMod}
                >
                  {pending === "import" ? "Importing…" : "Import mod"}
                </Button>
                {steamAvailable && (
                  <Button
                    disabled={
                      !!pending || !downloads.available || library.unreadable
                    }
                    onClick={downloads.check}
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
                <Button
                  disabled={!!pending}
                  onClick={() => act("template", { kind: "template" })}
                >
                  {pending === "template"
                    ? "Saving…"
                    : "Save authoring template"}
                </Button>
                {localEntries.map((entry) => (
                  <Button
                    key={entry.key}
                    disabled={
                      !steamOnline ||
                      !!pending ||
                      library.uploading ||
                      !!issues.get(entry.key) ||
                      !peakReadyByEntry.get(entry.key)
                    }
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
        open={!!conflict}
        onClose={() => resolveImport("cancel")}
        fullWidth
        maxWidth="sm"
        aria-labelledby="mod-import-title"
      >
        <DialogTitle id="mod-import-title">
          A mod with this ID is already installed
        </DialogTitle>
        <DialogContent>
          <Typography>
            Review the title, creator and version before replacing it.
          </Typography>
          {conflict && (
            <Stack spacing={2} sx={{ mt: 2, overflowWrap: "anywhere" }}>
              <Box>
                <Typography component="h3">Installed</Typography>
                <Typography>
                  {conflict.existing.title} · by {conflict.existing.creator} ·{" "}
                  {versionLabel(conflict.existing.version)}
                </Typography>
              </Box>
              <Box>
                <Typography component="h3">Imported file</Typography>
                <Typography>
                  {conflict.incoming.title} · by {conflict.incoming.creator} ·{" "}
                  {versionLabel(conflict.incoming.version)}
                </Typography>
              </Box>
              <Typography variant="body2">
                Update keeps its enabled state and Workshop identity. A copy
                gets a new ID and has no publication identity.
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button
            autoFocus
            disabled={!!pending}
            onClick={() => resolveImport("cancel")}
          >
            Cancel
          </Button>
          <Button disabled={!!pending} onClick={() => resolveImport("copy")}>
            Install as copy
          </Button>
          <Button
            disabled={!!pending}
            variant="contained"
            onClick={() => resolveImport("update")}
          >
            Update
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!playing}
        onClose={() => setPlaying(undefined)}
        fullWidth
        maxWidth="md"
        aria-labelledby="mod-play-title"
        slotProps={{
          paper: {
            sx: {
              m: { xs: 1.5, sm: 4 },
              width: { xs: "calc(100% - 24px)", sm: "calc(100% - 64px)" },
              maxHeight: "calc(100dvh - 24px)",
              overflowWrap: "anywhere",
              "& .MuiButton-root, & .MuiToggleButton-root": { minHeight: 44 },
            },
          },
        }}
      >
        <DialogTitle id="mod-play-title">
          Play {playing?.pack.title}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Modded run · unranked · no achievements
          </Typography>
          <Box className="difficultyPicker">
            <DifficultyPicker
              variant="toggle"
              value={difficulty}
              onChange={setDifficulty}
              showDescription
            />
          </Box>
          <Box sx={{ mt: 2 }}>
            {playing && playingDetails?.scenario && (
              <ModDetails
                scenario={playingDetails.scenario}
                objectiveIntent={
                  playing.pack.objectives === undefined ? "inherit" : "replace"
                }
                diagnostics={diagnosticsByEntry.get(playing.key)}
              />
            )}
            {playingDetails?.error && (
              <Alert severity="error">{playingDetails.error}</Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPlaying(undefined)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={startPlaying}
            disabled={!playingDetails?.scenario}
          >
            {coop ? "Choose for everyone" : "Start"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!authoring}
        onClose={() => setAuthoring(undefined)}
        fullWidth
        maxWidth="md"
        aria-labelledby="mod-author-report-title"
        slotProps={{
          paper: {
            sx: {
              m: { xs: 1.5, sm: 4 },
              width: { xs: "calc(100% - 24px)", sm: "calc(100% - 64px)" },
              maxHeight: "calc(100dvh - 24px)",
              overflowWrap: "anywhere",
              "& .MuiButton-root, & .MuiToggleButton-root": { minHeight: 44 },
            },
          },
        }}
      >
        <DialogTitle id="mod-author-report-title">
          Author validation report: {authoring?.pack.title}
        </DialogTitle>
        <DialogContent>
          <Alert
            severity={authorReport?.valid ? "info" : "error"}
            sx={{ mb: 2 }}
          >
            {authorReport?.valid
              ? "Validation passed."
              : "Fix the validation errors below."}{" "}
            Includes hidden events.
          </Alert>
          <Box
            className="difficultyPicker"
            sx={{
              mb: 2,
              "& .MuiToggleButtonGroup-root .MuiToggleButton-root": {
                flex: "1 1 auto",
                whiteSpace: "nowrap",
              },
            }}
          >
            <Typography
              component="h3"
              variant="subtitle1"
              sx={{ fontWeight: 600, mb: 1 }}
            >
              Inspect difficulty
            </Typography>
            <DifficultyPicker
              variant="toggle"
              value={authorDifficulty}
              onChange={setAuthorDifficulty}
            />
          </Box>
          {authorReport && !authorReport.difficulties[authorDifficulty] && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              This difficulty could not be compiled. Review the validation
              issues.
            </Alert>
          )}
          {authorFacts && <ModFacts facts={authorFacts} author />}
        </DialogContent>
        <DialogActions>
          <Button
            autoFocus
            variant="contained"
            onClick={() => setAuthoring(undefined)}
          >
            Close report
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
            disabled={!!pending}
            onClick={() => !pending && setRemoving(undefined)}
          >
            Cancel
          </Button>
          <Button
            disabled={!!pending}
            color="error"
            variant="contained"
            onClick={confirmRemove}
          >
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
        onClose={() => setPublishing(undefined)}
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
            onClick={() => setPublishing(undefined)}
          >
            {uploading ? "Close" : "Cancel"}
          </Button>
          <Button
            disabled={!!pending}
            variant="contained"
            onClick={confirmPublish}
          >
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

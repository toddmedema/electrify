import React from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Switch,
  FormControlLabel,
  TextField,
  Typography,
} from "@mui/material";
import { getDesktop } from "../../Desktop";
import { useAppDispatch, useAppSelector } from "../../Store";
import { modScenario } from "../../mods/Packages";
import type { InstalledMod, ModRequest } from "../../mods/Types";
import manifest from "../../data/RunCompatibility.json";
import { startWithSaveGuard } from "../views/StartGame";
import { delta, quit, start } from "../../reducers/Game";

export default function ModManager() {
  const dispatch = useAppDispatch();
  const coop = useAppSelector((state) => state.ui.coop);
  const [entries, setEntries] = React.useState<InstalledMod[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [id, setId] = React.useState("");
  const [publish, setPublish] = React.useState<InstalledMod>();
  const request = React.useCallback(async (input: ModRequest) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await getDesktop()?.mods?.(input);
      if (!result)
        throw new Error("Mod management is unavailable in this app version.");
      setEntries(result.entries);
      setMessage(result.message || "");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not complete the mod action.",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  React.useEffect(() => {
    void request({ kind: "list" });
  }, [request]);
  const play = (entry: InstalledMod) => {
    try {
      const scenario = modScenario(entry.pack);
      startWithSaveGuard(dispatch, () => {
        dispatch(quit());
        dispatch(delta({ scenarioId: 999, customScenario: scenario }));
        dispatch(start(999));
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start this mod.");
    }
  };
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography>
        Play community scenarios offline with their own rules, events, facility
        costs and program costs. Modded runs are unranked and do not earn
        achievements. Each save keeps its original mod version.
      </Typography>
      {coop && (
        <Alert severity="info">Leave co-op to launch a modded scenario.</Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {message && <Alert severity="success">{message}</Alert>}
      <Stack
        className="settingsKeyboardRow"
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ flexWrap: "wrap" }}
      >
        <Button
          variant={entries.length ? "outlined" : "contained"}
          disabled={busy}
          onClick={() => void request({ kind: "import" })}
        >
          Import mod
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void request({ kind: "template", rules: manifest.compatibilityId })
          }
        >
          Save authoring template
        </Button>
        <Button
          disabled={busy}
          onClick={() => void request({ kind: "refresh" })}
        >
          Refresh downloads
        </Button>
      </Stack>
      <Stack
        className="settingsKeyboardRow"
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ flexWrap: "wrap" }}
      >
        <TextField
          label="Workshop item ID"
          value={id}
          onChange={(e) => setId(e.target.value)}
          size="small"
          slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 20 } }}
        />
        <Button
          disabled={busy || !/^[1-9][0-9]{0,19}$/.test(id)}
          onClick={() => void request({ kind: "subscribe", id })}
        >
          Subscribe
        </Button>
      </Stack>
      <Typography variant="body2">
        Importing the same local package ID replaces it for future launches.
        Refresh installs completed Steam updates. Disable hides a mod from play;
        remove unsubscribes Workshop downloads. Existing saves remain playable.
      </Typography>
      {!entries.length && !busy && (
        <Typography>
          No mods installed. Import a JSON package or subscribe to a Workshop
          item.
        </Typography>
      )}
      {entries.map((entry) => {
        let issue = "";
        try {
          modScenario(entry.pack);
        } catch (e) {
          issue = e instanceof Error ? e.message : "Incompatible content";
        }
        const p = entry.pack;
        return (
          <Box
            key={entry.key}
            sx={{
              borderTop: 1,
              borderColor: "divider",
              pt: 2,
              overflowWrap: "anywhere",
            }}
          >
            <Typography variant="h6">{p.title}</Typography>
            <Typography>
              {p.creator} · Version {p.version} · Seed {p.seed}
            </Typography>
            <Typography variant="body2">Rules: {p.rules}</Typography>
            <Typography variant="body2">
              {issue || "Compatible with this version"} ·{" "}
              {entry.source === "local"
                ? "Local package"
                : `Workshop ${entry.workshopId}`}
            </Typography>
            {!!p.facilities && (
              <Typography variant="body2">
                Facility modifiers:{" "}
                {Object.entries(p.facilities)
                  .map(
                    ([name, values]) =>
                      `${name} (${Object.entries(values)
                        .map(
                          ([key, value]) =>
                            `${({ buildCost: "build cost", annualOperatingCost: "annual running cost", yearsToBuild: "build time" } as Record<string, string>)[key]} ×${value}`,
                        )
                        .join(", ")})`,
                  )
                  .join("; ")}
              </Typography>
            )}
            {!!p.programs && (
              <Typography variant="body2">
                Program cost modifiers:{" "}
                {Object.entries(p.programs)
                  .map(([name, value]) => `${name} ×${value}`)
                  .join("; ")}
              </Typography>
            )}
            <Stack
              className="settingsKeyboardRow"
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: "wrap", alignItems: "center" }}
            >
              <Button
                variant="contained"
                disabled={busy || !entry.enabled || !!issue || !!coop}
                onClick={() => play(entry)}
              >
                Play {p.title}
              </Button>
              <FormControlLabel
                label="Enabled"
                control={
                  <Switch
                    checked={entry.enabled}
                    disabled={busy}
                    onChange={(_, enabled) =>
                      void request({ kind: "enable", key: entry.key, enabled })
                    }
                  />
                }
              />
              {entry.source === "local" && (
                <Button
                  disabled={busy || !!issue}
                  onClick={() => setPublish(entry)}
                >
                  {entry.workshopId
                    ? "Update Workshop item"
                    : "Publish to Workshop"}
                </Button>
              )}
              <Button
                disabled={busy}
                onClick={() => void request({ kind: "remove", key: entry.key })}
              >
                {entry.source === "workshop"
                  ? "Unsubscribe and remove"
                  : "Remove"}
              </Button>
            </Stack>
          </Box>
        );
      })}
      <Dialog open={!!publish} onClose={() => setPublish(undefined)}>
        <DialogTitle>Publish {publish?.pack.title}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This uploads the package to Steam Workshop publicly, including the
            creator name and scenario data. Only publish content you have the
            right to share. Steam may require you to accept its Workshop legal
            agreement.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPublish(undefined)}>Cancel</Button>
          <Button
            onClick={() => {
              if (publish) void request({ kind: "publish", key: publish.key });
              setPublish(undefined);
            }}
          >
            Publish publicly
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

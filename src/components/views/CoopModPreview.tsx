import { useState } from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import type { CoopSelectionType, ScenarioType } from "../../Types";
import { useAppDispatch } from "../../Store";
import { delta as uiDelta } from "../../reducers/UI";
import { navigateBack } from "../../reducers/Card";
import { coopControls } from "../../multiplayer/Registry";
import { modBrowseSummary } from "../../multiplayer/ModBrowse";
import { getScenario } from "../../data/Scenarios";
import { getDesktop } from "../../Desktop";
import { useDesktopState } from "../../DesktopState";
import { MONTHS, difficultyLabel } from "../../Constants";
import ScreenPage from "../base/ScreenPage";
import CoopBrowseBar, { CoopStartButton } from "../base/CoopBrowseBar";
import ModDetails from "../base/ModDetails";
import { useMenuKeys } from "../base/useMenuKeys";

/** Optional, explicit Workshop subscription; a shared session never calls it on its own. */
export function KeepModCopy({ scenario }: { scenario: ScenarioType }) {
  const id = scenario.mod?.source.workshopId;
  const online = useDesktopState()?.steam?.online;
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  if (!id)
    return (
      <Typography variant="body2" color="text.secondary">
        This is the host&apos;s local mod.
      </Typography>
    );
  return (
    <Box>
      <Button
        disabled={!online || pending}
        onClick={() => {
          setPending(true);
          void getDesktop()
            ?.mods?.({ kind: "subscribe", id })
            .then((result) => {
              setMessage(
                result.error ||
                  result.message ||
                  "Subscribed on Steam Workshop.",
              );
            })
            .catch((error) =>
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Couldn't subscribe. Try again.",
              ),
            )
            .finally(() => setPending(false));
        }}
      >
        {pending ? "Subscribing…" : "Keep a copy from Workshop"}
      </Button>
      {message && (
        <Typography role="status" variant="body2">
          {message}
        </Typography>
      )}
      {!online && (
        <Typography variant="body2" color="text.secondary">
          Connect to Steam to keep a copy.
        </Typography>
      )}
    </Box>
  );
}

/** Both peers read these facts from the same frozen snapshot before the shared match starts. */
export default function CoopModPreview({ coop }: { coop: CoopSelectionType }) {
  const dispatch = useAppDispatch();
  const scenario = coop.modScenario?.mod ? coop.modScenario : undefined;
  const summary = scenario ? modBrowseSummary(scenario) : coop.modSummary;
  const host = coop.role === "host";
  const back = () => {
    if (!host) coopControls()?.back();
    else {
      dispatch(uiDelta({ coop: { ...coop, modScenario: undefined } }));
      dispatch(navigateBack());
    }
  };
  const date = (month: number) =>
    `${MONTHS[month % 12]} ${(summary?.startingYear ?? 2020) + Math.floor(month / 12)}`;
  const menuKeys = useMenuKeys(false, back);
  return (
    <ScreenPage
      {...menuKeys}
      className="keyboardMenu"
      id="gameCard"
      title={summary?.title ?? "Community scenarios"}
      onBack={back}
    >
      <Box className="scrollable" sx={{ width: "100%", overflowY: "auto" }}>
        <Stack
          className="modsScreen coopModPreview"
          spacing={2}
          sx={{ width: "100%", pt: 2, pb: 3, overflowWrap: "anywhere" }}
        >
          <CoopBrowseBar coop={coop} />
          {!summary ? (
            <Typography role="status">
              Waiting for {coop.hostName} to choose a community scenario…
            </Typography>
          ) : (
            <>
              <Typography component="h2" variant="h5">
                {summary.title}
              </Typography>
              <Typography color="text.secondary">
                By {summary.creator} · v{summary.version.replace(/^v/i, "")}
              </Typography>
              <Alert severity="info">Modded · Unranked · No achievements</Alert>
              <CoopStartButton
                coop={coop}
                disabled={!scenario}
                onStart={() => {
                  if (scenario)
                    coopControls()?.start({
                      scenarioId: 999,
                      difficulty: summary.difficulty,
                      customScenario: scenario,
                    });
                }}
              />
              {host && (
                <Button
                  onClick={() =>
                    dispatch(
                      uiDelta({ coop: { ...coop, modScenario: undefined } }),
                    )
                  }
                >
                  Choose another community scenario
                </Button>
              )}
              {coop.receivingScenario && (
                <Typography role="status">Receiving scenario…</Typography>
              )}
              {scenario ? (
                <ModDetails scenario={scenario} />
              ) : (
                <>
                  <Typography>
                    Based on{" "}
                    {getScenario(summary.baseScenarioId)?.name ?? "Custom game"}{" "}
                    · {summary.durationMonths} months ·{" "}
                    {difficultyLabel(summary.difficulty)}
                  </Typography>
                  <Typography color="text.secondary">
                    {date(0)}–{date(summary.durationMonths - 1)}
                  </Typography>
                  <Box component="section" aria-label="Scenario objectives">
                    <Typography component="h3" variant="h6">
                      Objectives
                    </Typography>
                    {!summary.objectives.length && (
                      <Typography>
                        No scenario goals. Reach the final month; ordinary game
                        failures still apply.
                      </Typography>
                    )}
                    {summary.objectives.map((goal) => (
                      <Box key={goal.id} sx={{ mt: 1.5 }}>
                        <Typography component="h4" variant="subtitle2">
                          {goal.label}
                          {!goal.required && " · Optional"}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {goal.definition}
                        </Typography>
                        <Typography variant="body2">
                          {goal.target} · {goal.window}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </>
              )}
              {!host && scenario && <KeepModCopy scenario={scenario} />}
            </>
          )}
        </Stack>
      </Box>
    </ScreenPage>
  );
}

import { Button, Stack, Typography } from "@mui/material";
import ScreenPage from "../base/ScreenPage";
import { store, useAppSelector } from "../../Store";
import { parseChallengeUrl } from "../../helpers/Challenge";
import { expandAuthoredRunReference } from "../../helpers/RunIdentity";
import { getHistoryApi, logEvent } from "../../Globals";
import { scenarioDetailsUrl, scenarioListUrl } from "../../ScenarioUrl";
import { navigate } from "../../reducers/Card";
import { delta as uiDelta } from "../../reducers/UI";
import { launchRun } from "../../reducers/GameActions";
import { selectContinueSave } from "../../SaveModel";
import { resumeSavedGame } from "../../SaveSession";
import { startWithSaveGuard } from "./StartGame";
import NewGameDetails from "./NewGameDetails";

export default function ChallengeLanding() {
  const href = useAppSelector((s) => s.ui.challengeHref);
  const game = useAppSelector((s) => s.game);
  const route = parseChallengeUrl(href || window.location.href);
  const invitation = route?.invitation;
  const saved = useAppSelector((state) =>
    selectContinueSave(state.saves.entries),
  );
  const leave = () => {
    getHistoryApi().replaceState(null, "", scenarioListUrl());
    store.dispatch(navigate({ name: "NEW_GAME", skipBrowserHistory: true }));
  };
  const continueGame = () => {
    getHistoryApi().replaceState(null, "", scenarioListUrl());
    if (game.inGame) store.dispatch(navigate("FACILITIES"));
    else if (saved) void resumeSavedGame(saved.id);
  };
  if (!invitation)
    return (
      <ScreenPage title="Challenge unavailable" onBack={leave}>
        <Stack
          className="scrollable"
          spacing={2}
          sx={{ py: 2, alignItems: "flex-start" }}
        >
          <Typography role="status">
            {route?.error || "This challenge could not be opened."}
          </Typography>
          <Button
            variant="contained"
            onClick={() => {
              if (route?.scenarioId !== undefined) {
                getHistoryApi().replaceState(
                  null,
                  "",
                  scenarioDetailsUrl(route.scenarioId),
                );
                store.dispatch(uiDelta({ scenarioPreview: route.scenarioId }));
                store.dispatch(
                  navigate({
                    name: "NEW_GAME_DETAILS",
                    skipBrowserHistory: true,
                  }),
                );
              } else leave();
            }}
          >
            {" "}
            {route?.scenarioId !== undefined
              ? "Open current mission"
              : "Choose a mission"}
          </Button>
          {(saved || game.inGame) && (
            <Button onClick={continueGame}>Continue saved game</Button>
          )}
          {route?.scenarioId !== undefined && (
            <Button onClick={leave}>Back to missions</Button>
          )}
        </Stack>
      </ScreenPage>
    );
  return (
    <NewGameDetails
      key={href}
      game={{
        ...game,
        scenarioId: invitation.run.scenarioId,
        customScenario: undefined,
        difficulty: invitation.run.difficulty,
      }}
      challenge={invitation}
      onContinue={saved || game.inGame ? continueGame : undefined}
      onBack={leave}
      onDelta={() => undefined}
      onWatchReplay={() => undefined}
      onReplayError={() => undefined}
      onStart={() =>
        startWithSaveGuard(store.dispatch, () => {
          const identity = expandAuthoredRunReference(invitation.run);
          if (!identity) return;
          logEvent("challenge_accept", { scenarioId: identity.scenarioId });
          getHistoryApi().replaceState(null, "", scenarioListUrl());
          store.dispatch(launchRun({ identity, challenge: invitation }));
        })
      }
    />
  );
}

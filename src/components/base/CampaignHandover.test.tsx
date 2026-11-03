import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { store } from "../../Store";
import { loaded, quit, resume } from "../../reducers/Game";
import { dialogClose, dialogOpen } from "../../reducers/UI";
import { sessionChanged } from "../../SaveLibrary";
import { createGame } from "../../testing/Simulator";
import { LegacyCampaignTermType } from "../../Types";
import { LEGACY_SCENARIOS } from "../../data/LegacyCampaign";
import { scenarioObjectiveDefinitions } from "../../helpers/ObjectiveRules";
import CampaignHandover from "./CampaignHandover";
import CampaignHandoverContainer from "./CampaignHandoverContainer";
import { selectNextTermObjectives } from "./CampaignHandoverContainer";
import { closingCompany } from "../../testing/LegacyCampaignProtocolFixtures";
import gameReducer, { continueLegacyCampaign } from "../../reducers/Game";

const nextObjectives = scenarioObjectiveDefinitions(LEGACY_SCENARIOS[1]);

jest.mock("../../SaveSession", () => ({
  saveSessionMiddleware:
    () => (next: (action: unknown) => unknown) => (action: unknown) =>
      next(action),
  quitSavedGame: jest.fn(),
}));

afterEach(() => {
  store.dispatch(dialogClose());
  store.dispatch(sessionChanged({ transitioning: false }));
  store.dispatch(quit());
});

const term: LegacyCampaignTermType = {
  generationIndex: 0,
  scenarioId: 117,
  openingCustomers: 100,
  referenceRate: 0.24,
  peakMW: 0.07,
  northCapacityMW: 0,
  debtAllowance: 10000,
  emissionsBudgetTonnes: 1000,
  inheritedDemandMultiplier: 1,
  closingCash: 4200,
  closingCustomers: 135,
  closingDebt: 8100,
  objectiveProgress: {
    version: 1,
    rulesDigest: "test",
    retentionBaseline: 100,
    completedMonths: 240,
    entries: [],
    checksum: "test",
  },
  objectiveResults: [
    {
      id: "retain-customers",
      metric: "customerRetention",
      label: "Retain 90% of opening customers",
      required: true,
      definition:
        "Customers kept, as a share of your recorded customer baseline.",
      status: "completed",
      target: 0.9,
      observed: 0.97,
      observedMonths: 1,
      requiredMonths: 1,
      objective: {
        id: "retain-customers",
        label: "Retain 90% of opening customers",
        metric: "customerRetention",
        minRetainedShare: 0.9,
        deadlineMonth: 239,
        required: true,
      },
    },
  ],
  debrief: {
    startingFleet: [],
    finalFleet: [],
    startingCash: 12000,
    finalCash: 4200,
    finalCustomers: 135,
    reliability: 0.998,
    unservedWh: 10000,
    kgco2e: 1000,
    highlights: [],
  },
};

it("shows concise term results and requires an explicit handover", async () => {
  const onContinue = jest.fn();
  const onExit = jest.fn();
  render(
    <CampaignHandover
      term={term}
      nextObjectives={nextObjectives}
      onContinue={onContinue}
      onExit={onExit}
    />,
  );
  expect(screen.getByRole("dialog", { name: "Term 1 complete" })).toBeVisible();
  expect(screen.queryByText("First Light (1882–1901)")).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Met" })).toBeVisible();
  expect(
    within(screen.getByRole("list", { name: "Term results" })).getByText(
      "Retain 90% of customers",
    ),
  ).toBeVisible();
  expect(screen.queryByText("Objectives")).not.toBeInTheDocument();
  expect(screen.queryByText("Your successor inherits")).not.toBeInTheDocument();
  expect(screen.queryByText("Demand served")).not.toBeInTheDocument();
  expect(screen.queryByText("Demand not met")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", {
      name: "Next: Beyond the Dynamo (1902–1921)",
    }),
  ).toBeVisible();
  expect(
    screen.getByRole("list", { name: "Next term goals" }),
  ).toHaveTextContent("Reach ≥600 customers");
  expect(
    within(screen.getByRole("list", { name: "Next term goals" })).getAllByRole(
      "listitem",
    ),
  ).toHaveLength(2);
  expect(
    screen.getByRole("list", { name: "Next term goals" }),
  ).not.toHaveTextContent("Retain");
  expect(screen.getAllByRole("img", { name: "Met" })).toHaveLength(1);
  await userEvent.keyboard("{Escape}");
  expect(onContinue).not.toHaveBeenCalled();
  expect(onExit).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Begin next term" }),
  );
  expect(onContinue).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));
  expect(onExit).toHaveBeenCalledTimes(1);
});

it("does not mark an unmet goal as completed", () => {
  render(
    <CampaignHandover
      term={{
        ...term,
        objectiveResults: [{ ...term.objectiveResults[0], status: "failed" }],
      }}
      nextObjectives={nextObjectives}
      onContinue={jest.fn()}
      onExit={jest.fn()}
    />,
  );
  expect(screen.getByRole("img", { name: "Failed" })).toBeVisible();
  expect(screen.queryByRole("img", { name: "Met" })).not.toBeInTheDocument();
});

it("previews the exact inherited next-term goals without advancing or mutating the company", () => {
  const game = { ...closingCompany(), inGame: true };
  const before = JSON.stringify(game);
  const state = { ...store.getState(), game };
  const preview = selectNextTermObjectives(state);
  const next = gameReducer(game, continueLegacyCampaign());
  expect(preview).toEqual(
    scenarioObjectiveDefinitions(LEGACY_SCENARIOS[1], next),
  );
  expect(preview[0]).toMatchObject({ metric: "customerCount" });
  expect(JSON.stringify(game)).toBe(before);
  expect(selectNextTermObjectives(state)).toBe(preview);
  expect(
    selectNextTermObjectives({ ...state, game: { ...game, inGame: false } }),
  ).toEqual([]);
});

it("yields to the save recovery dialog and returns after recovery closes", () => {
  const game = createGame({ scenarioId: 117, seed: 611 });
  store.dispatch(
    resume({
      ...game,
      campaign: {
        ...game.campaign!,
        pendingHandover: true,
        completedTerms: [term],
      },
    }),
  );
  store.dispatch(loaded());
  render(
    <Provider store={store}>
      <CampaignHandoverContainer />
    </Provider>,
  );
  expect(screen.getByRole("dialog", { name: "Term 1 complete" })).toBeVisible();
  act(() => {
    store.dispatch(sessionChanged({ transitioning: true }));
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  act(() => {
    store.dispatch(
      dialogOpen({
        open: true,
        title: "Save failed",
        message: "Retry saving before leaving this company.",
      }),
    );
    store.dispatch(sessionChanged({ transitioning: false }));
  });
  expect(store.getState().ui.dialog.title).toBe("Save failed");
  expect(
    screen.queryByRole("dialog", { name: "Term 1 complete" }),
  ).not.toBeInTheDocument();
  act(() => {
    store.dispatch(dialogClose());
  });
  expect(screen.getByRole("dialog", { name: "Term 1 complete" })).toBeVisible();
});

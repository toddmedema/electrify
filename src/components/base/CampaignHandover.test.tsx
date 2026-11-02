import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { store } from "../../Store";
import { loaded, quit, resume } from "../../reducers/Game";
import { dialogClose, dialogOpen } from "../../reducers/UI";
import { sessionChanged } from "../../SaveLibrary";
import { createGame } from "../../testing/Simulator";
import { LegacyCampaignTermType } from "../../Types";
import CampaignHandover from "./CampaignHandover";
import CampaignHandoverContainer from "./CampaignHandoverContainer";

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
  objectiveResults: [],
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

it("reviews the real inherited company and requires an explicit handover", async () => {
  const onContinue = jest.fn();
  const onExit = jest.fn();
  render(
    <CampaignHandover
      term={term}
      facilityCount={3}
      onContinue={onContinue}
      onExit={onExit}
    />,
  );
  expect(
    screen.getByRole("dialog", { name: "Generation 1 complete" }),
  ).toBeVisible();
  expect(
    screen.getByRole("region", { name: "Your successor inherits" }),
  ).toHaveTextContent("3 facilities");
  expect(
    screen.getByRole("region", { name: "Your successor inherits" }),
  ).toHaveTextContent("$8.1k");
  expect(
    screen.getByRole("region", { name: "Mission results" }),
  ).toHaveTextContent("135");
  expect(
    screen.getByRole("heading", { name: "Next: Beyond the Dynamo" }),
  ).toBeVisible();
  await userEvent.keyboard("{Escape}");
  expect(onContinue).not.toHaveBeenCalled();
  expect(onExit).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Begin next CEO term" }),
  );
  expect(onContinue).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Save and exit" }));
  expect(onExit).toHaveBeenCalledTimes(1);
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
  expect(
    screen.getByRole("dialog", { name: "Generation 1 complete" }),
  ).toBeVisible();
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
    screen.queryByRole("dialog", { name: "Generation 1 complete" }),
  ).not.toBeInTheDocument();
  act(() => {
    store.dispatch(dialogClose());
  });
  expect(
    screen.getByRole("dialog", { name: "Generation 1 complete" }),
  ).toBeVisible();
});

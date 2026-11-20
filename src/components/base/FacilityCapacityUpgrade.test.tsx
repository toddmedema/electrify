import * as React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import cloneDeep from "lodash.clonedeep";
import { ThemeProvider, createTheme } from "@mui/material";
import { createGame } from "../../testing/Simulator";
import { currentTick } from "../../helpers/GameSelectors";
import { facilityExpansionQuote } from "../../helpers/FacilityExpansion";
import { getBuildFacilityQuote } from "../../data/Facilities";
import * as facilities from "../../data/Facilities";
import { GameType, isStorage } from "../../Types";
import reducer, { buildFacility } from "../../reducers/Game";
import { expandFacility } from "../../reducers/GameActions";
import type {
  FacilityExpansionRequestResult,
  FacilityExpansionCancellationResult,
} from "../../helpers/RequestFacilityExpansion";
import FacilityCapacityUpgrade from "./FacilityCapacityUpgrade";

function ready(storage = false) {
  let game = createGame({ scenarioId: storage ? 100 : 104, seed: 818 });
  currentTick(game)!.cash = 1e12;
  if (storage) {
    const quote = getBuildFacilityQuote(game, {
      name: "Battery",
      peakWh: 10e6,
    })!;
    game = cloneDeep(
      reducer(game, buildFacility({ facility: quote, financed: false })),
    );
    const battery = game.facilities.find(isStorage)!;
    battery.yearsToBuildLeft = 0;
    return { game, facility: battery };
  }
  return { game, facility: game.facilities[0] };
}
function show(storage = false) {
  const setup = ready(storage);
  const onExpand = jest.fn(
    async (): Promise<FacilityExpansionRequestResult> => ({
      status: "accepted",
    }),
  );
  const onCancelExpansion = jest.fn(
    async (): Promise<FacilityExpansionCancellationResult> => ({
      status: "accepted" as const,
      refund: 123,
    }),
  );
  const theme = createTheme({
    components: { MuiButtonBase: { defaultProps: { disableRipple: true } } },
  });
  const content = (game: GameType) => (
    <ThemeProvider theme={theme}>
      <FacilityCapacityUpgrade
        game={game}
        facility={game.facilities.find(({ id }) => id === setup.facility.id)!}
        onExpand={onExpand}
        onCancelExpansion={onCancelExpansion}
      />
    </ThemeProvider>
  );
  const view = render(content(setup.game));
  return {
    ...setup,
    onExpand,
    onCancelExpansion,
    rerender: (game: GameType) => view.rerender(content(game)),
  };
}
function open() {
  fireEvent.click(screen.getByRole("button", { name: "Upgrade capacity" }));
  return screen.getByRole("dialog");
}

it("does not price catalogues while the upgrade review is closed or its clock advances", () => {
  const quote = jest.spyOn(facilities, "getBuildFacilityQuote");
  try {
    const view = show();
    expect(quote).not.toHaveBeenCalled();
    const later = cloneDeep(view.game);
    later.date.minute += 1;
    view.rerender(later);
    expect(
      screen.getByRole("button", { name: "Upgrade capacity" }),
    ).toBeEnabled();
    expect(quote).not.toHaveBeenCalled();
    open();
    expect(quote).toHaveBeenCalled();
  } finally {
    quote.mockRestore();
  }
});

it("keeps physical limits and retrofit availability visible without pricing a closed review", () => {
  const view = show();
  const retrofit = cloneDeep(view.game);
  retrofit.facilities[0].upgradeInProgress = {
    upgrade: "coldWeatherPackage",
    cost: 1e6,
    startsMinute: 0,
    completesMinute: 100,
  };
  view.rerender(retrofit);
  expect(
    screen.getByRole("button", { name: "Upgrade capacity" }),
  ).toBeDisabled();
  expect(screen.getByText("Finish the existing retrofit first.")).toBeVisible();
  const capped = cloneDeep(view.game);
  capped.facilities[0].peakW = 6e9;
  view.rerender(capped);
  expect(
    screen.getByRole("button", { name: "Upgrade capacity" }),
  ).toBeDisabled();
  expect(
    screen.getByText("This capacity exceeds the technology or site limit."),
  ).toBeVisible();
});

it.each([false, true])(
  "reviews exact added capacity and sends only canonical identities (storage=%s)",
  async (storage) => {
    const view = show(storage);
    const dialog = open();
    const size = view.facility.peakWh ?? view.facility.peakW;
    const targetSize = size * 1.12345;
    fireEvent.change(
      within(dialog).getByRole("spinbutton", {
        name: `New capacity (${storage ? "MWh" : "MW"})`,
      }),
      { target: { value: String(targetSize / 1e6) } },
    );
    const quote = facilityExpansionQuote(
      view.game,
      view.facility.id,
      targetSize,
    );
    expect(quote.status).toBe("ready");
    expect(dialog).toHaveTextContent("Added capital cost");
    expect(dialog).toHaveTextContent("Cash remaining");
    expect(dialog).toHaveTextContent("Current capacity keeps operating");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Pay / }));
    expect(view.onExpand).toHaveBeenCalledWith({
      facilityId: view.facility.id,
      targetSize,
      quoteKey: quote.status === "ready" ? quote.quoteKey : "",
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("region", { name: "Capacity upgrade" }),
    ).toHaveFocus();
  },
);

it("uses the authoritative maximum and rejects empty, shrinking and over-limit targets", () => {
  const view = show();
  const dialog = open();
  const input = within(dialog).getByRole("spinbutton");
  const quote = facilityExpansionQuote(
    view.game,
    view.facility.id,
    view.facility.peakW + 1,
  );
  expect(quote.status).toBe("ready");
  fireEvent.click(within(dialog).getByRole("button", { name: "Use maximum" }));
  expect(input).toHaveValue(quote.maxSize! / 1e6);
  expect(within(dialog).getByRole("button", { name: /^Pay / })).toBeEnabled();
  for (const value of [
    "",
    String(view.facility.peakW / 1e6),
    String(quote.maxSize! / 1e6 + 1),
  ]) {
    fireEvent.change(input, { target: { value } });
    const confirm = within(dialog).getByRole("button", {
      name: "Upgrade capacity",
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
  }
  expect(view.onExpand).not.toHaveBeenCalled();
});

it("rejects an unaffordable target after cash changes during review", () => {
  const view = show();
  const dialog = open();
  const poorer = cloneDeep(view.game);
  currentTick(poorer)!.cash = 0;
  view.rerender(poorer);
  expect(within(dialog).getByRole("button", { name: /^Pay / })).toBeDisabled();
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "more cash needed",
  );
  expect(view.onExpand).not.toHaveBeenCalled();
});

it("requires explicit review when the quote changes while open", () => {
  const view = show();
  const dialog = open();
  const nextMonth = cloneDeep(view.game);
  nextMonth.date.month = nextMonth.date.month === "Jan" ? "Feb" : "Jan";
  view.rerender(nextMonth);
  expect(within(dialog).getByRole("button", { name: /^Pay / })).toBeDisabled();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Review updated quote" }),
  );
  expect(within(dialog).getByRole("button", { name: /^Pay / })).toBeEnabled();
});

it("locks dismissal and duplicate submission until the host responds, keeping rejections reviewable", async () => {
  const view = show();
  let resolve!: (value: FacilityExpansionRequestResult) => void;
  view.onExpand.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const dialog = open();
  const pay = within(dialog).getByRole("button", { name: /^Pay / });
  fireEvent.click(pay);
  fireEvent.click(pay);
  expect(view.onExpand).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole("spinbutton")).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  await userEvent.keyboard("{Escape}");
  expect(dialog).toBeInTheDocument();
  await act(async () =>
    resolve({ status: "rejected", message: "Host rejected the stale quote." }),
  );
  expect(dialog).toBeInTheDocument();
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "Host rejected the stale quote",
  );
  expect(within(dialog).getByRole("button", { name: /^Pay / })).toBeDisabled();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Review updated quote" }),
  );
  expect(within(dialog).getByRole("button", { name: /^Pay / })).toBeEnabled();
});

it("closes on Escape and restores focus to the offer", async () => {
  show();
  const offer = screen.getByRole("button", { name: "Upgrade capacity" });
  expect(
    screen.queryByRole("heading", { name: "Capacity upgrade" }),
  ).not.toBeInTheDocument();
  act(() => offer.focus());
  open();
  await userEvent.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(offer).toHaveFocus();
});

it("shows expansion progress and confirms the refund before canceling", async () => {
  const view = show();
  const quote = facilityExpansionQuote(
    view.game,
    view.facility.id,
    view.facility.peakW * 1.2,
  );
  if (quote.status !== "ready") throw new Error(quote.reason);
  const started = cloneDeep(
    reducer(
      view.game,
      expandFacility({
        facilityId: view.facility.id,
        targetSize: quote.targetSize,
        quoteKey: quote.quoteKey,
      }),
    ),
  );
  started.facilities[0].expansionInProgress!.yearsToBuildLeft *= 0.5;
  // A scheduled closure must not hide the option to cancel work already paid for.
  started.facilities[0].permanentShutdownMonth = 1;
  view.rerender(started);
  expect(
    screen.getByRole("progressbar", { name: "Capacity upgrade construction" }),
  ).toHaveAttribute("aria-valuenow", "50");
  expect(
    screen.getByRole("region", { name: "Capacity upgrade" }),
  ).toHaveTextContent("Only the added capacity is under construction");
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel capacity upgrade" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("full refund");
  expect(view.onCancelExpansion).not.toHaveBeenCalled();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Cancel upgrade" }),
  );
  expect(view.onCancelExpansion).toHaveBeenCalledWith(
    view.facility.id,
    quote.quoteKey,
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("status")).toHaveTextContent("refunded");
});

it("keeps cancellation locked until the host distinguishes completion from a refund", async () => {
  const view = show();
  const quote = facilityExpansionQuote(
    view.game,
    view.facility.id,
    view.facility.peakW * 1.2,
  );
  if (quote.status !== "ready") throw new Error(quote.reason);
  const started = cloneDeep(
    reducer(
      view.game,
      expandFacility({
        facilityId: view.facility.id,
        targetSize: quote.targetSize,
        quoteKey: quote.quoteKey,
      }),
    ),
  );
  view.rerender(started);
  let resolve!: (result: FacilityExpansionCancellationResult) => void;
  view.onCancelExpansion.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel capacity upgrade" }),
  );
  const dialog = screen.getByRole("dialog");
  const confirm = within(dialog).getByRole("button", {
    name: "Cancel upgrade",
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(view.onCancelExpansion).toHaveBeenCalledTimes(1);
  expect(
    within(dialog).getByRole("button", { name: "Keep building" }),
  ).toBeDisabled();
  await userEvent.keyboard("{Escape}");
  expect(dialog).toBeInTheDocument();
  await act(async () =>
    resolve({
      status: "completed",
      message: "The upgrade already completed; no refund was issued.",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("status")).toHaveTextContent("no refund was issued");
});

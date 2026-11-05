import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import cloneDeep from "lodash.clonedeep";
import { createGame } from "../../testing/Simulator";
import { getTimeFromTimeline, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { retrofitCost } from "../../helpers/Hazards";
import { FacilityOperatingType } from "../../Types";
import FacilityContextMenu from "./FacilityContextMenu";

it("requotes the original upgrade targets and blocks confirmation when cash falls", async () => {
  const user = userEvent.setup({ delay: null });
  const game = createGame({ scenarioId: 107 });
  game.facilities = game.facilities.slice(0, 2).map(
    (f) =>
      ({
        ...f,
        name: "Gas",
        fuel: "Natural Gas",
        resilience: undefined,
      }) as FacilityOperatingType,
  );
  const cost = retrofitCost(game.facilities[0], game, "coldWeatherPackage")!;
  getTimeFromTimeline(game.date.minute, game.timeline)!.cash = 1e12;
  const onRetrofit = jest.fn();
  const props = {
    game,
    target: { ids: game.facilities.map((f) => f.id), top: 100, left: 100 },
    onClose: jest.fn(),
    onSell: jest.fn(),
    onTogglePause: jest.fn(),
    onPause: jest.fn(),
    onRetrofit,
  };
  const { rerender } = render(<FacilityContextMenu {...props} />);
  await user.click(
    screen.getByRole("menuitem", { name: /^Add cold-weather package \(2\)/ }),
  );
  let next = cloneDeep(game);
  getTimeFromTimeline(next.date.minute, next.timeline)!.cash = cost - 1;
  rerender(<FacilityContextMenu {...props} game={next} target={null} />);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("button", { name: /^Pay / })).toBeDisabled();
  expect(onRetrofit).not.toHaveBeenCalled();
  // A retired original target disappears; a newly built plant must never join the purchase.
  next = cloneDeep(next);
  next.facilities.splice(1, 1, { ...next.facilities[0], id: 999 });
  getTimeFromTimeline(next.date.minute, next.timeline)!.cash = 1e12;
  rerender(<FacilityContextMenu {...props} game={next} target={null} />);
  await user.click(within(dialog).getByRole("button", { name: /^Pay / }));
  expect(onRetrofit.mock.calls).toEqual([
    [{ facilityId: game.facilities[0].id, upgrade: "coldWeatherPackage" }],
  ]);
});

it("does not turn a completed construction cancellation into a facility sale", async () => {
  const user = userEvent.setup({ delay: null });
  const game = createGame({ scenarioId: 100 });
  game.facilities[0].yearsToBuildLeft = 1;
  const props = {
    game,
    target: { ids: [game.facilities[0].id], top: 100, left: 100 },
    onClose: jest.fn(),
    onSell: jest.fn(),
    onTogglePause: jest.fn(),
    onPause: jest.fn(),
  };
  const { rerender } = render(<FacilityContextMenu {...props} />);
  await user.click(
    screen.getByRole("menuitem", { name: "Cancel construction" }),
  );
  const next = cloneDeep(game);
  next.facilities[0].yearsToBuildLeft = 0;
  rerender(<FacilityContextMenu {...props} game={next} target={null} />);
  expect(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Cancel construction",
    }),
  ).toBeDisabled();
  expect(props.onSell).not.toHaveBeenCalled();
});

it("explains staged winterization without promising a full outage", async () => {
  const user = userEvent.setup({ delay: null });
  const game = createGame({ scenarioId: 107 });
  const facility = game.facilities.find(
    (f) => retrofitCost(f, game, "coldWeatherPackage") !== undefined,
  )!;
  getTimeFromTimeline(game.date.minute, game.timeline)!.cash = 1e12;
  const props = {
    game,
    target: { ids: [facility.id], top: 100, left: 100 },
    onClose: jest.fn(),
    onSell: jest.fn(),
    onTogglePause: jest.fn(),
    onPause: jest.fn(),
    onRetrofit: jest.fn(),
  };
  render(<FacilityContextMenu {...props} />);
  await user.click(
    screen.getByRole("menuitem", { name: /^Add cold-weather package/ }),
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent(
    "Staged installation keeps 90% of capacity available for a month.",
  );
  expect(dialog).not.toHaveTextContent(/offline/i);
});

it("bulk sale excludes retained assets", async () => {
  const user = userEvent.setup({ delay: null });
  const game = cloneDeep(createGame({ scenarioId: 100 }));
  game.facilities[0].saleRestricted = true;
  const onSell = jest.fn();
  render(
    <FacilityContextMenu
      game={game}
      target={{
        ids: game.facilities.map((facility) => facility.id),
        top: 100,
        left: 100,
      }}
      onClose={jest.fn()}
      onSell={onSell}
      onTogglePause={jest.fn()}
      onPause={jest.fn()}
    />,
  );
  await user.click(screen.getByRole("menuitem", { name: "Sell (1)" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Sell" }),
  );
  expect(onSell.mock.calls).toEqual([[game.facilities[1].id]]);
});

it("offers no context menu for a permanently shut retained reactor", () => {
  const game = createGame({ scenarioId: 126 });
  const unit = game.facilities.find(
    (facility) => facility.startingAssetId === "chernobyl-unit-4",
  )!;
  game.date.minute = 3 * MINUTES_PER_MONTH;
  unit.paused = true;
  render(
    <FacilityContextMenu
      game={game}
      target={{ ids: [unit.id], top: 100, left: 100 }}
      onClose={jest.fn()}
      onSell={jest.fn()}
      onTogglePause={jest.fn()}
      onPause={jest.fn()}
      onRetrofit={jest.fn()}
      onCancelRetrofit={jest.fn()}
    />,
  );
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("leaves shutdown assets out of mixed bulk resume and upgrade targets", async () => {
  const user = userEvent.setup({ delay: null });
  const game = createGame({ scenarioId: 107 });
  game.facilities = game.facilities.slice(0, 2).map(
    (facility) =>
      ({
        ...facility,
        name: "Gas",
        fuel: "Natural Gas",
        resilience: undefined,
        paused: true,
      }) as FacilityOperatingType,
  );
  game.facilities[0].permanentShutdownMonth = 1;
  game.facilities[0].saleRestricted = true;
  getTimeFromTimeline(game.date.minute, game.timeline)!.cash = 1e12;
  const props = {
    game,
    target: {
      ids: game.facilities.map((facility) => facility.id),
      top: 100,
      left: 100,
    },
    onClose: jest.fn(),
    onSell: jest.fn(),
    onTogglePause: jest.fn(),
    onPause: jest.fn(),
    onRetrofit: jest.fn(),
  };
  const { rerender } = render(<FacilityContextMenu {...props} />);
  await user.click(screen.getByRole("menuitem", { name: "Resume (1)" }));
  expect(props.onTogglePause.mock.calls).toEqual([[game.facilities[1].id]]);
  rerender(<FacilityContextMenu {...props} />);
  await user.click(
    screen.getByRole("menuitem", { name: /^Add cold-weather package \(1\)/ }),
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: /^Pay / }),
  );
  expect(props.onRetrofit.mock.calls).toEqual([
    [{ facilityId: game.facilities[1].id, upgrade: "coldWeatherPackage" }],
  ]);
});

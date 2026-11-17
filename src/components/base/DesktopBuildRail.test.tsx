import * as React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import DesktopBuildRail from "./DesktopBuildRail";
import { GameToolMemoryContext } from "./GameToolMemory";
import { createGame } from "../../testing/Simulator";
import { currentTick } from "../../helpers/GameSelectors";
import { projectCatalogue } from "../../helpers/ProjectBuild";
import { isStorage, type TerritoryTileId } from "../../Types";
import { hasVisibleEscapeOverlay } from "./VisibleEscapeOverlay";
import { projectSiteQuote, selectProject } from "../../helpers/ProjectBuild";
import { formatMoneyConcise } from "../../helpers/Format";

jest.mock("./BuildForecast", () => ({ useBuildForecast: () => undefined }));
jest.mock("./ManualLink", () => (props: { children?: React.ReactNode }) => (
  <>{props.children}</>
));

function show(siteId?: TerritoryTileId) {
  const game = createGame({ scenarioId: 116, seed: 188 });
  game.startingYear = 2025;
  game.date.year = 2025;
  currentTick(game)!.cash = 1e12;
  const memory = new Map<string, unknown>();
  const onProject = jest.fn();
  const content = (busy = false, focusRequest = 0) => (
    <GameToolMemoryContext.Provider value={memory}>
      <DesktopBuildRail
        game={game}
        siteId={siteId}
        busy={busy}
        focusRequest={focusRequest}
        onProject={onProject}
      />
    </GameToolMemoryContext.Provider>
  );
  const utils = render(content());
  return {
    game,
    memory,
    onProject,
    ...utils,
    update: (busy = false, focusRequest = 0) =>
      utils.rerender(content(busy, focusRequest)),
  };
}
const wind = () =>
  screen.getByRole("button", { name: "Choose sites for Wind" });

it("keeps every current catalogue technology discoverable with its canonical icon", () => {
  const { game } = show();
  const rail = screen.getByRole("complementary", { name: "Build facilities" });
  const expected = [
    ...projectCatalogue(game, 2e6, false),
    ...projectCatalogue(game, 1e8, true),
  ];
  for (const option of expected) {
    const button = within(rail).getByRole("button", {
      name: `Choose sites for ${option.name}`,
    });
    expect(within(button).getByRole("presentation")).toHaveAttribute(
      "src",
      `/images/${option.name.toLowerCase()}.svg`,
    );
  }
  expect(
    screen.queryByLabelText(/technology preview$/),
  ).not.toBeInTheDocument();
});

it("opens just one full expanded card on hover without spending or stealing focus", () => {
  const { game, onProject } = show();
  const before = JSON.stringify(game);
  const button = wind();
  fireEvent.mouseEnter(button);
  const preview = screen.getByLabelText("Wind technology preview");
  expect(within(preview).getByText("Build cost")).toBeInTheDocument();
  expect(within(preview).getByText("Accounting lifetime")).toBeInTheDocument();
  expect(
    within(preview).queryByRole("button", {
      name: /Review purchase|Show.*details/,
    }),
  ).not.toBeInTheDocument();
  expect(button).not.toHaveFocus();
  fireEvent.mouseEnter(
    screen.getByRole("button", { name: "Choose sites for Battery" }),
  );
  expect(
    screen.queryByLabelText("Wind technology preview"),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByLabelText("Battery technology preview")).getByText(
      "Discharge power",
    ),
  ).toBeInTheDocument();
  expect(onProject).not.toHaveBeenCalled();
  expect(JSON.stringify(game)).toBe(before);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("uses independent remembered power and energy sliders without changing an already chosen project", () => {
  const { memory, onProject } = show();
  fireEvent.click(screen.getByRole("button", { name: /Generator power:/ }));
  fireEvent.change(screen.getByRole("slider", { name: "Generator capacity" }), {
    target: { value: "12" },
  });
  expect(memory.get("project.generatorSize")).toBe(12);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(wind());
  expect(onProject.mock.calls[0][0].peakW).toBe(4e7);
  fireEvent.click(screen.getByRole("button", { name: /Storage energy:/ }));
  fireEvent.change(screen.getByRole("slider", { name: "Storage capacity" }), {
    target: { value: "22" },
  });
  expect(memory.get("project.storageSize")).toBe(22);
  expect(memory.get("project.generatorSize")).toBe(12);
  expect(onProject).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Choose sites for Battery" }),
  );
  expect(isStorage(onProject.mock.calls[1][0])).toBe(true);
  expect(onProject.mock.calls[1][0].peakWh).toBe(5e8);
});

it("allows preview focus and consumes Escape before the map, then restores icon focus", () => {
  show();
  act(() => wind().focus());
  const preview = screen.getByLabelText("Wind technology preview");
  const choose = within(preview).getByRole("button", { name: "Choose sites" });
  act(() => choose.focus());
  expect(preview).toBeInTheDocument();
  const mapEscape = jest.fn();
  const mapCapture = () => {
    if (!hasVisibleEscapeOverlay()) mapEscape();
  };
  window.addEventListener("keydown", mapCapture, true);
  fireEvent.keyDown(choose, { key: "Escape" });
  expect(
    screen.queryByLabelText("Wind technology preview"),
  ).not.toBeInTheDocument();
  expect(wind()).toHaveFocus();
  expect(mapEscape).not.toHaveBeenCalled();
  window.removeEventListener("keydown", mapCapture, true);
});

it("dismisses on outside activation and scrolling, and guards all rail actions during host work", () => {
  const { update, onProject } = show();
  fireEvent.mouseEnter(wind());
  fireEvent.pointerDown(document.body);
  expect(
    screen.queryByLabelText("Wind technology preview"),
  ).not.toBeInTheDocument();
  fireEvent.mouseEnter(wind());
  fireEvent.scroll(
    screen.getByRole("group", { name: "Construction technology list" }),
  );
  expect(
    screen.queryByLabelText("Wind technology preview"),
  ).not.toBeInTheDocument();
  fireEvent.mouseEnter(wind());
  update(true);
  expect(
    screen.queryByLabelText("Wind technology preview"),
  ).not.toBeInTheDocument();
  expect(wind()).toBeDisabled();
  fireEvent.click(wind());
  expect(onProject).not.toHaveBeenCalled();
  update(false, 1);
  expect(
    screen.getByRole("complementary", { name: "Build facilities" }),
  ).toHaveFocus();
});

it("uses the owning site quote for preview prices and explains incompatible sites", () => {
  const { game, onProject } = show("champlain:site-13");
  const option = projectCatalogue(game, 2e7, false).find(
    ({ name }) => name === "Wind",
  )!;
  const quote = projectSiteQuote(
    game,
    selectProject(option),
    "champlain:site-13",
  );
  if (!quote.facility) throw new Error("Expected an owned Wind site quote");
  fireEvent.mouseEnter(wind());
  const preview = screen.getByLabelText("Wind technology preview");
  expect(
    within(preview).getByText("Price for the inspected site"),
  ).toBeInTheDocument();
  expect(
    within(preview).getByText(formatMoneyConcise(quote.facility.buildCost)),
  ).toBeInTheDocument();
  fireEvent.mouseEnter(
    screen.getByRole("button", { name: "Choose sites for Offshore Wind" }),
  );
  expect(
    within(screen.getByLabelText("Offshore Wind technology preview")).getByText(
      /vacant compatible site/,
    ),
  ).toBeInTheDocument();
  expect(onProject).not.toHaveBeenCalled();
});

it("keeps exact technology limits when choosing an oversized project", () => {
  const { game, onProject } = show();
  fireEvent.click(screen.getByRole("button", { name: /Generator power:/ }));
  fireEvent.change(screen.getByRole("slider", { name: "Generator capacity" }), {
    target: { value: "34" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  const option = projectCatalogue(game, 8e9, false).find(
    ({ name }) => name === "Wind",
  )!;
  expect(option.maxPeakW).toBeLessThan(option.peakW);
  fireEvent.click(wind());
  expect(onProject).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Wind", peakW: option.maxPeakW }),
  );
});

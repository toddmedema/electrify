import * as React from "react";
import { IconButton, Tab, Tabs, Toolbar, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useAppDispatch, useAppSelector } from "../../Store";
import { navigate } from "../../reducers/Card";
import {
  buildTransmissionLine,
  setTradingPolicy,
  upgradeTransmissionLine,
} from "../../reducers/Game";
import { snackbarOpen } from "../../reducers/UI";
import { corridorsForLocation } from "../../data/AdjacentMarkets";
import { accessContextForGame } from "../../data/IntertieAccess";
import { intertieBuildQuote } from "../../helpers/Transmission";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { formatMoneyStable } from "../../helpers/Format";
import ConceptIcon from "../base/ConceptIcon";
import BuildGeneratorsContainer from "./BuildGeneratorsContainer";
import BuildStorageContainer from "./BuildStorageContainer";
import TransmissionPanel from "./TransmissionPanel";

const categories = [
  ["BUILD_GENERATORS", "Generators", "Generator"],
  ["BUILD_STORAGE", "Storage", "Storage"],
  ["BUILD_INTERTIES", "Interties", "Intertie"],
] as const;

export default function BuildFacilities(): React.JSX.Element {
  const dispatch = useAppDispatch();
  const game = useAppSelector((state) => state.game);
  const card = useAppSelector((state) => state.card.name);
  const introductoryChoices = game.scenarioId === 1 && game.tutorialStep === 1;
  const intertiesAvailable =
    !!game.transmission && corridorsForLocation(game.location).length > 0;
  // Isolated grids have nothing to connect to, so the tab would only ever be empty.
  const visibleCategories = categories.filter(
    ([name]) => intertiesAvailable || name !== "BUILD_INTERTIES",
  );
  const active = introductoryChoices
    ? "BUILD_GENERATORS"
    : visibleCategories.find(([name]) => name === card)?.[0] ||
      "BUILD_GENERATORS";
  const cash = getTimeFromTimeline(game.date.minute, game.timeline)?.cash || 0;
  const close = () => dispatch(navigate("FACILITIES"));

  return (
    <div id="topbar" className="flexContainer screenCatalog buildFacilities">
      <header className="constructionHeader">
        <Toolbar className="constructionTitleBar">
          <Typography variant="h6" className="constructionTitle">
            <span className="iconLabel">
              <ConceptIcon concept="build" fontSize="small" />
              Build
            </span>
            {/* The build screen carries no game bar, so the paused clock it opened with needs
                saying. Replays hide it: their speed is the player's own, not a stopped game */}
            {game.inGame && !game.replayPlayback && game.speed === "PAUSED" && (
              <span className="pausedChip">
                <span aria-hidden="true">
                  <ConceptIcon concept="pause" fontSize="small" />
                </span>
                Paused
              </span>
            )}
            <span
              className="weak constructionCash"
              aria-label={`Available cash ${formatMoneyStable(cash)}`}
            >
              {formatMoneyStable(cash)} cash
            </span>
          </Typography>
          <IconButton
            id="close-button"
            color="primary"
            onClick={close}
            aria-label="close"
            size="large"
          >
            <CloseIcon />
          </IconButton>
        </Toolbar>
        {!introductoryChoices && (
          <Tabs
            className="constructionTabs"
            value={active}
            variant="fullWidth"
            aria-label="Build categories"
            onChange={(_event, value) =>
              dispatch(
                navigate({
                  name: value,
                  dontRemember: true,
                  replaceCurrentCard: true,
                  skipBrowserHistory: true,
                }),
              )
            }
          >
            {visibleCategories.map(([name, label, className]) => (
              <Tab
                key={name}
                id={`tab-${name}`}
                aria-controls={`panel-${name}`}
                value={name}
                label={label}
                className={`button-build${className}`}
              />
            ))}
          </Tabs>
        )}
      </header>
      <div
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={introductoryChoices ? undefined : `tab-${active}`}
        aria-label={introductoryChoices ? "Generators" : undefined}
        className="constructionPanel"
      >
        {active === "BUILD_GENERATORS" && <BuildGeneratorsContainer embedded />}
        {active === "BUILD_STORAGE" && <BuildStorageContainer embedded />}
        {active === "BUILD_INTERTIES" && (
          <div className="scrollable constructionInterties">
            <TransmissionPanel
              game={game}
              projectsOnly
              onPolicy={(policy) => dispatch(setTradingPolicy(policy))}
              onUpgrade={(corridorId, financed) =>
                dispatch(upgradeTransmissionLine({ corridorId, financed }))
              }
              onBuild={(corridorId, financed, tier) => {
                dispatch(buildTransmissionLine({ corridorId, financed, tier }));
                const corridor = intertieBuildQuote(
                  corridorId,
                  game.date.year,
                  tier,
                  accessContextForGame(game),
                );
                if (corridor)
                  dispatch(
                    snackbarOpen(
                      `Intertie approved — power can flow in ${corridor.yearsToBuild} year${corridor.yearsToBuild === 1 ? "" : "s"}.`,
                    ),
                  );
                close();
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

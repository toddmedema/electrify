import * as React from "react";
import { IconButton, Tab, Tabs, Toolbar, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useAppDispatch, useAppSelector } from "../../Store";
import { navigate } from "../../reducers/Card";
import { buildTransmissionLine, setTradingPolicy } from "../../reducers/Game";
import { snackbarOpen } from "../../reducers/UI";
import {
  corridorsForLocation,
  TRANSMISSION_CORRIDORS,
} from "../../data/AdjacentMarkets";
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
  const active =
    categories.find(([name]) => name === card)?.[0] || "BUILD_GENERATORS";
  const cash = getTimeFromTimeline(game.date.minute, game.timeline)?.cash || 0;
  const close = () => dispatch(navigate("FACILITIES"));
  const intertiesAvailable =
    !!game.transmission && corridorsForLocation(game.location).length > 0;

  return (
    <div id="topbar" className="flexContainer screenCatalog buildFacilities">
      <header className="constructionHeader">
        <Toolbar className="constructionTitleBar">
          <Typography variant="h6" className="constructionTitle">
            <span className="iconLabel">
              <ConceptIcon concept="build" fontSize="small" />
              Build
            </span>
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
          {categories.map(([name, label, className]) => (
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
      </header>
      <div
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
        className="constructionPanel"
      >
        {active === "BUILD_GENERATORS" && <BuildGeneratorsContainer embedded />}
        {active === "BUILD_STORAGE" && <BuildStorageContainer embedded />}
        {active === "BUILD_INTERTIES" && (
          <div className="scrollable constructionInterties">
            {intertiesAvailable ? (
              <TransmissionPanel
                game={game}
                projectsOnly
                onPolicy={(policy) => dispatch(setTradingPolicy(policy))}
                onBuild={(corridorId, financed) => {
                  dispatch(buildTransmissionLine({ corridorId, financed }));
                  const corridor = TRANSMISSION_CORRIDORS.find(
                    ({ id }) => id === corridorId,
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
            ) : (
              <Typography color="textSecondary">
                No intertie projects are available in this region.
              </Typography>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import * as React from "react";
import { useToolScroll } from "../base/GameToolMemory";
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Tab,
  Tabs,
} from "@mui/material";
import { UtilityAreaId } from "../../Types";
import { getUtilityArea } from "../../data/UtilityExpansion";
import { BuildOperatingAreaContext } from "../base/BuildOperatingAreaContext";
import { useToolState } from "../base/GameToolMemory";
import { useAppDispatch, useAppSelector } from "../../Store";
import { navigate } from "../../reducers/Card";
import {
  buildTransmissionLine,
  setTradingPolicy,
  upgradeTransmissionLine,
} from "../../reducers/Game";
import { snackbarOpen } from "../../reducers/UI";
import { corridorsForLocation } from "../../data/AdjacentMarkets";
import { getTutorialStep } from "../../data/Scenarios";
import { accessContextForGame } from "../../data/IntertieAccess";
import { intertieBuildQuote } from "../../helpers/Transmission";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import ConceptIcon from "../base/ConceptIcon";
import CatalogTitleBar from "../base/CatalogTitleBar";
import BuildGeneratorsContainer from "./BuildGeneratorsContainer";
import BuildStorageContainer from "./BuildStorageContainer";
import TransmissionPanel from "./TransmissionPanel";
import {
  GameToolCloseContext,
  GameBuildCompleteContext,
} from "../base/GameWorkspaceContext";

const categories = [
  ["BUILD_GENERATORS", "Generators", "Generator"],
  ["BUILD_STORAGE", "Storage", "Storage"],
  ["BUILD_INTERTIES", "Interties", "Intertie"],
] as const;

export default function BuildFacilities({
  embedded = false,
  category,
}: {
  embedded?: boolean;
  category?: string;
}): React.JSX.Element {
  const dispatch = useAppDispatch();
  const closeTool = React.useContext(GameToolCloseContext);
  const completeBuild = React.useContext(GameBuildCompleteContext);
  const game = useAppSelector((state) => state.game);
  const card = useAppSelector((state) => state.card.name);
  const [selectedArea, setSelectedArea] = useToolState<UtilityAreaId>(
    "build.operatingArea",
    "champlain",
  );
  const areas = game.utilityExpansion?.areas ?? [];
  const operatingAreaId = game.utilityExpansion
    ? areas.some((area) => area.id === selectedArea)
      ? selectedArea
      : "champlain"
    : undefined;
  const introductoryChoices =
    getTutorialStep(game)?.phase === "GENERATOR_CHOICES";
  const intertiesAvailable =
    !!game.transmission &&
    (!!game.multiplayer || corridorsForLocation(game.location).length > 0);
  // Isolated grids have nothing to connect to, so the tab would only ever be empty.
  const visibleCategories = categories.filter(
    ([name]) => intertiesAvailable || name !== "BUILD_INTERTIES",
  );
  const active = introductoryChoices
    ? "BUILD_GENERATORS"
    : visibleCategories.find(([name]) => name === (category ?? card))?.[0] ||
      "BUILD_GENERATORS";
  const cash = getTimeFromTimeline(game.date.minute, game.timeline)?.cash || 0;
  const intertiesRef = useToolScroll<HTMLDivElement>(`build.${active}.scroll`);
  const close = closeTool ?? (() => dispatch(navigate("FACILITIES")));
  const gesture = React.useRef<{ id: number; x: number; y: number } | null>(
    null,
  );
  const changeCategory = (name: (typeof categories)[number][0]) =>
    dispatch(
      navigate({
        name,
        dontRemember: true,
        replaceCurrentCard: true,
        skipBrowserHistory: true,
      }),
    );

  return (
    <BuildOperatingAreaContext.Provider value={operatingAreaId}>
      <div
        id={embedded ? undefined : "topbar"}
        className="flexContainer screenCatalog buildFacilities"
      >
        <header className="constructionHeader">
          {!embedded && (
            <CatalogTitleBar
              icon={<ConceptIcon concept="build" fontSize="small" />}
              title="Build"
              cash={cash}
              onClose={close}
              closeButtonId="close-button"
              // The build screen stands in for the game bar, so tutorials find its speeds here
              speedControlId="speedChangeButtons"
            />
          )}
          {!introductoryChoices && (
            <Tabs
              className="constructionTabs"
              value={active}
              variant="fullWidth"
              aria-label="Build categories"
              onChange={(_event, value) => changeCategory(value)}
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
          {areas.length > 1 && active !== "BUILD_INTERTIES" && (
            <div className="buildOperatingArea">
              <FormControl fullWidth size="small">
                <InputLabel id="build-operating-area-label">
                  Operating area
                </InputLabel>
                <Select
                  labelId="build-operating-area-label"
                  label="Operating area"
                  value={operatingAreaId}
                  onChange={(event) =>
                    setSelectedArea(event.target.value as UtilityAreaId)
                  }
                >
                  {areas.map((area) => (
                    <MenuItem key={area.id} value={area.id}>
                      {getUtilityArea(area.id)?.name ?? area.id}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </div>
          )}
        </header>
        <div
          role="tabpanel"
          id={`panel-${active}`}
          aria-labelledby={introductoryChoices ? undefined : `tab-${active}`}
          aria-label={introductoryChoices ? "Generators" : undefined}
          className="constructionPanel"
          style={{ touchAction: "pan-y pinch-zoom" }}
          onTouchStart={(event) => {
            gesture.current = null;
            if (
              introductoryChoices ||
              event.touches.length !== 1 ||
              (event.target as Element).closest(
                ".constructionHeader, .MuiSlider-root, button, input, select, [role='slider']",
              )
            )
              return;
            const touch = event.touches[0];
            gesture.current = {
              id: touch.identifier,
              x: touch.clientX,
              y: touch.clientY,
            };
          }}
          onTouchMove={(event) => {
            const start = gesture.current;
            if (!start) return;
            const touch = event.touches[0];
            if (
              event.touches.length !== 1 ||
              Math.abs(touch.clientY - start.y) >
                Math.max(12, Math.abs(touch.clientX - start.x))
            )
              gesture.current = null;
          }}
          onTouchCancel={() => {
            gesture.current = null;
          }}
          onTouchEnd={(event) => {
            const start = gesture.current;
            gesture.current = null;
            if (!start || event.touches.length) return;
            const touch = Array.from(event.changedTouches).find(
              (touch) => touch.identifier === start.id,
            );
            if (!touch) return;
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
            const index = visibleCategories.findIndex(
              ([name]) => name === active,
            );
            const next = visibleCategories[index + (dx < 0 ? 1 : -1)];
            if (next) changeCategory(next[0]);
          }}
        >
          {active === "BUILD_GENERATORS" && <BuildGeneratorsContainer />}
          {active === "BUILD_STORAGE" && <BuildStorageContainer />}
          {active === "BUILD_INTERTIES" && (
            <div
              ref={intertiesRef}
              className="scrollable constructionInterties"
            >
              <TransmissionPanel
                game={game}
                projectsOnly
                onPolicy={(policy) => dispatch(setTradingPolicy(policy))}
                onUpgrade={(corridorId, financed) =>
                  dispatch(upgradeTransmissionLine({ corridorId, financed }))
                }
                onBuild={(corridorId, financed, tier) => {
                  dispatch(
                    buildTransmissionLine({ corridorId, financed, tier }),
                  );
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
                  (completeBuild ?? close)();
                }}
              />
            </div>
          )}
        </div>
      </div>
    </BuildOperatingAreaContext.Provider>
  );
}

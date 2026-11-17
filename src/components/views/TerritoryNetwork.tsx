import * as React from "react";
import { Button, Tab, Tabs, Typography } from "@mui/material";
import { getTerritoryDefinition } from "../../data/Territories";
import {
  tilePurchaseQuote,
  landTransferredCustomers,
} from "../../helpers/Territories";
import { currentTick } from "../../helpers/GameSelectors";
import {
  formatCount,
  formatFacilitySize,
  formatWatts,
} from "../../helpers/Format";
import type {
  FacilityShoppingType,
  TerritoryId,
  TerritoryTileId,
} from "../../Types";
import { UTILITY_AREAS } from "../../data/UtilityExpansion";
import { TERRAIN_LABELS } from "../../data/TerrainLabels";
import { tileFitsFacility } from "../../helpers/TerritoryTiles";
import { territoryTileViews } from "../../helpers/TerritoryMapState";
import { TransmissionPanelProps } from "./TransmissionPanel";
import { useToolState } from "../base/GameToolMemory";
import { getTerrainModifiers } from "../../helpers/TerrainModifiers";
import { cityDemandByType } from "../../helpers/CityDemand";
import { facilityDisplayName } from "../base/FacilityLabels";
import { facilityMapStatus } from "../base/FacilityMapStatus";
import AcquiredUtilities from "./AcquiredUtilities";
import TerritoryHexMap from "./TerritoryHexMap";
import AcquisitionReviewDialog from "../base/AcquisitionReviewDialog";
import UtilityOfferDialog from "../base/UtilityOfferDialog";
import { useMoney } from "../base/CurrencyContext";
import { useAppDispatch } from "../../Store";
import { generatorSizeChanged } from "../../reducers/GameActions";
import { purchaseFacility } from "../../helpers/PurchaseFacility";
import TileWorkspaceSurface from "../base/TileWorkspaceSurface";
import ExpandedFacilityDetails, {
  FacilityDetailActions,
} from "../base/ExpandedFacilityDetails";
import { signature } from "../base/DeferredProjection";
import ProjectBuild from "../base/ProjectBuild";
import {
  projectSiteQuote,
  type ProjectSelection,
} from "../../helpers/ProjectBuild";
import { tilePurchaseQuotes } from "../../helpers/Territories";
import BuildGenerators from "./BuildGenerators";
import BuildStorage from "./BuildStorage";
import {
  GameBuildCompleteContext,
  GameWorkspaceContext,
  MapWorkspacePanelContext,
} from "../base/GameWorkspaceContext";
import ChartForecastDemandByType, {
  demandTypesBySizeAtStart,
} from "../base/ChartForecastDemandByType";
import ChartLegend from "../base/ChartLegend";
import { demandTypeColors } from "../../Theme";
import {
  TerritoryTilePurchasesProvider,
  useTerritoryTilePurchases,
} from "../base/TerritoryTilePurchases";

const keepTileOpen = () => undefined;

type Props = TransmissionPanelProps & {
  facilityActions: FacilityDetailActions;
};

/** Shared purchase coordination lets the inspector and rapid-buy map use one pending budget. */
export default function TerritoryNetwork(props: Props) {
  return (
    <TerritoryTilePurchasesProvider game={props.game}>
      <TileNetwork {...props} />
    </TerritoryTilePurchasesProvider>
  );
}

function TileNetwork(props: Props) {
  const { game } = props;
  const panel = React.useContext(MapWorkspacePanelContext);
  const [selected, setSelected] = useToolState<TerritoryTileId | undefined>(
    "network.tile",
    undefined,
  );
  const [planning, setPlanning] = React.useState(false);
  const [catalogue, setCatalogue] = React.useState(true);
  const [project, setProject] = useToolState<ProjectSelection | undefined>(
    "network.project",
    undefined,
  );
  const [candidate, setCandidate] = React.useState<TerritoryTileId>();
  const projectBusy = React.useRef(false);
  const [inspected, setInspected] = React.useState<TerritoryTileId>();
  const [activation, setActivation] = React.useState(0);
  const [category, setCategory] = React.useState("generators");
  const [review, setReview] = React.useState(false);
  const [terms, setTerms] = React.useState(false);
  const { purchase, pendingIds, availableCash } = useTerritoryTilePurchases();
  const dispatch = useAppDispatch();
  const { formatMoneyConcise: money } = useMoney();
  const summaryRef = React.useRef<HTMLElement>(null);
  const acquired = React.useRef(false);
  React.useEffect(() => {
    if (!review && acquired.current && summaryRef.current) {
      acquired.current = false;
      summaryRef.current.focus();
    }
  }, [review, game.utilityExpansion?.acquisitions.length]);
  const views = territoryTileViews(game);
  const view =
    inspected && !panel?.open && !planning
      ? views.find(({ tile }) => tile.id === inspected)
      : undefined;
  const tile = view?.tile;
  const territory = tile ? getTerritoryDefinition(tile.territoryId) : undefined;
  const operatingFacility = view?.operatingFacility;
  const utility = tile
    ? Object.values(UTILITY_AREAS).find(({ id }) => id === tile.territoryId)
    : undefined;
  const quote = tile ? tilePurchaseQuote(game, tile.id) : undefined;
  const tick = currentTick(game);
  const customers = tile
    ? (utility?.customers ??
      (view?.owned
        ? landTransferredCustomers(game, tile.territoryId)
        : (quote?.customers ?? territory?.customers ?? 0)))
    : 0;
  const demandW =
    tick && tile
      ? Object.values(
          cityDemandByType(game, tick, tile.territoryId, !!view?.owned),
        ).reduce((sum, watts) => sum + watts, 0)
      : 0;
  const building = !!(view?.owned && tile && !tile.city && !view.facility);
  const storageFits = !!tile && tileFitsFacility(tile, { peakWh: 1, peakW: 1 });
  const close = React.useCallback(() => {
    if (projectBusy.current) return;
    setPlanning(false);
    setCandidate(undefined);
    setInspected(undefined);
    setSelected(undefined);
  }, [setSelected]);
  React.useEffect(() => {
    if (panel?.open) close();
  }, [panel?.open, close]);
  const startProject = React.useCallback(() => {
    panel?.inspect();
    setInspected(undefined);
    setSelected(undefined);
    setCandidate(undefined);
    setCatalogue(true);
    setPlanning(true);
  }, [panel, setSelected]);
  React.useEffect(() => {
    if (panel?.projectRequested) startProject();
  }, [panel?.projectRequested, startProject]);
  const projectPricingKey = `${signature(game)}|${game.interestRate}|${JSON.stringify(game.multiplayer?.tileOwners)}|${JSON.stringify(game.multiplayer?.landOwners)}`;
  const projectSites = React.useMemo(() => {
    if (!planning || !project || catalogue) return undefined;
    const connections = tilePurchaseQuotes(game);
    return new Map(
      views.flatMap(({ tile }) => {
        const quote = projectSiteQuote(game, project, tile.id, connections);
        return quote.facility
          ? [
              [
                tile.id,
                quote.owned ? ("owned" as const) : ("connection" as const),
              ] as const,
            ]
          : [];
      }),
    );
    // Reuse the shared economic/planning signature; map focus and clock ticks do not reprice every site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planning, project, catalogue, projectPricingKey]);
  const build = React.useCallback(
    (
      facility: FacilityShoppingType,
      financed: boolean,
      territoryId?: TerritoryId,
      tileId?: TerritoryTileId,
    ) => {
      dispatch(purchaseFacility(facility, financed, territoryId, tileId));
    },
    [dispatch],
  );
  const sizeChanged = React.useCallback(() => {
    dispatch(generatorSizeChanged());
  }, [dispatch]);
  const inspect = (id: TerritoryTileId, activate = false) => {
    if (projectBusy.current) return;
    setSelected(id);
    if (planning && !catalogue) {
      if (activate) setCandidate(id);
      return;
    }
    if (activate) {
      panel?.inspect();
      setActivation((value) => value + 1);
      setCategory("generators");
      setInspected(id);
    }
  };
  const title = tile
    ? operatingFacility
      ? facilityDisplayName(operatingFacility)
      : tile.city
        ? `${tile.city.sector === "industrial" ? "Industrial" : "Residential"} city`
        : building
          ? `Build · ${TERRAIN_LABELS[tile.terrain]}`
          : `${TERRAIN_LABELS[tile.terrain]} site`
    : "Tile";
  return (
    <section
      className="territoryNetwork"
      data-tile-inspection={view ? "open" : undefined}
      aria-label="Territory map workspace"
    >
      {views.length > 0 && (
        <TerritoryHexMap
          {...(view || planning ? { onCloseInspection: close } : {})}
          onPlanProject={startProject}
          projectPlanning={planning}
          projectSites={projectSites}
          onDeselect={close}
          game={game}
          selected={selected}
          onSelect={inspect}
        />
      )}
      {planning && !panel?.open && (
        <ProjectBuild
          game={game}
          project={project}
          candidate={candidate}
          catalogue={catalogue}
          onProject={(selection) => {
            setProject(selection);
            setCatalogue(false);
            setCandidate(undefined);
            setSelected(undefined);
          }}
          onChangeProject={() => {
            setCatalogue(true);
            setCandidate(undefined);
          }}
          onClose={close}
          onBusy={(busy) => {
            projectBusy.current = busy;
          }}
        />
      )}
      <AcquiredUtilities game={game} summaryRef={summaryRef} />
      {view && tile && territory && (
        <TileWorkspaceSurface
          title={title}
          focusKey={`${tile.id}:${activation}:${view.ownerKey ?? "unowned"}:${operatingFacility?.id ?? (view.facility ? "facility" : "empty")}`}
          subtitle={
            view.owned
              ? view.ownerName
              : territory.kind === "utility"
                ? territory.name
                : undefined
          }
          building={building}
          onClose={close}
        >
          {building ? (
            <GameWorkspaceContext.Provider value={true}>
              <GameBuildCompleteContext.Provider value={keepTileOpen}>
                <Tabs
                  className="tileBuildTabs"
                  value={storageFits ? category : "generators"}
                  variant="fullWidth"
                  aria-label="Build type"
                  onChange={(_event, value) => setCategory(value)}
                >
                  <Tab value="generators" label="Generators" />
                  <Tab
                    value="storage"
                    label="Storage"
                    disabled={!storageFits}
                  />
                </Tabs>
                {category === "storage" && storageFits ? (
                  <BuildStorage
                    game={game}
                    lockedTileId={tile.id}
                    onBack={close}
                    onBuildStorage={build}
                  />
                ) : (
                  <BuildGenerators
                    game={game}
                    lockedTileId={tile.id}
                    onBack={close}
                    onSizeChange={sizeChanged}
                    onBuildGenerator={build}
                  />
                )}
              </GameBuildCompleteContext.Provider>
            </GameWorkspaceContext.Provider>
          ) : (
            <>
              {tile.city ? (
                <>
                  <div className="tileCityMetrics">
                    <div>
                      <span>
                        {view.owned
                          ? "Connected customers"
                          : "Customers to connect"}
                      </span>
                      <strong>{formatCount(customers)}</strong>
                    </div>
                    <div>
                      <span>
                        {view.owned ? "Current demand" : "Estimated demand"}
                      </span>
                      <strong>{formatWatts(demandW)}</strong>
                    </div>
                  </div>
                  <CityDemand
                    game={game}
                    territoryId={tile.territoryId}
                    owned={view.owned}
                  />
                </>
              ) : operatingFacility ? (
                <ExpandedFacilityDetails
                  showStatus
                  facility={operatingFacility}
                  game={game}
                  {...props.facilityActions}
                />
              ) : view.facility ? (
                <div className="tileCityMetrics">
                  <div>
                    <span>{view.facility.name}</span>
                    <strong>{formatFacilitySize(view.facility)}</strong>
                  </div>
                  <Typography variant="body2" className="tileFacilityStatus">
                    {facilityMapStatus(view, game.date.minute)?.label}
                  </Typography>
                </div>
              ) : null}
              {!view.owned && !tile.city && (
                <TileTerrainModifiers game={game} tileId={tile.id} />
              )}
              {!view.owned && territory.kind === "utility" ? (
                <div className="territoryBuildActions">
                  <Button
                    variant="contained"
                    disabled={!props.onAcquire}
                    onClick={() => setReview(true)}
                  >
                    Acquire {territory.name}
                  </Button>
                  <Button variant="outlined" onClick={() => setTerms(true)}>
                    Inspect {territory.name}
                  </Button>
                </div>
              ) : (
                !view.owned && (
                  <div className="tilePurchaseSummary">
                    {quote && (
                      <div className="tilePurchaseMoney">
                        <div>
                          <span>Connection cost</span>
                          <strong>{money(quote.price)}</strong>
                        </div>
                        <div>
                          <span>Cash after connection</span>
                          <strong>{money(availableCash - quote.price)}</strong>
                        </div>
                      </div>
                    )}
                    <Button
                      variant="contained"
                      disabled={
                        !quote ||
                        pendingIds.size > 0 ||
                        availableCash < quote.price
                      }
                      onClick={() => void purchase(tile.id, quote?.quoteKey)}
                    >
                      {pendingIds.has(tile.id)
                        ? "Connecting…"
                        : quote
                          ? `Connect · ${money(quote.price)}`
                          : "Connection unavailable"}
                    </Button>
                    {quote && availableCash < quote.price && (
                      <Typography role="status" variant="body2">
                        {money(quote.price - availableCash)} more cash needed.
                      </Typography>
                    )}
                  </div>
                )
              )}
            </>
          )}
        </TileWorkspaceSurface>
      )}
      {review && tile && props.onAcquire && (
        <AcquisitionReviewDialog
          game={game}
          targetId={tile.territoryId}
          onClose={() => setReview(false)}
          onAcquire={async (payload) => {
            const accepted = await props.onAcquire!(payload);
            acquired.current = accepted;
            return accepted;
          }}
        />
      )}
      {terms && tile && (
        <UtilityOfferDialog
          game={game}
          targetId={tile.territoryId}
          onClose={() => setTerms(false)}
        />
      )}
    </section>
  );
}

function CityDemand({
  game,
  territoryId,
  owned,
}: {
  game: Props["game"];
  territoryId: TerritoryId;
  owned: boolean;
}) {
  const timeline = game.timeline.map((tick) => ({
    ...tick,
    demandByType: cityDemandByType(game, tick, territoryId, owned),
  }));
  const first = timeline[0]?.minute ?? game.date.minute;
  const last = timeline[timeline.length - 1]?.minute ?? first + 1;
  const types = demandTypesBySizeAtStart(timeline, first);
  return (
    <section className="tileCityDemand" aria-label="City demand by use">
      <Typography component="h4" variant="subtitle2">
        Demand by use
      </Typography>
      <ChartLegend
        items={types.map((type) => ({
          name: type,
          color: demandTypeColors()[type],
        }))}
      />
      <ChartForecastDemandByType
        height={160}
        timeline={timeline}
        domain={{ x: [first, Math.max(first + 1, last)] }}
        displayTypes={types}
        startingYear={game.startingYear}
        multiyear={false}
        xAxis="hour"
      />
    </section>
  );
}

function TileTerrainModifiers({
  game,
  tileId,
}: {
  game: Props["game"];
  tileId: TerritoryTileId;
}) {
  const wind = getTerrainModifiers(game, "Wind", tileId);
  const solar = getTerrainModifiers(game, "Sun", tileId);
  const percentage = (factor: number) =>
    `${factor >= 1 ? "+" : "−"}${Math.round(Math.abs(factor - 1) * 100)}%`;
  const modifiers = [
    { label: "Wind speed", value: wind.onshoreWindSpeed },
    { label: "Wind build cost", value: wind.buildCost },
    { label: "Solar build cost", value: solar.buildCost },
  ].filter(({ value }) => value !== 1);
  return (
    <section aria-label="Terrain modifiers">
      {modifiers.length ? (
        <dl className="tileTerrainModifiers">
          {modifiers.map(({ label, value }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{percentage(value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <Typography variant="body2" color="textSecondary">
          Standard wind and solar conditions
        </Typography>
      )}
    </section>
  );
}

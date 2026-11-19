import * as React from "react";
import { Button, Tab, Tabs, Typography } from "@mui/material";
import { SIDE_TOOL_MIN_WIDTH } from "../../WorkspaceLayout";
import DesktopBuildRail from "../base/DesktopBuildRail";
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
import {
  getTerritoryTile,
  tileFitsFacility,
} from "../../helpers/TerritoryTiles";
import {
  territoryMapTileKey,
  territoryTileViews,
  type TerritoryMapTileKey,
  type TerritoryTileView,
} from "../../helpers/TerritoryMapState";
import { TransmissionPanelProps } from "./TransmissionPanel";
import { useToolState } from "../base/GameToolMemory";
import { useBuildForecast } from "../base/BuildForecast";
import { windOutputByTerrain } from "../../helpers/ExpectedOutput";
import { terrainModifiers } from "../../helpers/TerrainModifiers";
import { customerMarketSizeAt } from "../../helpers/Customers";
import { cityCustomerCount } from "../../helpers/CityProfiles";
import {
  citySizeLabel,
  formatTerrainPercent,
} from "../base/TerritoryTileFacts";
import { cityDemandByType } from "../../helpers/CityDemand";
import { facilityDisplayName } from "../base/FacilityLabels";
import { facilityMapStatus } from "../base/FacilityMapStatus";
import AcquiredUtilities from "./AcquiredUtilities";
import TerritoryHexMap, { type MapTileMenuTarget } from "./TerritoryHexMap";
import TerritoryTileMenu from "./TerritoryTileMenu";
import AcquisitionReviewDialog from "../base/AcquisitionReviewDialog";
import UtilityOfferDialog from "../base/UtilityOfferDialog";
import { bordersUtility } from "../../helpers/Expansion";
import { useMoney } from "../base/CurrencyContext";
import { useAppDispatch, useAppSelector } from "../../Store";
import { generatorSizeChanged } from "../../reducers/GameActions";
import { purchaseFacility } from "../../helpers/PurchaseFacility";
import TileWorkspaceSurface from "../base/TileWorkspaceSurface";
import ExpandedFacilityDetails, {
  FacilityDetailActions,
} from "../base/ExpandedFacilityDetails";
import { signature } from "../base/DeferredProjection";
import {
  projectSiteQuote,
  type ProjectSelection,
  type ReadyProjectSite,
} from "../../helpers/ProjectBuild";
import { tilePurchaseQuotes } from "../../helpers/Territories";
import BuildGenerators from "./BuildGenerators";
import BuildStorage from "./BuildStorage";
import {
  GameBuildCompleteContext,
  GameWorkspaceContext,
  GameWorkspaceLayoutContext,
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

function ProjectBuildUnavailable({ onClose }: { onClose: () => void }) {
  return (
    <TileWorkspaceSurface
      title="Project planner unavailable"
      focusKey="project-unavailable"
      returnFocusSelector=".desktopBuildRail, #buildNav"
      onClose={onClose}
    >
      <p role="status">
        The project planner could not load. Close this panel and open Build to
        try again.
      </p>
    </TileWorkspaceSurface>
  );
}

function DeferredProjectBuild(
  props: React.ComponentProps<typeof import("../base/ProjectBuild").default>,
) {
  // A new opening can retry a failed chunk without disturbing the map or saved project.
  const [ProjectBuild] = React.useState(() =>
    React.lazy(() =>
      import(
        /* webpackChunkName: "project-build" */ "../base/ProjectBuild"
      ).catch(() => ({ default: ProjectBuildUnavailable })),
    ),
  );
  return (
    <React.Suspense
      fallback={
        <TileWorkspaceSurface
          title="Plan a project"
          focusKey="project-loading"
          returnFocusSelector=".desktopBuildRail, #buildNav"
          onClose={props.onClose}
        >
          <p role="status">Loading project planner…</p>
        </TileWorkspaceSurface>
      }
    >
      <ProjectBuild {...props} />
    </React.Suspense>
  );
}

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
  const layout = React.useContext(GameWorkspaceLayoutContext);
  const desktopRail = (layout?.effectiveWidth ?? 0) >= SIDE_TOOL_MIN_WIDTH;
  const [railFocusRequest, setRailFocusRequest] = React.useState(0);
  const [railSite, setRailSite] = React.useState<TerritoryTileId>();
  const [projectPending, setProjectPending] = React.useState(false);
  const [selected, setSelected] = useToolState<TerritoryMapTileKey | undefined>(
    "network.tile",
    undefined,
  );
  const [planning, setPlanning] = React.useState(false);
  const [catalogue, setCatalogue] = React.useState(true);
  const [project, setProject] = useToolState<ProjectSelection | undefined>(
    "network.project",
    undefined,
  );
  const windSpeeds = useBuildForecast(
    game,
    planning && !catalogue && project?.fuel === "Wind",
  )?.windSpeeds;
  const projectWindOutput = React.useMemo(
    () => windSpeeds && windOutputByTerrain(windSpeeds),
    [windSpeeds],
  );
  const [candidate, setCandidate] = React.useState<TerritoryTileId>();
  const projectBusy = React.useRef(false);
  const [inspected, setInspected] = React.useState<TerritoryMapTileKey>();
  const [activation, setActivation] = React.useState(0);
  const [category, setCategory] = React.useState("generators");
  const [utilityDialog, setUtilityDialog] = React.useState<{
    action: "acquire" | "inspect";
    id: TerritoryId;
  }>();
  const [menu, setMenu] = React.useState<MapTileMenuTarget | null>(null);
  const [expandRequest, setExpandRequest] = React.useState<number>();
  const { purchase, pendingIds, availableCash } = useTerritoryTilePurchases();
  const dispatch = useAppDispatch();
  const { formatMoneyConcise: money, formatPurchasePrice } = useMoney();
  const summaryRef = React.useRef<HTMLElement>(null);
  const acquired = React.useRef(false);
  React.useEffect(() => {
    if (!utilityDialog && acquired.current && summaryRef.current) {
      acquired.current = false;
      summaryRef.current.focus();
    }
  }, [utilityDialog, game.utilityExpansion?.acquisitions.length]);
  const views = React.useMemo(() => territoryTileViews(game), [game]);
  const view =
    inspected && !panel?.open && !planning
      ? views.find(({ tile }) => territoryMapTileKey(tile) === inspected)
      : undefined;
  const tile = view?.tile;
  const territory = tile ? getTerritoryDefinition(tile.territoryId) : undefined;
  const operatingFacility = view?.operatingFacility;
  const utility = tile
    ? Object.values(UTILITY_AREAS).find(({ id }) => id === tile.territoryId)
    : undefined;
  const acquisition = game.utilityExpansion?.acquisitions.find(
    ({ targetId }) => targetId === tile?.territoryId,
  );
  const quote =
    tile && view?.connectable ? tilePurchaseQuote(game, tile.id) : undefined;
  const tick = currentTick(game);
  const customers = tile?.city
    ? view?.owned
      ? (acquisition?.transferredCustomers ??
        utility?.customers ??
        landTransferredCustomers(game, tile.territoryId))
      : (quote?.customers ??
        customerMarketSizeAt(
          cityCustomerCount(tile.territoryId),
          game.date.minute,
        ))
    : 0;
  const demandW =
    tick && tile?.city
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
    setRailSite(undefined);
    setExpandRequest(undefined);
    setMenu(null);
  }, [setSelected]);
  React.useEffect(() => {
    if (panel?.open) close();
  }, [panel?.open, close]);
  const startProject = React.useCallback(() => {
    if (projectBusy.current || pendingIds.size > 0) return;
    panel?.inspect();
    setInspected(undefined);
    setSelected(undefined);
    setCandidate(undefined);
    setCatalogue(true);
    setRailSite(undefined);
    setPlanning(!desktopRail);
    if (desktopRail) setRailFocusRequest((value) => value + 1);
  }, [panel, setSelected, desktopRail, pendingIds.size]);
  React.useEffect(() => {
    if (panel?.projectRequested) startProject();
  }, [panel?.projectRequested, startProject]);
  const projectPricingKey =
    planning && project && !catalogue
      ? `${signature(game)}|${game.interestRate}|${JSON.stringify(views.map(({ tile }) => territoryMapTileKey(tile)))}|${JSON.stringify(game.multiplayer?.tileOwners)}|${JSON.stringify(game.multiplayer?.landOwners)}`
      : undefined;
  const projectSites = React.useMemo(() => {
    if (!planning || !project || catalogue) return undefined;
    const connections = tilePurchaseQuotes(game, views);
    return new Map<TerritoryMapTileKey, ReadyProjectSite>(
      views.flatMap(({ tile, owned, connectable }) => {
        if (!owned && !connectable) return [];
        const quote = projectSiteQuote(game, project, tile.id, connections);
        return quote.facility
          ? [[territoryMapTileKey(tile), quote] as const]
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
    ) => dispatch(purchaseFacility(facility, financed, territoryId, tileId)),
    [dispatch],
  );
  const sizeChanged = React.useCallback(() => {
    dispatch(generatorSizeChanged());
  }, [dispatch]);
  const inspect = (
    key: TerritoryMapTileKey,
    activate = false,
    mode?: "details" | "expand",
  ) => {
    if (projectBusy.current) return;
    setSelected(key);
    if (!activate) return;
    const activated = views.find(
      ({ tile }) => territoryMapTileKey(tile) === key,
    );
    if (!activated) return;
    const id = activated.tile.id;
    if (!mode && planning && !catalogue) {
      // A peer's retained alias can share an economic ID with a local site.
      setCandidate(activated.owned || id === key ? id : undefined);
      return;
    }
    panel?.inspect();
    if (mode && planning) {
      setPlanning(false);
      setCandidate(undefined);
    }
    setExpandRequest(mode === "expand" ? activation + 1 : undefined);
    setActivation((value) => value + 1);
    setCategory("generators");
    setInspected(key);
    setRailSite(undefined);
    if (
      desktopRail &&
      activated.owned &&
      !activated.tile.city &&
      !activated.facility
    ) {
      setRailSite(id);
      setRailFocusRequest((value) => value + 1);
    }
  };
  const title = tile
    ? operatingFacility
      ? facilityDisplayName(operatingFacility)
      : tile.city
        ? (tile.city.name ?? citySizeLabel(tile.city.size))
        : TERRAIN_LABELS[tile.terrain]
    : "Tile";
  const preferredSite = candidate ?? (building ? tile?.id : railSite);
  return (
    <section
      className="territoryNetwork"
      data-tile-inspection={view ? "open" : undefined}
      data-desktop-build-rail={desktopRail || undefined}
      aria-label="Territory map workspace"
    >
      {desktopRail && views.length > 0 && (
        <DesktopBuildRail
          game={game}
          project={project}
          siteId={preferredSite}
          busy={projectPending || pendingIds.size > 0}
          focusRequest={railFocusRequest}
          onProject={(selection) => {
            if (projectBusy.current || pendingIds.size > 0) return;
            panel?.inspect();
            setProject(selection);
            setCatalogue(false);
            setPlanning(true);
            setInspected(undefined);
            const preferred =
              preferredSite &&
              projectSiteQuote(game, selection, preferredSite).facility
                ? preferredSite
                : undefined;
            setCandidate(preferred);
            const preferredTile =
              preferred && getTerritoryTile(preferred, game);
            setSelected(preferredTile && territoryMapTileKey(preferredTile));
          }}
        />
      )}
      {views.length > 0 && (
        <TerritoryHexMap
          {...(view || planning ? { onCloseInspection: close } : {})}
          projectPlanning={planning}
          projectPending={projectPending}
          projectSites={projectSites}
          projectWindOutput={projectWindOutput}
          onDeselect={close}
          game={game}
          views={views}
          selected={selected}
          onSelect={inspect}
          onTileMenu={(target) => {
            if (!projectBusy.current) setMenu(target);
          }}
        />
      )}
      <TerritoryTileMenu
        game={game}
        anchor={menu}
        view={
          menu
            ? views.find(({ tile }) => territoryMapTileKey(tile) === menu.key)
            : undefined
        }
        actions={props.facilityActions}
        busy={projectPending}
        canAcquire={!!props.onAcquire}
        projectSite={!!menu && !!projectSites?.has(menu.key)}
        onClose={() => setMenu(null)}
        onChooseSite={() => menu && inspect(menu.key, true)}
        onInspect={() => menu && inspect(menu.key, true, "details")}
        onExpand={() => menu && inspect(menu.key, true, "expand")}
        onUtility={(action, id) => setUtilityDialog({ action, id })}
      />
      {planning && (!panel?.open || projectPending) && (
        <DeferredProjectBuild
          game={game}
          project={project}
          candidate={candidate}
          compatibleSites={projectSites?.size ?? 0}
          catalogue={catalogue}
          onProject={(selection) => {
            if (projectBusy.current) return;
            setProject(selection);
            setCatalogue(false);
            setCandidate(undefined);
            setSelected(undefined);
          }}
          onUpdateProject={
            desktopRail
              ? (selection) => {
                  if (!projectBusy.current) setProject(selection);
                }
              : undefined
          }
          onChangeProject={() => {
            if (projectBusy.current) return;
            setCatalogue(true);
            setCandidate(undefined);
            if (desktopRail) {
              setPlanning(false);
              setRailFocusRequest((value) => value + 1);
            }
          }}
          onClose={close}
          onBusy={(busy) => {
            projectBusy.current = busy;
            setProjectPending(busy);
            panel?.onProjectBusyChange?.(busy);
          }}
        />
      )}
      <AcquiredUtilities game={game} summaryRef={summaryRef} />
      {view && tile && territory && (
        <TileWorkspaceSurface
          title={title}
          focusKey={`${inspected}:${activation}:${view.ownerKey ?? "unowned"}:${operatingFacility?.id ?? (view.facility ? "facility" : "empty")}`}
          subtitle={view.ownerName}
          building={building && !desktopRail}
          initialFocusSelector={
            building && desktopRail && railSite === tile.id
              ? ".desktopBuildRail"
              : undefined
          }
          onClose={close}
        >
          {building && desktopRail ? (
            <TileTerrainModifiers terrain={tile.terrain} />
          ) : building ? (
            <GameWorkspaceContext.Provider value={true}>
              <GameBuildCompleteContext.Provider value={keepTileOpen}>
                <TileTerrainModifiers terrain={tile.terrain} />
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
                        {!view.owned
                          ? "Customers to connect"
                          : utility && !acquisition
                            ? "Opening customers"
                            : "Customers transferred"}
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
                  expandRequest={expandRequest}
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
                <TileTerrainModifiers terrain={tile.terrain} />
              )}
              {!view.owned && territory.kind === "utility" ? (
                <div className="territoryBuildActions">
                  <Button
                    variant="contained"
                    disabled={
                      !props.onAcquire ||
                      !bordersUtility(game, tile.territoryId)
                    }
                    onClick={() =>
                      setUtilityDialog({
                        action: "acquire",
                        id: tile.territoryId,
                      })
                    }
                  >
                    Acquire {territory.name}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() =>
                      setUtilityDialog({
                        action: "inspect",
                        id: tile.territoryId,
                      })
                    }
                  >
                    Inspect {territory.name}
                  </Button>
                </div>
              ) : (
                !view.owned && (
                  <div className="tilePurchaseSummary">
                    {quote?.utilityName ? (
                      <Typography variant="body2">
                        Includes both sites and {formatCount(quote.customers)}{" "}
                        customers. The seller removes its plant on transfer.
                      </Typography>
                    ) : view.municipalCity && quote ? (
                      <Typography variant="body2">
                        The seller removes its plant on transfer.
                      </Typography>
                    ) : null}
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
                          ? `${quote.utilityName ? "Acquire utility" : "Connect"} · ${formatPurchasePrice(quote.price)}`
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
      {utilityDialog?.action === "acquire" && props.onAcquire && (
        <AcquisitionReviewDialog
          game={game}
          targetId={utilityDialog.id}
          onClose={() => setUtilityDialog(undefined)}
          onAcquire={async (payload) => {
            const accepted = await props.onAcquire!(payload);
            acquired.current = accepted;
            return accepted;
          }}
        />
      )}
      {utilityDialog?.action === "inspect" && (
        <UtilityOfferDialog
          game={game}
          targetId={utilityDialog.id}
          onClose={() => setUtilityDialog(undefined)}
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
  const runId = useAppSelector((state) => state.ui?.evidenceRunId);
  const forecastKey = signature(game);
  const first = game.timeline[0]?.minute ?? game.date.minute;
  const last = game.timeline.at(-1)?.minute ?? first + 1;
  const { timeline, domain, types } = React.useMemo(() => {
    const timeline = game.timeline.map((tick) => ({
      minute: tick.minute,
      demandByType: cityDemandByType(game, tick, territoryId, owned),
    }));
    return {
      timeline,
      domain: { x: [first, Math.max(first + 1, last)] as [number, number] },
      types: demandTypesBySizeAtStart(timeline, first),
    };
    // The forecast signature and minute bounds track the chart inputs across live ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forecastKey, runId, first, last, territoryId, owned]);
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
        domain={domain}
        displayTypes={types}
        startingYear={game.startingYear}
        multiyear={false}
        xAxis="hour"
      />
    </section>
  );
}

function TileTerrainModifiers({
  terrain,
}: {
  terrain: TerritoryTileView["tile"]["terrain"];
}) {
  const { onshoreWindSpeed, buildCost } = terrainModifiers(terrain, "Wind");
  const modifiers = [
    {
      label: "wind speed",
      value: onshoreWindSpeed,
      good: onshoreWindSpeed > 1,
    },
    { label: "build cost", value: buildCost, good: buildCost < 1 },
  ].filter(({ value }) => value !== 1);
  return (
    <section aria-label="Terrain modifiers">
      {modifiers.length ? (
        <ul className="tileTerrainModifiers">
          {modifiers.map(({ label, value, good }) => (
            <li key={label}>
              <strong data-favorable={good}>
                {formatTerrainPercent(value)}
              </strong>{" "}
              {label}
            </li>
          ))}
        </ul>
      ) : (
        <Typography variant="body2" color="textSecondary">
          Standard build cost
        </Typography>
      )}
    </section>
  );
}

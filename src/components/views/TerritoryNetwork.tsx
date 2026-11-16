import * as React from "react";
import { Button, Tab, Tabs, Typography } from "@mui/material";
import { getTerritoryDefinition } from "../../data/Territories";
import {
  territoryDemandShares,
  territoryDemandByType,
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
import { territoryBuildTileName } from "../base/TerritoryBuildDestination";
import { facilityDisplayName } from "../base/FacilityLabels";
import AcquiredUtilities from "./AcquiredUtilities";
import TerritoryHexMap from "./TerritoryHexMap";
import { territoryMapLabel } from "../base/TerritoryMapLayout";
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
import BuildGenerators from "./BuildGenerators";
import BuildStorage from "./BuildStorage";
import {
  GameBuildCompleteContext,
  GameWorkspaceContext,
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
  const [selected, setSelected] = useToolState<TerritoryTileId>(
    "network.tile",
    "champlain:city",
  );
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
  const selectedView =
    views.find(({ tile }) => tile.id === selected) ?? views[0];
  const view = inspected
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
      ? (territoryDemandShares(game, tick)[tile.territoryId] ?? 0)
      : 0;
  const building = !!(view?.owned && tile && !tile.city && !view.facility);
  const storageFits = !!tile && tileFitsFacility(tile, { peakWh: 1, peakW: 1 });
  const close = React.useCallback(() => setInspected(undefined), []);
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
    setSelected(id);
    if (activate) {
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
      {selectedView && (
        <TerritoryHexMap
          {...(view ? { onCloseInspection: close } : {})}
          game={game}
          selected={selectedView.tile.id}
          onSelect={inspect}
        />
      )}
      <AcquiredUtilities game={game} summaryRef={summaryRef} />
      {view && tile && territory && (
        <TileWorkspaceSurface
          title={title}
          focusKey={`${tile.id}:${activation}:${view.ownerKey ?? "unowned"}:${operatingFacility?.id ?? (view.facility ? "facility" : "empty")}`}
          subtitle={`${territoryMapLabel(territory.id)} · ${view.ownerName}`}
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
                    {view.owned && (
                      <div>
                        <span>Current demand</span>
                        <strong>{formatWatts(demandW)}</strong>
                      </div>
                    )}
                  </div>
                  {view.owned && (
                    <CityDemand game={game} territoryId={tile.territoryId} />
                  )}
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
                </div>
              ) : (
                <Typography variant="body2">
                  {territoryBuildTileName(tile.id, game)}
                </Typography>
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
                    <Typography variant="body2">
                      {tile.city
                        ? `Connect ${formatCount(customers)} ${tile.city.sector} customers and their electricity demand.`
                        : tile.hydroSiteId
                          ? "Hydropower site. Plant construction is purchased separately."
                          : tile.siteKind === "geothermal"
                            ? "Geothermal site. Plant construction is purchased separately."
                            : "Build a generator or storage on this tile."}
                    </Typography>
                    {quote && (
                      <div className="tilePurchaseMoney">
                        <div>
                          <span>Tile price</span>
                          <strong>{money(quote.price)}</strong>
                        </div>
                        <div>
                          <span>Cash after purchase</span>
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
                        ? "Buying tile…"
                        : quote
                          ? `Buy tile · ${money(quote.price)}`
                          : "Tile unavailable"}
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
}: {
  game: Props["game"];
  territoryId: TerritoryId;
}) {
  const timeline = game.timeline.map((tick) => ({
    ...tick,
    demandByType: territoryDemandByType(game, tick, territoryId),
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
      />
    </section>
  );
}

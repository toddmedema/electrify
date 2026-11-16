import * as React from "react";
import { Button, Typography } from "@mui/material";
import {
  TERRITORIES,
  isLandTerritoryId,
  TerritorySiteKind,
} from "../../data/Territories";
import {
  ownedTerritories,
  territoryDemandShares,
  landPurchaseQuote,
  landTransferredCustomers,
} from "../../helpers/Territories";
import { currentTick } from "../../helpers/GameSelectors";
import {
  formatBuildMonths,
  formatCount,
  formatFacilitySize,
  formatWatts,
} from "../../helpers/Format";
import type {
  FacilityOperatingType,
  LandTerritoryId,
  TerritoryId,
  TerritoryTileId,
} from "../../Types";
import { UTILITY_AREAS } from "../../data/UtilityExpansion";
import { TERRAIN_LABELS } from "../../data/TerrainLabels";
import {
  getTerritoryTile,
  getTerritoryTiles,
  territoryTileInventory,
  tileFitsFacility,
} from "../../helpers/TerritoryTiles";
import { territoryTileViews } from "../../helpers/TerritoryMapState";
import { getTerrainModifiers } from "../../helpers/TerrainModifiers";
import { TransmissionPanelProps } from "./TransmissionPanel";
import { GameToolMemoryContext, useToolState } from "../base/GameToolMemory";
import {
  TERRITORY_BUILD_MEMORY_KEY,
  TERRITORY_TILE_BUILD_MEMORY_KEY,
} from "../base/TerritoryBuildDestination";
import { facilityDisplayName } from "../base/FacilityLabels";
import AcquiredUtilities from "./AcquiredUtilities";
import TerritoryHexMap from "./TerritoryHexMap";
import { territoryMapLabel } from "../base/TerritoryMapLayout";
import AcquisitionReviewDialog from "../base/AcquisitionReviewDialog";
import UtilityOfferDialog from "../base/UtilityOfferDialog";
import DecisionDialog from "../base/DecisionDialog";
import { useMoney } from "../base/CurrencyContext";
import { useAppDispatch } from "../../Store";
import { acquireLand } from "../../reducers/GameActions";
import { multiplayerRuntime } from "../../multiplayer/Registry";

const siteLabels: Record<TerritorySiteKind, string> = {
  industrial: "Thermal",
  wind: "Wind",
  "open-land": "Solar / storage",
  general: "General building",
  hydro: "Hydro",
  geothermal: "Geothermal",
};
type Props = TransmissionPanelProps & {
  onBuildFacility?: (id: TerritoryId, storage: boolean) => void;
  onInspectFacility?: (id: FacilityOperatingType["id"]) => void;
};
export default function TerritoryNetwork(props: Props) {
  const { game } = props;
  const [selected, setSelected] = useToolState<TerritoryTileId>(
    "network.tile",
    "champlain:city",
  );
  const [review, setReview] = React.useState(false);
  const [terms, setTerms] = React.useState(false);
  const [reviewLandId, setReviewLandId] = React.useState<LandTerritoryId>();
  const [error, setError] = React.useState<string>();
  const dispatch = useAppDispatch();
  const { formatMoneyConcise: money } = useMoney();
  const memory = React.useContext(GameToolMemoryContext);
  const summaryRef = React.useRef<HTMLElement>(null);
  const detailRef = React.useRef<HTMLElement>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const acquired = React.useRef(false);
  const boughtLand = React.useRef(false);
  React.useEffect(() => {
    if (!review && acquired.current && summaryRef.current) {
      acquired.current = false;
      summaryRef.current.focus();
    }
  }, [review, game.utilityExpansion?.acquisitions.length]);
  React.useEffect(() => {
    if (!reviewLandId && boughtLand.current) {
      boughtLand.current = false;
      headingRef.current?.focus();
    }
  }, [reviewLandId, game.territoryNetwork?.landPurchases.length]);
  const owned = ownedTerritories(game);
  const tile = getTerritoryTile(selected, game) ?? getTerritoryTiles(game)[0];
  const view = territoryTileViews(game).find(
    ({ tile: item }) => item.id === tile.id,
  )!;
  const territory = TERRITORIES.find(({ id }) => id === tile.territoryId)!;
  const isOwned = view.owned;
  const facility = view.facility;
  const operatingFacility = view.operatingFacility;
  const land = isLandTerritoryId(territory.id)
    ? landPurchaseQuote(game, territory.id)
    : undefined;
  const reviewLand = reviewLandId
    ? landPurchaseQuote(game, reviewLandId)
    : undefined;
  const reviewedTerritory = TERRITORIES.find(({ id }) => id === reviewLandId);
  const utility = Object.values(UTILITY_AREAS).find(
    ({ id }) => id === territory.id,
  );
  const customers =
    utility?.customers ??
    (isOwned
      ? landTransferredCustomers(game, territory.id)
      : (land?.customers ?? territory.customers ?? 0));
  const tick = currentTick(game);
  const demandW = tick ? territoryDemandShares(game, tick)[territory.id] : 0;
  const inventory = territoryTileInventory(game, tile.id);
  const hasRoom = inventory.remaining > 0 && !facility;
  const windRoom = tileFitsFacility(tile, { fuel: "Wind", peakW: 1 });
  const solarRoom = tileFitsFacility(tile, { fuel: "Sun", peakW: 1 });
  const storageRoom = tileFitsFacility(tile, { peakWh: 1, peakW: 1 });
  const generatorRoom =
    !tile.city && (tile.siteKind !== "open-land" || solarRoom);
  const modifiers = getTerrainModifiers(
    game,
    facility
      ? facility.fuel
      : windRoom
        ? "Wind"
        : solarRoom
          ? "Sun"
          : undefined,
    tile.id,
  );
  const terrain = TERRAIN_LABELS[tile.terrain];
  const siteLabel = tile.city
    ? `${tile.city.sector === "industrial" ? "Industrial" : "Residential"} city`
    : tile.terrain === "ocean"
      ? "Offshore wind site"
      : `${siteLabels[tile.siteKind]} site`;
  const facilityName = operatingFacility
    ? facilityDisplayName(operatingFacility)
    : facility?.name;
  const facilityStatus = facility?.yearsToBuildLeft
    ? `${operatingFacility?.paused ? "Construction paused" : "Under construction"} · ${formatBuildMonths(facility.yearsToBuildLeft, "long")} left`
    : operatingFacility?.paused
      ? "Paused"
      : operatingFacility
        ? operatingFacility.currentW < 0
          ? "Charging"
          : operatingFacility.currentW > 0
            ? facility?.peakWh !== undefined
              ? "Discharging"
              : "Generating"
            : "Idle"
        : "Operating";
  const build = (storage: boolean) => {
    memory?.set(TERRITORY_BUILD_MEMORY_KEY, territory.id);
    memory?.set(TERRITORY_TILE_BUILD_MEMORY_KEY, tile.id);
    props.onBuildFacility?.(territory.id, storage);
  };
  const status = (id: TerritoryId) => {
    if (owned.includes(id)) return "Your territory";
    if (!isLandTerritoryId(id)) return "Independent utility";
    const other = game.multiplayer?.landOwners?.[id];
    return other ? `Owned by ${other.name}` : "Available to buy";
  };
  const inspect = (id: TerritoryTileId, focusDetails = false) => {
    setSelected(id);
    if (focusDetails)
      requestAnimationFrame(() => {
        const narrow = window.matchMedia("(max-width: 740px)").matches;
        if (narrow) detailRef.current?.scrollIntoView({ block: "start" });
        headingRef.current?.focus({ preventScroll: !narrow });
      });
  };
  const description = tile.city
    ? "Customers add demand to your company power pool. Cities have no building slot."
    : facility
      ? "This facility occupies the tile's only building slot."
      : "One construction project can occupy this tile. Construction reserves the slot.";
  return (
    <section className="territoryNetwork" aria-label="Territories">
      <header className="territoryNetworkHeading">
        <Typography component="h2" variant="h6">
          Territories
        </Typography>
      </header>
      <div className="territoryNetworkLayout">
        <div className="territoryMapColumn">
          <TerritoryHexMap
            game={game}
            selected={tile.id}
            status={status}
            onSelect={inspect}
          />
          <div className="territoryNetworkNote">
            <p>All your facilities and customers share one power pool.</p>
          </div>
          <AcquiredUtilities game={game} summaryRef={summaryRef} />
        </div>
        <section
          className="territoryDetail"
          aria-label="Selected territory"
          ref={detailRef}
        >
          <header>
            <Typography variant="overline" color="textSecondary">
              {territoryMapLabel(territory.id)} · {status(territory.id)}
            </Typography>
            <Typography
              component="h3"
              variant="h6"
              tabIndex={-1}
              ref={headingRef}
            >
              {terrain} · {facilityName ?? siteLabel}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {description}
            </Typography>
          </header>
          <div className="territorySites">
            {tile.city ? (
              <>
                <Typography component="h4" variant="subtitle2">
                  {isOwned ? "Connected customers" : "Customers to connect"}
                </Typography>
                <div>
                  <span>
                    {tile.city.sector === "residential"
                      ? "Residential"
                      : "Industrial"}
                  </span>
                  <strong>{formatCount(customers)}</strong>
                </div>
                {isOwned && (
                  <div>
                    <span>Current demand</span>
                    <strong>{formatWatts(demandW)}</strong>
                  </div>
                )}
                <Typography variant="caption" color="textSecondary">
                  {isOwned
                    ? "Demand is included in your company total."
                    : "Adds customer demand when acquired."}{" "}
                  No building slot.
                </Typography>
              </>
            ) : facility ? (
              <>
                <Typography component="h4" variant="subtitle2">
                  {facility.peakWh !== undefined ? "Storage" : "Generator"}
                </Typography>
                <div>
                  <span>Size</span>
                  <strong>{formatFacilitySize(facility)}</strong>
                </div>
                {facility.peakWh !== undefined && (
                  <div>
                    <span>Power</span>
                    <strong>{formatWatts(facility.peakW)}</strong>
                  </div>
                )}
                <div>
                  <span>Status</span>
                  <strong>{facilityStatus}</strong>
                </div>
                <Typography variant="caption" color="textSecondary">
                  Building slot occupied. One project per tile.
                </Typography>
              </>
            ) : (
              <>
                <Typography component="h4" variant="subtitle2">
                  {isOwned ? "Building slot" : "Tile included"}
                </Typography>
                <div>
                  <span>{siteLabel}</span>
                  <strong>
                    {inventory.remaining} / {inventory.total} available
                    <small>{formatWatts(inventory.maxPeakW)} / project</small>
                  </strong>
                </div>
                <Typography variant="caption" color="textSecondary">
                  {storageRoom
                    ? tile.siteKind === "open-land"
                      ? "Accepts solar generation or storage."
                      : "Accepts thermal, wind, solar or storage."
                    : tile.terrain === "ocean"
                      ? "Accepts offshore wind."
                      : `Accepts ${siteLabels[tile.siteKind].toLowerCase()} generation.`}
                </Typography>
              </>
            )}
            {modifiers.onshoreWindSpeed !== 1 && (
              <div>
                <span>Onshore wind speed</span>
                <strong>
                  {modifiers.onshoreWindSpeed > 1 ? "+" : ""}
                  {Math.round((modifiers.onshoreWindSpeed - 1) * 100)}%
                </strong>
              </div>
            )}
            {modifiers.buildCost !== 1 && (
              <div>
                <span>
                  {facility
                    ? "Build cost"
                    : windRoom && solarRoom
                      ? "Wind / solar build cost"
                      : windRoom
                        ? "Wind build cost"
                        : "Solar build cost"}
                </span>
                <strong>+{Math.round((modifiers.buildCost - 1) * 100)}%</strong>
              </div>
            )}
          </div>
          {isOwned ? (
            operatingFacility ? (
              <div className="territoryBuildActions">
                <Button
                  variant="contained"
                  disabled={!props.onInspectFacility}
                  onClick={() =>
                    props.onInspectFacility?.(operatingFacility.id)
                  }
                >
                  Inspect plant
                </Button>
              </div>
            ) : (
              !tile.city &&
              !facility && (
                <div className="territoryBuildActions">
                  {generatorRoom && (
                    <Button
                      variant="contained"
                      disabled={!props.onBuildFacility || !hasRoom}
                      onClick={() => build(false)}
                    >
                      {tile.siteKind === "hydro"
                        ? "Build hydro"
                        : tile.siteKind === "geothermal"
                          ? "Build geothermal"
                          : `Build in ${territoryMapLabel(territory.id)}`}
                    </Button>
                  )}
                  {storageRoom && (
                    <Button
                      variant={generatorRoom ? "outlined" : "contained"}
                      disabled={!props.onBuildFacility || !hasRoom}
                      onClick={() => build(true)}
                    >
                      Storage
                    </Button>
                  )}
                  {!hasRoom && (
                    <Typography variant="body2" color="textSecondary">
                      This site has already been used.
                    </Typography>
                  )}
                </div>
              )
            )
          ) : territory.kind === "utility" ? (
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
            <div className="territoryBuildActions">
              <Button
                variant="contained"
                disabled={!land}
                onClick={() => {
                  if (isLandTerritoryId(territory.id)) {
                    setError(undefined);
                    setReviewLandId(territory.id);
                  }
                }}
              >
                Buy territory{land ? ` · ${money(land.price)}` : ""}
              </Button>
              <Typography variant="body2" color="textSecondary">
                One cash payment. Ownership is immediate.
                {game.multiplayer
                  ? " The first accepted purchase owns this parcel."
                  : ""}
              </Typography>
            </div>
          )}
        </section>
      </div>
      {review && props.onAcquire && (
        <AcquisitionReviewDialog
          game={game}
          targetId={territory.id}
          onClose={() => setReview(false)}
          onAcquire={async (payload) => {
            const accepted = await props.onAcquire!(payload);
            acquired.current = accepted;
            return accepted;
          }}
        />
      )}
      {terms && (
        <UtilityOfferDialog
          game={game}
          targetId={territory.id}
          onClose={() => setTerms(false)}
        />
      )}
      {reviewLandId && reviewedTerritory && (
        <DecisionDialog
          open
          title="Buy territory"
          onClose={() => setReviewLandId(undefined)}
          actions={
            <>
              <Button onClick={() => setReviewLandId(undefined)}>Cancel</Button>
              <Button
                variant="contained"
                disabled={
                  !reviewLand ||
                  (currentTick(game)?.cash ?? 0) < reviewLand.price
                }
                onClick={async () => {
                  if (!reviewLand) return;
                  try {
                    const payload = {
                      territoryId: reviewLand.territoryId,
                      quoteKey: reviewLand.quoteKey,
                    };
                    const runtime = multiplayerRuntime();
                    if (runtime)
                      await runtime.submit({
                        kind: "action",
                        name: "acquireLand",
                        payload,
                      });
                    else dispatch(acquireLand(payload));
                    boughtLand.current = true;
                    setReviewLandId(undefined);
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Territory purchase unavailable",
                    );
                  }
                }}
              >
                Buy territory{reviewLand ? ` · ${money(reviewLand.price)}` : ""}
              </Button>
            </>
          }
        >
          <Typography component="p" variant="subtitle1">
            {territoryMapLabel(reviewLandId)}
          </Typography>
          {reviewLand ? (
            <>
              <Typography sx={{ mt: 1 }}>
                {reviewLand.customers > 0
                  ? `Connect ${formatCount(reviewLand.customers)} ${reviewLand.benefit === "industrial" ? "industrial" : "residential"} customers and add their electricity demand. No plants or power agreements transfer.`
                  : reviewedTerritory.benefit === "general"
                    ? `${reviewedTerritory.sites.general.count} shared building sites for general generators or storage. No customers or plants transfer.`
                    : `One ${reviewedTerritory.benefit} development site. Build the plant separately; its normal costs and construction time apply.`}
              </Typography>
              <Typography sx={{ mt: 1 }}>
                One cash payment. Ownership is immediate.
              </Typography>
              {(currentTick(game)?.cash ?? 0) < reviewLand.price && (
                <Typography role="status" sx={{ mt: 1 }}>
                  {money(reviewLand.price - (currentTick(game)?.cash ?? 0))}{" "}
                  more cash needed.
                </Typography>
              )}
            </>
          ) : (
            <Typography role="alert">
              This territory is no longer available.
            </Typography>
          )}
          {error && <Typography role="alert">{error}</Typography>}
        </DecisionDialog>
      )}
    </section>
  );
}

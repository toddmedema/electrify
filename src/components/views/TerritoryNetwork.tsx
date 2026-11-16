import * as React from "react";
import { Button, Typography } from "@mui/material";
import {
  TERRITORIES,
  isLandTerritoryId,
  TerritorySiteKind,
} from "../../data/Territories";
import {
  facilityTerritoryId,
  ownedTerritories,
  territorySiteInventory,
  landPurchaseQuote,
  landTransferredCustomers,
} from "../../helpers/Territories";
import { currentTick } from "../../helpers/GameSelectors";
import { formatCount, formatWatts } from "../../helpers/Format";
import type { LandTerritoryId, TerritoryId } from "../../Types";
import { TransmissionPanelProps } from "./TransmissionPanel";
import { GameToolMemoryContext, useToolState } from "../base/GameToolMemory";
import { TERRITORY_BUILD_MEMORY_KEY } from "../base/TerritoryBuildDestination";
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
  industrial: "Industrial",
  wind: "Wind",
  "open-land": "Solar / storage",
  general: "General building sites",
  hydro: "Hydro site",
  geothermal: "Geothermal site",
};
type Props = TransmissionPanelProps & {
  onBuildFacility?: (id: TerritoryId, storage: boolean) => void;
};
export default function TerritoryNetwork(props: Props) {
  const { game } = props;
  const [selected, setSelected] = useToolState<TerritoryId>(
    "network.territory",
    "champlain",
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
  const territory =
    TERRITORIES.find(({ id }) => id === selected) ?? TERRITORIES[0];
  const isOwned = owned.includes(territory.id);
  const plants = game.facilities.filter(
    (facility) => facilityTerritoryId(facility) === territory.id,
  );
  const land = isLandTerritoryId(territory.id)
    ? landPurchaseQuote(game, territory.id)
    : undefined;
  const reviewLand = reviewLandId
    ? landPurchaseQuote(game, reviewLandId)
    : undefined;
  const reviewedTerritory = TERRITORIES.find(({ id }) => id === reviewLandId);
  const isCustomer =
    territory.benefit === "residential" || territory.benefit === "industrial";
  const customers = isOwned
    ? landTransferredCustomers(game, territory.id)
    : (land?.customers ?? 0);
  const inventories = (Object.keys(siteLabels) as TerritorySiteKind[])
    .map((kind) => ({
      kind,
      ...territorySiteInventory(game, territory.id, kind),
    }))
    .filter((inventory) => inventory.total > 0);
  const hasRoom = inventories.some((inventory) => inventory.remaining > 0);
  const storageRoom = inventories.some(
    (inventory) =>
      (inventory.kind === "general" || inventory.kind === "open-land") &&
      inventory.remaining > 0,
  );
  const build = (storage: boolean) => {
    memory?.set(TERRITORY_BUILD_MEMORY_KEY, territory.id);
    props.onBuildFacility?.(territory.id, storage);
  };
  const status = (id: TerritoryId) => {
    if (owned.includes(id)) return "Your territory";
    if (!isLandTerritoryId(id)) return "Independent utility";
    const other = game.multiplayer?.landOwners?.[id];
    return other ? `Owned by ${other.name}` : "Available to buy";
  };
  const inspect = (id: TerritoryId, focusDetails = false) => {
    setSelected(id);
    if (focusDetails)
      requestAnimationFrame(() => {
        const narrow = window.matchMedia("(max-width: 740px)").matches;
        if (narrow) detailRef.current?.scrollIntoView({ block: "start" });
        headingRef.current?.focus({ preventScroll: !narrow });
      });
  };
  const description =
    territory.benefit === "residential"
      ? "Connect residential customers to your company."
      : territory.benefit === "industrial"
        ? "Connect industrial customers, with higher electricity demand per account."
        : territory.benefit === "hydro"
          ? "Develop a hydro plant here. Its output depends on the available water."
          : territory.benefit === "geothermal"
            ? "Develop a geothermal plant here."
            : territory.benefit === "general"
              ? "Build general generators or storage here."
              : territory.description;
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
            selected={territory.id}
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
              {status(territory.id)}
            </Typography>
            <Typography
              component="h3"
              variant="h6"
              tabIndex={-1}
              ref={headingRef}
            >
              {territoryMapLabel(territory.id)}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {description}
            </Typography>
          </header>
          <div className="territorySites">
            {isCustomer ? (
              <>
                <Typography component="h4" variant="subtitle2">
                  {isOwned ? "Customers added" : "Customers to connect"}
                </Typography>
                <div>
                  <span>
                    {territory.benefit === "residential"
                      ? "Residential"
                      : "Industrial"}
                  </span>
                  <strong>{formatCount(customers)}</strong>
                </div>
                <Typography variant="caption" color="textSecondary">
                  Adds customer demand. No plants or power agreements transfer.
                </Typography>
              </>
            ) : (
              <>
                <Typography component="h4" variant="subtitle2">
                  {isOwned ? "Building sites" : "Sites included"}
                </Typography>
                {inventories.map((inventory) => (
                  <div key={inventory.kind}>
                    <span>{siteLabels[inventory.kind]}</span>
                    <strong>
                      {inventory.remaining} / {inventory.total} left
                      <small>{formatWatts(inventory.maxPeakW)} / project</small>
                    </strong>
                  </div>
                ))}
                <Typography variant="caption" color="textSecondary">
                  {isOwned ? `${plants.length} plants and storage · ` : ""}
                  Construction reserves a site.{" "}
                  {territory.benefit === "general"
                    ? "Shared sites accept thermal, wind, solar or storage."
                    : ""}
                </Typography>
              </>
            )}
          </div>
          {isOwned ? (
            inventories.length > 0 && (
              <div className="territoryBuildActions">
                <Button
                  variant="contained"
                  disabled={!props.onBuildFacility || !hasRoom}
                  onClick={() => build(false)}
                >
                  {territory.benefit === "hydro"
                    ? "Build hydro"
                    : territory.benefit === "geothermal"
                      ? "Build geothermal"
                      : `Build in ${territoryMapLabel(territory.id)}`}
                </Button>
                {storageRoom && (
                  <Button
                    variant="outlined"
                    disabled={!props.onBuildFacility}
                    onClick={() => build(true)}
                  >
                    Storage
                  </Button>
                )}
                {!hasRoom && (
                  <Typography variant="body2" color="textSecondary">
                    All local sites are reserved.
                  </Typography>
                )}
              </div>
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

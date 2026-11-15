import * as React from "react";
import { Button, Typography } from "@mui/material";
import { TERRITORIES, TerritorySiteKind } from "../../data/Territories";
import {
  facilityTerritoryId,
  ownedTerritories,
  territorySiteInventory,
  landPurchaseQuote,
} from "../../helpers/Territories";
import { currentTick } from "../../helpers/GameSelectors";
import { formatWatts } from "../../helpers/Format";
import type { TerritoryId } from "../../Types";
import { TransmissionPanelProps } from "./TransmissionPanel";
import { GameToolMemoryContext, useToolState } from "../base/GameToolMemory";
import { TERRITORY_BUILD_MEMORY_KEY } from "../base/TerritoryBuildDestination";
import AcquiredUtilities from "./AcquiredUtilities";
import TerritoryHexMap from "./TerritoryHexMap";
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
  "open-land": "Open land · solar / storage",
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
  const [landReview, setLandReview] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const dispatch = useAppDispatch();
  const { formatMoneyConcise: money } = useMoney();
  const memory = React.useContext(GameToolMemoryContext);
  const summaryRef = React.useRef<HTMLElement>(null);
  const acquired = React.useRef(false);
  React.useEffect(() => {
    if (!review && acquired.current && summaryRef.current) {
      acquired.current = false;
      summaryRef.current.focus();
    }
  }, [review, game.utilityExpansion?.acquisitions.length]);
  const owned = ownedTerritories(game);
  const territory = TERRITORIES.find(({ id }) => id === selected)!;
  const isOwned = owned.includes(selected);
  const plants = game.facilities.filter(
    (facility) => facilityTerritoryId(facility) === selected,
  );
  const land = landPurchaseQuote(game);
  const build = (storage: boolean) => {
    memory?.set(TERRITORY_BUILD_MEMORY_KEY, selected);
    props.onBuildFacility?.(selected, storage);
  };
  const status = (id: TerritoryId, compact = false) =>
    id === "champlain"
      ? compact
        ? "Home"
        : "Your home territory"
      : owned.includes(id)
        ? compact
          ? "Owned"
          : "Your territory"
        : id === "green-uplands"
          ? game.multiplayer?.landOwner
            ? `Owned by ${game.multiplayer.landOwner.name}`
            : compact
              ? "Available land"
              : "Land available to buy"
          : "Independent utility";
  return (
    <section className="territoryNetwork" aria-label="Territories">
      <header className="territoryNetworkHeading">
        <Typography component="h2" variant="h6">
          Your territories
        </Typography>
      </header>
      <div className="territoryNetworkLayout">
        <div className="territoryMapColumn">
          <TerritoryHexMap
            game={game}
            selected={selected}
            status={status}
            onSelect={setSelected}
          />
          <div className="territoryNetworkNote">
            <p>
              All your facilities and customers share one power pool. Place
              projects where suitable sites remain.
            </p>
          </div>
          <AcquiredUtilities game={game} summaryRef={summaryRef} />
        </div>
        <section className="territoryDetail" aria-label="Selected territory">
          <header>
            <Typography variant="overline" color="textSecondary">
              {status(selected)}
            </Typography>
            <Typography component="h3" variant="h6">
              {territory.name}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {territory.description}
            </Typography>
          </header>
          <div className="territorySites">
            <Typography component="h4" variant="subtitle2">
              {isOwned ? "Building sites" : "Sites included"}
            </Typography>
            {(Object.keys(siteLabels) as TerritorySiteKind[]).map((kind) => {
              const inventory = territorySiteInventory(game, selected, kind);
              return (
                <div key={kind}>
                  <span>{siteLabels[kind]}</span>
                  <strong>
                    {inventory.remaining} / {inventory.total} left
                    <small>{formatWatts(inventory.maxPeakW)} / project</small>
                  </strong>
                </div>
              );
            })}
            <Typography variant="caption" color="textSecondary">
              {isOwned
                ? `${plants.length} plants and storage · construction reserves a site. `
                : ""}
              No new hydro sites.
            </Typography>
          </div>
          {isOwned ? (
            <div className="territoryBuildActions">
              <Button
                variant="contained"
                disabled={!props.onBuildFacility}
                onClick={() => build(false)}
              >
                Build in {territory.name}
              </Button>
              <Button
                variant="outlined"
                disabled={!props.onBuildFacility}
                onClick={() => build(true)}
              >
                Storage
              </Button>
            </div>
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
                disabled={!land || (currentTick(game)?.cash ?? 0) < land.price}
                onClick={() => setLandReview(true)}
              >
                Buy Green Uplands{land ? ` · ${money(land.price)}` : ""}
              </Button>
              <Typography variant="body2" color="textSecondary">
                One cash purchase. Land supplies sites, with no customers,
                plants or power.{" "}
                {game.multiplayer
                  ? "The first accepted purchase owns this shared land."
                  : ""}
              </Typography>
            </div>
          )}
        </section>
      </div>
      {review && props.onAcquire && (
        <AcquisitionReviewDialog
          game={game}
          targetId={selected}
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
          targetId={selected}
          onClose={() => setTerms(false)}
        />
      )}
      {landReview && land && (
        <DecisionDialog
          open
          title="Buy Green Uplands"
          onClose={() => setLandReview(false)}
          actions={
            <>
              <Button onClick={() => setLandReview(false)}>Cancel</Button>
              <Button
                variant="contained"
                disabled={(currentTick(game)?.cash ?? 0) < land.price}
                onClick={async () => {
                  try {
                    const payload = {
                      territoryId: land.territoryId,
                      quoteKey: land.quoteKey,
                    };
                    const runtime = multiplayerRuntime();
                    if (runtime)
                      await runtime.submit({
                        kind: "action",
                        name: "acquireLand",
                        payload,
                      });
                    else dispatch(acquireLand(payload));
                    setLandReview(false);
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Land purchase unavailable",
                    );
                  }
                }}
              >
                Buy land · {money(land.price)}
              </Button>
            </>
          }
        >
          <Typography>
            One cash payment buys 4 wind sites and 3 solar or storage sites.
            Ownership is immediate. No customers, plants or power transfer.
          </Typography>
          {error && <Typography role="alert">{error}</Typography>}
        </DecisionDialog>
      )}
    </section>
  );
}

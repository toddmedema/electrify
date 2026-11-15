import * as React from "react";
import { Button, Typography } from "@mui/material";
import { TERRITORIES, TerritorySiteKind } from "../../data/Territories";
import {
  facilityTerritoryId,
  internalTerritoryEdges,
  ownedTerritories,
  territorySiteInventory,
} from "../../helpers/Territories";
import { currentTick } from "../../helpers/GameSelectors";
import { formatWatts } from "../../helpers/Format";
import type { TerritoryId } from "../../Types";
import TransmissionPanel, { TransmissionPanelProps } from "./TransmissionPanel";
import { GameToolMemoryContext, useToolState } from "../base/GameToolMemory";
import { TERRITORY_BUILD_MEMORY_KEY } from "../base/TerritoryBuildDestination";
import AcquiredUtilities from "./AcquiredUtilities";
import TerritoryHexMap from "./TerritoryHexMap";

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
  const memory = React.useContext(GameToolMemoryContext);
  const summaryRef = React.useRef<HTMLElement>(null);
  const owned = ownedTerritories(game);
  const territory = TERRITORIES.find(({ id }) => id === selected)!;
  const now = currentTick(game);
  const balance = now?.territories?.[selected];
  const line = game.transmission?.lines.find(
    ({ corridorId }) => corridorId === territory.corridorId,
  );
  const edge =
    now &&
    internalTerritoryEdges(game, now).find(
      ({ corridorId }) => corridorId === territory.corridorId,
    );
  const isOwned = owned.includes(selected);
  const plants = game.facilities.filter(
    (facility) => facilityTerritoryId(facility) === selected,
  );
  const build = (storage: boolean) => {
    memory?.set(TERRITORY_BUILD_MEMORY_KEY, selected);
    props.onBuildFacility?.(selected, storage);
  };
  const status = (id: TerritoryId, compact = false) => {
    if (id === "champlain") return compact ? "Home" : "Your home territory";
    const item = TERRITORIES.find((candidate) => candidate.id === id)!;
    const route = game.transmission?.lines.find(
      ({ corridorId }) => corridorId === item.corridorId,
    );
    if (route && route.yearsToBuildLeft > 0)
      return compact ? "Building line" : "Connection under construction";
    if (owned.includes(id))
      return route?.paused
        ? compact
          ? "Line paused"
          : "Your territory · line paused"
        : compact
          ? "Owned"
          : "Your territory";
    return route
      ? compact
        ? "Connected"
        : "Connected · independent"
      : id === "green-uplands"
        ? compact
          ? "Open land"
          : "Open land · unconnected"
        : compact
          ? "Independent"
          : "Independent · unconnected";
  };
  return (
    <section className="territoryNetwork" aria-label="Territory network">
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
              Lines carry power between territories. Purchase agreements buy the
              supply.
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
          {isOwned && (
            <>
              {balance ? (
                <dl
                  className="territoryBalance"
                  aria-label={`${territory.name} live balance`}
                >
                  <div>
                    <dt>Local demand</dt>
                    <dd>{formatWatts(balance?.demandW ?? 0)}</dd>
                  </div>
                  <div>
                    <dt>Plants producing</dt>
                    <dd>{formatWatts(balance?.generationW ?? 0)}</dd>
                  </div>
                  <div>
                    <dt>External power arriving</dt>
                    <dd>{formatWatts(balance?.importedW ?? 0)}</dd>
                  </div>
                  {(balance?.storageChargeW ?? 0) > 0 && (
                    <div>
                      <dt>Storage charging</dt>
                      <dd>{formatWatts(balance!.storageChargeW)}</dd>
                    </div>
                  )}
                  {(balance?.storageDischargeW ?? 0) > 0 && (
                    <div>
                      <dt>Storage supplying</dt>
                      <dd>{formatWatts(balance!.storageDischargeW)}</dd>
                    </div>
                  )}
                  {(balance?.unservedW ?? 0) > 0 && (
                    <div className="territoryShortage">
                      <dt>Unserved demand</dt>
                      <dd>{formatWatts(balance!.unservedW)}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <Typography
                  role="status"
                  variant="body2"
                  color="textSecondary"
                  sx={{ p: 2 }}
                >
                  Local readings update with the next simulation tick.
                </Typography>
              )}
              {line && (
                <div className="territoryLineReading">
                  <strong>
                    {(line.currentFlowW ?? 0) === 0
                      ? "No power flowing"
                      : `${line.currentFlowW! > 0 ? `${territory.name} → Champlain` : `Champlain → ${territory.name}`} · ${formatWatts(Math.abs(line.currentFlowW ?? 0))}`}
                  </strong>
                  <meter
                    min={0}
                    max={edge?.capacityW || line.capacityW}
                    value={Math.abs(line.currentFlowW ?? 0)}
                    aria-label={`${territory.name} connection utilization`}
                  />
                  <span>
                    {formatWatts(edge?.capacityW ?? 0)} available ·{" "}
                    {formatWatts(line.capacityW)} rated
                    {line.paused ? " · paused" : ""}
                  </span>
                </div>
              )}
              <div className="territorySites">
                <Typography component="h4" variant="subtitle2">
                  Building sites
                </Typography>
                {(Object.keys(siteLabels) as TerritorySiteKind[]).map(
                  (kind) => {
                    const inventory = territorySiteInventory(
                      game,
                      selected,
                      kind,
                    );
                    return (
                      <div key={kind}>
                        <span>{siteLabels[kind]}</span>
                        <strong>
                          {inventory.remaining} / {inventory.total} left
                          <small>
                            {formatWatts(inventory.maxPeakW)} / project
                          </small>
                        </strong>
                      </div>
                    );
                  },
                )}
                <Typography variant="caption" color="textSecondary">
                  {plants.length} plants and storage · construction reserves a
                  site. No new hydro sites.
                </Typography>
              </div>
              <div className="territoryBuildActions">
                <Button
                  variant="contained"
                  disabled={
                    !props.onBuildFacility ||
                    (selected !== "champlain" &&
                      (!line || line.yearsToBuildLeft > 0 || !!line.paused))
                  }
                  onClick={() => build(false)}
                >
                  Build in {territory.name}
                </Button>
                <Button
                  variant="outlined"
                  disabled={
                    !props.onBuildFacility ||
                    (selected !== "champlain" &&
                      (!line || line.yearsToBuildLeft > 0 || !!line.paused))
                  }
                  onClick={() => build(true)}
                >
                  Storage
                </Button>
              </div>
            </>
          )}
          {territory.corridorId && (
            <TransmissionPanel
              key={territory.id}
              {...props}
              corridorIds={[territory.corridorId]}
              projectsOnly={!line}
              heading="Territory connection"
              hideOwnership
              ownershipSummaryRef={summaryRef}
            />
          )}
        </section>
      </div>
    </section>
  );
}

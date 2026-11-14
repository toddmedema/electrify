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

const geography: Record<TerritoryId, { path: string; x: number; y: number }> = {
  champlain: {
    path: "M66 44 175 25 301 52 330 145 289 223 187 234 73 189 39 106Z",
    x: 26,
    y: 27,
  },
  "ridge-electric": {
    path: "M335 42 460 20 610 39 665 113 647 212 522 247 427 202 330 145Z",
    x: 74,
    y: 25,
  },
  "valley-electric": {
    path: "M289 223 330 145 427 202 522 247 581 344 527 449 380 463 285 392 251 305Z",
    x: 74,
    y: 72,
  },
  "green-uplands": {
    path: "M73 189 187 234 289 223 251 305 285 392 190 453 68 436 25 327Z",
    x: 23,
    y: 73,
  },
};
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
  const status = (id: TerritoryId) => {
    if (id === "champlain") return "Your home territory";
    const item = TERRITORIES.find((candidate) => candidate.id === id)!;
    const route = game.transmission?.lines.find(
      ({ corridorId }) => corridorId === item.corridorId,
    );
    if (route && route.yearsToBuildLeft > 0)
      return "Connection under construction";
    if (owned.includes(id))
      return route?.paused ? "Your territory · line paused" : "Your territory";
    return route
      ? "Connected · independent"
      : id === "green-uplands"
        ? "Open land · unconnected"
        : "Independent · unconnected";
  };
  return (
    <section className="territoryNetwork" aria-label="Territory network">
      <header className="territoryNetworkHeading">
        <Typography component="h2" variant="h6">
          Your physical network
        </Typography>
        <Typography variant="body2" color="textSecondary">
          Local demand comes first. Connections carry each territory’s net
          balance.
        </Typography>
      </header>
      <div className="territoryNetworkLayout">
        <div className="territoryMapColumn">
          <div
            className="territoryMap"
            aria-label="Four territories and their physical connections"
          >
            <svg
              viewBox="0 0 700 480"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {TERRITORIES.map(({ id }) => (
                <path
                  key={id}
                  d={geography[id].path}
                  className={`territoryLand${owned.includes(id) ? " owned" : ""}${id === selected ? " selected" : ""}`}
                />
              ))}
              <path
                className="territoryWater"
                d="M38 5 74 0 89 48 68 92 85 148 61 183 69 224 42 267 15 247 33 188 22 145 42 99 28 57Z"
              />
              <path
                className="territoryRiver"
                d="M302 0C272 63 342 91 309 164S353 241 331 308 371 396 342 480"
              />
              <g className="territoryContours">
                <path d="M425 58c46-26 132-20 170 18s20 88-23 91-51-32-82-17-88-9-65-92Z" />
                <path d="M449 79c36-20 96-12 122 14s7 50-18 52-31-22-61-15-61-28-43-51Z" />
                <path d="M81 283c46-38 118-27 138 18s-12 107-56 105-111-48-82-123Z" />
              </g>
              {TERRITORIES.filter(({ corridorId }) => corridorId).map(
                ({ id, corridorId }) => {
                  const route = game.transmission?.lines.find(
                    (candidate) => candidate.corridorId === corridorId,
                  );
                  return (
                    <path
                      key={id}
                      d={`M182 130 L${geography[id].x * 7} ${geography[id].y * 4.8}`}
                      className={`territoryRoute${!route || route.yearsToBuildLeft > 0 || route.paused ? " planned" : ""}`}
                    />
                  );
                },
              )}
            </svg>
            {TERRITORIES.map(({ id, name }) => (
              <button
                type="button"
                key={id}
                className="territoryMapNode"
                style={{
                  left: `${geography[id].x}%`,
                  top: `${geography[id].y}%`,
                }}
                aria-pressed={selected === id}
                aria-label={`Inspect ${name} territory`}
                onClick={() => setSelected(id)}
              >
                <strong>{name}</strong>
                <span>{status(id)}</span>
              </button>
            ))}
          </div>
          <div className="territoryMapLegend">
            <span>
              <i /> Connected route
            </span>
            <span>
              <i className="planned" /> Planned or unavailable
            </span>
            <span>Territory schematic</span>
          </div>
          <div className="territoryNetworkNote">
            <strong>Wires and agreements do different jobs.</strong>
            <p>
              Acquiring a utility transfers its customers, plants and contracts.
              Its connection still limits power reaching Champlain. A larger
              wire creates room for power; purchase agreements buy the supply.
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

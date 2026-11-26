import * as React from "react";
import { Button } from "@mui/material";
import { DOWNPAYMENT_PERCENT } from "../../Constants";
import { GENERATORS, STORAGE } from "../../data/Facilities";
import { getHydroAvailability } from "../../data/HydroSites";
import {
  isStorage,
  type FacilityShoppingType,
  type GameType,
  type TerritoryTileId,
} from "../../Types";
import { sliderTickToW } from "../../helpers/BuildSizing";
import { formatWatts, formatWattHours } from "../../helpers/Format";
import { currentTick } from "../../helpers/GameSelectors";
import { hasVisibleEscapeOverlay } from "./VisibleEscapeOverlay";
import { expectedMonthlyOutputShape } from "../../helpers/ExpectedOutput";
import {
  territoryBuildAvailability,
  tilePurchaseQuotes,
} from "../../helpers/Territories";
import {
  createTerritoryTileOwnership,
  getTerritoryTile,
  getTerritoryTiles,
  ownsTerritoryTile,
  territoryTileInventory,
  tileFitsFacility,
  tileSupportsFacilityTechnology,
} from "../../helpers/TerritoryTiles";
import { resilienceBuildOptions } from "../../helpers/Hazards";
import {
  projectCatalogue,
  projectSiteQuote,
  selectProject,
  withTerritoryCatalogueLimits,
  type ProjectSelection,
} from "../../helpers/ProjectBuild";
import { GeneratorBuildItem } from "../views/BuildGenerators";
import { StorageBuildItem } from "../views/BuildStorage";
import { signature } from "./DeferredProjection";
import { useBuildForecast } from "./BuildForecast";
import {
  compareBuildPreview,
  typicalCapacityFactor,
} from "./BuildPreviewComparison";
import { useToolState } from "./GameToolMemory";
import "./DesktopBuildRail.scss";

const technologyOrder = [
  "Solar",
  "Wind",
  "Offshore Wind",
  "Airborne Wind",
  "Hydro",
  "Geothermal",
  "Enhanced Geothermal",
  "Natural Gas Peaker",
  "Natural Gas Steam",
  "Natural Gas CC",
  "Oil",
  "Biomass",
  "Coal",
  "Nuclear",
  "Battery",
  "Iron-Air Battery",
  "Pumped Hydro",
];

const sizeBounds = {
  generator: { min: 0, max: 34 },
  storage: { min: 4, max: 37 },
};

function railSites(game: GameType, options: FacilityShoppingType[]) {
  const tiles = getTerritoryTiles(game);
  const owns = createTerritoryTileOwnership(game);
  const connections = tilePurchaseQuotes(game);
  const candidates = tiles
    .filter((tile) => owns(tile) || connections.has(tile.id))
    .filter((tile) => territoryTileInventory(game, tile.id).remaining)
    .sort(
      (a, b) =>
        (connections.get(a.id)?.price ?? 0) -
        (connections.get(b.id)?.price ?? 0),
    );
  return new Map(
    options
      .filter((facility) =>
        tiles.some((tile) => tileSupportsFacilityTechnology(tile, facility)),
      )
      .map((facility) => {
        const selection = selectProject(facility);
        let minimumDue = Infinity;
        let minimumConstructionDue = Infinity;
        // Within one terrain, the cheapest legal connection also has the cheapest project.
        const pricedSites = new Set<string>();
        for (const tile of candidates) {
          const siteType = `${tile.terrain}:${connections.has(tile.id)}`;
          if (pricedSites.has(siteType) || !tileFitsFacility(tile, selection))
            continue;
          const quote = projectSiteQuote(game, selection, tile.id, connections);
          if (!quote.facility) continue;
          pricedSites.add(siteType);
          const downpayment = quote.facility.buildCost * DOWNPAYMENT_PERCENT;
          minimumDue = Math.min(
            minimumDue,
            quote.connection?.price ?? downpayment,
          );
          minimumConstructionDue = Math.min(
            minimumConstructionDue,
            quote.connectionCost + downpayment,
          );
        }
        return [facility.name, { minimumDue, minimumConstructionDue }] as const;
      }),
  );
}

/** A catalogue of technology identities; only the active preview mounts a full build card. */
export default function DesktopBuildRail({
  game,
  project,
  siteId,
  busy,
  focusRequest,
  onProject,
  onProjectDrag,
}: {
  game: GameType;
  project?: ProjectSelection;
  siteId?: TerritoryTileId;
  busy: boolean;
  focusRequest: number;
  onProject: (project: ProjectSelection | undefined) => void;
  onProjectDrag?: (project: ProjectSelection | undefined) => void;
}) {
  const rail = React.useRef<HTMLElement>(null);
  const origin = React.useRef<HTMLButtonElement>();
  const previewPanel = React.useRef<HTMLElement>(null);
  const dismissTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const suppressFocus = React.useRef(false);
  const [previewName, setPreviewName] = React.useState<string>();
  const [previewEntry, setPreviewEntry] = React.useState(0);
  const generatorSizeButton = React.useRef<HTMLButtonElement>(null);
  const storageSizeButton = React.useRef<HTMLButtonElement>(null);
  const sizingPanel = React.useRef<HTMLElement>(null);
  const sizingInput = React.useRef<HTMLInputElement>(null);
  const [sizing, setSizing] = React.useState<{
    category: "generator" | "storage";
    pinned: boolean;
  }>();
  const [sizingTop, setSizingTop] = React.useState(0);
  const [generatorSize, setGeneratorSize] = useToolState(
    "project.generatorSize",
    10,
  );
  const [storageSize, setStorageSize] = useToolState("project.storageSize", 18);
  const forecast = useBuildForecast(game);
  const previewId = React.useId();
  const previewHintId = React.useId();
  const sizingId = React.useId();
  const pricingKey = `${signature(game)}|${game.interestRate}|${JSON.stringify(game.multiplayer?.tileOwners)}|${JSON.stringify(game.multiplayer?.landOwners)}`;
  const options = React.useMemo<FacilityShoppingType[]>(
    () =>
      withTerritoryCatalogueLimits(game, [
        ...GENERATORS(
          game,
          sliderTickToW(generatorSize),
          forecast?.windSpeeds ?? [],
          forecast?.solarIrradiances ?? [],
          forecast?.offshoreWindSpeeds ?? [],
          forecast?.airborneWindSpeeds ?? [],
        ),
        ...STORAGE(game, sliderTickToW(storageSize)),
        // Planning inputs, rather than clock ticks or map focus, own catalogue pricing.
      ]).sort(
        (a, b) =>
          technologyOrder.indexOf(a.name) - technologyOrder.indexOf(b.name),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pricingKey, generatorSize, storageSize, forecast],
  );
  const sites = React.useMemo(
    () => railSites(game, options),
    // Cash changes every tick. Site eligibility and prices use the planning inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pricingKey, options],
  );
  const cash = currentTick(game)?.cash ?? 0;
  const canChoose = (facility: FacilityShoppingType) =>
    !busy &&
    (project?.name === facility.name ||
      (sites.get(facility.name)?.minimumDue ?? Infinity) <= cash);
  const clearTimer = React.useCallback(() => {
    if (dismissTimer.current !== undefined) clearTimeout(dismissTimer.current);
  }, []);
  const dismiss = React.useCallback(() => {
    clearTimer();
    setPreviewName(undefined);
    setSizing(undefined);
  }, [clearTimer]);
  const dismissAndReturn = React.useCallback(() => {
    dismiss();
    if (rail.current?.contains(document.activeElement)) {
      suppressFocus.current = true;
      origin.current?.focus({ preventScroll: true });
      suppressFocus.current = false;
    }
  }, [dismiss]);
  const positionSizing = React.useCallback(() => {
    const button = origin.current?.getBoundingClientRect();
    const bounds = rail.current?.getBoundingClientRect();
    if (button && bounds) {
      setSizingTop(button.top - bounds.top + button.height / 2);
    }
  }, []);
  React.useEffect(() => () => clearTimer(), [clearTimer]);
  React.useLayoutEffect(() => {
    if (sizing?.pinned) sizingInput.current?.focus({ preventScroll: true });
  }, [sizing]);
  React.useEffect(() => {
    if (!sizing) return;
    window.addEventListener("resize", positionSizing);
    return () => window.removeEventListener("resize", positionSizing);
  }, [sizing, positionSizing]);
  React.useEffect(() => {
    if (busy) return;
    const generator = generatorSizeButton.current;
    const storage = storageSizeButton.current;
    const adjustSize = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : -event.deltaY;
      if (!delta) return;

      event.preventDefault();
      event.stopPropagation();
      const isStorageSize = event.currentTarget === storage;
      const { min, max } = sizeBounds[isStorageSize ? "storage" : "generator"];
      const setSize = isStorageSize ? setStorageSize : setGeneratorSize;
      const step = Math.sign(delta);
      setSize((tick) => Math.max(min, Math.min(max, tick + step)));
    };
    // Cancel the native scroll before the list can scroll or dismiss the popover.
    generator?.addEventListener("wheel", adjustSize, { passive: false });
    storage?.addEventListener("wheel", adjustSize, { passive: false });
    return () => {
      generator?.removeEventListener("wheel", adjustSize);
      storage?.removeEventListener("wheel", adjustSize);
    };
  }, [busy, setGeneratorSize, setStorageSize]);
  React.useLayoutEffect(() => {
    if (previewEntry) previewPanel.current?.focus({ preventScroll: true });
  }, [previewEntry]);
  React.useEffect(() => {
    if (focusRequest) {
      dismiss();
      rail.current?.focus({ preventScroll: true });
    }
  }, [focusRequest, dismiss]);
  React.useEffect(() => {
    if (busy) dismiss();
  }, [busy, dismiss]);
  React.useEffect(() => {
    if (!previewName && !sizing) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (sizing) {
        if (
          !origin.current?.contains(event.target) &&
          !sizingPanel.current?.contains(event.target)
        )
          dismiss();
      } else if (!rail.current?.contains(event.target)) {
        dismiss();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        hasVisibleEscapeOverlay(rail.current)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismissAndReturn();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [previewName, sizing, dismiss, dismissAndReturn]);
  const show = (option: FacilityShoppingType, button: HTMLButtonElement) => {
    if (busy || suppressFocus.current || sizing?.pinned) return;
    clearTimer();
    origin.current = button;
    setSizing(undefined);
    setPreviewName(option.name);
  };
  const leave = () => {
    clearTimer();
    dismissTimer.current = setTimeout(() => {
      if (!rail.current?.contains(document.activeElement))
        setPreviewName(undefined);
    }, 160);
  };
  const leaveSizing = () => {
    clearTimer();
    if (!sizing?.pinned) {
      dismissTimer.current = setTimeout(() => {
        if (
          !origin.current?.contains(document.activeElement) &&
          !sizingPanel.current?.contains(document.activeElement)
        )
          setSizing(undefined);
      }, 160);
    }
  };
  const choose = (option: FacilityShoppingType, exactSize?: number) => {
    if (busy) return;
    const requested = isStorage(option) ? option.peakWh : option.peakW;
    const size = exactSize ?? requested;
    const selected =
      size === requested
        ? option
        : projectCatalogue(game, size, isStorage(option)).find(
            ({ name }) => name === option.name,
          );
    if (!selected) return;
    const due =
      size === requested
        ? sites.get(selected.name)?.minimumDue
        : railSites(game, [selected]).get(selected.name)?.minimumDue;
    if ((due ?? Infinity) <= cash) {
      dismiss();
      onProject(selectProject(selected));
    }
  };
  const option = options.find((item) => item.name === previewName);
  const hasPreview = !!option;
  const siteQuotes = React.useMemo(() => {
    if (!hasPreview || !siteId) return undefined;
    const connections = tilePurchaseQuotes(game);
    return new Map(
      options.map((item) => [
        item.name,
        projectSiteQuote(game, selectProject(item), siteId, connections),
      ]),
    );
    // The same planning inputs own the inspected-site quotes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricingKey, options, hasPreview, siteId]);
  const quote = option && siteQuotes?.get(option.name);
  const inspectedTile = siteId ? getTerritoryTile(siteId, game) : undefined;
  const ownedSite =
    inspectedTile && ownsTerritoryTile(game, inspectedTile)
      ? inspectedTile
      : undefined;
  const siteAvailability =
    option && ownedSite
      ? territoryBuildAvailability(
          game,
          quote?.facility ?? option,
          ownedSite.territoryId,
          ownedSite.id,
        )
      : undefined;
  const facility = quote?.facility ?? option;
  // An inspected tile without a slot can explain why more precisely than the quote.
  const unavailableSiteReason =
    siteAvailability?.remaining === 0 ? siteAvailability.reason : undefined;
  const previewSiteIssue = quote?.facility
    ? undefined
    : (unavailableSiteReason ?? quote?.reason);
  const previewComparison = React.useMemo(() => {
    if (!facility || (siteId && !quote?.facility)) return undefined;
    const sameTypeAndSize = (item: FacilityShoppingType) =>
      isStorage(facility)
        ? isStorage(item) && item.peakWh === facility.peakWh
        : !isStorage(item) && item.peakW === facility.peakW;
    const peers = options.filter(sameTypeAndSize).flatMap((item) => {
      if (siteQuotes) {
        const peerQuote = siteQuotes.get(item.name);
        return peerQuote?.facility &&
          peerQuote.connectionCost +
            peerQuote.facility.buildCost * DOWNPAYMENT_PERCENT <=
            cash
          ? [peerQuote.facility]
          : [];
      }
      return (sites.get(item.name)?.minimumConstructionDue ?? Infinity) <= cash
        ? [item]
        : [];
    });
    if (peers.length < 2) return undefined;
    const markers = compareBuildPreview(
      facility,
      peers,
      !forecast,
      (generator) =>
        typicalCapacityFactor(
          generator,
          generator.fuel === "Hydro"
            ? expectedMonthlyOutputShape(generator, forecast?.timeline ?? [], {
                game,
                tileId: siteId,
              })
            : undefined,
        ),
    );
    return {
      caption: isStorage(facility)
        ? `Compared with typical buildable storage${siteId ? " at this site" : ""}`
        : undefined,
      markers,
    };
    // As with the quotes, planning inputs own the forecast comparison.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pricingKey,
    facility,
    options,
    siteQuotes,
    siteId,
    cash,
    sites,
    forecast,
    quote,
  ]);
  const sizeControl = (storage: boolean) => {
    const category = storage ? "storage" : "generator";
    const label = storage ? "Energy" : "Power";
    const value = sliderTickToW(storage ? storageSize : generatorSize);
    const expanded = sizing?.category === category;
    const open = (button: HTMLButtonElement, pinned: boolean) => {
      if (busy || suppressFocus.current || (!pinned && sizing?.pinned)) return;
      clearTimer();
      origin.current = button;
      setPreviewName(undefined);
      positionSizing();
      setSizing({ category, pinned });
    };
    return (
      <Button
        ref={storage ? storageSizeButton : generatorSizeButton}
        className="desktopBuildSize"
        disabled={busy}
        aria-label={`${label}: ${storage ? formatWattHours(value) : formatWatts(value)}`}
        aria-expanded={expanded}
        aria-controls={expanded ? sizingId : undefined}
        onMouseEnter={(event) => open(event.currentTarget, false)}
        onMouseLeave={leaveSizing}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible"))
            open(event.currentTarget, false);
        }}
        onClick={(event) => {
          if (!expanded || !sizing?.pinned) open(event.currentTarget, true);
        }}
      >
        <span>{label}</span>
        <strong>{storage ? formatWattHours(value) : formatWatts(value)}</strong>
      </Button>
    );
  };
  return (
    <aside
      className="desktopBuildRail"
      aria-label="Build facilities"
      aria-busy={busy}
      tabIndex={-1}
      ref={rail}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          dismiss();
      }}
    >
      <div className="desktopBuildSizing">
        <h3>Generators</h3>
        {sizeControl(false)}
      </div>
      <span className="srOnly" id={previewHintId}>
        Press Right Arrow to enter the technology preview, then Tab to move
        between its controls. Escape returns to the technology.
      </span>
      <div
        className="desktopBuildTechnologies"
        role="group"
        aria-label="Construction technology list"
        onWheel={() => {
          if (!sizing?.pinned) dismiss();
        }}
        onPointerDown={() => {
          if (!sizing) dismiss();
        }}
        onScroll={(event) => {
          if (sizing) {
            positionSizing();
            return;
          }
          // A scroll notification can arrive after a row receives hover or focus.
          // Explicit wheel and scrollbar activity dismiss the preview separately.
          const button = origin.current;
          if (
            !event.currentTarget.contains(button ?? null) ||
            (button !== document.activeElement && !button?.matches(":hover"))
          )
            setPreviewName(undefined);
        }}
      >
        {[false, true].map((storage) => (
          <section
            key={String(storage)}
            aria-label={
              storage ? "Storage technologies" : "Generator technologies"
            }
          >
            {storage && (
              <>
                <h3>Storage</h3>
                <div className="desktopBuildSizing">{sizeControl(true)}</div>
              </>
            )}
            {options
              .filter(
                (item) => isStorage(item) === storage && sites.has(item.name),
              )
              .map((item) => (
                <div
                  key={item.name}
                  onMouseEnter={(event) => {
                    const button = event.currentTarget.querySelector("button");
                    if (button) show(item, button);
                  }}
                  onMouseLeave={leave}
                >
                  <button
                    type="button"
                    className="desktopBuildTechnology"
                    aria-disabled={!canChoose(item)}
                    draggable={
                      !!onProjectDrag &&
                      !busy &&
                      (sites.get(item.name)?.minimumDue ?? Infinity) <= cash
                    }
                    onDragStart={(event) => {
                      if (!event.currentTarget.draggable || !onProjectDrag) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData(
                        "application/x-electrify-project",
                        "",
                      );
                      dismiss();
                      onProjectDrag(selectProject(item));
                    }}
                    onDragEnd={() => onProjectDrag?.(undefined)}
                    title={
                      busy || canChoose(item)
                        ? item.name
                        : sites.get(item.name)?.minimumDue === Infinity
                          ? `${item.name} · No available sites at this size`
                          : `${item.name} · Insufficient cash to start construction`
                    }
                    aria-label={`Choose sites for ${item.name}`}
                    aria-pressed={project?.name === item.name}
                    aria-keyshortcuts="ArrowRight"
                    aria-describedby={`${previewHintId}${previewName === item.name ? ` ${previewId}` : ""}`}
                    onFocus={(event) => show(item, event.currentTarget)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowRight" || busy) return;
                      event.preventDefault();
                      show(item, event.currentTarget);
                      setPreviewEntry((value) => value + 1);
                    }}
                    onClick={() => {
                      if (busy) return;
                      if (project?.name === item.name) {
                        dismiss();
                        onProject(undefined);
                      } else {
                        choose(item);
                      }
                    }}
                  >
                    <img
                      src={`/images/${item.name.toLowerCase()}.svg`}
                      draggable={false}
                      alt=""
                    />
                    {storage && <span>{item.name}</span>}
                  </button>
                </div>
              ))}
          </section>
        ))}
      </div>
      {sizing && (
        <section
          className="desktopBuildSizePopover"
          data-escape-overlay="true"
          id={sizingId}
          ref={sizingPanel}
          aria-label={`${sizing.category === "storage" ? "Energy" : "Power"} sizing`}
          style={{
            top: `clamp(8px, ${sizingTop - 24}px, calc(100% - var(--game-dock-clearance, 80px) - 56px))`,
          }}
          onMouseEnter={clearTimer}
          onMouseLeave={leaveSizing}
        >
          <input
            ref={sizingInput}
            type="range"
            aria-label={
              sizing.category === "storage"
                ? "Storage capacity"
                : "Generator capacity"
            }
            aria-valuetext={
              sizing.category === "storage"
                ? formatWattHours(sliderTickToW(storageSize))
                : formatWatts(sliderTickToW(generatorSize))
            }
            min={sizeBounds[sizing.category].min}
            max={sizeBounds[sizing.category].max}
            step={1}
            value={sizing.category === "storage" ? storageSize : generatorSize}
            disabled={busy}
            onChange={(event) => {
              if (!busy)
                (sizing.category === "storage"
                  ? setStorageSize
                  : setGeneratorSize)(Number(event.target.value));
            }}
          />
        </section>
      )}
      {facility && (
        <section
          key={facility.name}
          className="desktopBuildPreview"
          data-escape-overlay="true"
          aria-label={`${facility.name} technology preview`}
          id={previewId}
          ref={previewPanel}
          tabIndex={-1}
          onMouseEnter={clearTimer}
          onMouseLeave={leave}
        >
          <div className="desktopBuildPreviewScroll">
            <ul>
              {isStorage(facility) ? (
                <StorageBuildItem
                  preview
                  previewSiteIssue={previewSiteIssue}
                  previewComparison={previewComparison}
                  game={game}
                  cash={cash}
                  interestRate={game.interestRate}
                  location={game.location}
                  storage={facility}
                  minimumBuildCost={Infinity}
                  territoryAvailability={siteAvailability}
                  territoryId={ownedSite?.territoryId}
                  tileId={ownedSite?.id}
                  lockedTile={!!ownedSite}
                  onUseMaxSize={(size) => choose(facility, size)}
                  onBuild={() => undefined}
                />
              ) : (
                <GeneratorBuildItem
                  preview
                  previewSiteIssue={previewSiteIssue}
                  previewComparison={previewComparison}
                  game={game}
                  generator={facility}
                  date={game.date}
                  seed={game.seed}
                  location={game.location}
                  cash={cash}
                  interestRate={game.interestRate}
                  hydroAvailability={
                    facility.name === "Hydro" &&
                    (!quote?.facility || quote.owned)
                      ? getHydroAvailability(
                          game,
                          facility.peakW,
                          ownedSite?.territoryId,
                          ownedSite?.id,
                        )
                      : undefined
                  }
                  forecastPending={!forecast}
                  outputShape={expectedMonthlyOutputShape(
                    facility,
                    forecast?.timeline ?? [],
                    { game, tileId: quote?.facility ? siteId : undefined },
                  )}
                  territoryAvailability={siteAvailability}
                  territoryId={ownedSite?.territoryId}
                  tileId={ownedSite?.id}
                  lockedTile={!!ownedSite}
                  resilienceOptions={resilienceBuildOptions(facility, game)}
                  onUseSiteMaximum={(size) => choose(facility, size)}
                  onUseMaxSize={(size) => choose(facility, size)}
                  onBuild={() => undefined}
                />
              )}
            </ul>
          </div>
        </section>
      )}
    </aside>
  );
}

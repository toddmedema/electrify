import * as React from "react";
import { Button, IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { GENERATORS } from "../../data/Facilities";
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
import { territoryBuildAvailability } from "../../helpers/Territories";
import {
  getTerritoryTile,
  ownsTerritoryTile,
} from "../../helpers/TerritoryTiles";
import { resilienceBuildOptions } from "../../helpers/Hazards";
import {
  projectCatalogue,
  projectSiteQuote,
  selectProject,
  type ProjectSelection,
} from "../../helpers/ProjectBuild";
import { GeneratorBuildItem } from "../views/BuildGenerators";
import { StorageBuildItem } from "../views/BuildStorage";
import { signature } from "./DeferredProjection";
import { useBuildForecast } from "./BuildForecast";
import { useToolState } from "./GameToolMemory";
import "./DesktopBuildRail.scss";

/** A catalogue of technology identities; only the active preview mounts a full build card. */
export default function DesktopBuildRail({
  game,
  project,
  siteId,
  busy,
  focusRequest,
  onProject,
}: {
  game: GameType;
  project?: ProjectSelection;
  siteId?: TerritoryTileId;
  busy: boolean;
  focusRequest: number;
  onProject: (project: ProjectSelection) => void;
}) {
  const rail = React.useRef<HTMLElement>(null);
  const origin = React.useRef<HTMLButtonElement>();
  const previewFirstControl = React.useRef<HTMLButtonElement>(null);
  const dismissTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const suppressFocus = React.useRef(false);
  const [previewName, setPreviewName] = React.useState<string>();
  const [previewEntry, setPreviewEntry] = React.useState(0);
  const [sizing, setSizing] = React.useState<"generator" | "storage">();
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
    () => [
      ...GENERATORS(
        game,
        sliderTickToW(generatorSize),
        forecast?.windSpeeds ?? [],
        forecast?.solarIrradiances ?? [],
        forecast?.offshoreWindSpeeds ?? [],
        forecast?.airborneWindSpeeds ?? [],
      ),
      ...projectCatalogue(game, sliderTickToW(storageSize), true),
      // Planning inputs, rather than clock ticks or map focus, own catalogue pricing.
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pricingKey, generatorSize, storageSize, forecast],
  );
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
  React.useEffect(() => () => clearTimer(), [clearTimer]);
  React.useLayoutEffect(() => {
    if (previewEntry)
      previewFirstControl.current?.focus({ preventScroll: true });
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
      if (event.target instanceof Node && !rail.current?.contains(event.target))
        dismiss();
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
    if (busy || suppressFocus.current) return;
    clearTimer();
    origin.current = button;
    setSizing(undefined);
    setPreviewName(option.name);
  };
  const leave = () => {
    clearTimer();
    dismissTimer.current = setTimeout(() => {
      if (!rail.current?.contains(document.activeElement)) dismiss();
    }, 160);
  };
  const choose = (option: FacilityShoppingType, exactSize?: number) => {
    if (busy) return;
    const max = isStorage(option) ? option.maxPeakWh : option.maxPeakW;
    const requested = isStorage(option) ? option.peakWh : option.peakW;
    const size = exactSize ?? (max > 0 && requested > max ? max : requested);
    const selected =
      size === requested
        ? option
        : projectCatalogue(game, size, isStorage(option)).find(
            ({ name }) => name === option.name,
          );
    if (selected) {
      dismiss();
      onProject(selectProject(selected));
    }
  };
  const option = options.find(({ name }) => name === previewName);
  const quote = React.useMemo(
    () =>
      option && siteId
        ? projectSiteQuote(game, selectProject(option), siteId)
        : undefined,
    // The same planning inputs own the inspected-site quote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pricingKey, option, siteId],
  );
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
  const sizeControl = (storage: boolean) => {
    const category = storage ? "storage" : "generator";
    const label = storage ? "Storage energy" : "Generator power";
    const value = sliderTickToW(storage ? storageSize : generatorSize);
    return (
      <Button
        className="desktopBuildSize"
        disabled={busy}
        aria-label={`${label}: ${storage ? formatWattHours(value) : formatWatts(value)}`}
        aria-expanded={sizing === category}
        aria-controls={sizing === category ? sizingId : undefined}
        onClick={(event) => {
          origin.current = event.currentTarget;
          setPreviewName(undefined);
          setSizing(sizing === category ? undefined : category);
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
        {sizeControl(false)}
        {sizeControl(true)}
      </div>
      <span className="srOnly" id={previewHintId}>
        Press Right Arrow to enter the technology preview, then Tab to move
        between its controls. Escape returns to the technology.
      </span>
      <div
        className="desktopBuildTechnologies"
        role="group"
        aria-label="Construction technology list"
        onWheel={dismiss}
        onPointerDown={dismiss}
        onScroll={(event) => {
          // Native focus scrolling can arrive in several steps. Keep the
          // focused technology's preview; explicit scrolling intent dismisses it.
          if (
            origin.current !== document.activeElement ||
            !event.currentTarget.contains(document.activeElement)
          )
            dismiss();
        }}
      >
        {[false, true].map((storage) => (
          <section
            key={String(storage)}
            aria-label={
              storage ? "Storage technologies" : "Generator technologies"
            }
          >
            <h3>{storage ? "Storage" : "Generators"}</h3>
            {options
              .filter((item) => isStorage(item) === storage)
              .map((item) => (
                <button
                  key={item.name}
                  type="button"
                  className="desktopBuildTechnology"
                  disabled={busy}
                  aria-label={`Choose sites for ${item.name}`}
                  aria-pressed={project?.name === item.name}
                  aria-keyshortcuts="ArrowRight"
                  aria-describedby={`${previewHintId}${previewName === item.name ? ` ${previewId}` : ""}`}
                  onMouseEnter={(event) => show(item, event.currentTarget)}
                  onMouseLeave={leave}
                  onFocus={(event) => show(item, event.currentTarget)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowRight" || busy) return;
                    event.preventDefault();
                    show(item, event.currentTarget);
                    setPreviewEntry((value) => value + 1);
                  }}
                  onClick={() => choose(item)}
                >
                  <img src={`/images/${item.name.toLowerCase()}.svg`} alt="" />
                  <span>
                    {item.name === "Battery" ? "Lithium Battery" : item.name}
                  </span>
                </button>
              ))}
          </section>
        ))}
      </div>
      {sizing && (
        <section
          className="desktopBuildSizePopover"
          data-escape-overlay="true"
          id={sizingId}
          aria-label={`${sizing === "storage" ? "Storage energy" : "Generator power"} sizing`}
        >
          <label>
            {sizing === "storage"
              ? "Storage energy (MWh)"
              : "Generator power (MW)"}
            <strong>
              {sizing === "storage"
                ? formatWattHours(sliderTickToW(storageSize))
                : formatWatts(sliderTickToW(generatorSize))}
            </strong>
            <input
              autoFocus
              type="range"
              aria-label={
                sizing === "storage" ? "Storage capacity" : "Generator capacity"
              }
              aria-valuetext={
                sizing === "storage"
                  ? formatWattHours(sliderTickToW(storageSize))
                  : formatWatts(sliderTickToW(generatorSize))
              }
              min={sizing === "storage" ? 4 : 0}
              max={sizing === "storage" ? 37 : 34}
              step={1}
              value={sizing === "storage" ? storageSize : generatorSize}
              disabled={busy}
              onChange={(event) => {
                if (!busy)
                  (sizing === "storage" ? setStorageSize : setGeneratorSize)(
                    Number(event.target.value),
                  );
              }}
            />
          </label>
          <p>
            Sets the size of the next{" "}
            {sizing === "storage"
              ? "storage project you choose. Discharge power depends on the technology."
              : "generator project you choose."}
          </p>
          <Button onClick={dismissAndReturn}>Done</Button>
        </section>
      )}
      {facility && (
        <section
          className="desktopBuildPreview"
          data-escape-overlay="true"
          aria-label={`${facility.name} technology preview`}
          id={previewId}
          onMouseEnter={clearTimer}
          onMouseLeave={leave}
        >
          <header>
            <span>Technology preview · → to explore</span>
            <IconButton
              size="small"
              aria-label="Close technology preview"
              ref={previewFirstControl}
              onClick={dismissAndReturn}
            >
              <CloseIcon />
            </IconButton>
          </header>
          <div className="desktopBuildPreviewScroll">
            {siteId && (
              <p className="desktopBuildPreviewSite">
                {quote?.facility
                  ? "Price for the inspected site"
                  : quote?.reason}
              </p>
            )}
            <ul className="cardList">
              {isStorage(facility) ? (
                <StorageBuildItem
                  preview
                  game={game}
                  cash={currentTick(game)?.cash ?? 0}
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
                  game={game}
                  generator={facility}
                  date={game.date}
                  seed={game.seed}
                  location={game.location}
                  cash={currentTick(game)?.cash ?? 0}
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
          <Button
            disabled={busy}
            onClick={() => choose(facility)}
            variant="contained"
          >
            Choose sites
          </Button>
        </section>
      )}
    </aside>
  );
}

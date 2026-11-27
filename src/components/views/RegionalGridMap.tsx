import * as React from "react";
import { Typography } from "@mui/material";
import type { GameType } from "../../Types";
import {
  initDataCenterCustomers,
  type DataCenterCustomerSources,
} from "../../data/DataCenterCustomers";
import { TERRAIN_LABELS } from "../../data/TerrainLabels";
import { facilityIconSrc } from "../../helpers/FacilityIcon";
import {
  formatCount,
  formatFacilitySize,
  formatWatts,
} from "../../helpers/Format";
import { currentTick } from "../../helpers/GameSelectors";
import { regionalMapViews } from "../../helpers/RegionalMap";
import {
  territoryMapTileKey,
  type TerritoryMapTileKey,
} from "../../helpers/TerritoryMapState";
import ExpandedFacilityDetails, {
  type FacilityDetailActions,
} from "../base/ExpandedFacilityDetails";
import { facilityOperatingStatus } from "../base/FacilityMapStatus";
import { MapWorkspacePanelContext } from "../base/GameWorkspaceContext";
import {
  findTileControl,
  TileInspectionSurface,
} from "../base/TileWorkspaceSurface";
import TerritoryHexMap from "./TerritoryHexMap";

/** The regional map projects the running grid through the shared terrain and plant renderer. */
export default function RegionalGridMap({
  game,
  facilityActions,
}: {
  game: GameType;
  facilityActions?: FacilityDetailActions;
}) {
  const map = React.useRef<HTMLElement>(null);
  const { open, returnToMap, showTile, hideTile, tileWindow } =
    React.useContext(MapWorkspacePanelContext) ?? {};
  const focusAfterClose = React.useRef<TerritoryMapTileKey>();
  const [sources, setSources] = React.useState<DataCenterCustomerSources>();
  const [selected, setSelected] = React.useState<TerritoryMapTileKey>();
  const [inspected, setInspected] = React.useState<TerritoryMapTileKey>();
  React.useEffect(() => {
    let active = true;
    initDataCenterCustomers().then(
      (loaded) => {
        if (active) setSources(loaded);
      },
      () => {}, // A playable regional map also has labels when the source file is offline.
    );
    return () => {
      active = false;
    };
  }, []);
  const close = React.useCallback(() => {
    setInspected(undefined);
    setSelected(undefined);
  }, []);
  const generation = game.campaign?.generationIndex;
  React.useEffect(() => {
    if (generation !== undefined) close();
  }, [close, generation]);
  const closeInspection = React.useCallback(() => {
    focusAfterClose.current = inspected;
    close();
  }, [close, inspected]);
  const blocked = open && !tileWindow;
  React.useEffect(() => {
    if (blocked) close();
  }, [blocked, close]);
  React.useLayoutEffect(() => {
    if (!inspected || blocked || !showTile) return;
    showTile(closeInspection);
    return hideTile;
  }, [blocked, closeInspection, hideTile, inspected, showTile]);
  React.useLayoutEffect(() => {
    const key = focusAfterClose.current;
    if (inspected || !key) return;
    focusAfterClose.current = undefined;
    findTileControl(map.current, key)?.focus({ preventScroll: true });
  }, [inspected]);
  const views = React.useMemo(
    () => regionalMapViews(game, sources),
    [game, sources],
  );
  const view =
    inspected && !blocked
      ? views.find(({ tile }) => territoryMapTileKey(tile) === inspected)
      : undefined;
  const tile = view?.tile;
  const facility = view?.operatingFacility;
  const homeCity = !!(tile?.city && view?.owned);
  const tick = homeCity ? currentTick(game) : undefined;
  return (
    <section
      ref={map}
      className="territoryNetwork regionalMapWorkspace"
      aria-label="Regional map workspace"
    >
      <TerritoryHexMap
        regional
        game={game}
        views={views}
        selected={selected}
        inspected={view ? inspected : undefined}
        onSelect={(key, inspect) => {
          setSelected(key);
          if (inspect) {
            if (blocked) returnToMap?.();
            setInspected(key);
          }
        }}
        onDeselect={close}
        onCloseInspection={view ? closeInspection : undefined}
        inspectionWindow={
          view && tileWindow
            ? tileWindow.front
              ? "front"
              : "background"
            : undefined
        }
        dismissInspectionOnBlank={!!view}
      />
      {view && tile && inspected && (
        <TileInspectionSurface
          map={map}
          showClose
          title={
            facility?.name ?? tile.city?.name ?? TERRAIN_LABELS[tile.terrain]
          }
          titleIconSrc={facility && facilityIconSrc(facility)}
          subtitle={
            tile.city ? `${view.ownerName} · Illustrative grid` : undefined
          }
          focusKey={`${inspected}:${facility?.id ?? "terrain"}`}
          returnFocusSelector={`[data-map-target="${inspected}"]`}
          wide={!!(facility || tile.city)}
          onClose={closeInspection}
        >
          {facility && facilityActions ? (
            <ExpandedFacilityDetails
              game={game}
              facility={facility}
              showStatus
              {...facilityActions}
            />
          ) : facility ? (
            <Typography variant="body2" className="tileFacilityStatus">
              {facilityOperatingStatus(facility, game.date.minute).label} ·{" "}
              {formatFacilitySize(facility)}
            </Typography>
          ) : (
            tick && (
              <div className="tileCityMetrics">
                <div>
                  <span>Grid customers</span>
                  <strong>{formatCount(tick.customers)}</strong>
                </div>
                <div>
                  <span>Grid demand</span>
                  <strong>{formatWatts(tick.demandW)}</strong>
                </div>
              </div>
            )
          )}
        </TileInspectionSurface>
      )}
    </section>
  );
}

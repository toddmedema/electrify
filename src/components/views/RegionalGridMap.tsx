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
  const [inspection, setInspection] = React.useState<{
    tileKey: TerritoryMapTileKey;
    facilityId: number | undefined;
  }>();
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
    setInspection(undefined);
    setSelected(undefined);
  }, []);
  const generation = game.campaign?.generationIndex;
  React.useEffect(() => {
    if (generation !== undefined) close();
  }, [close, generation]);
  const views = React.useMemo(
    () => regionalMapViews(game, sources),
    [game, sources],
  );
  const inspectedView =
    inspection &&
    views.find(
      ({ tile, operatingFacility }) =>
        territoryMapTileKey(tile) === inspection.tileKey &&
        operatingFacility?.id === inspection.facilityId,
    );
  // A named dam can reserve an existing plot and move the plant inspected there.
  if (inspection && !inspectedView) setInspection(undefined);
  const blocked = open && !tileWindow;
  const view = blocked ? undefined : inspectedView;
  const inspected = view ? inspection?.tileKey : undefined;
  const closeInspection = React.useCallback(() => {
    focusAfterClose.current = inspected;
    close();
  }, [close, inspected]);
  React.useEffect(() => {
    if (blocked) close();
  }, [blocked, close]);
  React.useLayoutEffect(() => {
    if (!inspected || !showTile) return;
    showTile(closeInspection);
    return hideTile;
  }, [closeInspection, hideTile, inspected, showTile]);
  React.useLayoutEffect(() => {
    const key = focusAfterClose.current;
    if (inspected || !key) return;
    focusAfterClose.current = undefined;
    findTileControl(map.current, key)?.focus({ preventScroll: true });
  }, [inspected]);
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
        inspected={inspected}
        onSelect={(key, inspect) => {
          setSelected(key);
          if (!inspect) return;
          const target = views.find(
            ({ tile }) => territoryMapTileKey(tile) === key,
          );
          if (target) {
            if (blocked) returnToMap?.();
            setInspection({
              tileKey: key,
              facilityId: target.operatingFacility?.id,
            });
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

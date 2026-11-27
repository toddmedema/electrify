import * as React from "react";
import { Button, Typography } from "@mui/material";
import type { GameType, TerritoryTileId } from "../../Types";
import { useAppDispatch } from "../../Store";
import { TERRAIN_LABELS } from "../../data/TerrainLabels";
import { facilityIconSrc } from "../../helpers/FacilityIcon";
import {
  formatCount,
  formatFacilitySize,
  formatWatts,
} from "../../helpers/Format";
import { currentTick } from "../../helpers/GameSelectors";
import {
  multiplayerClaimQuote,
  multiplayerTerritoryClaimable,
  multiplayerTerritoryViews,
} from "../../helpers/MultiplayerTerritory";
import {
  territoryMapTileKey,
  type TerritoryMapTileKey,
} from "../../helpers/TerritoryMapState";
import { waitForPurchase } from "../../helpers/WaitForPurchase";
import { multiplayerRuntime } from "../../multiplayer/Registry";
import { useMoney } from "../base/CurrencyContext";
import ExpandedFacilityDetails, {
  type FacilityDetailActions,
} from "../base/ExpandedFacilityDetails";
import {
  GameBuildCompleteContext,
  GameToolCloseContext,
  MapWorkspacePanelContext,
} from "../base/GameWorkspaceContext";
import { MapProjectPanel } from "../base/MapPanelWindow";
import { tileHasConstructionTechnology } from "../base/TerritoryTileFacts";
import {
  findTileControl,
  TileInspectionSurface,
} from "../base/TileWorkspaceSurface";
import BuildFacilities from "./BuildFacilities";
import TerritoryHexMap from "./TerritoryHexMap";
import "./MultiplayerTerritory.scss";

export default function MultiplayerTerritoryMap({
  game,
  facilityActions,
  onAgreements,
}: {
  game: GameType;
  facilityActions: FacilityDetailActions;
  onAgreements: (peer: string) => void;
}) {
  const dispatch = useAppDispatch();
  const { formatPurchasePrice } = useMoney();
  const panel = React.useContext(MapWorkspacePanelContext);
  const {
    showTile,
    hideTile,
    showProject,
    hideProject,
    tileWindow,
    returnToMap,
    projectRequested,
  } = panel ?? {};
  const map = React.useRef<HTMLElement>(null);
  const focusOnMap = React.useRef<TerritoryMapTileKey>();
  const focusOnBuild = React.useRef(false);
  const [selected, setSelected] = React.useState<TerritoryMapTileKey>();
  const [inspected, setInspected] = React.useState<TerritoryMapTileKey>();
  const [project, setProject] = React.useState<{ site?: TerritoryTileId }>();
  const pending = React.useRef<TerritoryTileId>();
  const [pendingTileId, setPendingTileId] = React.useState<TerritoryTileId>();
  const [claimError, setClaimError] = React.useState<{
    tileId: TerritoryTileId;
    message: string;
  }>();
  const views = React.useMemo(() => multiplayerTerritoryViews(game), [game]);
  const view = views.find(
    ({ tile }) => territoryMapTileKey(tile) === inspected,
  );
  const tile = view?.tile;
  const facility = view?.operatingFacility;
  const peerId = view?.ownerKey?.startsWith("peer:")
    ? view.ownerKey.slice("peer:".length)
    : undefined;
  const peer = game.multiplayer?.peers?.find(({ id }) => id === peerId);
  const companyEnded = !!game.multiplayer?.ending;
  const quote =
    view && !view.owned && !peer
      ? multiplayerClaimQuote(game, view.tile.id)
      : undefined;
  const now = currentTick(game);
  const cash = now?.cash ?? 0;
  const hasInspection = !!view;

  const clearInspection = React.useCallback(() => {
    setInspected(undefined);
    setSelected(undefined);
  }, []);
  const closeInspection = React.useCallback(() => {
    focusOnMap.current = inspected;
    clearInspection();
  }, [clearInspection, inspected]);
  const startProject = React.useCallback(
    (site?: TerritoryTileId) => {
      returnToMap?.();
      clearInspection();
      setProject({ site });
    },
    [clearInspection, returnToMap],
  );
  const closeProject = React.useCallback(() => {
    if (project?.site) focusOnMap.current = project.site;
    else focusOnBuild.current = true;
    setProject(undefined);
  }, [project]);
  React.useLayoutEffect(() => {
    if (!hasInspection || !showTile) return;
    showTile(closeInspection);
    return hideTile;
  }, [closeInspection, hasInspection, hideTile, showTile]);
  React.useLayoutEffect(() => {
    if (!project || !showProject) return;
    showProject(closeProject);
    return hideProject;
  }, [closeProject, hideProject, project, showProject]);
  React.useLayoutEffect(() => {
    const previous = focusOnMap.current;
    if (inspected || project) return;
    focusOnMap.current = undefined;
    if (previous)
      findTileControl(map.current, previous)?.focus({ preventScroll: true });
    else if (focusOnBuild.current)
      map.current
        ?.closest(".gameWorkspace")
        ?.querySelector<HTMLElement>("#buildNav")
        ?.focus({ preventScroll: true });
    focusOnBuild.current = false;
  }, [inspected, project]);
  React.useEffect(() => {
    if (!projectRequested) return;
    if (companyEnded) returnToMap?.();
    else startProject();
  }, [companyEnded, projectRequested, returnToMap, startProject]);
  React.useEffect(() => {
    if (panel?.open && !tileWindow) clearInspection();
  }, [clearInspection, panel?.open, tileWindow]);
  React.useEffect(() => {
    if (panel?.open && !projectRequested) setProject(undefined);
  }, [panel?.open, projectRequested]);

  async function claim() {
    const runtime = multiplayerRuntime();
    if (!quote || pending.current || !runtime || companyEnded) return;
    const { tileId, quoteKey } = quote;
    pending.current = tileId;
    setPendingTileId(tileId);
    setClaimError(undefined);
    try {
      await runtime.submit({
        kind: "action",
        name: "acquireTile",
        payload: { tileId, quoteKey },
      });
      const confirmed = await dispatch((_dispatch, getState) =>
        waitForPurchase(
          getState,
          ({ game }) =>
            game.multiplayer?.territorial?.claims.some(
              (receipt) => receipt.tileId === tileId,
            ) || undefined,
        ),
      );
      if (!confirmed)
        setClaimError({
          tileId,
          message:
            "Territory ownership has not updated. Check the map before trying again.",
        });
    } catch (error) {
      setClaimError({
        tileId,
        message:
          error instanceof Error
            ? error.message
            : "The claim could not be completed.",
      });
    } finally {
      pending.current = undefined;
      setPendingTileId(undefined);
    }
  }

  const buildableSite =
    view?.owned &&
    tile &&
    !view.reserved &&
    !facility &&
    tileHasConstructionTechnology(tile);
  return (
    <section
      ref={map}
      className="territoryNetwork multiplayerTerritoryMap"
      data-tile-inspection={view ? "open" : undefined}
      aria-label="Territorial map workspace"
    >
      <TerritoryHexMap
        regional
        game={game}
        views={views}
        selected={selected}
        inspected={view && inspected}
        inspectionWindow={
          view && tileWindow
            ? tileWindow.front
              ? "front"
              : "background"
            : undefined
        }
        onSelect={(key, inspect) => {
          if (project) return;
          setSelected(key);
          if (inspect) {
            setClaimError(undefined);
            setInspected(key);
          }
        }}
        onDeselect={clearInspection}
        onCloseInspection={view ? closeInspection : undefined}
        dismissInspectionOnBlank={!!view}
      />
      {project && (
        <GameToolCloseContext.Provider value={closeProject}>
          <GameBuildCompleteContext.Provider value={closeProject}>
            <MapProjectPanel
              catalogue
              title={project.site ? "Build on this tile" : "Build"}
              focusKey={project.site ?? "catalogue"}
              onClose={closeProject}
            >
              <BuildFacilities
                embedded
                mapCatalogue
                lockedTileId={project.site}
              />
            </MapProjectPanel>
          </GameBuildCompleteContext.Provider>
        </GameToolCloseContext.Provider>
      )}
      {view && tile && inspected && (
        <TileInspectionSurface
          map={map}
          showClose
          title={
            view.facility?.name ??
            tile.city?.name ??
            TERRAIN_LABELS[tile.terrain]
          }
          titleIconSrc={facility && facilityIconSrc(facility)}
          subtitle={view.ownerKey ? view.ownerName : "Unclaimed territory"}
          focusKey={`${inspected}:${view.ownerKey ?? "neutral"}:${facility?.id ?? "empty"}`}
          returnFocusSelector={`[data-map-target="${inspected}"]`}
          wide={!!(view.facility || tile.city)}
          onClose={closeInspection}
        >
          <div className="multiplayerTileDetails">
            {facility && (
              <ExpandedFacilityDetails
                game={game}
                facility={facility}
                showStatus
                {...facilityActions}
              />
            )}
            {!facility && view.facility && (
              <Typography variant="body2">
                {formatFacilitySize(view.facility)}
                {view.facility.yearsToBuildLeft > 0
                  ? " · Under construction"
                  : " · Construction complete"}
              </Typography>
            )}
            {view.owned && tile.city && now && (
              <div className="tileCityMetrics">
                <div>
                  <span>Grid customers</span>
                  <strong>{formatCount(now.customers)}</strong>
                </div>
                <div>
                  <span>Grid demand</span>
                  <strong>{formatWatts(now.demandW)}</strong>
                </div>
              </div>
            )}
            {buildableSite && !companyEnded && (
              <Button variant="contained" onClick={() => startProject(tile.id)}>
                Build here
              </Button>
            )}
            {!view.owned &&
              !peer &&
              !companyEnded &&
              (quote ? (
                <>
                  <Button
                    variant="contained"
                    disabled={!!pendingTileId || cash < quote.price}
                    onClick={claim}
                  >
                    {pendingTileId === tile.id
                      ? "Claiming territory…"
                      : `Claim for ${formatPurchasePrice(quote.price)}`}
                  </Button>
                  {cash < quote.price && (
                    <Typography variant="body2" color="warning.main">
                      {formatPurchasePrice(quote.price - cash)} more cash
                      needed.
                    </Typography>
                  )}
                </>
              ) : (
                <Typography variant="body2">
                  {multiplayerTerritoryClaimable(tile)
                    ? "Claim an adjacent tile first."
                    : "This tile cannot be claimed."}
                </Typography>
              ))}
            {claimError?.tileId === tile.id && (
              <Typography role="alert" variant="body2" color="error">
                {claimError.message}
              </Typography>
            )}
            {peer && (
              <Button
                onClick={() => {
                  clearInspection();
                  onAgreements(peer.id);
                }}
              >
                {peer.border && !peer.endpoints
                  ? "Review connection"
                  : "View connection"}
              </Button>
            )}
          </div>
        </TileInspectionSurface>
      )}
    </section>
  );
}

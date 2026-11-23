import { TERRAIN_LABELS } from "../../data/TerrainLabels";
import { utilityOffer } from "../../helpers/Expansion";
import { facilityExpansionQuote } from "../../helpers/FacilityExpansion";
import type { TerritoryTileView } from "../../helpers/TerritoryMapState";
import { tilePurchaseQuote } from "../../helpers/Territories";
import type { GameType, UtilityAcquisitionId } from "../../Types";
import ConceptIcon from "../base/ConceptIcon";
import { useMoney } from "../base/CurrencyContext";
import type { FacilityDetailActions } from "../base/ExpandedFacilityDetails";
import {
  citySizeLabel,
  tileHasConstructionTechnology,
} from "../base/TerritoryTileFacts";
import { useTerritoryTilePurchases } from "../base/TerritoryTilePurchases";
import FacilityContextMenu, {
  type ContextMenuAction,
  facilityActionIcon,
} from "./FacilityContextMenu";
import type { MapTileMenuTarget } from "./TerritoryHexMap";

export default function TerritoryTileMenu({
  game,
  anchor,
  view,
  actions,
  busy,
  canAcquire,
  projectSite,
  onClose,
  onChooseSite,
  onBuild,
  onExpand,
  onAcquire,
}: {
  game: GameType;
  anchor: MapTileMenuTarget | null;
  view?: TerritoryTileView;
  actions: FacilityDetailActions;
  busy: boolean;
  canAcquire: boolean;
  projectSite: boolean;
  onClose: () => void;
  onChooseSite: () => void;
  onBuild: () => void;
  onExpand: () => void;
  onAcquire: (id: UtilityAcquisitionId) => void;
}) {
  const { formatMoneyConcise, formatPurchasePrice } = useMoney();
  const { availableCash, pendingIds, purchase } = useTerritoryTilePurchases();
  const tile = view?.tile;
  const facility = view?.operatingFacility;
  const acquisitionId = view?.acquisitionId;
  const offer = acquisitionId ? utilityOffer(game, acquisitionId) : undefined;
  const quote =
    tile && view?.connectable ? tilePurchaseQuote(game, tile.id) : undefined;
  const limit =
    facility && actions.onExpand
      ? facilityExpansionQuote(
          game,
          facility.id,
          (facility.peakWh ?? facility.peakW) + 1,
        )
      : undefined;
  const showBuild =
    !projectSite &&
    tile &&
    view?.owned &&
    view.developed &&
    !view.reserved &&
    !view.facility &&
    tileHasConstructionTechnology(tile);
  const tileActions: ContextMenuAction[] = [];
  if (projectSite) {
    tileActions.push({
      label: "Choose site",
      icon: <ConceptIcon concept="build" fontSize="small" decorative />,
      disabled: busy,
      onSelect: onChooseSite,
    });
  }
  if (acquisitionId) {
    tileActions.push({
      label: offer
        ? `Acquire (${formatPurchasePrice(offer.equityPrice)})`
        : "Acquire",
      icon: <ConceptIcon concept="buy" fontSize="small" decorative />,
      disabled: busy || !canAcquire,
      onSelect: () => onAcquire(acquisitionId),
    });
  } else if (quote) {
    tileActions.push({
      label: `Connect (${formatPurchasePrice(quote.price)})`,
      detail:
        quote.price > availableCash
          ? `${formatMoneyConcise(quote.price - availableCash)} more cash needed.`
          : undefined,
      icon: <ConceptIcon concept="buy" fontSize="small" decorative />,
      disabled: busy || pendingIds.size > 0 || quote.price > availableCash,
      onSelect: () => void purchase(quote.tileId, quote.quoteKey),
    });
  }
  if (showBuild) {
    tileActions.push({
      label: "Build",
      icon: <ConceptIcon concept="build" fontSize="small" decorative />,
      disabled: busy,
      onSelect: onBuild,
    });
  }
  const canCancelCapacity = !!(
    facility?.expansionInProgress && actions.onCancelExpansion
  );
  if (limit?.status === "ready" || canCancelCapacity) {
    tileActions.push({
      label: canCancelCapacity ? "Cancel capacity upgrade" : "Upgrade capacity",
      icon: canCancelCapacity ? (
        facilityActionIcon("cancelUpgrade", "small")
      ) : (
        <ConceptIcon concept="build" fontSize="small" decorative />
      ),
      disabled: busy,
      onSelect: onExpand,
    });
  }
  const caption =
    !tile || facility
      ? undefined
      : tile.city
        ? (tile.city.name ?? citySizeLabel(tile.city.size))
        : TERRAIN_LABELS[tile.terrain];
  return (
    <FacilityContextMenu
      game={game}
      target={
        anchor && tile
          ? {
              top: anchor.top,
              left: anchor.left,
              ids: facility ? [facility.id] : [],
            }
          : null
      }
      tileActions={tileActions}
      tileCaption={caption}
      onClose={onClose}
      onPause={actions.onPause}
      onTogglePause={actions.onTogglePause}
      onSell={actions.onSell}
      onRetrofit={actions.onRetrofit}
      onCancelRetrofit={actions.onCancelRetrofit}
    />
  );
}

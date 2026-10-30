import { facilityActionName } from "../base/FacilityLabels";
import * as React from "react";
import {
  DialogContentText,
  Divider,
  ListSubheader,
  Menu,
  MenuItem,
} from "@mui/material";
import {
  FacilityOperatingType,
  GameType,
  RetrofitFacilityAction,
} from "../../Types";
import {
  facilityResilienceSummary,
  isUpgradingAt,
} from "../../helpers/Hazards";
import { gasConversionQuote } from "../../helpers/GasConversion";
import { currentCash } from "../../helpers/GameSelectors";
import { facilityCashBack } from "../../helpers/Financials";
import { formatFacilitySize, formatMoneyConcise } from "../../helpers/Format";
import ConfirmDialog from "../base/ConfirmDialog";
import type { DispatchProps } from "./Facilities";

export interface FacilityMenuTarget {
  ids: number[];
  top: number;
  left: number;
}

type ActionKey =
  | "pause"
  | "resume"
  | "cancelUpgrade"
  | "cancelConstruction"
  | "sell"
  | RetrofitFacilityAction["upgrade"];
interface FleetAction {
  key: ActionKey;
  label: string;
  facilities: FacilityOperatingType[];
  cost?: number;
  confirm?: boolean;
}

function actionsFor(
  game: GameType,
  facilities: FacilityOperatingType[],
): FleetAction[] {
  const operating = facilities.filter(
    (f) => f.yearsToBuildLeft <= 0 && !isUpgradingAt(f, game.date.minute),
  );
  const upgrades: FleetAction[] = [
    {
      key: "hailResistant",
      label: "Add hail-resistant panels",
      facilities: [],
      cost: 0,
      confirm: true,
    },
    {
      key: "coldWeatherPackage",
      label: "Add cold-weather package",
      facilities: [],
      cost: 0,
      confirm: true,
    },
    {
      key: "combinedCycle",
      label: "Convert to combined cycle",
      facilities: [],
      cost: 0,
      confirm: true,
    },
  ];
  for (const facility of facilities) {
    const resilience = facilityResilienceSummary(game, facility);
    const conversion = gasConversionQuote(facility, game);
    for (const action of upgrades) {
      const cost =
        action.key === "combinedCycle"
          ? conversion?.cost
          : resilience?.upgrade === action.key
            ? resilience.retrofitCost
            : undefined;
      if (cost !== undefined) {
        action.facilities.push(facility);
        action.cost! += cost;
      }
    }
  }
  return [
    ...upgrades,
    {
      key: "pause",
      label: "Pause",
      facilities: operating.filter((f) => !f.paused),
    },
    {
      key: "resume",
      label: "Resume",
      facilities: operating.filter((f) => f.paused),
    },
    {
      key: "cancelUpgrade",
      label: "Cancel upgrade",
      facilities: facilities.filter((f) => !!f.upgradeInProgress),
    },
    {
      key: "cancelConstruction",
      label: "Cancel construction",
      facilities: facilities.filter((f) => f.yearsToBuildLeft > 0),
      confirm: true,
    },
    {
      key: "sell",
      label: "Sell",
      facilities: facilities.filter((f) => f.yearsToBuildLeft <= 0),
      confirm: true,
    },
  ];
}

export default function FacilityContextMenu(props: {
  game: GameType;
  target: FacilityMenuTarget | null;
  onClose: () => void;
  onMenuExited?: () => void;
  onSell: DispatchProps["onSell"];
  onTogglePause: DispatchProps["onTogglePause"];
  onPause: DispatchProps["onPause"];
  onRetrofit?: DispatchProps["onRetrofit"];
  onCancelRetrofit?: DispatchProps["onCancelRetrofit"];
}) {
  const [pending, setPending] = React.useState<{
    key: ActionKey;
    ids: number[];
  } | null>(null);
  const { game, target } = props;
  const selected = game.facilities.filter((f) => target?.ids.includes(f.id));
  const offered = actionsFor(game, selected).filter(
    (action) =>
      action.facilities.length &&
      (action.cost === undefined || props.onRetrofit) &&
      (action.key !== "cancelUpgrade" || props.onCancelRetrofit),
  );
  // Requote only the original targets on every render: the clock may complete work, retire a
  // plant, or change cash while a confirmation is open. Never substitute another facility.
  const confirmation = pending
    ? actionsFor(
        game,
        game.facilities.filter((f) => pending.ids.includes(f.id)),
      ).find((action) => action.key === pending.key)
    : undefined;
  const affected = confirmation?.facilities ?? [];
  const cost = confirmation?.cost;
  const shortfall =
    cost === undefined ? 0 : Math.max(0, cost - currentCash(game));
  const cashBack = affected.reduce(
    (sum, facility) => sum + facilityCashBack(facility, game.date.minute),
    0,
  );
  const loans = affected.reduce(
    (sum, facility) => sum + facility.loanAmountLeft,
    0,
  );
  const execute = (action: FleetAction) => {
    for (const facility of action.facilities) {
      switch (action.key) {
        case "pause":
          if (action.facilities.length === 1)
            props.onPause(facility.id, facilityActionName(facility));
          else props.onTogglePause(facility.id);
          break;
        case "resume":
          props.onTogglePause(facility.id);
          break;
        case "cancelUpgrade":
          props.onCancelRetrofit?.(facility.id);
          break;
        case "cancelConstruction":
        case "sell":
          props.onSell(facility.id);
          break;
        default:
          props.onRetrofit?.({ facilityId: facility.id, upgrade: action.key });
      }
    }
  };
  const actionLabel = (action: FleetAction, bulk: boolean) =>
    `${action.label}${bulk ? ` (${action.facilities.length})` : ""}${action.cost !== undefined ? ` · ${formatMoneyConcise(action.cost)}` : ""}`;
  const title =
    selected.length === 1
      ? `${formatFacilitySize(selected[0])} ${facilityActionName(selected[0])}`
      : null;
  return (
    <>
      <Menu
        open={!!target && selected.length > 0}
        onClose={props.onClose}
        anchorReference="anchorPosition"
        anchorPosition={
          target ? { top: target.top, left: target.left } : undefined
        }
        slotProps={{
          list: { "aria-label": "Facility actions" },
          paper: { className: "facilityContextMenu" },
          transition: { onExited: props.onMenuExited },
        }}
      >
        {title && <ListSubheader disableSticky>{title}</ListSubheader>}
        {offered.flatMap((action, index) => [
          ...(action.key === "sell" && index > 0
            ? [<Divider key="sale-divider" />]
            : []),
          <MenuItem
            key={action.key}
            disabled={
              action.cost !== undefined && action.cost > currentCash(game)
            }
            onClick={() => {
              props.onClose();
              if (action.confirm)
                setPending({
                  key: action.key,
                  ids: action.facilities.map((f) => f.id),
                });
              else execute(action);
            }}
          >
            {actionLabel(action, selected.length > 1)}
          </MenuItem>,
        ])}
        {offered.some(
          (action) =>
            action.cost !== undefined && action.cost > currentCash(game),
        ) && (
          <ListSubheader disableSticky className="facilityMenuHint">
            More cash needed for disabled upgrades
          </ListSubheader>
        )}
      </Menu>
      {pending && confirmation && (
        <ConfirmDialog
          open
          title={`${confirmation.label}${affected.length === 1 ? `: ${formatFacilitySize(affected[0])} ${facilityActionName(affected[0])}` : `: ${affected.length} facilities`}?`}
          confirmLabel={
            cost !== undefined
              ? `Pay ${formatMoneyConcise(cost)}`
              : confirmation.label
          }
          confirmDisabled={!affected.length || shortfall > 0}
          destructive={cost === undefined}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            if (affected.length && shortfall <= 0) execute(confirmation);
            setPending(null);
          }}
        >
          <DialogContentText>
            {affected
              .map((f) => `${formatFacilitySize(f)} ${facilityActionName(f)}`)
              .join(", ") ||
              "These facilities are no longer available for this action."}
          </DialogContentText>
          {cost !== undefined ? (
            <>
              <DialogContentText>
                {confirmation.key === "combinedCycle"
                  ? "Use less gas for the same power. Six months offline; slower starts and 45% minimum output afterward."
                  : confirmation.key === "coldWeatherPackage"
                    ? "Staged installation keeps 90% of capacity available for a month. Improves protection against extreme cold."
                    : "Offline for one month. Less damage from future hail; current repairs still need to finish."}{" "}
                Cancel before completion for a full refund.
              </DialogContentText>
              {shortfall > 0 && (
                <DialogContentText>
                  {formatMoneyConcise(shortfall)} more cash needed.
                </DialogContentText>
              )}
            </>
          ) : (
            <>
              <DialogContentText>
                You will receive {formatMoneyConcise(cashBack)}.
                {loans > 0
                  ? ` The rest goes toward remaining loans of ${formatMoneyConcise(loans)}.`
                  : ""}
              </DialogContentText>
              {affected.some((f) => f.hydroSiteId) && (
                <DialogContentText>
                  {confirmation.key === "cancelConstruction"
                    ? "Cancelling frees the hydro sites."
                    : "Selling won't free the hydro sites."}
                </DialogContentText>
              )}
            </>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

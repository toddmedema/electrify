import * as React from "react";
import { Button, DialogContentText, Typography } from "@mui/material";
import {
  FacilityOperatingType,
  GameType,
  RetrofitFacilityAction,
  isStorage,
} from "../../Types";
import {
  facilityCashBack,
  facilityLoanBalance,
  facilityPermanentlyShutdown,
} from "../../helpers/Financials";
import { coalRepowerInProgress } from "../../helpers/CoalRepower";
import { isUpgradingAt, upgradeInProgress } from "../../helpers/Hazards";
import {
  formatBuildMonths,
  formatFacilitySize,
  formatWattsOfPeak,
  formatWattHoursOfPeak,
} from "../../helpers/Format";
import { facilityActionIcon } from "../views/FacilityContextMenu";
import { facilityOperatingStatus } from "./FacilityMapStatus";
import { useMoney } from "./CurrencyContext";
import ConfirmDialog from "./ConfirmDialog";
import FacilityDetails from "./FacilityDetails";
import type { FacilityCapacityUpgradeActions } from "./FacilityCapacityUpgrade";

export interface FacilityDetailActions extends FacilityCapacityUpgradeActions {
  onSell: (id: number) => void;
  onTogglePause: (id: number) => void;
  onPause: (id: number, name: string) => void;
  onRetrofit?: (payload: RetrofitFacilityAction) => void;
  onCancelRetrofit?: (id: number) => void;
}

function FacilityActions(props: {
  facility: FacilityOperatingType;
  upgrading: boolean;
  permanentlyShutdown: boolean;
  onPause: FacilityDetailActions["onPause"];
  onTogglePause: FacilityDetailActions["onTogglePause"];
  onCancelRetrofit?: FacilityDetailActions["onCancelRetrofit"];
  onOpenSell: () => void;
}) {
  const {
    facility,
    onOpenSell,
    onPause,
    onTogglePause,
    upgrading,
    permanentlyShutdown,
    onCancelRetrofit,
  } = props;
  const underConstruction = facility.yearsToBuildLeft > 0;
  const repowering = !!coalRepowerInProgress(facility);
  if (permanentlyShutdown && facility.saleRestricted)
    return (
      <div className="facilityActions">
        <Typography
          variant="caption"
          color="textSecondary"
          className="facilityActionNote"
        >
          This plant can't be sold.
        </Typography>
      </div>
    );
  return (
    <div className="facilityActions">
      {upgrading && !permanentlyShutdown && onCancelRetrofit && (
        // Cancellation returns the paid project equity.
        <Button
          className="facilityCancelConstruction"
          variant="outlined"
          startIcon={facilityActionIcon("cancelUpgrade")}
          aria-label={`Cancel ${repowering ? "conversion" : "upgrade"} of ${facility.name}`}
          onClick={() => onCancelRetrofit(facility.id)}
        >
          <span className="facilityActionLabel">
            {repowering ? "Cancel conversion" : "Cancel upgrade"}
          </span>
        </Button>
      )}
      {!underConstruction &&
        (!upgrading || repowering) &&
        !permanentlyShutdown && (
          <Button
            variant="outlined"
            startIcon={facilityActionIcon(facility.paused ? "resume" : "pause")}
            aria-label={
              facility.paused
                ? "Resume " + facility.name
                : "Pause " + facility.name
            }
            onClick={() =>
              facility.paused
                ? onTogglePause(facility.id)
                : onPause(facility.id, facility.name)
            }
          >
            <span className="facilityActionLabel">
              {facility.paused ? "Resume" : "Pause"}
            </span>
          </Button>
        )}
      {facility.saleRestricted ? (
        <Typography
          variant="caption"
          color="textSecondary"
          className="facilityActionNote"
        >
          This plant can't be sold.
        </Typography>
      ) : (
        !repowering && (
          <Button
            className={
              underConstruction ? "facilityCancelConstruction" : undefined
            }
            variant="outlined"
            startIcon={facilityActionIcon(
              underConstruction ? "cancelConstruction" : "sell",
            )}
            aria-label={
              (underConstruction ? "Cancel construction of " : "Sell ") +
              facility.name
            }
            onClick={onOpenSell}
          >
            <span className="facilityActionLabel">
              {underConstruction ? "Cancel construction" : "Sell"}
            </span>
          </Button>
        )
      )}
    </div>
  );
}

const MemoizedFacilityActions = React.memo(
  FacilityActions,
  (previous, next) => {
    const previousUnderConstruction = previous.facility.yearsToBuildLeft > 0;
    const nextUnderConstruction = next.facility.yearsToBuildLeft > 0;
    return (
      previous.facility.id === next.facility.id &&
      previous.facility.name === next.facility.name &&
      previous.facility.paused === next.facility.paused &&
      previous.facility.saleRestricted === next.facility.saleRestricted &&
      previousUnderConstruction === nextUnderConstruction &&
      previous.upgrading === next.upgrading &&
      !!coalRepowerInProgress(previous.facility) ===
        !!coalRepowerInProgress(next.facility) &&
      previous.permanentlyShutdown === next.permanentlyShutdown &&
      previous.onCancelRetrofit === next.onCancelRetrofit &&
      previous.onPause === next.onPause &&
      previous.onTogglePause === next.onTogglePause &&
      previous.onOpenSell === next.onOpenSell
    );
  },
);

/** The fleet row and tile inspector share the same controls, financial detail and sale review. */
export default function ExpandedFacilityDetails({
  facility,
  game,
  showStatus,
  ...actions
}: {
  facility: FacilityOperatingType;
  game: GameType;
  showStatus?: boolean;
} & FacilityDetailActions) {
  const { formatMoneyConcise } = useMoney();
  const [open, setOpen] = React.useState(false);
  const underConstruction = facility.yearsToBuildLeft > 0;
  const installing = upgradeInProgress(facility);
  const repowering = !!coalRepowerInProgress(facility);
  const loanBalance = facilityLoanBalance(facility);
  const permanentlyShutdown = facilityPermanentlyShutdown(
    facility,
    game.date.minute,
  );
  const status = facilityOperatingStatus(facility, game.date.minute);
  return (
    <>
      {showStatus && (
        <Typography variant="body2" className="tileFacilityStatus">
          {status.label}
          {underConstruction
            ? ` · ${formatBuildMonths(facility.yearsToBuildLeft, "long")} left`
            : isStorage(facility)
              ? ` · ${formatWattsOfPeak(facility.currentW, facility.peakW)} · ${formatWattHoursOfPeak(facility.currentWh, facility.peakWh)}`
              : ` · ${formatWattsOfPeak(facility.currentW, facility.peakW)}`}
        </Typography>
      )}
      {open && (
        <ConfirmDialog
          open
          destructive
          isolateClicks
          title={
            <>
              {underConstruction ? "Cancel construction of" : "Sell"}{" "}
              {formatFacilitySize(facility)}{" "}
              {facility.name === facility.name
                ? facility.name.toLowerCase()
                : facility.name}{" "}
              facility?
            </>
          }
          cancelLabel="Never mind"
          confirmLabel={underConstruction ? "Cancel construction" : "Sell"}
          confirmDisabled={repowering}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            actions.onSell(facility.id);
            setOpen(false);
          }}
        >
          {facility.hydroSiteId && (
            <DialogContentText>
              {underConstruction
                ? "Canceling frees this site."
                : "Selling won't free this site."}
            </DialogContentText>
          )}
          {repowering ? (
            <DialogContentText>
              Cancel the conversion before selling this plant.
            </DialogContentText>
          ) : (
            <DialogContentText>
              You will receive{" "}
              {formatMoneyConcise(facilityCashBack(facility, game.date.minute))}
              {loanBalance > 0
                ? ` and the rest will go towards paying off the remaining loan balance of ${formatMoneyConcise(loanBalance)}`
                : ""}
              .
            </DialogContentText>
          )}
        </ConfirmDialog>
      )}
      <FacilityDetails
        facility={facility}
        date={game.date}
        seed={game.seed}
        location={game.location}
        game={game}
        onRetrofit={actions.onRetrofit}
        onExpand={actions.onExpand}
        onCancelExpansion={actions.onCancelExpansion}
      />
      <MemoizedFacilityActions
        facility={facility}
        upgrading={!!installing && isUpgradingAt(facility, game.date.minute)}
        permanentlyShutdown={permanentlyShutdown}
        onPause={actions.onPause}
        onTogglePause={actions.onTogglePause}
        onCancelRetrofit={actions.onCancelRetrofit}
        onOpenSell={() => setOpen(true)}
      />
    </>
  );
}

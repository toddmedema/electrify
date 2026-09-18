import * as React from "react";
import { Typography } from "@mui/material";
import { MONTH_NAMES, MONTHS, TICKS_PER_YEAR } from "../../Constants";
import { MANUAL_ENTRY } from "../../data/Manual";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { formatWattHours, formatWattHoursOfPeak } from "../../helpers/Format";
import {
  describeHydroStatus,
  ReservoirOutlookPoint,
  reservoirOutlook,
} from "../../helpers/HydroOutlook";
import { generateNewTimeline } from "../../reducers/Game";
import { FacilityOperatingType, GameType } from "../../Types";
import ManualLink from "./ManualLink";
import Sparkline from "./Sparkline";

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

/**
 * The year ahead only changes meaningfully when the month or the operating fleet does, so the
 * forecast is kept until one of those moves rather than re-simulated on every throttled render.
 */
function useReservoirOutlook(
  game: GameType,
): ReservoirOutlookPoint[] | undefined {
  const cache = React.useRef<{
    key: string;
    outlook?: ReservoirOutlookPoint[];
  }>();
  const key = [
    game.date.year,
    game.date.monthNumber,
    game.facilities
      .filter((f) => f.fuel === "Hydro" && f.yearsToBuildLeft === 0)
      .map((f) => f.id)
      .join(","),
  ].join("|");
  if (cache.current?.key !== key) {
    const now = getTimeFromTimeline(game.date.minute, game.timeline);
    cache.current = {
      key,
      outlook: now
        ? reservoirOutlook(
            now,
            generateNewTimeline(game, now.cash, now.customers, TICKS_PER_YEAR),
            game.startingYear,
          )
        : undefined,
    };
  }
  return cache.current.outlook;
}

function Stat(props: { label: string; value: React.ReactNode }) {
  return (
    <div className="facilityStat">
      <Typography variant="caption" color="textSecondary" component="dt">
        {props.label}
      </Typography>
      <Typography variant="body2" component="dd" className="facilityStatValue">
        {props.value}
      </Typography>
    </div>
  );
}

/** Why a dam is producing what it is, and where its water is heading, beside the dam itself. */
export default function HydroWaterSection(props: {
  facility: FacilityOperatingType;
  game: GameType;
}): React.JSX.Element {
  const { facility, game } = props;
  const outlook = useReservoirOutlook(game);
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  const capacityWh = facility.reservoirCapacityWh || 0;
  const heading = (
    <Typography component="h3" className="facilityDetailHeading">
      Water
      <ManualLink entry={MANUAL_ENTRY.HYDROPOWER} label="hydropower" />
    </Typography>
  );

  if (facility.yearsToBuildLeft > 0) {
    return (
      <section className="facilityDetailSection" aria-label="Water">
        {heading}
        <Typography variant="body2" className="facilityWaterStatus">
          Opens half full.
        </Typography>
      </section>
    );
  }

  const fleet =
    game.facilities.filter(
      (f) => f.fuel === "Hydro" && f.yearsToBuildLeft === 0,
    ).length > 1;
  const fraction =
    capacityWh > 0 ? (facility.reservoirWh || 0) / capacityWh : 0;
  const status = describeHydroStatus({
    fraction,
    spilling: (facility.hydroLastSpillWh || 0) > 0,
    monthNumber: game.date.monthNumber,
    latitude: game.location.lat,
    outlook,
    fleet,
  });
  const values = outlook?.map((point) => point.fraction) || [];
  const lowIndex = values.reduce(
    (low, value, index) => (value < values[low] ? index : low),
    0,
  );
  const lowPoint = outlook?.[lowIndex];
  // The combined level would contradict this dam's own Reservoir stat above, so it's only
  // shown for a lone dam
  const outlookLabel = [
    fleet ? undefined : `Now ${percent(values[0])}`,
    lowIndex > 0 && lowPoint
      ? `Low ${MONTHS[lowPoint.monthNumber - 1]} ${percent(lowPoint.fraction)}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  // A line pressed flat against the baseline says nothing a sentence can't say better
  const emptyAllYear = values.every((value) => value <= 0.02);

  return (
    <section className="facilityDetailSection" aria-label="Water">
      {heading}
      <Typography variant="body2" className="facilityWaterStatus">
        <strong className={status.tone}>{status.lead}</strong> {status.detail}
      </Typography>
      <dl className="facilityStats">
        <Stat
          label="Reservoir"
          value={formatWattHoursOfPeak(facility.reservoirWh || 0, capacityWh)}
        />
        <Stat
          label="Inflow this month"
          value={
            now
              ? formatWattHours(
                  (facility.hydroWhPerMm || 0) * now.hydroRunoffMm,
                )
              : "—"
          }
        />
      </dl>
      {values.length > 2 && lowPoint && (
        <figure className="facilityWaterOutlook">
          <Typography
            variant="caption"
            color="textSecondary"
            component="figcaption"
          >
            {fleet ? "All your dams, next 12 months" : "Next 12 months"}
            {/* A lone dam's status already says no refill is coming */}
            {emptyAllYear && fleet && ": no refill expected"}
          </Typography>
          {!emptyAllYear && (
            <div className="facilityTrend">
              <Sparkline
                values={values}
                domain={[0, 1]}
                width={144}
                height={28}
                fill
                baseline
                lowMarker
                ariaLabel={`Reservoir forecast for the next ${values.length - 1} months: now ${percent(values[0])}, lowest in ${MONTH_NAMES[lowPoint.monthNumber - 1]} at ${percent(lowPoint.fraction)}.`}
              />
              {outlookLabel && (
                <Typography variant="caption" color="textSecondary">
                  {outlookLabel}
                </Typography>
              )}
            </div>
          )}
        </figure>
      )}
    </section>
  );
}

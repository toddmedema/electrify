import * as React from "react";
import { Typography } from "@mui/material";
import { TICKS_PER_YEAR } from "../../Constants";
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

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

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
          Opens half full. After that, rain and snowmelt refill it and
          generating drains it.
        </Typography>
      </section>
    );
  }

  const fraction =
    capacityWh > 0 ? (facility.reservoirWh || 0) / capacityWh : 0;
  const status = describeHydroStatus({
    fraction,
    spilling: (facility.hydroLastSpillWh || 0) > 0,
    monthNumber: game.date.monthNumber,
    latitude: game.location.lat,
    outlook,
  });
  const values = outlook?.map((point) => point.fraction) || [];
  const lowIndex = values.reduce(
    (low, value, index) => (value < values[low] ? index : low),
    0,
  );
  const lowPoint = outlook?.[lowIndex];

  return (
    <section className="facilityDetailSection" aria-label="Water">
      {heading}
      <Typography
        variant="body2"
        className={`facilityWaterStatus${status.tone ? ` ${status.tone}` : ""}`}
      >
        {status.text}
      </Typography>
      <dl className="facilityStats">
        <Stat
          label="Reservoir"
          value={formatWattHoursOfPeak(facility.reservoirWh || 0, capacityWh)}
        />
        <Stat
          label="Water in this month"
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
            Reservoir, next 12 months
          </Typography>
          <div className="facilityTrend">
            <Sparkline
              values={values}
              domain={[0, 1]}
              width={144}
              height={28}
              fill
              baseline
              lowMarker
              ariaLabel={`Reservoir forecast for the next ${values.length - 1} months: now ${percent(values[0])}, lowest in ${MONTHS_SHORT[lowPoint.monthNumber - 1]} at ${percent(lowPoint.fraction)}.`}
            />
            <Typography variant="caption" color="textSecondary">
              Low {MONTHS_SHORT[lowPoint.monthNumber - 1]}{" "}
              {percent(lowPoint.fraction)}
            </Typography>
          </div>
        </figure>
      )}
    </section>
  );
}

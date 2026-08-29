import * as React from "react";
import { Typography } from "@mui/material";
import { getFuelPricesPerMBTU } from "../../data/FuelPrices";
import {
  facilityAgeYears,
  facilityEquivalentCycles,
  facilityEquivalentOperatingHours,
  facilityLifetime,
  facilityOutputFactor,
} from "../../helpers/Financials";
import {
  formatMoneyConcise,
  formatWattHours,
  formatWattHoursOfPeak,
  formatWatts,
} from "../../helpers/Format";
import { facilityColor } from "../../Theme";
import {
  DateType,
  FacilityOperatingType,
  FuelNameType,
  GeneratorOperatingType,
  LocationType,
  StorageOperatingType,
} from "../../Types";
import Sparkline from "./Sparkline";

/**
 * What a selected facility has actually been doing: how hard it has run, what a MWh out of it
 * costs against what it fetches, what it has made or lost, and - for anything that burns
 * something - where the price of that something has been heading.
 *
 * All of it comes off totals the simulation already keeps (see LifetimeTotals) plus the fuel
 * price table, so opening a row costs a handful of lookups rather than a re-simulation.
 */

// How far back the fuel price trend looks. A year is long enough to show a direction and short
// enough that the last few months are still legible in 72 pixels
const TREND_MONTHS = 12;

export interface Props {
  facility: FacilityOperatingType;
  date: DateType;
  seed: number;
  location: LocationType;
}

interface StatProps {
  label: string;
  value: string;
  // Profit is the one number here that means something different either side of zero
  tone?: "good" | "bad";
}

function Stat(props: StatProps): React.JSX.Element {
  return (
    <div className="facilityStat">
      <Typography variant="caption" color="textSecondary" component="div">
        {props.label}
      </Typography>
      <Typography
        variant="body2"
        component="div"
        className={props.tone ? `facilityStatValue ${props.tone}` : undefined}
      >
        {props.value}
      </Typography>
    </div>
  );
}

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

/**
 * The last year of this fuel's price, oldest first. Empty when the game hasn't been running long
 * enough for a trend, or when the price table isn't loaded - which is every render outside a real
 * game, and not worth a crash in a list row.
 */
export function fuelPriceTrend(
  fuel: FuelNameType,
  date: DateType,
  seed: number,
  location?: LocationType,
): number[] {
  const months = Math.min(TREND_MONTHS, date.monthsEllapsed + 1);
  if (months < 2) {
    return [];
  }
  const prices: number[] = [];
  try {
    for (let back = months - 1; back >= 0; back--) {
      // monthNumber is 1-12, so shift to a 0-based count of months before dividing it back out
      const absolute = date.year * 12 + (date.monthNumber - 1) - back;
      const price = getFuelPricesPerMBTU(
        {
          year: Math.floor(absolute / 12),
          monthNumber: (absolute % 12) + 1,
        } as DateType,
        seed,
        location,
      )[fuel];
      if (price === undefined) {
        return [];
      }
      prices.push(price);
    }
  } catch {
    // The table is only loaded once a game is running; a row rendered before that just goes
    // without its trend line
    return [];
  }
  return prices;
}

export default function FacilityDetails(props: Props): React.JSX.Element {
  const { facility, date, seed, location } = props;
  const lifetime = facilityLifetime(facility);
  const fuel = (facility as Partial<GeneratorOperatingType>).fuel;
  const isStorage = facility.peakWh > 0;
  const accentColor = facilityColor(fuel);
  const underConstruction = facility.yearsToBuildLeft > 0;
  const isHydro = fuel === "Hydro" && !!facility.reservoirCapacityWh;
  const ageYears = facilityAgeYears(facility, date.minute);
  const outputFactor = facilityOutputFactor(facility, date.minute);
  const equivalentCycles = facilityEquivalentCycles(facility);
  const equivalentOperatingHours = facilityEquivalentOperatingHours(facility);

  const trend = fuel ? fuelPriceTrend(fuel, date, seed, location) : [];
  const trendChange =
    trend.length > 1 && trend[0] > 0
      ? trend[trend.length - 1] / trend[0] - 1
      : 0;

  return (
    <div className="facilityDetails">
      <div className="facilityStats">
        {underConstruction ? (
          <Stat
            label="Completes in"
            value={`${Math.ceil(facility.yearsToBuildLeft * 12)} months`}
          />
        ) : (
          <>
            <Stat
              label="Age / design life"
              value={`${ageYears.toFixed(1)} / ${facility.lifespanYears} yr${ageYears >= facility.lifespanYears ? " · beyond" : ""}`}
            />
            <Stat
              // Capacity factor is the generator's word for it; a battery isn't producing
              // anything, it's being used or it isn't
              label={isStorage ? "Utilization" : "Capacity factor"}
              value={
                lifetime.capacityFactor === undefined
                  ? "—"
                  : percent(lifetime.capacityFactor)
              }
            />
          </>
        )}
        <Stat
          label="Cost"
          value={
            lifetime.costPerMWh === undefined
              ? "—"
              : `${formatMoneyConcise(lifetime.costPerMWh)}/MWh`
          }
        />
        <Stat
          label="Earned"
          value={
            lifetime.revenuePerMWh === undefined
              ? "—"
              : `${formatMoneyConcise(lifetime.revenuePerMWh)}/MWh`
          }
        />
        <Stat
          label="Lifetime profit"
          value={formatMoneyConcise(lifetime.profit)}
          tone={lifetime.profit < 0 ? "bad" : "good"}
        />
        <Stat label="Delivered" value={formatWattHours(lifetime.wh)} />
        {isStorage && (
          <Stat
            label="Charge"
            value={formatWattHoursOfPeak(
              facility.currentWh,
              (facility as StorageOperatingType).peakWh,
            )}
          />
        )}
        {facility.name === "Battery" && equivalentCycles !== undefined && (
          <Stat
            label="Equivalent cycles"
            value={`${Math.round(equivalentCycles).toLocaleString()} / 7,300`}
          />
        )}
        {!isStorage && equivalentOperatingHours !== undefined && (
          <Stat
            label="Equivalent operating hours"
            value={Math.round(equivalentOperatingHours).toLocaleString()}
          />
        )}
        {facility.tracksStarts && (
          <Stat
            label="Equivalent starts"
            value={Math.round(facility.lifetimeStarts || 0).toLocaleString()}
          />
        )}
        {facility.tracksStarts && fuel === "Natural Gas" && (
          <Stat
            label="Service intervals"
            value="HGP 900 · major 1,800 starts"
          />
        )}
        {facility.costPerStart !== undefined && (
          <Stat
            label="Non-fuel start cost"
            value={`${formatMoneyConcise(facility.costPerStart)}/start`}
          />
        )}
        {facility.tracksStarts && (
          <Stat
            label="Start accounting"
            value="Each simulated day represents its month"
          />
        )}
        {isHydro && (
          <Stat
            label="Reservoir"
            value={formatWattHoursOfPeak(
              facility.reservoirWh || 0,
              facility.reservoirCapacityWh || 0,
            )}
          />
        )}
        {isHydro && (
          <Stat
            label="Last inflow"
            value={formatWattHours(facility.hydroLastInflowWh || 0)}
          />
        )}
        {isHydro && (
          <Stat
            label="Last spill"
            value={formatWattHours(facility.hydroLastSpillWh || 0)}
          />
        )}
        {isStorage && (
          <Stat
            label="Round trip"
            value={percent(
              (facility as StorageOperatingType).roundTripEfficiency,
            )}
          />
        )}
        {!isStorage && (
          <Stat label="Nameplate" value={formatWatts(facility.peakW)} />
        )}
        {!isStorage && outputFactor < 1 && (
          <Stat
            label="Effective max"
            value={`${formatWatts(facility.peakW * outputFactor)} · ${percent(outputFactor)} health`}
          />
        )}
        {facility.loanAmountLeft > 0 && (
          <Stat
            label="Loan left"
            value={formatMoneyConcise(facility.loanAmountLeft)}
          />
        )}
        {trend.length > 1 && fuel && (
          <div className="facilityStat">
            <Typography variant="caption" color="textSecondary" component="div">
              {fuel} price, {trend.length}mo
            </Typography>
            <div className="facilityTrend">
              <Sparkline
                values={trend}
                color={accentColor}
                ariaLabel={`${fuel} price over the last ${trend.length} months, ${trendChange >= 0 ? "up" : "down"} ${Math.abs(Math.round(trendChange * 100))} percent`}
              />
              <Typography
                variant="body2"
                component="span"
                className={`facilityStatValue ${trendChange > 0 ? "bad" : "good"}`}
              >
                {trendChange >= 0 ? "+" : ""}
                {Math.round(trendChange * 100)}%
              </Typography>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

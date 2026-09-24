import { HYDRO_SITES } from "../../data/HydroSites";
import * as React from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography,
} from "@mui/material";
import { getFuelPricesPerMBTU } from "../../data/FuelPrices";
import {
  facilityAgeYears,
  facilityEquivalentCycles,
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
import { getTimeFromTimeline } from "../../helpers/DateTime";
import {
  annualInsuranceCost,
  facilityHazardStatus,
  facilityResilienceSummary,
  FacilityResilienceSummaryType,
  retrofittedResilience,
} from "../../helpers/Hazards";
import { STANDARD_GAS_DESIGN_MIN_TEMP_C } from "../../data/Hazards";
import { useUnits } from "./UnitsContext";
import {
  coldPackageEffect,
  dayCount,
  formatDesignTemperature,
  insuranceChange,
  resilienceActionLabel,
} from "./WeatherResilienceText";
import {
  DateType,
  FacilityOperatingType,
  FuelNameType,
  GameType,
  GeneratorOperatingType,
  LocationType,
  RetrofitFacilityAction,
  StorageOperatingType,
} from "../../Types";
import HydroWaterSection from "./HydroWaterSection";
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
  /** Needed by a hydro plant's water outlook and by the weather resilience section */
  game?: GameType;
  // A replay can inspect a facility's hardening but not buy any
  readOnly?: boolean;
  onRetrofit?: (payload: RetrofitFacilityAction) => void;
}

interface StatProps {
  label: string;
  value: React.ReactNode;
  // Profit is the one number here that means something different either side of zero
  tone?: "good" | "bad";
}

function Stat(props: StatProps): React.JSX.Element {
  return (
    <div className="facilityStat">
      <Typography variant="caption" color="textSecondary" component="dt">
        {props.label}
      </Typography>
      <Typography
        variant="body2"
        component="dd"
        className={`facilityStatValue${props.tone ? ` ${props.tone}` : ""}`}
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
  const months = Math.min(TREND_MONTHS, date.monthsElapsed + 1);
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

/**
 * How the facility is hardened against the weather hazard its technology faces, what that costs
 * in insurance, and - outside a replay - an offer to add the upgrade to the standing plant.
 */
function WeatherResilienceSection(props: {
  facility: FacilityOperatingType;
  game: GameType;
  summary: FacilityResilienceSummaryType;
  readOnly?: boolean;
  onRetrofit?: Props["onRetrofit"];
}): React.JSX.Element {
  const { facility, game, summary, onRetrofit } = props;
  const units = useUnits();
  const [confirming, setConfirming] = React.useState(false);
  // Paying removes the offer button, so focus moves to the section heading instead of the page
  const [focusHeading, setFocusHeading] = React.useState(0);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const shortfallId = React.useId();
  React.useEffect(() => {
    if (focusHeading > 0) {
      headingRef.current?.focus();
    }
  }, [focusHeading]);
  const hail = summary.upgrade === "hailResistant";
  const cost = summary.retrofitCost;
  const cash = getTimeFromTimeline(game.date.minute, game.timeline)?.cash ?? 0;
  const shortfall = cost === undefined ? 0 : Math.max(0, cost - cash);
  const shortfallText = `${formatMoneyConcise(shortfall)} more cash needed`;
  const canOffer = !props.readOnly && !!onRetrofit && cost !== undefined;
  const designMinTempC =
    facility.resilience?.designMinTempC ?? STANDARD_GAS_DESIGN_MIN_TEMP_C;
  const detail = hail
    ? summary.detail
    : `Rated to ${formatDesignTemperature(designMinTempC, units)}`;
  const actionLabel = resilienceActionLabel(summary.upgrade);
  const retrofitted = canOffer
    ? retrofittedResilience(facility, game, summary.upgrade)
    : undefined;
  const insuranceAfter =
    hail && retrofitted && summary.annualInsuranceCost !== undefined
      ? annualInsuranceCost({ ...facility, resilience: retrofitted }, game)
      : undefined;
  const hazard = facilityHazardStatus(game, facility);
  const activeOutage =
    hazard && (hazard.hazard === "HAIL") === hail
      ? hail
        ? "Doesn't speed up current repairs."
        : "Doesn't end this month's cold outage."
      : undefined;
  return (
    <section className="facilityDetailSection" aria-label="Weather resilience">
      <Typography
        component="h3"
        className="facilityDetailHeading"
        ref={headingRef}
        tabIndex={-1}
      >
        Weather resilience
      </Typography>
      <dl className="facilityStats">
        <Stat
          label={hail ? "Hail protection" : "Cold protection"}
          value={
            <>
              {summary.label}
              <span className="facilityStatNote">{detail}</span>
            </>
          }
        />
        {summary.annualInsuranceCost !== undefined && (
          <Stat
            label="Weather insurance"
            value={
              <>
                {formatMoneyConcise(summary.annualInsuranceCost)}/yr
                <span className="facilityStatNote">Charged with upkeep</span>
              </>
            }
          />
        )}
      </dl>
      {canOffer && (
        <div className="facilityRetrofit">
          <Button
            variant="outlined"
            color="primary"
            disabled={shortfall > 0}
            aria-describedby={shortfall > 0 ? shortfallId : undefined}
            onClick={() => setConfirming(true)}
          >
            {actionLabel} · {formatMoneyConcise(cost)}
          </Button>
          {shortfall > 0 && (
            <Typography
              id={shortfallId}
              variant="caption"
              color="textSecondary"
            >
              {shortfallText}
            </Typography>
          )}
        </div>
      )}
      {canOffer && confirming && (
        <Dialog
          open
          onClose={() => setConfirming(false)}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <DialogTitle>
            {actionLabel} to {facility.name}?
          </DialogTitle>
          <DialogContent className="facilityRetrofitDialog">
            <DialogContentText>
              {hail
                ? "Less damage from future hail."
                : coldPackageEffect(
                    retrofitted?.designMinTempC ?? designMinTempC,
                    designMinTempC,
                    units,
                  )}
            </DialogContentText>
            {insuranceAfter !== undefined && (
              <DialogContentText>
                {insuranceChange(
                  summary.annualInsuranceCost ?? 0,
                  insuranceAfter,
                )}
              </DialogContentText>
            )}
            {activeOutage && (
              <DialogContentText>{activeOutage}</DialogContentText>
            )}
            {shortfall > 0 && (
              <DialogContentText className="facilityRetrofitShortfall">
                {shortfallText}.
              </DialogContentText>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirming(false)} color="primary">
              Cancel
            </Button>
            <Button
              color="primary"
              variant="contained"
              autoFocus
              disabled={shortfall > 0}
              onClick={() => {
                onRetrofit?.({
                  facilityId: facility.id,
                  upgrade: summary.upgrade,
                });
                setConfirming(false);
                setFocusHeading((count) => count + 1);
              }}
            >
              Pay {formatMoneyConcise(cost)}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </section>
  );
}

export default function FacilityDetails(props: Props): React.JSX.Element {
  const { facility, date, seed, location } = props;
  const lifetime = facilityLifetime(facility);
  const fuel = (facility as Partial<GeneratorOperatingType>).fuel;
  const variableOperatingCostPerMWh = (
    facility as Partial<GeneratorOperatingType>
  ).variableOperatingCostPerMWh;
  const minimumStableOutput = (facility as Partial<GeneratorOperatingType>)
    .minimumStableOutput;
  const isStorage = facility.peakWh > 0;
  const accentColor = facilityColor(fuel);
  const underConstruction = facility.yearsToBuildLeft > 0;
  const isHydro = fuel === "Hydro" && !!facility.reservoirCapacityWh;
  const ageYears = facilityAgeYears(facility, date.minute);
  const outputFactor = facilityOutputFactor(facility, date.minute);
  const equivalentCycles = facilityEquivalentCycles(facility);
  const resilience = props.game
    ? facilityResilienceSummary(props.game, facility)
    : undefined;
  const hazard =
    props.game && !underConstruction
      ? facilityHazardStatus(props.game, facility)
      : undefined;
  // Age wear and an active weather outage both cap output, and the simulation multiplies them
  const maxOutputFactor = outputFactor * (hazard?.availableFraction ?? 1);
  const maxOutputCauses = [
    outputFactor < 1 ? "age" : "",
    hazard ? (hazard.hazard === "HAIL" ? "hail" : "cold") : "",
  ].filter(Boolean);

  // Price history only changes at a month boundary. Selected-facility lifetime totals still
  // refresh visually, but the twelve table lookups and sparkline input do not run every tick.
  const trend = React.useMemo(
    () =>
      fuel
        ? fuelPriceTrend(
            fuel,
            {
              year: date.year,
              monthNumber: date.monthNumber,
              monthsElapsed: date.monthsElapsed,
            } as DateType,
            seed,
            location,
          )
        : [],
    [fuel, date.year, date.monthNumber, date.monthsElapsed, seed, location],
  );
  const trendChange =
    trend.length > 1 && trend[0] > 0
      ? trend[trend.length - 1] / trend[0] - 1
      : 0;

  return (
    <div className="facilityDetails">
      {facility.hydroSiteId && (
        <Typography variant="body2">
          Hydro site:{" "}
          {HYDRO_SITES[facility.hydroSiteId]?.name || facility.hydroSiteId}
        </Typography>
      )}
      <section className="facilityDetailSection" aria-label="Operation">
        <Typography component="h3" className="facilityDetailHeading">
          Operation
        </Typography>
        <dl className="facilityStats">
          {underConstruction ? (
            <Stat
              label="Completes in"
              value={`${Math.ceil(facility.yearsToBuildLeft * 12)} months`}
            />
          ) : (
            <>
              <Stat
                label="Age"
                value={`${ageYears.toFixed(1)} / ${facility.lifespanYears} yr${ageYears >= facility.lifespanYears ? " · beyond" : ""}`}
              />
              <Stat
                // Capacity factor is the generator's word for it; a battery isn't producing
                // anything, it's being used or it isn't
                label={isStorage ? "Time in use" : "Avg output"}
                value={
                  lifetime.capacityFactor === undefined
                    ? "—"
                    : percent(lifetime.capacityFactor)
                }
              />
            </>
          )}
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
              label="Cycles"
              value={`${Math.round(equivalentCycles).toLocaleString()} / 7,300`}
            />
          )}
          {minimumStableOutput !== undefined && (
            <Stat
              label="Minimum stable output"
              value={`${percent(minimumStableOutput)} · ${formatWatts(facility.peakW * minimumStableOutput)}`}
            />
          )}
          {facility.tracksStarts && (
            <Stat
              label="Starts"
              value={Math.round(facility.lifetimeStarts || 0).toLocaleString()}
            />
          )}
          {isStorage && (
            <Stat
              label="Round-trip efficiency"
              value={percent(
                (facility as StorageOperatingType).roundTripEfficiency,
              )}
            />
          )}
          {hazard && (
            <Stat
              label={hazard.label}
              value={
                <span className="facilityStatWarning">
                  {percent(hazard.availableFraction)} available
                  <span className="facilityStatNote">
                    {hazard.daysLeft !== undefined
                      ? `${dayCount(hazard.daysLeft)} to repair`
                      : "Until month end"}
                  </span>
                </span>
              }
            />
          )}
          {!isStorage && maxOutputFactor < 1 && (
            <Stat
              label="Current maximum output"
              value={
                <>
                  {formatWatts(facility.peakW * maxOutputFactor)}
                  <span className="facilityStatNote">
                    {`Limited to ${percent(maxOutputFactor)} (${maxOutputCauses.join(", ")})`}
                  </span>
                </>
              }
            />
          )}
        </dl>
      </section>
      {isHydro && props.game && (
        <HydroWaterSection facility={facility} game={props.game} />
      )}
      <section className="facilityDetailSection" aria-label="Economics">
        <Typography component="h3" className="facilityDetailHeading">
          Economics
        </Typography>
        <dl className="facilityStats">
          <Stat
            label="Lifetime cost per MWh"
            value={
              lifetime.costPerMWh === undefined
                ? "—"
                : `${formatMoneyConcise(lifetime.costPerMWh)}/MWh`
            }
          />
          <Stat
            label="Revenue per MWh"
            value={
              lifetime.revenuePerMWh === undefined
                ? "—"
                : `${formatMoneyConcise(lifetime.revenuePerMWh)}/MWh`
            }
          />
          <Stat
            label="Lifetime profit"
            value={`${lifetime.profit > 0 ? "+" : ""}${formatMoneyConcise(lifetime.profit)}`}
            tone={
              lifetime.profit < 0
                ? "bad"
                : lifetime.profit > 0
                  ? "good"
                  : undefined
            }
          />
          {facility.loanAmountLeft > 0 && (
            <Stat
              label="Loan balance"
              value={formatMoneyConcise(facility.loanAmountLeft)}
            />
          )}
          {variableOperatingCostPerMWh !== undefined && (
            <Stat
              label="Fixed upkeep"
              value={`${formatMoneyConcise(facility.annualOperatingCost)}/yr`}
            />
          )}
          {variableOperatingCostPerMWh !== undefined && (
            <Stat
              label="Variable upkeep"
              value={`$${variableOperatingCostPerMWh.toFixed(2)}/MWh`}
            />
          )}
          {facility.costPerStart !== undefined && (
            <Stat
              label="Non-fuel start cost"
              value={`${formatMoneyConcise(facility.costPerStart)}/start`}
            />
          )}
          {trend.length > 1 && fuel && (
            <div className="facilityStat facilityFuelTrend">
              <Typography
                variant="caption"
                color="textSecondary"
                component="dt"
              >
                {fuel} price, {trend.length}mo
              </Typography>
              <dd className="facilityTrend">
                <Sparkline
                  values={trend}
                  color={accentColor}
                  ariaLabel={`${fuel} price over the last ${trend.length} months, ${trendChange === 0 ? "unchanged" : `${trendChange > 0 ? "up" : "down"} ${Math.abs(Math.round(trendChange * 100))} percent`}`}
                />
                <Typography
                  variant="body2"
                  component="span"
                  className={`facilityStatValue${trendChange > 0 ? " bad" : trendChange < 0 ? " good" : ""}`}
                >
                  {trendChange > 0 ? "+" : ""}
                  {Math.round(trendChange * 100)}%
                </Typography>
              </dd>
            </div>
          )}
        </dl>
      </section>
      {resilience && props.game && (
        <WeatherResilienceSection
          facility={facility}
          game={props.game}
          summary={resilience}
          readOnly={props.readOnly}
          onRetrofit={props.onRetrofit}
        />
      )}
    </div>
  );
}

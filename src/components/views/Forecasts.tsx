import * as React from "react";
import {
  MenuItem,
  Select,
  SelectChangeEvent,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Toolbar,
  Typography,
} from "@mui/material";
import { TICKS_PER_YEAR } from "../../Constants";
import {
  FuelNameType,
  GameType,
  GeneratorOperatingType,
  TickPresentFutureType,
} from "../../Types";
import {
  formatHour,
  getDateFromMinute,
  getTimeFromTimeline,
} from "../../helpers/DateTime";
import { formatWattHours, formatWatts } from "../../helpers/Format";
import { getDispatchOrderedFuels } from "../../helpers/Energy";
import { getStorageChoice, setStorageKeyValue } from "../../LocalStorage";
import { generateNewTimeline } from "../../reducers/Game";
import ChartForecastFuelPrices, {
  PRICED_FUELS,
} from "../base/ChartForecastFuelPrices";
import ChartForecastSupplyDemand from "../base/ChartForecastSupplyDemand";
import ChartForecastSupplyByFuel, {
  forecastFuels,
} from "../base/ChartForecastSupplyByFuel";
import ChartForecastWeather from "../base/ChartForecastWeather";
import ChartForecastStorage from "../base/ChartForecastStorage";
import ChartForecastWater from "../base/ChartForecastWater";
import ChartLegend from "../base/ChartLegend";
import GameCard from "../base/GameCard";
import { TICK_MINUTES } from "../../Constants";
import { chartPalette, fuelColors, fuelDashArrays } from "../../Theme";

const FORECAST_YEARS_KEY = "forecastYears";
const FORECAST_YEARS_OPTIONS = [1, 5, 10, 20];

// Everything in this pane is drawn against the same months, so hovering any of it should say
// where you are in all of it -- the whole point of the pane is that these five things move
// together. Only the bottom chart draws the month names; the rest keep their ticks and hand
// the height back to the plot
const FORECAST_SYNC_KEY = "forecasts";

interface BlackoutEdges {
  minute: number;
  value: number;
}

export interface StateProps {
  game: GameType;
  // Which facility the fleet list has open, so Supply by Fuel can say which band is its
  selectedFacilityId: number | null;
}

export interface DispatchProps {}

export interface Props extends StateProps, DispatchProps {}

interface State {
  years: number;
}

export default class Forecasts extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    // Building a facility unmounts this pane, so the horizon has to be remembered outside the
    // component or every trip to the build screen drops the player back to a one year forecast
    this.state = {
      years: getStorageChoice(FORECAST_YEARS_KEY, FORECAST_YEARS_OPTIONS, 1),
    };
  }

  public setYears(years: number) {
    setStorageKeyValue(FORECAST_YEARS_KEY, years);
    this.setState({ years });
  }

  public shouldComponentUpdate(nextProps: Props, nextState: State) {
    // Because forecasts are computationally intense and long term, only update when the
    // month or state changes -- plus when the player selects a facility, which is a direct
    // request to re-highlight the stack and would otherwise wait for a month rollover, or moves
    // the rate slider, which drives both customer growth and revenue and would otherwise sit
    // frozen until the next month rolled over
    return (
      this.props.game.date.monthNumber !== nextProps.game.date.monthNumber ||
      this.props.selectedFacilityId !== nextProps.selectedFacilityId ||
      this.state.years !== nextState.years ||
      this.props.game.dollarsPerkWh !== nextProps.game.dollarsPerkWh
    );
  }

  public render() {
    const { game, selectedFacilityId } = this.props;
    const { years } = this.state;
    const now = getTimeFromTimeline(game.date.minute, game.timeline);
    if (!now) {
      return <span />;
    }

    // Generate the forecast
    const forecastedTimeline = generateNewTimeline(
      game,
      now.cash,
      now.customers,
      TICKS_PER_YEAR * years,
    );

    let hasStorage = false;
    const hasHydro = game.facilities.some(
      (facility) => facility.fuel === "Hydro",
    );
    for (let i = 0; i < forecastedTimeline.length; i++) {
      if (forecastedTimeline[i].storedWh > 0) {
        hasStorage = true;
        break;
      }
    }

    // Figure out the boundaries of the chart data
    let domainMin = 999999999999;
    let domainMax = 0;
    const rangeMin = forecastedTimeline[0].minute;
    const rangeMax = forecastedTimeline[forecastedTimeline.length - 1].minute;
    forecastedTimeline.forEach((d: TickPresentFutureType) => {
      domainMin = Math.min(domainMin, d.supplyW, d.demandW);
      domainMax = Math.max(domainMax, d.supplyW, d.demandW);
    });

    // BLACKOUT CALCULATION
    // Less precise (+faster) than the realtime calculator b/c longer term
    // But also tracks blackout metrics for reporting
    let blackoutTotalWh = 0;
    let currentBlackout = {
      wh: 0,
      peakW: 0,
      start: rangeMin,
      end: rangeMin,
    };
    let largestBlackout = currentBlackout;
    const blackouts = [
      {
        minute: rangeMin,
        value: 0,
      },
    ] as BlackoutEdges[];
    let prev = forecastedTimeline[0];
    let isBlackout = prev.demandW > prev.supplyW;
    if (isBlackout) {
      blackouts.push({
        minute: rangeMin,
        value: domainMax,
      });
    }
    forecastedTimeline.forEach((d: TickPresentFutureType) => {
      if (d.demandW > d.supplyW) {
        if (!isBlackout) {
          // Blackout starting: low then high edge, start a new current blackout entryr
          blackouts.push({ minute: d.minute, value: 0 });
          blackouts.push({ minute: d.minute, value: domainMax });
          isBlackout = true;
          currentBlackout = {
            wh: 0,
            peakW: 0,
            start: d.minute,
            end: d.minute,
          };
        }
        const amount = d.demandW - d.supplyW;
        blackoutTotalWh += amount;
        currentBlackout.wh += amount;
        currentBlackout.peakW = Math.max(currentBlackout.peakW, amount);
      } else if (d.demandW < d.supplyW && isBlackout) {
        // Blackout ending: high then low edge, close current blackout entry
        blackouts.push({ minute: d.minute, value: domainMax });
        blackouts.push({ minute: d.minute, value: 0 });
        isBlackout = false;
        currentBlackout.end = d.minute;
        if (currentBlackout.wh > largestBlackout.wh) {
          largestBlackout = currentBlackout;
        }
      }
      prev = d;
    });
    // Close out
    blackouts.push({
      minute: rangeMax,
      value: isBlackout ? domainMax : 0,
    });
    if (currentBlackout.wh > largestBlackout.wh) {
      largestBlackout = currentBlackout;
    }
    largestBlackout.end = largestBlackout.end || rangeMax;

    const blackoutStart = getDateFromMinute(
      largestBlackout.start,
      game.startingYear,
    );
    const blackoutEnd = getDateFromMinute(
      largestBlackout.end,
      game.startingYear,
    );

    // Downsample the data to 6 per day @ 1 year, less at longer, to make it more vague / forecast-y
    const sampledForecastedTimeline = forecastedTimeline.filter(
      (t: TickPresentFutureType) => t.minute % (240 * years) < TICK_MINUTES,
    );
    // Make sure it gets the first + last entries for a full chart
    sampledForecastedTimeline.unshift(forecastedTimeline[0]);
    sampledForecastedTimeline.push(
      forecastedTimeline[forecastedTimeline.length - 1],
    );

    // Derived here rather than inside the chart, since the legend beside the chart's title has
    // to name exactly the bands the chart draws
    const fuels = forecastFuels(
      getDispatchOrderedFuels(game.facilities) as FuelNameType[],
      sampledForecastedTimeline,
    );

    // Storage has no band of its own in this chart, so selecting a battery highlights
    // nothing rather than emptying the stack
    const selected = game.facilities.find(
      (f) => f.id === selectedFacilityId,
    ) as Partial<GeneratorOperatingType> | undefined;
    const highlightFuel =
      selected && selected.fuel && fuels.indexOf(selected.fuel) > -1
        ? selected.fuel
        : undefined;

    return (
      <GameCard className="Forecasts" id="forecastsPane">
        <div className="scrollable">
          {/* The pane's own header rather than GameCard's plain one, so the horizon picker --
              which governs every chart in the stack below, not just the first -- sits with the
              title instead of floating inside "Supply & Demand" (see Facilities, whose build
              buttons live here the same way) */}
          <Toolbar className="paneHeader">
            <Typography variant="h6">Forecasts</Typography>
            <Select
              id="forecastYears"
              value={years}
              onChange={(e: SelectChangeEvent<number>) =>
                this.setYears(e.target.value as number)
              }
              className="headerControl"
            >
              {FORECAST_YEARS_OPTIONS.map((y: number) => (
                <MenuItem value={y} key={y}>
                  {y} year{y > 1 ? "s" : ""}
                </MenuItem>
              ))}
            </Select>
          </Toolbar>
          <Toolbar>
            <Typography variant="h6">Supply & Demand</Typography>
          </Toolbar>
          <ChartForecastSupplyDemand
            height={140}
            timeline={sampledForecastedTimeline}
            blackouts={blackouts}
            domain={{ x: [rangeMin, rangeMax], y: [domainMin, domainMax] }}
            startingYear={game.startingYear}
            multiyear={years > 1}
            showXLabels={false}
            syncKey={FORECAST_SYNC_KEY}
          />
          {blackoutTotalWh > 0 && (
            <Table size="small">
              <TableBody>
                <TableRow className="bold">
                  <TableCell colSpan={2}>Blackouts forecasted</TableCell>
                  <TableCell align="right">
                    ~{formatWattHours(blackoutTotalWh)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={2}>Largest blackout</TableCell>
                  <TableCell align="right">
                    ~{formatWattHours(largestBlackout.wh)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell></TableCell>
                  <TableCell>Peak shortage</TableCell>
                  <TableCell align="right">
                    ~{formatWatts(largestBlackout.peakW)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell></TableCell>
                  <TableCell>When</TableCell>
                  <TableCell align="right">
                    {blackoutStart.month} {formatHour(blackoutStart)} -
                    {blackoutStart.month !== blackoutEnd.month
                      ? ` ${blackoutEnd.month} `
                      : " "}{" "}
                    {formatHour(blackoutEnd)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
          {/* Each chart's key sits in its title row rather than on a row of its own below the
              plot, which is a chart's worth of height across the five of them */}
          <Toolbar className="forecastSection">
            <Typography variant="h6">Supply by Fuel</Typography>
            <ChartLegend
              inline
              items={[
                ...[...fuels].reverse().map((f) => ({
                  name: f,
                  color: fuelColors()[f],
                  muted: !!highlightFuel && f !== highlightFuel,
                })),
                { name: "Demand", color: "", rule: true },
              ]}
            />
          </Toolbar>
          <ChartForecastSupplyByFuel
            height={140}
            timeline={sampledForecastedTimeline}
            domain={{ x: [rangeMin, rangeMax] }}
            startingYear={game.startingYear}
            multiyear={years > 1}
            fuels={fuels}
            showXLabels={false}
            syncKey={FORECAST_SYNC_KEY}
            highlightFuel={highlightFuel}
          />
          {hasStorage && (
            <div>
              <Toolbar className="forecastSection">
                <Typography variant="h6">Stored power</Typography>
              </Toolbar>
              <ChartForecastStorage
                height={140}
                timeline={sampledForecastedTimeline}
                domain={{ x: [rangeMin, rangeMax] }}
                startingYear={game.startingYear}
                multiyear={years > 1}
                showXLabels={false}
                syncKey={FORECAST_SYNC_KEY}
              />
            </div>
          )}
          <Toolbar className="forecastSection">
            <Typography variant="h6">Fuel Prices</Typography>
            <ChartLegend
              inline
              items={PRICED_FUELS.map((f) => ({
                name: f,
                color: fuelColors()[f],
                dash: fuelDashArrays[f],
              }))}
            />
          </Toolbar>
          <ChartForecastFuelPrices
            height={140}
            timeline={sampledForecastedTimeline}
            domain={{ x: [rangeMin, rangeMax] }}
            startingYear={game.startingYear}
            multiyear={years > 1}
            showXLabels={false}
            syncKey={FORECAST_SYNC_KEY}
          />
          {hasHydro && (
            <div>
              <Toolbar className="forecastSection">
                <Typography variant="h6">
                  Water in {game.location.watershedName || game.location.name}
                </Typography>
                <ChartLegend
                  inline
                  items={[
                    {
                      name: "Precipitation",
                      color: chartPalette().precipitation,
                    },
                    { name: "Snowpack", color: chartPalette().snowpack },
                    { name: "Reservoir", color: chartPalette().reservoir },
                  ]}
                />
              </Toolbar>
              <ChartForecastWater
                height={140}
                timeline={sampledForecastedTimeline}
                domain={{ x: [rangeMin, rangeMax] }}
                startingYear={game.startingYear}
                multiyear={years > 1}
                showXLabels={false}
                syncKey={FORECAST_SYNC_KEY}
              />
            </div>
          )}
          <Toolbar className="forecastSection">
            <Typography variant="h6">
              Weather in {game.location.name}
            </Typography>
          </Toolbar>
          {/* Last, so it's the one that draws the month names the whole stack is read against */}
          <ChartForecastWeather
            height={140}
            timeline={sampledForecastedTimeline}
            domain={{ x: [rangeMin, rangeMax] }}
            startingYear={game.startingYear}
            multiyear={years > 1}
            syncKey={FORECAST_SYNC_KEY}
          />
        </div>
      </GameCard>
    );
  }
}

import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
  Toolbar,
  Typography,
} from "@mui/material";
import { TICKS_PER_YEAR } from "../../Constants";
import { GameType, TickPresentFutureType } from "../../Types";
import {
  formatHour,
  getDateFromMinute,
  getTimeFromTimeline,
} from "../../helpers/DateTime";
import { formatWattHours, formatWatts } from "../../helpers/Format";
import { generateNewTimeline } from "../../reducers/Game";
import ChartForecastFuelPrices from "../base/ChartForecastFuelPrices";
import ChartForecastSupplyDemand from "../base/ChartForecastSupplyDemand";
import ChartForecastWeather from "../base/ChartForecastWeather";
import GameCard from "../base/GameCard";

const FORECAST_YEARS = 1;

interface BlackoutEdges {
  minute: number;
  value: number;
}

export interface StateProps {
  game: GameType;
}

export interface DispatchProps {}

export interface Props extends StateProps, DispatchProps {}

interface State {
  year: number;
}

export default class Forecasts extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { year: 0 };
  }

  public shouldComponentUpdate(nextProps: Props, nextState: any) {
    // Because forecasts are computationally intense and long term, only update when the month changes
    return this.props.game.date.monthNumber !== nextProps.game.date.monthNumber;
  }

  public render() {
    const { game } = this.props;
    const now = getTimeFromTimeline(game.date.minute, game.timeline);
    if (!now) {
      return <span />;
    }

    // Generate the forecast
    const forecastedTimeline = generateNewTimeline(
      game,
      now.cash,
      now.customers,
      TICKS_PER_YEAR * FORECAST_YEARS,
    );

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

    // TODO user ability to see more than one year in the future
    return (
      <GameCard className="Forecasts">
        <div className="scrollable">
          <Toolbar>
            <Typography variant="h6">Supply & Demand</Typography>
          </Toolbar>
          <ChartForecastSupplyDemand
            height={140}
            timeline={forecastedTimeline}
            blackouts={blackouts}
            domain={{ x: [rangeMin, rangeMax], y: [domainMin, domainMax] }}
            startingYear={game.startingYear}
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
          <br />
          <br />
          <Toolbar>
            <Typography variant="h6">Fuel Prices</Typography>
          </Toolbar>
          <ChartForecastFuelPrices
            height={140}
            timeline={forecastedTimeline}
            domain={{ x: [rangeMin, rangeMax] }}
            startingYear={game.startingYear}
          />
          <br />
          <br />
          <Toolbar>
            <Typography variant="h6">
              Weather in {game.location.name}
            </Typography>
          </Toolbar>
          <ChartForecastWeather
            height={140}
            timeline={forecastedTimeline}
            domain={{ x: [rangeMin, rangeMax] }}
            startingYear={game.startingYear}
          />
        </div>
      </GameCard>
    );
  }
}

import * as React from "react";
import { FormControlLabel, Slider, Switch, Typography } from "@mui/material";
import { GameType } from "../../Types";
import { TICK_MINUTES } from "../../Constants";
import {
  activeScenarioOrDefault,
  currentTick,
} from "../../helpers/GameSelectors";
import { getRateInflationIndex } from "../../data/Economy";
import { getDateFromMinute, summarizeHistory } from "../../helpers/DateTime";
import {
  customerMarketSizeAt,
  getMarketRate,
  projectCustomerChange,
  publicRateCap,
  publicTargetRate,
} from "../../helpers/Customers";
import { formatMoneyConcise } from "../../helpers/Format";
import { formatCustomerChange } from "../../helpers/HistoryMetrics";
import {
  PUBLIC_RATE_POINTS_PER_CENT,
  publicRateYearContribution,
} from "../../helpers/Scoring";
import {
  projectionReady,
  readProjection,
  requestProjection,
  subscribeProjection,
} from "../base/DeferredProjection";
import "./Programs.scss";

function formatRateCompact(rate: number): string {
  return `${Number((rate * 100).toFixed(1))}¢`;
}

/** Axis labels read in cents below a dollar, so they fit beneath the slider. */
function formatRateAxis(rate: number): string {
  return rate < 1 ? formatRateCompact(rate) : formatMoneyConcise(rate);
}

function rateMarkLabel(
  rate: number,
  desktopLabel = formatRateAxis(rate),
  mobileLabel = "",
) {
  return (
    <>
      <span className="insightsRateMarkDesktop">{desktopLabel}</span>
      <span className="insightsRateMarkMobile">{mobileLabel}</span>
    </>
  );
}

function formatRateScore(points: number): string {
  return `${points > 0 ? "+" : points < 0 ? "−" : "±"}${Math.abs(points).toLocaleString("en-US")} pts`;
}

export interface RateControlsProps {
  game: GameType;
  onDelta: (change: Partial<GameType>) => void;
}

/** Pricing reads the same deferred forecast as Insights and the global status bar. */
export default function RateControls({ game, onDelta }: RateControlsProps) {
  const now = currentTick(game);
  // Announce only the change a drag makes, not a state the panel opened in.
  const followSetting = !!game.rateFollowsTarget;
  const wasFollowing = React.useRef(followSetting);
  const [announcedStop, setAnnouncedStop] = React.useState(false);
  React.useEffect(() => {
    setAnnouncedStop(wasFollowing.current && !followSetting);
    wasFollowing.current = followSetting;
  }, [followSetting]);
  const investorOwned = activeScenarioOrDefault(game).ownership === "Investor";
  const [, refresh] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => subscribeProjection(refresh), []);
  const forecast =
    !investorOwned &&
    now &&
    (projectionReady(game) || typeof Worker === "undefined")
      ? readProjection(game, now)
      : undefined;
  React.useEffect(() => {
    if (!investorOwned && now && !projectionReady(game))
      requestProjection(game, now);
  }, [game, now, investorOwned]);
  if (!now) return null;
  const scenario = activeScenarioOrDefault(game);
  const marketRate = getMarketRate(
    scenario.dollarsPerkWh,
    game.date,
    game.startingYear,
    game.seed,
  );
  const customerChange = projectCustomerChange({
    customers: now.customers,
    customerRate: now.customerRate || game.customerRate || game.dollarsPerkWh,
    currentRate: game.dollarsPerkWh,
    marketRateAt: (tick) =>
      getMarketRate(
        scenario.dollarsPerkWh,
        getDateFromMinute(
          game.date.minute + tick * TICK_MINUTES,
          game.startingYear,
        ),
        game.startingYear,
        game.seed,
      ),
    marketSizeAt: (tick) =>
      customerMarketSizeAt(
        game.customerMarketSize || now.customers * 2,
        game.date.minute + tick * TICK_MINUTES,
      ),
    ownership: scenario.ownership,
  });
  const investor = scenario.ownership === "Investor";
  // A public utility's customers never switch and its growth is fixed, so the market rate
  // changes nothing it can act on. What the rate does move is the score, against the
  // scenario's own target. That target is authored in starting-year dollars and scored against
  // deflated revenue, so the slider shows it in today's dollars, beside the rate being set.
  const inflationIndex = getRateInflationIndex(
    game.date,
    game.startingYear,
    game.seed,
  );
  const targetRate = publicTargetRate(
    scenario.dollarsPerkWh,
    game.date,
    game.startingYear,
    game.seed,
  );
  // Tutorials and multiplayer matches set their own rates, so only a solo public run can follow.
  const canFollow = !investor && !scenario.tutorialSteps && !game.multiplayer;
  const following = canFollow && !!game.rateFollowsTarget;
  const max = publicRateCap(
    scenario.dollarsPerkWh,
    game.date,
    game.startingYear,
    game.seed,
  );
  // The final score decomposes exactly into a supply-weighted sum over the years played, so
  // what a rate is worth is the coming year's own term of that sum: the distance from the
  // target, times how much of the lifetime energy the coming year makes up. Always a full
  // year, even near the end of a run, so the figure means the same thing every time. The
  // sign is the sign of target minus rate: a rate above target reads as a loss every year it
  // is in force, no matter what the lifetime average did last period.
  const projection = forecast;
  const upcoming = projection?.financeProjected.slice(0, 12) || [];
  const pastTotals = summarizeHistory(game.monthlyHistory);
  const nextSupplyWh = upcoming.reduce((sum, m) => sum + m.supplyWh, 0);
  const rateScore = (rate: number) =>
    publicRateYearContribution(
      scenario.dollarsPerkWh,
      pastTotals,
      { supplyWh: nextSupplyWh },
      rate,
      inflationIndex,
    );
  const formattedRateScore = projection
    ? formatRateScore(rateScore(game.dollarsPerkWh))
    : "Calculating…";
  const marks = investor
    ? [
        { value: 0, label: rateMarkLabel(0, "0¢", "0¢") },
        {
          value: marketRate,
          label: rateMarkLabel(
            marketRate,
            `${formatRateAxis(marketRate)} market`,
            `market ${formatRateCompact(marketRate)}`,
          ),
        },
        {
          value: max,
          label: rateMarkLabel(
            max,
            formatRateAxis(max),
            formatRateCompact(max),
          ),
        },
      ]
    : [
        { value: 0, label: rateMarkLabel(0, "0¢", "0¢") },
        {
          value: targetRate,
          label: rateMarkLabel(
            targetRate,
            `${formatRateAxis(targetRate)} target`,
            `target ${formatRateCompact(targetRate)}`,
          ),
        },
        {
          value: max,
          label: rateMarkLabel(
            max,
            `${formatRateAxis(max)} cap`,
            `cap ${formatRateCompact(max)}`,
          ),
        },
      ];
  const formattedCustomerChange = formatCustomerChange(
    customerChange,
    now.customers,
  );
  const rateSummary = investor
    ? `Rate ${formatMoneyConcise(game.dollarsPerkWh)} per kilowatt hour; market rate ${formatMoneyConcise(marketRate)}; projected customers ${formattedCustomerChange} next month.`
    : `Rate ${formatMoneyConcise(game.dollarsPerkWh)} per kilowatt hour; target ${formatMoneyConcise(targetRate)}; ${following ? "following the target each month; " : ""}${projection ? `rate score ${formattedRateScore} over the next year at this rate` : "calculating the rate score"}. You earn ${PUBLIC_RATE_POINTS_PER_CENT} points for each cent below the target and lose ${PUBLIC_RATE_POINTS_PER_CENT} for each cent above it, weighted by the coming year's share of lifetime sales.`;
  const rateScoreClass = `insightsRateScore ${
    rateScore(game.dollarsPerkWh) > 0
      ? "good"
      : rateScore(game.dollarsPerkWh) < 0
        ? "bad"
        : ""
  }`;
  const rateMetrics = (
    <>
      <span className="insightsRateMetric">
        <span className="insightsRateMetricLabel">Your rate</span>
        <strong className="insightsRateMetricValue">
          {formatRateCompact(game.dollarsPerkWh)}/kWh
        </strong>
      </span>
      <span className="insightsRateMetric">
        <span className="insightsRateMetricLabel">
          {investor ? "Market" : "Target"}
        </span>
        <span className="insightsRateMetricValue">
          {formatRateCompact(investor ? marketRate : targetRate)}
          {following && <span className="programsRateMatched"> · matched</span>}
        </span>
      </span>
      {investor ? (
        <span className="insightsRateMetric">
          <span className="insightsRateMetricLabel">Customers / mo</span>
          <strong className="insightsRateMetricValue">
            {formattedCustomerChange}
          </strong>
        </span>
      ) : (
        <span className="insightsRateMetric">
          <span className="insightsRateMetricLabel">Points / yr</span>
          <strong className={`insightsRateMetricValue ${rateScoreClass}`}>
            {formattedRateScore}
          </strong>
        </span>
      )}
    </>
  );

  return (
    <section
      className="programsPricing customerProgramSection"
      aria-label="Electricity pricing"
      aria-describedby="programsRateSummary"
    >
      <div className="programsPricingHeader">
        <Typography component="h3" variant="subtitle2">
          Electricity pricing
        </Typography>
        {canFollow && (
          <FormControlLabel
            className="programsRateFollow"
            labelPlacement="start"
            disabled={!!game.replayPlayback}
            label={
              <>
                <span className="programsRateFollowFull">Follow target</span>
                <span className="programsRateFollowShort" aria-hidden="true">
                  Follow
                </span>
              </>
            }
            control={
              <Switch
                color="primary"
                checked={following}
                slotProps={{
                  input: {
                    "aria-label": "Follow target rate",
                    "aria-describedby": following
                      ? "programsRateFollowNote"
                      : undefined,
                  },
                }}
                onChange={(event) =>
                  onDelta({ rateFollowsTarget: event.target.checked })
                }
              />
            }
          />
        )}
      </div>
      <div className="insightsRateMetrics" aria-hidden="true">
        {rateMetrics}
      </div>
      {following && (
        <Typography
          id="programsRateFollowNote"
          className="programsRateFollowNote"
          variant="caption"
        >
          Your rate moves with the target each month.
        </Typography>
      )}
      {canFollow && (
        <span className="srOnly" role="status" aria-live="polite">
          {!following && announcedStop
            ? "Rate no longer follows the target."
            : ""}
        </span>
      )}
      <span id="programsRateSummary" className="srOnly">
        {rateSummary}
      </span>
      {(game.policies?.programs.timeOfUse?.tier !== "Off" ||
        game.policies?.programs.curtailment?.tier !== "Off") &&
        game.policies && (
          <Typography variant="caption">
            Active programs adjust this rate.
          </Typography>
        )}
      <div
        className="budgetSlider"
        id="rateSliderControl"
        data-testid="rate-slider-control"
      >
        <Slider
          // Keep the thumb local while it is moving. Dispatching every pointer step makes
          // the entire workbench reconcile and regenerate its long-range projection before
          // the browser can paint the next thumb position. The committed rate remounts this
          // uncontrolled slider through its key, so external changes still stay in sync.
          key={game.dollarsPerkWh}
          id="rateSlider"
          disabled={!!game.replayPlayback}
          defaultValue={game.dollarsPerkWh}
          aria-label="The rate you charge for electricity generation"
          valueLabelDisplay="auto"
          valueLabelFormat={(rate) =>
            investor
              ? `${formatRateAxis(rate)}/kWh`
              : `${formatRateAxis(rate)}/kWh · ${formatRateScore(rateScore(rate))}/yr`
          }
          getAriaValueText={(rate) =>
            investor
              ? `${formatMoneyConcise(rate)} per kilowatt hour`
              : `${formatMoneyConcise(rate)} per kilowatt hour${following && rate === targetRate ? ", matches target" : ""}, rate score ${formatRateScore(rateScore(rate))} over the next year`
          }
          marks={marks}
          min={0}
          step={investor ? 0.001 : 0.01}
          max={max}
          onChangeCommitted={(_event, value) =>
            onDelta({
              dollarsPerkWh: Array.isArray(value) ? value[0] : value,
            })
          }
        />
      </div>
    </section>
  );
}

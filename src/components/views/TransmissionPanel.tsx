import ManualLink from "../base/ManualLink";
import { MANUAL_ENTRY } from "../../data/Manual";
import * as React from "react";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import CloseIcon from "@mui/icons-material/Close";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import { DOWNPAYMENT_PERCENT, LOAN_MONTHS } from "../../Constants";
import {
  adjacentMarketForCorridor,
  corridorsForLocation,
} from "../../data/AdjacentMarkets";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { formatMoneyConcise, formatWatts } from "../../helpers/Format";
import { transmissionRatingW } from "../../helpers/Transmission";
import { getMonthlyPayment } from "../../helpers/Financials";
import { GameType, TradingPolicyType } from "../../Types";
import { formatMass } from "../../helpers/Units";
import { useUnits } from "../base/UnitsContext";
import DecisionImpactPreview from "../base/DecisionImpactPreview";

const POLICY_LABELS: Record<TradingPolicyType, string> = {
  BALANCED: "Buy for shortages, sell extra",
  RELIABILITY_FIRST: "Buy for shortages only",
  SURPLUS_ONLY: "Sell extra only",
  CLOSED: "No trading",
};

export interface TransmissionPanelProps {
  game: GameType;
  projectsOnly?: boolean;
  onBuild: (corridorId: string, financed: boolean) => void;
  onPolicy: (policy: TradingPolicyType) => void;
}

export function TransmissionTradingSummary({
  game,
  onPolicy,
}: Pick<TransmissionPanelProps, "game" | "onPolicy">) {
  const state = game.transmission;
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  const readOnly = !!game.replayPlayback;
  if (!state?.lines.length) return null;
  return (
    <details
      className="tradingSummary"
      open={
        game.scenarioId === 112 && [3, 9].includes(game.tutorialStep)
          ? true
          : undefined
      }
    >
      <summary>
        <span className="networkTradingCopy">
          <span className="networkTradingHeading">
            <strong>Network trading</strong>
            <span className="networkTradingFlow">
              {(now?.importedW || 0) > 0
                ? "Importing " + formatWatts(now!.importedW || 0)
                : (now?.exportedW || 0) > 0
                  ? "Exporting " + formatWatts(now!.exportedW || 0)
                  : "No power flowing"}
            </span>
          </span>
          <span className="tradingSummaryRule">
            {POLICY_LABELS[state.tradingPolicy]}
          </span>
        </span>
        <KeyboardArrowDownIcon className="facilityChevron" aria-hidden />
      </summary>
      <FormControl fullWidth size="small" className="tradingPolicy">
        <InputLabel id="trading-policy-label">Trading rule</InputLabel>
        <Select
          labelId="trading-policy-label"
          label="Trading rule"
          value={state.tradingPolicy}
          disabled={readOnly}
          onChange={(event) =>
            onPolicy(event.target.value as TradingPolicyType)
          }
        >
          {Object.entries(POLICY_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography variant="caption" color="textSecondary">
        One rule for all connections. Imports depend on line capacity and
        neighboring supply.
      </Typography>
      <ManualLink entry={MANUAL_ENTRY.INTERTIES} text="How interties work" />
    </details>
  );
}

export default function TransmissionPanel({
  game,
  onBuild,
  projectsOnly = false,
}: TransmissionPanelProps) {
  const units = useUnits();
  const [selectedLine, setSelectedLine] = React.useState<number | null>(null);
  const [reviewId, setReviewId] = React.useState<string | null>(null);
  const state = game.transmission ?? { tradingPolicy: "BALANCED", lines: [] };
  const availableCorridors = corridorsForLocation(game.location);
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  const readOnly = !!game.replayPlayback;
  // The guided mission names the northern project. Showing only that choice until it is approved
  // makes an exploratory tap recoverable instead of letting a much dearer three-year project
  // consume the cash and time needed by the lesson.
  const corridors =
    game.scenarioId === 112 &&
    !state.lines.some(({ corridorId }) => corridorId === "california-north")
      ? availableCorridors.filter(({ id }) => id === "california-north")
      : availableCorridors;
  const unbuiltCorridors = corridors.filter(
    (corridor) =>
      !state.lines.some(({ corridorId }) => corridorId === corridor.id),
  );
  const review = unbuiltCorridors.find(({ id }) => id === reviewId);
  const reviewMarket = review && adjacentMarketForCorridor(review.id);
  const reviewDownpayment = (review?.buildCost || 0) * DOWNPAYMENT_PERCENT;
  const approve = (financed: boolean) => {
    if (!review) return;
    onBuild(review.id, financed);
    setReviewId(null);
  };

  if (!corridors.length) {
    return null;
  }

  return (
    <div className={projectsOnly ? "transmissionPanel" : "transmissionFleet"}>
      {projectsOnly && (
        <section className="transmissionIntro">
          <img
            src="/images/transmission.svg"
            alt="Two grids exchanging power"
          />
          <div>
            <Typography variant="h6">Share power with nearby grids</Typography>
            <Typography variant="body2" color="textSecondary">
              Buy backup; sell extra. Imports are limited.
            </Typography>
          </div>
        </section>
      )}

      {!projectsOnly && (
        <section aria-labelledby="your-interties-title">
          <Typography
            id="your-interties-title"
            className="facilitySectionLabel"
            variant="subtitle2"
          >
            Interties <span>Automatic trading</span>
          </Typography>
          {!state.lines.length && (
            <Typography
              variant="body2"
              color="textSecondary"
              sx={{ px: 2, pb: 2 }}
            >
              No connections yet. Choose Build to connect a nearby grid.
            </Typography>
          )}
          {state.lines.map((line) => {
            const market = adjacentMarketForCorridor(line.corridorId);
            const rating = now
              ? transmissionRatingW(line, now)
              : line.capacityW;
            const building = line.yearsToBuildLeft > 0;
            return (
              <div key={line.id} className="transmissionLine">
                <button
                  type="button"
                  className="facilityDisclosure"
                  aria-label={"Inspect " + line.name}
                  aria-expanded={selectedLine === line.id}
                  onClick={() =>
                    setSelectedLine(selectedLine === line.id ? null : line.id)
                  }
                >
                  <img
                    className="transmissionListIcon"
                    src="/images/transmission.svg"
                    alt=""
                  />
                  <span className="transmissionLineText">
                    <span>{line.name}</span>
                    <Typography
                      component="span"
                      variant="body2"
                      color="textSecondary"
                    >
                      {building
                        ? line.yearsToBuildLeft.toFixed(1) +
                          (line.yearsToBuildLeft <= 1 ? " year" : " years") +
                          " remaining"
                        : formatWatts(rating) + " available"}
                      {" · "}
                      <span className="transmissionLineStatus">
                        {building ? "Building" : "Connected"}
                      </span>
                    </Typography>
                  </span>
                  <KeyboardArrowDownIcon
                    className="facilityChevron"
                    aria-hidden
                  />
                </button>
                {selectedLine === line.id && (
                  <div className="transmissionLineDetails">
                    <Typography variant="body2">
                      {market?.name} · {formatWatts(line.capacityW)} rated
                      capacity
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      {building
                        ? "Power can flow when construction finishes."
                        : "Available capacity changes with weather. Trading is automatic across the network."}
                    </Typography>
                    {line.loanAmountLeft > 0 && (
                      <Typography variant="body2">
                        Loan balance {formatMoneyConcise(line.loanAmountLeft)} ·
                        Monthly payments during construction and operation
                      </Typography>
                    )}
                    {market && (
                      <Typography variant="caption" color="textSecondary">
                        Purchased emissions:{" "}
                        {formatMass(market.emissionsKgco2ePerMWh, units)}/MWh
                        CO2e
                      </Typography>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {projectsOnly && !unbuiltCorridors.length && (
        <Typography>All available connections have been approved.</Typography>
      )}
      {projectsOnly && !!unbuiltCorridors.length && (
        <section aria-labelledby="intertie-projects-title">
          <Typography id="intertie-projects-title" variant="subtitle2">
            Connection projects
          </Typography>
          <div className="transmissionProjects">
            {unbuiltCorridors.map((corridor) => {
              const market = adjacentMarketForCorridor(corridor.id);
              const downpayment = corridor.buildCost * DOWNPAYMENT_PERCENT;
              const financed = corridor.buildCost - downpayment;
              return (
                <article
                  className="transmissionProject"
                  data-corridor-id={corridor.id}
                  data-testid={`transmission-project-${corridor.id}`}
                  key={corridor.id}
                >
                  <div className="transmissionProjectHeading">
                    <div>
                      <Typography variant="subtitle1">
                        {market?.name}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        {corridor.name}
                      </Typography>
                    </div>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={
                        corridor.routeType === "EXISTING"
                          ? "Existing route"
                          : "New route"
                      }
                    />
                  </div>
                  <Typography variant="body2">{market?.description}</Typography>
                  <dl className="transmissionMetrics">
                    <div>
                      <dt>Capacity</dt>
                      <dd>{formatWatts(corridor.capacityW)}</dd>
                    </div>
                    <div>
                      <dt>Build time</dt>
                      <dd>
                        {corridor.yearsToBuild} year
                        {corridor.yearsToBuild === 1 ? "" : "s"}
                      </dd>
                    </div>
                    <div>
                      <dt>Total cost</dt>
                      <dd>{formatMoneyConcise(corridor.buildCost)}</dd>
                    </div>
                    <div>
                      <dt>Loan payment</dt>
                      <dd>
                        {formatMoneyConcise(
                          getMonthlyPayment(
                            financed,
                            game.interestRate,
                            LOAN_MONTHS,
                          ),
                        )}
                        /mo
                      </dd>
                    </div>
                  </dl>
                  {!readOnly && (
                    <Button
                      id={`review-intertie-${corridor.id}`}
                      aria-label={`Review purchase of ${market?.name} intertie`}
                      fullWidth
                      variant="outlined"
                      disabled={!now || now.cash < downpayment}
                      onClick={() => setReviewId(corridor.id)}
                    >
                      Review
                    </Button>
                  )}
                  {!readOnly && (
                    <Typography variant="caption" color="textSecondary">
                      Pay {formatMoneyConcise(downpayment)} now · finance{" "}
                      {formatMoneyConcise(financed)}. Payments begin during
                      construction; electricity purchases and maintenance cost
                      extra.
                    </Typography>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
      {projectsOnly && (
        <>
          <ManualLink
            entry={MANUAL_ENTRY.INTERTIES}
            text="How interties work"
          />
          <details>
            <summary style={{ minHeight: 44, cursor: "pointer" }}>
              How trading and purchased emissions are estimated
            </summary>
            <Typography variant="body2" color="textSecondary" sx={{ my: 1 }}>
              Buy backup during shortages; sell surplus after customers and
              storage. Trading is automatic, limited by line capacity and
              neighboring supply; imports are not guaranteed backup. Prices and
              flows are simplified estimates, not a least-cost dispatch or a
              network engineering study. Imported emissions count toward your
              total; the game's carbon fee applies to your local plants.
            </Typography>
            {Array.from(new Set(corridors.map((corridor) => corridor.id))).map(
              (id) => {
                const market = adjacentMarketForCorridor(id);
                return market ? (
                  <Typography key={id} variant="body2" sx={{ my: 1 }}>
                    {market.name}:{" "}
                    {formatMass(market.emissionsKgco2ePerMWh, units)}
                    /MWh CO2e · {market.emissionsBasis}.{" "}
                    <a
                      aria-label={`Source for ${market.name} emissions`}
                      href={market.emissionsSource}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source
                    </a>
                  </Typography>
                ) : null;
              },
            )}
          </details>
        </>
      )}
      {review && (
        <Dialog
          open
          onClose={() => setReviewId(null)}
          fullWidth
          maxWidth="sm"
          aria-labelledby="intertie-review-title"
        >
          <DialogTitle id="intertie-review-title">
            Build {reviewMarket?.name} intertie?
            <IconButton
              aria-label="close"
              onClick={() => setReviewId(null)}
              className="top-right"
              size="large"
            >
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          <DialogContent className="noPadding">
            <DecisionImpactPreview
              facts={[
                {
                  concept: "money",
                  label: "Cash purchase",
                  value: `${formatMoneyConcise(now?.cash || 0)} → ${formatMoneyConcise((now?.cash || 0) - review.buildCost)}`,
                },
                {
                  concept: "finances",
                  label: "Loan option",
                  value: `${formatMoneyConcise(reviewDownpayment)} now + ${formatMoneyConcise(getMonthlyPayment(review.buildCost - reviewDownpayment, game.interestRate, LOAN_MONTHS))}/mo`,
                  detail: `Payments start during construction. Loan term: ${LOAN_MONTHS / 12} years. Interest rate: ${(game.interestRate * 100).toFixed(2)}%.`,
                },
                {
                  concept: "money",
                  label: "Estimated upkeep",
                  value: `${formatMoneyConcise(review.annualOperatingCost / 12)}/mo`,
                  detail: "Electricity purchases and loan payments are extra.",
                },
                {
                  concept: "time",
                  label: "Online in",
                  value: `${Math.round(review.yearsToBuild * 12)} months`,
                },
                {
                  concept: "supply",
                  label: "Connection capacity",
                  value: formatWatts(review.capacityW),
                  detail:
                    "Imports depend on neighboring supply and line conditions; backup is not guaranteed.",
                },
              ]}
            />
          </DialogContent>
          <DialogActions>
            <Button
              variant="contained"
              disabled={readOnly || !now || now.cash < review.buildCost}
              onClick={() => approve(false)}
            >
              Pay cash
            </Button>
            <Button
              id={`approve-intertie-${review.id}`}
              variant="outlined"
              disabled={readOnly || !now || now.cash < reviewDownpayment}
              onClick={() => approve(true)}
            >
              Take loan
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}

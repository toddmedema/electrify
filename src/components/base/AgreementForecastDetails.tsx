import * as React from "react";
import { Box, Button, Typography } from "@mui/material";
import type { PowerAgreementAccount } from "../../Types";
import { agreementDate } from "../../helpers/PowerAgreements";
import {
  formatFixed,
  formatMoneyConcise,
  formatPercent,
  formatWattHours,
} from "../../helpers/Format";
import type {
  AgreementEnergy,
  AgreementService,
} from "../../helpers/AgreementForecast";
import type { useAgreementForecast } from "./useAgreementForecast";
import BuildDetails, { BuildDetailRow } from "./BuildDetails";

const serviceShare = (value: AgreementService) =>
  value.demandMWh > 0
    ? `${Number(formatFixed((value.servedMWh / value.demandMWh) * 100, 3))}%`
    : "No customer demand";
const energyUse = (value: AgreementEnergy) =>
  value.availableMWh > 0
    ? `${formatPercent(value.usefulMWh / value.availableMWh, 1)} of available minimum`
    : "No available minimum";
const energyDetail = (value: AgreementEnergy) =>
  `${formatWattHours(value.usefulMWh * 1e6)} used / ${formatWattHours(value.availableMWh * 1e6)} available · ${formatMoneyConcise(value.payment)} paid · ${formatMoneyConcise(value.unusedPayment)} unused`;

export default function AgreementForecastDetails({
  forecast,
  offer,
  account,
  expired,
  legacy,
}: {
  forecast: ReturnType<typeof useAgreementForecast>;
  offer: boolean;
  account?: PowerAgreementAccount;
  expired?: boolean;
  legacy?: boolean;
}) {
  const [explain, setExplain] = React.useState(false);
  if (expired)
    return account ? <RecordedAgreementHistory account={account} /> : null;
  if (forecast.blocked)
    return (
      <>
        <Typography role="status" sx={{ mb: 2 }}>
          {forecast.blocked === "coop" ? (
            <>
              Forecast unavailable in co-op
              <br />
              Shared supply depends on other companies.
            </>
          ) : (
            <>
              Comparison unavailable
              <br />
              Turn on market buying to compare.
            </>
          )}
        </Typography>
        {account && <RecordedAgreementHistory account={account} />}
      </>
    );
  if (!forecast.result)
    return (
      <Box role="status" sx={{ mb: 2 }}>
        <Typography>
          {forecast.error
            ? "Forecast unavailable"
            : forecast.updating
              ? "Updating forecast"
              : "Calculating full-term forecast"}
        </Typography>
        {forecast.error && <Button onClick={forecast.retry}>Retry</Button>}
        {account && <RecordedAgreementHistory account={account} />}
      </Box>
    );
  const result = forecast.result;
  const combined: AgreementEnergy = {
    availableMWh: result.recorded.availableMWh + result.remaining.availableMWh,
    usefulMWh: result.recorded.usefulMWh + result.remaining.usefulMWh,
    payment: result.recorded.payment + result.remaining.payment,
    unusedPayment:
      result.recorded.unusedPayment + result.remaining.unusedPayment,
  };
  const withShare = serviceShare(result.withAgreement);
  const marketShare = serviceShare(result.marketPurchases);
  return (
    <Box
      className="agreementForecast"
      sx={{ mb: 2 }}
      aria-label="Agreement forecast"
    >
      <Typography
        component="h3"
        variant="h6"
        color={
          result.cashDifference > 0
            ? "success.main"
            : result.cashDifference < 0
              ? "warning.main"
              : "textPrimary"
        }
      >
        {result.cashDifference === 0
          ? "No forecast cash difference"
          : `Forecast cash ${result.cashDifference > 0 ? "benefit" : "cost"} · ${formatMoneyConcise(Math.abs(result.cashDifference))}`}
      </Typography>
      <Typography variant="body2" color="textSecondary">
        Compared with market purchases ·{" "}
        {offer ? "Full delivery term" : "Remaining delivery term"}
      </Typography>
      <Typography component="h3" variant="subtitle1" sx={{ mt: 2 }}>
        Demand served
      </Typography>
      <Typography variant="body2">
        With agreement {withShare} · Market purchases {marketShare}
      </Typography>
      {withShare === marketShare && (
        <Typography variant="body2" color="textSecondary">
          Same forecast service share
        </Typography>
      )}
      <BuildDetails label="Agreement forecast details">
        <BuildDetailRow
          label={
            legacy
              ? "Purchases through expiry"
              : offer
                ? "Forecast use"
                : result.completeHistory
                  ? "Full-term use estimate"
                  : "Use estimate through expiry"
          }
          value={
            <>
              {legacy
                ? formatWattHours(combined.usefulMWh * 1e6)
                : energyUse(combined)}
              {!offer && (
                <Typography
                  component="div"
                  variant="caption"
                  color="textSecondary"
                >
                  {result.completeHistory
                    ? "Recorded + forecast"
                    : `Recorded since ${agreementDate(result.recordingStartMinute)} + forecast`}
                </Typography>
              )}
            </>
          }
        />
        <BuildDetailRow
          label={offer ? "Unused minimum cost" : "Unused cost remaining"}
          value={`${formatMoneyConcise(result.remaining.unusedPayment)}, included above`}
        />
        <BuildDetailRow
          label="Forecast from"
          value={agreementDate(result.cutoffMinute)}
        />
      </BuildDetails>
      <Button
        size="small"
        onClick={() => setExplain(!explain)}
        aria-expanded={explain}
      >
        How this is estimated
      </Button>
      {explain && (
        <Box>
          <Typography variant="body2">
            If nothing else changes. Includes changes in customer income and
            operating costs. Cash compares closing company balances, including
            energy, unused minimums, generation, carbon costs, exports,
            financing and scheduled effects. Future nominal dollars,
            undiscounted. Each demand-served share uses that alternative’s own
            customer demand.
          </Typography>
          <BuildDetails label="Agreement energy and payment history">
            <BuildDetailRow
              label={
                result.completeHistory
                  ? "Recorded so far"
                  : `Recorded since ${agreementDate(result.recordingStartMinute)}`
              }
              value={energyDetail(result.recorded)}
            />
            <BuildDetailRow
              label="Forecast remaining"
              value={energyDetail(result.remaining)}
            />
            <BuildDetailRow
              label={
                result.completeHistory
                  ? "Full-term estimate"
                  : `Since ${agreementDate(result.recordingStartMinute)} through expiry estimate`
              }
              value={
                legacy
                  ? energyDetail(combined)
                  : `${energyUse(combined)} · ${energyDetail(combined)}`
              }
            />
          </BuildDetails>
          {result.earlierHistoryUnavailable && (
            <Typography variant="body2" color="textSecondary">
              Earlier history unavailable.
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

function RecordedAgreementHistory({
  account,
}: {
  account: PowerAgreementAccount;
}) {
  const totals = account.months.reduce(
    (sum, row) => ({
      availableMWh: sum.availableMWh + row.availableMWh,
      usefulMWh: sum.usefulMWh + row.usefulMWh,
      payment: sum.payment + row.payment,
      unusedPayment:
        sum.unusedPayment +
        (account.termsVersion === 2 && row.availableMWh > 0
          ? row.payment * Math.max(0, 1 - row.usefulMWh / row.availableMWh)
          : 0),
    }),
    { availableMWh: 0, usefulMWh: 0, payment: 0, unusedPayment: 0 },
  );
  return (
    <BuildDetails label="Recorded agreement history">
      <BuildDetailRow
        label={`Recorded since ${agreementDate(account.accountingStartMinute)}`}
        value={energyDetail(totals)}
      />
    </BuildDetails>
  );
}

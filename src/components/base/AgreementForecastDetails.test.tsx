import { fireEvent, render, screen } from "@testing-library/react";
import type { AgreementForecast } from "../../helpers/AgreementForecast";
import AgreementForecastDetails, {
  RecordedAgreementHistory,
} from "./AgreementForecastDetails";
import type { useAgreementForecast } from "./useAgreementForecast";
import BuildDetails from "./BuildDetails";
function forecast(
  partial: Partial<ReturnType<typeof useAgreementForecast>> = {},
) {
  return {
    blocked: undefined,
    result: undefined,
    error: false,
    updating: false,
    retry: jest.fn(),
    ...partial,
  };
}
it("preserves negative savings and the requested horizon without competing metrics", () => {
  render(
    <BuildDetails label="Agreement forecast">
      <AgreementForecastDetails
        forecast={forecast({
          result: {
            cashDifference: -1250000,
            withAgreement: { demandMWh: 100, servedMWh: 100 },
            withoutAgreement: { demandMWh: 100, servedMWh: 60 },
          } as AgreementForecast,
        })}
        horizon="over 5 years"
      />
    </BuildDetails>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("-$1.3M over 5 years");
  expect(screen.getByText("Compared with omitting this trade")).toBeVisible();
  expect(screen.getByText("60 → 100%")).toBeVisible();
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
});
it.each([
  [{}, "Calculating…", "Compared with omitting this trade"],
  [{ updating: true }, "Updating…", "Compared with omitting this trade"],
  [
    { blocked: "coop" as const },
    "Unavailable in co-op",
    "Shared supply depends on other companies",
  ],
  [
    { blocked: "buying" as const },
    "Comparison unavailable",
    "Turn on market buying to compare",
  ],
])("keeps transient states in the savings cell", (partial, value, caption) => {
  render(
    <BuildDetails label="Agreement forecast">
      <AgreementForecastDetails
        forecast={forecast(partial)}
        horizon="over 5 years"
      />
    </BuildDetails>,
  );
  expect(screen.getByRole("status")).toHaveTextContent(value);
  expect(screen.getByText(caption)).toBeVisible();
});
it("offers an inline retry when a forecast fails", () => {
  const retry = jest.fn();
  render(
    <BuildDetails label="Agreement forecast">
      <AgreementForecastDetails
        forecast={forecast({ error: true, retry })}
        horizon="over 5 years"
      />
    </BuildDetails>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Forecast unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
});
it("keeps recorded payments separate and does not manufacture unavailable earlier history", () => {
  render(
    <RecordedAgreementHistory
      account={{
        agreementId: "nuclear",
        termsVersion: 2,
        accountingStartMinute: 15,
        accountedThroughMinute: 30,
        months: [{ month: 0, availableMWh: 100, usefulMWh: 50, payment: 1000 }],
      }}
    />,
  );
  expect(
    screen.getByRole("table", { name: "Recorded trade history" }),
  ).toHaveTextContent("50 MWh used · $1k paid");
  expect(screen.getByText("Earlier history unavailable")).toBeVisible();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("identifies missing history instead of rendering zero payments", () => {
  render(<RecordedAgreementHistory />);
  expect(screen.getByText("Earlier history unavailable")).toBeVisible();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

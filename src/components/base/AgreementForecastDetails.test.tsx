import { fireEvent, render, screen } from "@testing-library/react";
import type { AgreementForecast } from "../../helpers/AgreementForecast";
import AgreementForecastDetails from "./AgreementForecastDetails";
import type { useAgreementForecast } from "./useAgreementForecast";
const energy = {
  availableMWh: 100,
  usefulMWh: 50,
  payment: 1000,
  unusedPayment: 500,
};
const result: AgreementForecast = {
  cutoffMinute: 0,
  startMinute: 0,
  endMinute: 1440,
  cashDifference: -250,
  withAgreement: { demandMWh: 100, servedMWh: 100 },
  marketPurchases: { demandMWh: 100, servedMWh: 100 },
  recorded: { ...energy, usefulMWh: 100 },
  remaining: energy,
  recordingStartMinute: 0,
  completeHistory: true,
  earlierHistoryUnavailable: false,
};
function forecast(
  partial: Partial<ReturnType<typeof useAgreementForecast>> = {},
) {
  return {
    blocked: undefined,
    result,
    error: false,
    updating: false,
    retry: jest.fn(),
    ...partial,
  };
}
it("names cash cost and equal service, and weights full-term use by energy", () => {
  render(<AgreementForecastDetails forecast={forecast()} offer />);
  expect(
    screen.getByRole("heading", { name: /Forecast cash cost/ }),
  ).toHaveTextContent("250");
  expect(screen.getByText("Same forecast service share")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "How this is estimated" }),
  );
  expect(
    screen.getByRole("row", { name: /Full-term estimate/ }),
  ).toHaveTextContent("75.0%");
  expect(
    screen.queryByText("Earlier history unavailable."),
  ).not.toBeInTheDocument();
});
it("keeps observed usage and payments visible when comparisons are unavailable", () => {
  render(
    <AgreementForecastDetails
      forecast={forecast({ blocked: "buying", result: undefined })}
      offer={false}
      account={{
        agreementId: "nuclear",
        termsVersion: 2,
        accountingStartMinute: 0,
        accountedThroughMinute: 15,
        months: [{ month: 0, availableMWh: 100, usefulMWh: 50, payment: 1000 }],
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Turn on market buying to compare",
  );
  expect(
    screen.getByRole("table", { name: "Recorded agreement history" }),
  ).toHaveTextContent("paid");
  expect(
    screen.queryByRole("heading", { name: /Forecast cash/ }),
  ).not.toBeInTheDocument();
});

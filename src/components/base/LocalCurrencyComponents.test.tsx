import { render, screen, within } from "@testing-library/react";
import { currencyByCode } from "../../helpers/Currency";
import { getScenario } from "../../data/Scenarios";
import { CurrencyContext } from "./CurrencyContext";
import { RunDebrief } from "./RunResult";
import VictoryConditions from "./VictoryConditions";
import ChartForecastFuelPrices from "./ChartForecastFuelPrices";
import ChartForecastPowerExchange from "./ChartForecastPowerExchange";
import UPlotChart from "./UPlotChart";
import { TickPresentFutureType, VictoryDebriefType } from "../../Types";

jest.mock("./UPlotChart", () => jest.fn(() => null));

const debrief: VictoryDebriefType = {
  startingFleet: [],
  finalFleet: [],
  startingCash: 0,
  finalCash: 1e6,
  finalCustomers: 100,
  reliability: 1,
  unservedWh: 0,
  kgco2e: 0,
  highlights: [],
};

it("keeps a completed custom result in its saved currency when the active location changes", () => {
  const content = (
    <RunDebrief
      outcome="completed"
      debrief={{ ...debrief, currencyCode: "JPY" }}
    />
  );
  const { rerender } = render(
    <CurrencyContext.Provider value={currencyByCode("EUR")}>
      {content}
    </CurrencyContext.Provider>,
  );
  expect(screen.getByText("¥157M")).toBeInTheDocument();
  rerender(
    <CurrencyContext.Provider value={currencyByCode("INR")}>
      {content}
    </CurrencyContext.Provider>,
  );
  expect(screen.getByText("¥157M")).toBeInTheDocument();
  expect(debrief.finalCash).toBe(1e6);
});

it.each([
  [115, "₹89.9M"],
  [126, "SUR 1M"],
])(
  "infers legacy official result currency from scenario %i",
  (scenarioId, amount) => {
    render(
      <CurrencyContext.Provider value={currencyByCode("EUR")}>
        <RunDebrief
          scenarioId={scenarioId}
          outcome="completed"
          debrief={debrief}
        />
      </CurrencyContext.Provider>,
    );
    expect(screen.getByText(amount)).toBeInTheDocument();
  },
);

it("uses a preview's own location for scoring even while another game is active", () => {
  const scenario = { ...getScenario(115)!, ownership: "Investor" as const };
  render(
    <CurrencyContext.Provider value={currencyByCode("EUR")}>
      <VictoryConditions scenario={scenario} difficulty="Manager" />
    </CurrencyContext.Provider>,
  );
  const scoring = screen.getByRole("region", { name: "Scoring" });
  expect(within(scoring).getByText(/₹89.9B/)).toBeInTheDocument();
  expect(scoring).not.toHaveTextContent("€");
});

it("updates fuel chart labels and accessible values through context without converting its data", () => {
  const timeline = [{ minute: 0, Coal: 10 }] as TickPresentFutureType[];
  const element = (
    <ChartForecastFuelPrices
      selectedFuel="Coal"
      timeline={timeline}
      domain={{ x: [0, 60] }}
      startingYear={2020}
      multiyear={false}
    />
  );
  const { rerender } = render(
    <CurrencyContext.Provider value={currencyByCode("EUR")}>
      {element}
    </CurrencyContext.Provider>,
  );
  const latest = () => (UPlotChart as jest.Mock).mock.calls.at(-1)![0];
  expect(latest().formatSummaryValue(10)).toBe("€8.5");
  expect(latest().tooltip(0, latest().state)).toContain("Coal: €8.5");
  const options = latest().buildOptions({
    getState: () => latest().state,
    scale: 1,
  });
  expect(options.axes[1].label).toBe("Price per MMBtu (EUR)");
  expect(options.axes[1].values(undefined, [10])).toEqual(["€8.5"]);
  rerender(
    <CurrencyContext.Provider value={currencyByCode("JPY")}>
      {element}
    </CurrencyContext.Provider>,
  );
  expect(latest().formatSummaryValue(10)).toBe("¥1.6k");
  expect(latest().data[1]).toEqual([10]);
  expect(timeline[0].Coal).toBe(10);
});

it("localizes exchange tooltip prices without changing power or price values", () => {
  const timeline = [
    {
      minute: 0,
      importedW: 1e6,
      exportedW: 0,
      marketPricePerMWh: 10,
      transmissionCapacityW: 2e6,
    },
  ] as TickPresentFutureType[];
  render(
    <CurrencyContext.Provider value={currencyByCode("ZMW")}>
      <ChartForecastPowerExchange
        timeline={timeline}
        domain={{ x: [0, 60] }}
        startingYear={2020}
        multiyear={false}
      />
    </CurrencyContext.Provider>,
  );
  const chart = (UPlotChart as jest.Mock).mock.calls.at(-1)![0];
  expect(chart.tooltip(0, chart.state)).toContain("Neighbor price: ZK220/MWh");
  expect(chart.state.points[0].pricePerMWh).toBe(10);
  expect(chart.data[1]).toEqual([1e6]);
});

it("uses USD for a legacy custom result whose location was never saved", () => {
  render(
    <CurrencyContext.Provider value={currencyByCode("INR")}>
      <RunDebrief scenarioId={999} outcome="completed" debrief={debrief} />
    </CurrencyContext.Provider>,
  );
  expect(screen.getByText("$1M")).toBeInTheDocument();
});

it("spaces fuel price ticks at distinct display increments in a smaller local unit", () => {
  render(
    <CurrencyContext.Provider value={currencyByCode("KWD")}>
      <ChartForecastFuelPrices
        selectedFuel="Coal"
        timeline={[]}
        domain={{ x: [0, 60] }}
        startingYear={2020}
        multiyear={false}
      />
    </CurrencyContext.Provider>,
  );
  const chart = (UPlotChart as jest.Mock).mock.calls.at(-1)![0];
  const options = chart.buildOptions({ getState: () => chart.state, scale: 1 });
  const ticks = options.axes[1].splits(undefined, 1, 0.1, 0.2);
  const labels = options.axes[1].values(undefined, ticks);
  expect(labels.length).toBeGreaterThan(1);
  expect(new Set(labels).size).toBe(labels.length);
});

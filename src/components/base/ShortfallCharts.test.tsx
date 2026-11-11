import { render } from "@testing-library/react";
import { LOCATIONS } from "../../Constants";
import { TickPresentFutureType } from "../../Types";
import UPlotChart from "./UPlotChart";
import ChartSupplyDemand from "./ChartSupplyDemand";
import ChartForecastSupplyDemand from "./ChartForecastSupplyDemand";
import ChartSupplyDemandRanges from "./ChartSupplyDemandRanges";

jest.mock("./UPlotChart", () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

const timeline = [
  { minute: 0, supplyW: 120e6, demandW: 100e6, supplyByFuel: { Coal: 120e6 } },
  { minute: 60, supplyW: 60e6, demandW: 100e6, supplyByFuel: { Coal: 60e6 } },
  { minute: 120, supplyW: 90e6, demandW: 100e6, supplyByFuel: { Coal: 90e6 } },
  {
    minute: 180,
    supplyW: 110e6,
    demandW: 100e6,
    supplyByFuel: { Coal: 110e6 },
  },
] as TickPresentFutureType[];
const forecastProps = {
  timeline,
  startingYear: 2020,
  currentMinute: 0,
  domain: {
    x: [0, 180] as [number, number],
    y: [0, 150e6] as [number, number],
  },
  blackouts: [
    { minute: 20, value: 150e6 },
    { minute: 150, value: 0 },
  ],
};

it.each([
  ["daily", <ChartSupplyDemand {...forecastProps} location={LOCATIONS.SF} />],
  [
    "hourly forecast",
    <ChartForecastSupplyDemand {...forecastProps} multiyear={false} />,
  ],
  ["monthly ranges", <ChartSupplyDemandRanges {...forecastProps} />],
])(
  "%s tooltip inspects the shaded interval rather than just the nearest sample",
  (_name, chart) => {
    jest.mocked(UPlotChart).mockClear();
    render(chart);
    const props = jest.mocked(UPlotChart).mock.calls[0][0];
    const label = props.tooltip!(0, props.state, 25);
    expect(label).toContain("Unmet demand: 5MW");
    expect(label).toContain("Peak shortfall: 40MW");
    expect(props.tooltip!(1, props.state, 170)).not.toContain("Unmet demand:");
  },
);

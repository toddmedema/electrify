import { render } from "@testing-library/react";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { LOCATIONS } from "../../Constants";
import { TickPresentFutureType } from "../../Types";
import UPlotChart from "./UPlotChart";
import ChartSupplyDemand from "./ChartSupplyDemand";
import ChartForecastSupplyDemand from "./ChartForecastSupplyDemand";
import ChartSupplyDemandRanges, {
  supplyDemandMonthlyRanges,
} from "./ChartSupplyDemandRanges";

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
  {
    minute: MINUTES_PER_MONTH,
    supplyW: 120e6,
    demandW: 100e6,
    supplyByFuel: { Coal: 120e6 },
  },
] as TickPresentFutureType[];
const forecastProps = {
  timeline,
  startingYear: 2020,
  currentMinute: 0,
  domain: {
    x: [0, MINUTES_PER_MONTH] as [number, number],
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
  [
    "monthly ranges",
    <ChartSupplyDemandRanges
      {...forecastProps}
      ranges={supplyDemandMonthlyRanges(timeline, 0)}
    />,
  ],
])(
  "%s tooltip inspects the shaded interval rather than just the nearest sample",
  (name, chart) => {
    jest.mocked(UPlotChart).mockClear();
    render(chart);
    const props = jest.mocked(UPlotChart).mock.calls[0][0];
    const label = props.tooltip!(0, props.state, 25);
    expect(label).toContain(
      name === "monthly ranges" ? "13MW avg unmet" : "5MW unmet",
    );
    expect(label).toContain("40MW peak");
    expect(label.split("\n")[0]).toContain("40MW peak");
    expect(label).not.toContain("Blackout:");
    const supplyLabel = name === "daily" ? "Total supply:" : "Supply:";
    expect(label.indexOf("40MW peak")).toBeLessThan(label.indexOf(supplyLabel));
    expect(
      props.tooltip!(props.data[0].length - 1, props.state, MINUTES_PER_MONTH),
    ).not.toMatch(/\d+(?:MW|W) (?:avg )?unmet/);
  },
);

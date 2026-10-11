import { render } from "@testing-library/react";
import ChartSupplyDemand, { Props } from "./ChartSupplyDemand";
import UPlotChart from "./UPlotChart";
import { LOCATIONS } from "../../Constants";
import { chartPalette } from "../../Theme";

jest.mock("./UPlotChart", () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

it("draws storage/intertie dividers above the fills in both history and forecast", () => {
  const timeline: Props["timeline"] = [
    {
      minute: 0,
      demandW: 100,
      supplyW: 100,
      supplyByFuel: { Sun: 20, Coal: 80 },
      storageDischargeW: 10,
      importedW: 20,
      storageChargeW: 20,
      exportedW: 10,
    },
    {
      minute: 60,
      demandW: 110,
      supplyW: 110,
      supplyByFuel: { Sun: 30, Coal: 70 },
      storageDischargeW: 20,
      importedW: 30,
      storageChargeW: 25,
      exportedW: 15,
    },
    {
      minute: 120,
      demandW: 120,
      supplyW: 110,
      supplyByFuel: { Sun: 40, Coal: 60 },
      storageDischargeW: 30,
      importedW: 40,
      storageChargeW: 40,
      exportedW: 20,
    },
  ];
  render(
    <ChartSupplyDemand
      timeline={timeline}
      currentMinute={60}
      location={LOCATIONS.SF}
      startingYear={2020}
    />,
  );
  const props = jest.mocked(UPlotChart).mock.calls[0][0];
  const options = props.buildOptions({ getState: () => props.state, scale: 1 });
  const series = options.series!;
  const lastFill = Math.max(
    ...series.flatMap((item, i) => (item.fill ? [i] : [])),
  );
  const dividers = series.flatMap((item, i) =>
    item.stroke === chartPalette().intertie && (item.width || 0) > 0
      ? [{ index: i, values: props.data[i], dash: item.dash || [] }]
      : [],
  );
  expect(dividers.map(({ values, dash }) => ({ values, dash }))).toEqual(
    expect.arrayContaining([
      // Discharge/import boundary: generation plus storage discharge.
      { values: [110, 120, null], dash: [] },
      { values: [110, 120, 130], dash: [2, 3] },
      // Charging/export boundary: customer demand plus grid draw for charging.
      { values: [120, 135, null], dash: [] },
      { values: [120, 135, 160], dash: [2, 3] },
    ]),
  );
  dividers.forEach(({ index }) => expect(index).toBeGreaterThan(lastFill));
});

import { render, screen } from "@testing-library/react";
import cloneDeep from "lodash.clonedeep";
import { createGame } from "../../testing/Simulator";
import { COLD_DEFINITION_ID } from "../../helpers/Hazards";
import { FacilityFeedbackProvider } from "./FacilityFeedback";

it("updates the existing live region for repeated identical recoveries, without repeating healthy frames", () => {
  const damaged = createGame({ scenarioId: 100 });
  const gas = damaged.facilities.find(
    (facility) => facility.fuel === "Natural Gas",
  )!;
  damaged.worldEvents.active.push({
    key: "feedback-cold",
    definitionId: COLD_DEFINITION_ID,
    startsMinute: damaged.date.minute,
    endsMinute: damaged.date.minute + 30,
    attributes: { hazard: "EXTREME_COLD" },
    effects: { facilityOutputMultipliersById: { [String(gas.id)]: 0.5 } },
  });
  const healthy = cloneDeep(damaged);
  healthy.worldEvents.active = [];
  const view = render(
    <FacilityFeedbackProvider game={damaged}>
      <div />
    </FacilityFeedbackProvider>,
  );
  const status = screen.getByRole("status");
  const observer = new MutationObserver(() => undefined);
  observer.observe(status, { childList: true });
  const show = (game: typeof damaged) =>
    view.rerender(
      <FacilityFeedbackProvider game={game}>
        <div />
      </FacilityFeedbackProvider>,
    );

  show(healthy);
  expect(status).toHaveTextContent(`${gas.name}: weather outage ended.`);
  expect(observer.takeRecords()).not.toHaveLength(0);
  show(cloneDeep(healthy));
  expect(observer.takeRecords()).toHaveLength(0);
  show(damaged);
  expect(observer.takeRecords()).toHaveLength(0);
  show(healthy);
  expect(status).toHaveTextContent(`${gas.name}: weather outage ended.`);
  expect(observer.takeRecords()).not.toHaveLength(0);
  expect(screen.getByRole("status")).toBe(status);
  observer.disconnect();
});

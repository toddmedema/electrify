import { renderScenarioText, scenarioTextError } from "./ScenarioText";
import { compileScenarioRules } from "./ScenarioRules";

const parameters = {
  namespace: { kind: "mod" as const, id: "dates" },
  seed: 42,
  difficulty: "Employee" as const,
  startingYear: 2020,
  durationMonths: 36,
  startingPeakW: 1e6,
  startingAssetIds: [],
};

test("start and event anchors render calendar dates across years", () => {
  expect(
    renderScenarioText(
      "Prepare by {{start+2 months}}; return in {{event+7 months}}.",
      2020,
      12,
    ),
  ).toBe("Prepare by March 2020; return in August 2021.");
  expect(
    renderScenarioText(
      "{{start}} / {{event}} / {{ event + 1 month }}",
      2040,
      11,
    ),
  ).toBe("January 2040 / December 2040 / January 2041");
});

test("the real compiler freezes event, decision, goal and report dates", () => {
  const rules = compileScenarioRules(
    {
      objectives: [
        {
          id: "retire",
          label: "Retire by {{start+24 months}}",
          metric: "fuelRetirement",
          fuel: "Coal",
          deadlineMonth: 25,
        },
      ],
      events: [
        {
          id: "outage",
          title: "Outage in {{event}}",
          message: "Offline until {{event+3 months}}.",
          startMonth: 13,
          durationMonths: 3,
          effects: { demandMultiplier: 1.1 },
          endMessage: "Work began in {{event}}.",
          report: {
            id: "assets",
            kind: "affectedFacilities",
            eventId: "outage",
            label: "Assets affected in {{event}}",
          },
        },
      ],
      choices: [
        {
          id: "plan",
          title: "Plan",
          dueMonth: 7,
          prompt: "Prepare for {{start+12 months}}; decide in {{event}}.",
          options: [
            {
              id: "pay",
              label: "Pay",
              description: "Ready by {{event+6 months}}.",
              message: "Paid in {{event}}.",
              costDollars: 1000,
            },
            {
              id: "wait",
              label: "Wait",
              description: "Keep the current plan.",
              message: "Plan kept.",
            },
          ],
        },
      ],
      debriefReports: [
        {
          id: "review",
          kind: "profitLoss",
          fromMonth: 1,
          throughMonth: 36,
          label: "Review from {{start}}",
        },
      ],
    },
    parameters,
  );
  expect(rules.events[0]).toEqual(
    expect.objectContaining({
      title: "Outage in January 2021",
      message: "Offline until April 2021.",
      endMessage: "Work began in January 2021.",
    }),
  );
  expect(rules.events[0].report?.label).toBe("Assets affected in January 2021");
  expect(rules.choices[0].prompt).toBe(
    "Prepare for January 2021; decide in July 2020.",
  );
  expect(
    rules.choices[0].options.find((o) => o.id === "pay")?.description,
  ).toBe("Ready by January 2021.");
  expect(rules.choices[0].freeOptionId).toBe("wait");
  expect(rules.objectives[0].label).toBe("Retire by January 2022");
  expect(rules.debriefReports[0].label).toBe("Review from January 2020");
  expect(JSON.stringify(rules)).not.toContain("{{");
});

test("seeded event dates use that run's actual onset", () => {
  for (const seed of [1, 2, 3, 4]) {
    const event = compileScenarioRules(
      {
        objectives: [],
        events: [
          {
            id: "opening",
            title: "Opening",
            message: "Starts {{event}}.",
            startMonth: { from: 2, to: 3 },
          },
        ],
      },
      { ...parameters, seed },
    ).events[0];
    expect(event.message).toBe(
      event.startMonth === 1 ? "Starts February 2020." : "Starts March 2020.",
    );
  }
});

test.each([
  "{{date}}",
  "{{start+1201 months}}",
  "{{event.constructor}}",
  "{{start-1 months}}",
  "{{start+2 months}",
])("rejects invalid date expression %s", (text) => {
  expect(scenarioTextError(text, true)).toBeDefined();
});

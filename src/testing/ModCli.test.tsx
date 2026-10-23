import cloneDeep from "lodash.clonedeep";
import { packageDigest } from "../mods/ModSchema";
import type { ModPackage } from "../mods/ModSchema";
import {
  formatModSimulation,
  modSimulationMatrix,
  parseModResponses,
  runModSimulation,
} from "./ModCli";

const pack = (): ModPackage => ({
  schemaVersion: 1,
  gameApi: 1,
  id: "cli-grid",
  title: "CLI grid",
  creator: "Fixture author",
  version: "1",
  description: "Explicit decisions for your grid.",
  seed: 2468,
  baseScenarioId: 999,
  officialArcs: [],
  objectives: [],
  scenario: {
    durationMonths: 6,
    startingYear: 2020,
    cash: 1e9,
    startingCustomers: 10000,
    dollarsPerkWh: 0.2,
  },
  choices: [
    {
      id: "funding",
      title: "Funding",
      prompt: "Choose funding.",
      dueMonth: 1,
      options: [
        {
          id: "accept",
          label: "Accept",
          description: "Receive funding.",
          message: "Funding received.",
          grantDollars: 10000,
        },
        {
          id: "decline",
          label: "Decline",
          description: "Keep your current plan.",
          message: "Current plan kept.",
          costDollars: 0,
        },
      ],
    },
    {
      id: "follow-up",
      title: "Follow-up",
      prompt: "Choose your follow-up.",
      dueMonth: 3,
      requiresChoice: { choiceId: "funding", optionIds: ["accept"] },
      options: [
        {
          id: "keep",
          label: "Keep",
          description: "Keep the contribution.",
          message: "Contribution kept.",
          costDollars: 0,
        },
        {
          id: "return",
          label: "Return",
          description: "Return the contribution.",
          message: "Contribution returned.",
          costDollars: 10000,
        },
      ],
    },
  ],
});
const responses = (
  ...items: { choiceId: string; optionId: string; arc?: number }[]
) => ({ responses: items });

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("mod simulation requires an explicit response policy and rejects an unanswered reached choice", () => {
  expect(() => runModSimulation(pack())).toThrow(
    /--responses.*--free-fallback/,
  );
  expect(() => runModSimulation(pack(), { responses: responses() })).toThrow(
    /no response.*mod:cli-grid:funding/i,
  );
  expect(() =>
    runModSimulation(pack(), {
      responses: responses({ choiceId: "funding", optionId: "accept" }),
    }),
  ).toThrow(/no response.*mod:cli-grid:follow-up/i);
  const [valid] = runModSimulation(pack(), {
    responses: responses(
      { choiceId: "funding", optionId: "accept" },
      { choiceId: "follow-up", optionId: "keep" },
    ),
  });
  expect(valid.responses).toEqual([
    {
      choiceId: "funding",
      optionId: "accept",
      month: 1,
      automatic: false,
      fallback: false,
    },
    {
      choiceId: "follow-up",
      optionId: "keep",
      month: 3,
      automatic: false,
      fallback: false,
    },
  ]);
  expect(valid.outcome).toBe("completed");
  expect(valid.result.violationCount).toBe(0);
  expect(valid.seed).toBe(2468);
  expect(valid.packageDigest).toBe(packageDigest(pack()));
});

test("explicit branches use actual receipts and warn for a known response never reached", () => {
  const [accepted] = runModSimulation(pack(), {
    responses: responses(
      { choiceId: "funding", optionId: "accept" },
      { choiceId: "follow-up", optionId: "return" },
    ),
  });
  const [declined] = runModSimulation(pack(), {
    responses: responses(
      { choiceId: "funding", optionId: "decline" },
      { choiceId: "follow-up", optionId: "return" },
    ),
  });
  expect(accepted.responses).toHaveLength(2);
  expect(declined.responses).toEqual([
    {
      choiceId: "funding",
      optionId: "decline",
      month: 1,
      automatic: false,
      fallback: false,
    },
  ]);
  expect(declined.warnings).toEqual([
    "Response mod:cli-grid:follow-up/return was never reached.",
  ]);
  const receipt = accepted.result.storyOccurrences.find(
    (event) => event.key === "mod:cli-grid:funding",
  )!;
  expect(receipt.attributes).toMatchObject({
    choice: "accept",
    upfrontGrant: 10000,
  });
  expect(accepted.result.months[0].revenueGrants).toBe(10000);
  expect(declined.result.months[0].revenueGrants ?? 0).toBe(0);
  expect(formatModSimulation(accepted)).toContain("funding/accept (explicit)");
});

test("free fallback is explicit and reports each actual default, while supplied branches still win", () => {
  const [fallback] = runModSimulation(pack(), { freeFallback: true });
  expect(fallback.responses.every((response) => response.fallback)).toBe(true);
  expect(formatModSimulation(fallback)).toContain("(free fallback)");
  const [mixed] = runModSimulation(pack(), {
    freeFallback: true,
    responses: responses({ choiceId: "funding", optionId: "accept" }),
  });
  expect(
    mixed.responses.find((response) => response.choiceId === "funding")
      ?.fallback,
  ).toBe(false);
  expect(
    mixed.responses.find((response) => response.choiceId === "follow-up")
      ?.fallback,
  ).toBe(true);
});

test.each([
  [
    "unknown choice",
    responses({ choiceId: "invented", optionId: "accept" }),
    /Unknown choice/,
  ],
  [
    "unknown option",
    responses({ choiceId: "funding", optionId: "invented" }),
    /Unknown option/,
  ],
  [
    "unknown arc",
    responses({ arc: 106, choiceId: "funding", optionId: "accept" }),
    /Unknown choice/,
  ],
  [
    "duplicate",
    responses(
      { choiceId: "funding", optionId: "accept" },
      { choiceId: "funding", optionId: "decline" },
    ),
    /More than one/,
  ],
] as const)(
  "invalid %s response is rejected before simulating",
  (_label, input, message) => {
    expect(() => runModSimulation(pack(), { responses: input })).toThrow(
      message,
    );
  },
);

test.each([
  null,
  { responses: [], extra: true },
  { responses: [{ choiceId: "funding", optionId: "accept", source: "code" }] },
  { responses: [{ choiceId: "funding", optionId: "accept", arc: Infinity }] },
  { responses: [{ choiceId: "../funding", optionId: "accept" }] },
  { responses: [() => "code"] },
])("hostile response JSON is rejected with a valid neighbor", (input) => {
  expect(() => parseModResponses(input)).toThrow(/Responses|responses/);
  expect(
    parseModResponses(responses({ choiceId: "funding", optionId: "accept" })),
  ).toEqual([{ choiceId: "funding", optionId: "accept" }]);
});

test("a small seed/difficulty matrix freezes each variant and leaves the source package unchanged", () => {
  const input = pack();
  const original = cloneDeep(input);
  const runs = runModSimulation(input, {
    freeFallback: true,
    seeds: [0, 17],
    difficulties: ["Intern", "CEO"],
  });
  expect(runs.map(({ seed, difficulty }) => [seed, difficulty])).toEqual([
    [0, "Intern"],
    [0, "CEO"],
    [17, "Intern"],
    [17, "CEO"],
  ]);
  expect(new Set(runs.map((run) => run.runtimeDigest)).size).toBe(4);
  runs.forEach((run) => {
    expect(run.result.scenario.mod!.parameters).toMatchObject({
      seed: run.seed,
      difficulty: run.difficulty,
    });
    expect(run.result.violationCount).toBe(0);
  });
  expect(input).toEqual(original);
  expect(() =>
    modSimulationMatrix(input, {
      seeds: Array.from({ length: 21 }, (_, index) => index),
    }),
  ).toThrow(/20/);
  expect(() => modSimulationMatrix(input, { seeds: [1, 1] })).toThrow(
    /distinct/,
  );
  expect(() => modSimulationMatrix(input, { seeds: [-1] })).toThrow(/Seeds/);
  expect(() =>
    modSimulationMatrix(input, { difficulties: ["Manager", "Manager"] }),
  ).toThrow(/distinct/);
});

test("a partial probe is labelled in progress and cannot run beyond the frozen term", () => {
  const input = pack();
  delete input.choices;
  const [partial] = runModSimulation(input, { simulation: { months: 2 } });
  expect(partial.outcome).toBe("inProgress");
  expect(formatModSimulation(partial)).toContain("inProgress at month 2 of 6");
  expect(() => runModSimulation(input, { simulation: { months: 7 } })).toThrow(
    /frozen term of 6/,
  );
});

test("imported response references bind to the real arc choice and automatic choices report their committed branch", () => {
  const input = pack();
  input.baseScenarioId = 106;
  input.officialArcs = [{ scenarioId: 106, includeChoices: true }];
  input.scenario = { ...input.scenario, durationMonths: 120, cash: 1e12 };
  delete input.choices;
  const [explicit] = runModSimulation(input, {
    responses: responses({
      arc: 106,
      choiceId: "connection",
      optionId: "phased",
    }),
    simulation: { months: 49 },
  });
  expect(explicit.responses).toEqual([
    {
      arc: 106,
      choiceId: "connection",
      optionId: "phased",
      month: 49,
      automatic: false,
      fallback: false,
    },
  ]);
  expect(explicit.warnings).toEqual([]);
  input.officialArcs[0].includeChoices = false;
  const [automatic] = runModSimulation(input, { simulation: { months: 49 } });
  expect(automatic.responses).toEqual([
    {
      arc: 106,
      choiceId: "connection",
      optionId: "fast-track",
      month: 49,
      automatic: true,
      fallback: false,
    },
  ]);
  expect(formatModSimulation(automatic)).toContain(
    "arc 106/connection/fast-track (automatic)",
  );
  expect(() =>
    runModSimulation(input, {
      responses: responses({
        arc: 106,
        choiceId: "connection",
        optionId: "phased",
      }),
    }),
  ).toThrow(/resolves automatically/);
});

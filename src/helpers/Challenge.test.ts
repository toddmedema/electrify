import cloneDeep from "lodash.clonedeep";
import { SCENARIOS } from "../data/Scenarios";
import {
  captureRunIdentity,
  expandAuthoredRunReference,
  projectAuthoredRunReference,
  sameRunIdentity,
  validRunIdentity,
} from "./RunIdentity";
import {
  challengeUrl,
  parseChallengeUrl,
  validInvitation,
  challengeShareContent,
  challengeComparison,
  MAX_CHALLENGE_URL,
} from "./Challenge";
import { ChallengeInvitationV1, VictoryType } from "../Types";
const scenario = SCENARIOS.find((s) => s.id === 101)!;
const identity = captureRunIdentity(scenario, 42, "CEO");
const run = projectAuthoredRunReference(identity)!;
const invitation: ChallengeInvitationV1 = {
  invitationSchemaVersion: 1,
  run,
  target: 12400,
};
const victory: VictoryType = {
  scenarioId: 101,
  scenarioName: scenario.name,
  difficulty: "CEO",
  score: 12400,
  breakdown: {},
  ranked: false,
  runIdentity: identity,
};
const url = (raw: unknown) =>
  `https://electrifygame.com/?challenge=${encodeURIComponent(JSON.stringify(raw))}`;
it("round trips canonical identity and preserves unrelated attribution", () => {
  expect(sameRunIdentity(identity, expandAuthoredRunReference(run))).toBe(true);
  expect(validRunIdentity(identity)).toBe(true);
  expect(
    parseChallengeUrl(
      challengeUrl(invitation, "https://electrifygame.com/?ref=friend")!,
    )?.invitation,
  ).toEqual(invitation);
  expect(
    challengeUrl(invitation, "https://electrifygame.com/?ref=friend"),
  ).toContain("ref=friend");
});
it.each([0, -100, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])(
  "accepts integer target %p",
  (target) => expect(validInvitation({ ...invitation, target })).toBe(true),
);
it.each([
  NaN,
  Infinity,
  -Infinity,
  1.1,
  Number.MAX_SAFE_INTEGER + 1,
  "2",
  null,
  {},
  [],
])("rejects target %p", (target) =>
  expect(validInvitation({ ...invitation, target })).toBe(false),
);
it.each([
  { seed: -1 },
  { seed: 2 ** 32 },
  { seed: 1.1 },
  { difficulty: "constructor" },
  { scenarioId: 0 },
  { scenarioId: 99999 },
  { identitySchemaVersion: 2 },
  { optionsProfile: "anything" },
  { scenarioRevision: "old" },
  { compatibilityId: "old" },
  { extra: true },
])("rejects incompatible reference %p", (patch) =>
  expect(expandAuthoredRunReference({ ...run, ...patch })).toBeUndefined(),
);
it("rejects overrides, waived gates, changed inputs, and custom/replay/tutorial origins", () => {
  for (const origin of ["custom", "tutorial", "replay"] as const)
    expect(
      projectAuthoredRunReference({ ...identity, origin }),
    ).toBeUndefined();
  for (const inputs of [
    { cash: 1 },
    { meaningfulDecisionGateWaived: true },
    { location: { ...identity.inputs.location, lat: 0 } },
    { facilities: [] },
  ])
    expect(
      projectAuthoredRunReference({
        ...identity,
        inputs: { ...identity.inputs, ...inputs },
      }),
    ).toBeUndefined();
  const fixed = SCENARIOS.find(
    (s) => !s.tutorialSteps && s.seed !== undefined,
  )!;
  const fixedIdentity = captureRunIdentity(fixed, fixed.seed!, "Intern");
  expect(projectAuthoredRunReference(fixedIdentity)).toBeDefined();
  expect(
    projectAuthoredRunReference({ ...fixedIdentity, seed: fixed.seed! + 1 }),
  ).toBeUndefined();
  expect(sameRunIdentity(identity, { ...identity, origin: "replay" })).toBe(
    true,
  );
  expect(sameRunIdentity(identity, undefined)).toBe(false);
  expect(validRunIdentity(null)).toBe(false);
});
it("rejects transport ambiguity, malformed payload and unknown schemas without a fallback challenge", () => {
  expect(
    parseChallengeUrl("https://electrifygame.com/?scenario=101"),
  ).toBeUndefined();
  for (const href of [
    url(invitation) + "&challenge=x",
    url(invitation) + "&scenario=102",
    url(invitation) + "&scenario=101&scenario=101",
    url({ ...invitation, invitationSchemaVersion: 2 }),
    url({ ...invitation, html: "<script>" }),
    "https://electrifygame.com/?challenge=%invalid",
    url([]),
  ])
    expect(parseChallengeUrl(href)?.error).toBeTruthy();
  expect(
    parseChallengeUrl(url(invitation) + "&scenario=101")?.invitation,
  ).toEqual(invitation);
});
it("bounds the whole generated URL and incoming input before JSON decoding", () => {
  const base = challengeUrl(invitation, "https://electrifygame.com/?r=")!;
  const exact = challengeUrl(
    invitation,
    `https://electrifygame.com/?r=${"a".repeat(MAX_CHALLENGE_URL - base.length)}`,
  )!;
  expect(exact.length).toBe(MAX_CHALLENGE_URL);
  expect(
    challengeUrl(
      invitation,
      `https://electrifygame.com/?r=${"a".repeat(MAX_CHALLENGE_URL)}`,
    ),
  ).toBeUndefined();
  const parse = jest.spyOn(JSON, "parse");
  expect(parseChallengeUrl(exact + "a")?.error).toBeTruthy();
  expect(parse).not.toHaveBeenCalled();
  parse.mockRestore();
  expect(challengeUrl({ ...invitation, target: NaN })).toBeUndefined();
});
it("uses bounded ordinary sharing when identity or URL is ineligible, without an invitation claim", () => {
  for (const result of [
    challengeShareContent({ ...victory, runIdentity: undefined }),
    challengeShareContent(
      victory,
      `https://electrifygame.com/?noise=${"x".repeat(2048)}`,
    ),
  ]) {
    expect(result.challenge).toBe(false);
    expect(result.content.url.length).toBeLessThanOrEqual(2048);
    expect(result.content.text).not.toContain("Can you beat");
    expect(result.content.url).not.toContain("challenge");
  }
});
it("compares signed local scores only for matching conditions", () => {
  expect(challengeComparison({ ...victory, challenge: invitation })).toContain(
    "tied",
  );
  expect(
    challengeComparison({ ...victory, score: 12410, challenge: invitation }),
  ).toContain("beat");
  expect(
    challengeComparison({
      ...victory,
      score: -20,
      challenge: { ...invitation, target: 0 },
    }),
  ).toContain("20 points below");
  expect(
    challengeComparison({
      ...victory,
      runIdentity: undefined,
      challenge: invitation,
    }),
  ).toContain("cannot be compared");
  expect(challengeComparison(victory)).toBeUndefined();
  expect(
    challengeComparison({
      ...victory,
      score: 2,
      challenge: { ...invitation, target: Number.MIN_SAFE_INTEGER },
    }),
  ).toContain("9,007,199,254,740,993");
});
it("stories report demand served, never infer blackout absence or uptime, and handle zero demand", () => {
  const debrief = {
    startingFleet: [],
    finalFleet: [],
    startingCash: 0,
    finalCash: 0,
    finalCustomers: 0,
    reliability: 0.99999,
    unservedWh: 1,
    kgco2e: 0,
    highlights: [],
    demandWh: 1000,
  };
  const story = challengeShareContent({
    ...victory,
    debrief,
    outcome: "fired",
  });
  expect(story.content.text).toContain("electricity demand");
  expect(story.content.text).not.toMatch(/blackout|uptime|emissions/);
  expect(
    challengeShareContent({ ...victory, debrief: { ...debrief, demandWh: 0 } })
      .content.text,
  ).not.toContain("100%");
  expect(challengeShareContent(cloneDeep(victory)).challenge).toBe(true);
});

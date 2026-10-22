import { createHash } from "crypto";
import {
  canonicalRuleJson,
  canonicalRuleValue,
  ruleDigest,
  sha256,
  utf8Bytes,
} from "./RuleIdentity";
import { packageDigest } from "../mods/ModSchema";

const nodeSha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

describe("shared SHA-256", () => {
  test.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
  ])("matches the standard vector for %j", (input, expected) => {
    expect(sha256(input)).toBe(expected);
    expect(sha256(input)).toBe(nodeSha256(input));
  });

  test.each([55, 56, 63, 64, 65, 127, 128, 129, 1024])(
    "matches Node crypto across the %i-byte padding boundary",
    (length) => {
      const input = "a".repeat(length);
      expect(sha256(input)).toBe(nodeSha256(input));
    },
  );

  test("matches the million-byte standard vector", () => {
    const input = "a".repeat(1000000);
    expect(sha256(input)).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });

  test.each([
    "ASCII",
    "é",
    "電力",
    "⚡🔋",
    "\ud800",
    "\udc00",
    "A\ud800B",
    "\ud800\udc00",
  ])("encodes UTF-8 and hashes %j identically to Node", (input) => {
    expect(utf8Bytes(input)).toEqual([...Buffer.from(input, "utf8")]);
    expect(sha256(input)).toBe(nodeSha256(input));
  });
});

describe("canonical rule identities", () => {
  test("object key order and unordered ID collections cannot change identity", () => {
    const content = {
      events: [
        { id: "z-event", startMonth: 2, effects: { demandMultiplier: 1.1 } },
        { id: "a-event", startMonth: 1, effects: { demandMultiplier: 0.9 } },
      ],
      choices: [
        {
          id: "decision",
          options: [
            { id: "z-option", costDollars: 1 },
            { id: "a-option", costDollars: 0 },
          ],
        },
      ],
      objectives: [{ id: "z-goal" }, { id: "a-goal" }],
      loads: [{ id: "z-load" }, { id: "a-load" }],
      debriefReports: [{ id: "z-report" }, { id: "a-report" }],
      officialArcs: [
        { scenarioId: 111, includeChoices: true },
        { scenarioId: 106, includeChoices: false },
      ],
    };
    const reordered = {
      officialArcs: [...content.officialArcs].reverse(),
      debriefReports: [...content.debriefReports].reverse(),
      loads: [...content.loads].reverse(),
      objectives: [...content.objectives].reverse(),
      choices: [
        {
          options: [...content.choices[0].options].reverse(),
          id: content.choices[0].id,
        },
      ],
      events: content.events
        .slice()
        .reverse()
        .map((item) => ({
          effects: item.effects,
          startMonth: item.startMonth,
          id: item.id,
        })),
    };
    expect(canonicalRuleJson(reordered)).toBe(canonicalRuleJson(content));
    expect(ruleDigest(reordered)).toBe(ruleDigest(content));
    expect(content.events[0].id).toBe("z-event");
    expect(content.choices[0].options[0].id).toBe("z-option");
  });

  test("reference sets canonicalize while intentional array ordering remains significant", () => {
    const references = {
      optionIds: ["z-option", "a-option"],
      eventIds: ["z-event", "a-event"],
      fuels: ["Wind", "Sun"],
      startingAssetIds: ["z-asset", "a-asset"],
    };
    const reordered = Object.fromEntries(
      Object.entries(references).map(([key, items]) => [
        key,
        [...items].reverse(),
      ]),
    );
    expect(ruleDigest(reordered)).toBe(ruleDigest(references));
    const fleet = [
      { fuel: "Coal", peakMW: 200 },
      { fuel: "Sun", peakMW: 100 },
    ];
    expect(canonicalRuleValue({ fleet })).toEqual({ fleet });
    expect(ruleDigest({ fleet: [...fleet].reverse() })).not.toBe(
      ruleDigest({ fleet }),
    );
    expect(ruleDigest({ monthlyValues: [1, 2] })).not.toBe(
      ruleDigest({ monthlyValues: [2, 1] }),
    );
  });

  test("canonicalization preserves exact authored numbers and semantic changes move the digest", () => {
    expect(canonicalRuleJson({ z: 0, a: { z: 1, b: 2 } })).toBe(
      '{"a":{"b":2,"z":1},"z":0}',
    );
    expect(ruleDigest({ startMonth: 1 })).not.toBe(
      ruleDigest({ startMonth: 2 }),
    );
    expect(ruleDigest({ multiplier: 0.3 })).not.toBe(
      ruleDigest({ multiplier: 0.30000000000000004 }),
    );
    const content = { events: [{ id: "event", startMonth: 1 }] };
    expect(ruleDigest(content)).toBe(
      `sha256-${nodeSha256(canonicalRuleJson(content))}`,
    );
  });

  test("editor $schema is excluded by the package owner without hiding other changes", () => {
    const pack = {
      schemaVersion: 1,
      gameApi: 1,
      id: "test-grid",
      title: "Test Grid",
      creator: "Creator",
      version: "1",
      description: "A grid planning challenge.",
      seed: 42,
      baseScenarioId: 999,
      objectives: { mode: "none" },
    };
    expect(packageDigest({ ...pack, $schema: "./scenario.schema.json" })).toBe(
      packageDigest(pack),
    );
    expect(
      packageDigest({ ...pack, $schema: "https://example.com/schema.json" }),
    ).toBe(packageDigest(pack));
    expect(packageDigest({ ...pack, seed: 43 })).not.toBe(packageDigest(pack));
    expect(packageDigest({ ...pack, title: "A Changed Grid" })).not.toBe(
      packageDigest(pack),
    );
  });
});

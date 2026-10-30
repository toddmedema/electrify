import fs from "fs";
import path from "path";
import { MOD_SCENARIO_IDS } from "../mods/ModSchema";
import { formatModArcReference, modArcReferences } from "./ModArcReference";

const reference = modArcReferences();
// Markdown formatting is mechanical; compare all generated content without table padding.
const normalizedDocument = (text: string) =>
  text
    .split("\n")
    .map((line) =>
      line.startsWith("|")
        ? line
            .split("|")
            .map((cell) => (/^:?-+:?$/.test(cell.trim()) ? "---" : cell.trim()))
            .join("|")
        : line,
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

test("the generated arc document covers every actual imported phase, decision and load", () => {
  expect(reference.map((arc) => arc.id)).toEqual(MOD_SCENARIO_IDS);
  for (const arc of reference) {
    // Expansion has base-owned portfolios; every other imported arc carries events, loads or choices.
    expect(
      arc.phases.length + arc.choices.length + arc.loads.length === 0,
    ).toBe(arc.id === 116);
    expect(new Set(arc.phases.map((phase) => phase.id)).size).toBe(
      arc.phases.length,
    );
    for (const phase of arc.phases) {
      expect(phase.offset.from).toBeGreaterThanOrEqual(0);
      expect(phase.offset.to).toBeGreaterThanOrEqual(phase.offset.from);
    }
    for (const choice of arc.choices)
      expect(choice.options).toContain(choice.automaticResponse);
  }
  expect(
    normalizedDocument(
      fs.readFileSync(
        path.resolve(__dirname, "../../docs/mods/arc-reference.md"),
        "utf8",
      ),
    ),
  ).toBe(normalizedDocument(formatModArcReference(reference)));
});

test("arc-scoped data-center IDs preserve actual prepared timing and free response", () => {
  const arc = reference.find((entry) => entry.id === 106)!;
  expect(arc.choices).toContainEqual({
    id: "connection",
    dueMonth: 49,
    options: ["fast-track", "phased"],
    automaticResponse: "fast-track",
  });
  expect(arc.loads).toEqual(
    expect.arrayContaining([
      { id: "manassas-data-centers", month: 73 },
      {
        id: "manassas-data-centers-phase-one",
        month: 73,
        branch: "connection/phased",
      },
      {
        id: "manassas-data-centers-phase-two",
        month: 97,
        branch: "connection/phased",
      },
    ]),
  );
  expect(reference.find((entry) => entry.id === 110)!.phases).toContainEqual(
    expect.objectContaining({ id: "trip", offset: { from: 42, to: 48 } }),
  );
});

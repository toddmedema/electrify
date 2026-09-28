import { POLICIES } from "../data/Policies";
import { GameType, PolicyProgramType } from "../Types";
import {
  choiceStatus,
  labelMonth,
  pendingLabel,
  programStatus,
} from "./PolicyStatus";

const game = { startingYear: 2030 } as GameType;

function program(overrides: Partial<PolicyProgramType>): PolicyProgramType {
  return { tier: "Off", adoption: 0, spending: 0, spent: 0, ...overrides };
}

describe("labelMonth", () => {
  it("names run-relative months, including ones before the run began", () => {
    expect(labelMonth(game, 0)).toBe("Jan 2030");
    expect(labelMonth(game, 13)).toBe("Feb 2031");
    expect(labelMonth(game, -1)).toBe("Dec 2029");
  });
});

describe("programStatus", () => {
  it("reports an operating offer's tier", () => {
    expect(programStatus(game, "timeOfUse", program({ tier: "On" }))).toBe(
      "On",
    );
  });

  it("describes a build-out as a project", () => {
    const months = POLICIES.solar.buildoutMonths;
    expect(programStatus(game, "solar", program({}))).toBe("Not started");
    expect(
      programStatus(game, "solar", program({ tier: "On", adoption: 0.5 })),
    ).toBe(`In progress · month ${months / 2} of ${months}`);
    expect(programStatus(game, "solar", program({ adoption: 0.5 }))).toBe(
      `Paused · month ${months / 2} of ${months}`,
    );
    expect(
      programStatus(
        game,
        "solar",
        program({ adoption: 1, completedMonth: 25 }),
      ),
    ).toBe("Completed Feb 2032");
  });
});

describe("pendingLabel and choiceStatus", () => {
  it("has nothing to say without a scheduled change", () => {
    expect(pendingLabel(game, "solar", program({}))).toBeUndefined();
    expect(choiceStatus(game, "solar", program({}))).toBe("Not started");
  });

  it("appends a scheduled change to the status line", () => {
    const scheduled = program({ pending: { tier: "On", month: 2 } });
    expect(pendingLabel(game, "solar", scheduled)).toBe("Starts Mar 2030");
    expect(choiceStatus(game, "solar", scheduled)).toBe(
      "Not started · starts Mar 2030",
    );
  });

  it("gives an operating offer's window when it turns on", () => {
    const scheduled = program({
      pending: { tier: "On", month: 0, startHour: 18 },
    });
    expect(pendingLabel(game, "timeOfUse", scheduled)).toBe(
      "Turns on Jan 2030 · 18:00–22:00",
    );
  });
});

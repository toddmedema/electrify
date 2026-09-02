import { GameEventType } from "../Types";
import { soundEffectsForUpdate, SoundEventSnapshot } from "./SoundEvents";

function event(
  id: number,
  kind: GameEventType["kind"],
  message: string = kind,
): GameEventType {
  return { id, kind, label: "Jan 2020", message };
}

function snapshot(
  overrides: Partial<SoundEventSnapshot> = {},
): SoundEventSnapshot {
  return {
    inGame: true,
    events: [],
    victoryOpen: false,
    dialogOpen: false,
    dialogTitle: "",
    ...overrides,
  };
}

describe("soundEffectsForUpdate", () => {
  it("maps newly logged gameplay transitions onto their semantic cues", () => {
    const previous = snapshot({ events: [event(1, "BUILD")] });
    const current = snapshot({
      events: [
        event(4, "BLACKOUT_OVER"),
        event(3, "CONSTRUCTION"),
        event(2, "BLACKOUT"),
        event(1, "BUILD"),
      ],
    });

    expect(soundEffectsForUpdate(previous, current)).toEqual([
      "BLACKOUT",
      "CONSTRUCTION_COMPLETE",
      "POWER_RESTORED",
    ]);
  });

  it("does not replay a restored run's saved event history", () => {
    expect(
      soundEffectsForUpdate(
        snapshot({ inGame: false }),
        snapshot({ events: [event(6, "BLACKOUT")] }),
      ),
    ).toEqual([]);
  });

  it("plays a build commitment but not a construction cancellation", () => {
    expect(
      soundEffectsForUpdate(
        snapshot(),
        snapshot({ events: [event(1, "BUILD", "Building Wind, 500MW")] }),
      ),
    ).toEqual(["BUILD_COMMITTED"]);
    expect(
      soundEffectsForUpdate(
        snapshot(),
        snapshot({
          events: [event(1, "BUILD", "Cancelled construction of Wind")],
        }),
      ),
    ).toEqual([]);
  });

  it("deduplicates facilities completed in the same tick", () => {
    expect(
      soundEffectsForUpdate(
        snapshot(),
        snapshot({
          events: [event(2, "CONSTRUCTION"), event(1, "CONSTRUCTION")],
        }),
      ),
    ).toEqual(["CONSTRUCTION_COMPLETE"]);
  });

  it("recognises victory, tutorial completion and both failure dialogs", () => {
    expect(
      soundEffectsForUpdate(snapshot(), snapshot({ victoryOpen: true })),
    ).toEqual(["VICTORY"]);
    expect(
      soundEffectsForUpdate(
        snapshot(),
        snapshot({
          dialogOpen: true,
          dialogTitle: "Tutorial complete!",
        }),
      ),
    ).toEqual(["VICTORY"]);
    for (const dialogTitle of ["Bankrupt!", "Fired!"]) {
      expect(
        soundEffectsForUpdate(
          snapshot(),
          snapshot({ dialogOpen: true, dialogTitle }),
        ),
      ).toEqual(["FAILURE"]);
    }
  });
});

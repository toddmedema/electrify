import { TextDecoder, TextEncoder } from "util";
import type { WireMessage } from "./SessionTransport";
import { TurnFrameReader, turnFrames, validTurnPayload } from "./TurnWire";

Object.assign(globalThis, { TextDecoder, TextEncoder });

const generation = "generation-one";
const epoch = "epoch-one";

test("reassembles consecutive bounded fragments without changing deterministic wire values", () => {
  const message: WireMessage = {
    kind: "command",
    envelope: {
      matchId: "campaign",
      epoch,
      sequence: 1,
      command: {
        kind: "action",
        name: "test",
        payload: ["电".repeat(8_000), -0, undefined, Infinity],
      },
    },
  };
  const [first, second, ...rest] = turnFrames({ generation, epoch, message });
  expect(rest).toEqual([]);
  const reader = new TurnFrameReader();
  expect(
    reader.read(first.buffer, 0, generation, epoch, false),
  ).toBeUndefined();
  expect(
    reader.read(second.buffer, 10, generation, epoch, false)?.message,
  ).toEqual(message);
});

test("rejects obsolete, reordered, deep and role-invalid gameplay", () => {
  const heartbeat = turnFrames({
    generation,
    epoch,
    message: { kind: "heartbeat" },
  })[0];
  expect(() =>
    new TurnFrameReader().read(heartbeat.buffer, 0, "replaced", epoch, true),
  ).toThrow("Invalid multiplayer message");

  const value = {
    kind: "records" as const,
    matchId: "campaign",
    epoch,
    from: 0,
    records: [{ t: "verify" as const }],
  };
  const records = turnFrames({ generation, epoch, message: value })[0];
  expect(() =>
    new TurnFrameReader().read(records.buffer, 0, generation, epoch, false),
  ).toThrow("Invalid multiplayer message");
  expect(
    new TurnFrameReader().read(records.buffer, 0, generation, epoch, true)
      ?.message,
  ).toEqual(value);
  expect(validTurnPayload({ ...value, epoch: "replaced" }, true, epoch)).toBe(
    false,
  );
  expect(validTurnPayload({ ...value, sender: "host" }, true, epoch)).toBe(
    false,
  );

  const deep = turnFrames({
    generation,
    epoch,
    message: {
      kind: "command",
      envelope: {
        matchId: "campaign",
        epoch,
        sequence: 1,
        command: {
          kind: "action",
          name: "test",
          payload: Array.from({ length: 60 }).reduce<unknown>(
            (child) => [child],
            null,
          ),
        },
      },
    },
  })[0];
  expect(() =>
    new TurnFrameReader().read(deep.buffer, 0, generation, epoch, false),
  ).toThrow("structural limits");

  const badFragment = heartbeat.slice();
  badFragment[1] = 1;
  expect(() =>
    new TurnFrameReader().read(badFragment.buffer, 0, generation, epoch, false),
  ).toThrow("Invalid multiplayer fragment");
});

test("only the host can announce unique company logo claims", () => {
  const pick = { kind: "utility-logo-pick", logo: "sunburst" };
  expect(validTurnPayload(pick, false, epoch)).toBe(true);
  expect(validTurnPayload({ ...pick, logo: null }, false, epoch)).toBe(true);
  expect(validTurnPayload({ ...pick, logo: "unknown" }, false, epoch)).toBe(
    false,
  );
  expect(validTurnPayload({ ...pick, seat: "other" }, false, epoch)).toBe(
    false,
  );
  expect(validTurnPayload(pick, true, epoch)).toBe(false);

  const announce = {
    kind: "utility-logo-claims",
    claims: { guest: "sunburst" },
  };
  expect(validTurnPayload(announce, true, epoch)).toBe(true);
  expect(validTurnPayload(announce, false, epoch)).toBe(false);
  expect(
    validTurnPayload(
      { ...announce, claims: { guest: "sunburst", host: "sunburst" } },
      true,
      epoch,
    ),
  ).toBe(false);
});

test("stops accepting frames when the peer exceeds its rate budget", () => {
  const heartbeat = turnFrames({
    generation,
    epoch,
    message: { kind: "heartbeat" },
  })[0];
  const reader = new TurnFrameReader();
  for (let count = 0; count < 512; count += 1) {
    reader.read(heartbeat.buffer, 0, generation, epoch, true);
  }
  expect(() =>
    reader.read(heartbeat.buffer, 0, generation, epoch, true),
  ).toThrow("rate limit");
  expect(
    reader.read(heartbeat.buffer, 5_000, generation, epoch, true)?.message,
  ).toEqual({ kind: "heartbeat" });
});

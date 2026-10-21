import {
  resumeBlocker,
  resumeSeats,
  seatAssignments,
  slotClaim,
} from "./Slots";
import type { PendingCampaign } from "./Native";

const campaign: PendingCampaign = {
  id: "c1",
  name: "Friends",
  players: [
    { id: "a", name: "Ada" },
    { id: "b", name: "Bea" },
    { id: "c", name: "Cy" },
  ],
  requiredPlayerIds: ["a", "b"],
};
const member = (id: string, name: string, slot?: string) => ({
  id,
  name,
  ...(slot && { slot: slotClaim("c1", slot) }),
});
const seats = (members: ReturnType<typeof member>[]) =>
  Object.fromEntries(
    [...seatAssignments(campaign, members).bySeat].map(([seat, m]) => [
      seat,
      m.id,
    ]),
  );

test("returning players take back their own company by default", () => {
  expect(seats([member("a", "Ada"), member("b", "Bea")])).toEqual({
    a: "a",
    b: "b",
  });
});

test("an explicit claim wins over a returning player's default", () => {
  const members = [member("a", "Ada"), member("x", "Xi", "a")];
  expect(seats(members)).toEqual({ a: "x" });
  expect(seatAssignments(campaign, members).unseated).toEqual([members[0]]);
  expect(resumeBlocker(campaign, members, () => true)).toBe(
    "Ada must pick a company",
  );
});

test("the first claim on a company holds it and claims from other campaigns are ignored", () => {
  expect(
    seats([
      member("x", "Xi", "b"),
      member("y", "Yu", "b"),
      { id: "a", name: "Ada", slot: slotClaim("old", "b") },
    ]),
  ).toEqual({ b: "x", a: "a" });
});

test("nobody can take over a retired company", () => {
  expect(seats([member("x", "Xi", "c")])).toEqual({});
  expect(seats([member("c", "Cy", "c")])).toEqual({ c: "c" });
});

test("resume waits for every company still playing and every connection", () => {
  const members = [member("a", "Ada"), member("x", "Xi", "b")];
  expect(resumeBlocker(campaign, [members[0]], () => true)).toBe(
    "Someone must take Bea's company",
  );
  expect(resumeBlocker(campaign, members, (id) => id === "a")).toBe(
    "Every player must be connected",
  );
  expect(resumeBlocker(campaign, members, () => true)).toBeUndefined();
});

test("resumed seats keep saved order and unique ids when players swap companies", () => {
  // Bea plays Ada's company and Cy, retired, keeps a seat under Ada's freed id.
  expect(
    resumeSeats(campaign, [member("b", "Bea", "a"), member("c2", "Cy2", "b")]),
  ).toEqual([
    { id: "b", name: "Bea" },
    { id: "c2", name: "Cy2" },
    { id: "c", name: "Cy" },
  ]);
  const swapped = resumeSeats(campaign, [
    member("c", "Cy", "a"),
    member("b", "Bea"),
  ]);
  expect(swapped).toEqual([
    { id: "c", name: "Cy" },
    { id: "b", name: "Bea" },
    { id: "a", name: "Cy" },
  ]);
});

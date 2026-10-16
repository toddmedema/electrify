import { ViewPublication } from "./ViewPublication";
import type { RoomView, World } from "./Types";

jest.mock("./World", () => ({ roomView: jest.fn() }));

function fixture() {
  const world = {
    epoch: "epoch",
    revision: 0,
    speed: "PAUSED",
    paused: true,
    readyRequired: true,
    reason: "Everyone ready?",
    ready: [],
    seats: [{ id: "host" }, { id: "guest" }],
  } as unknown as World;
  const build = jest.fn(
    (value: World) => ({ revision: value.revision }) as RoomView,
  );
  const publication = new ViewPublication(build);
  publication.request(world, 0, { force: true });
  publication.take(world, 0);
  build.mockClear();
  return { world, build, publication };
}

test("unchanged paused worlds do not clone or publish during ten seconds of idle polling", () => {
  const { world, publication, build } = fixture();
  for (let now = 250; now <= 10000; now += 250)
    expect(publication.request(world, now)).toBeUndefined();
  expect(build).not.toHaveBeenCalled();
});

test("ordinary updates publish the newest revision at five Hz", () => {
  const { world, publication, build } = fixture();
  const published = [];
  for (let now = 10; now <= 1000; now += 10) {
    world.revision++;
    if (publication.request(world, now) === 0)
      published.push(publication.take(world, now).guest.revision);
  }
  expect(published).toEqual([20, 40, 60, 80, 100]);
  expect(build).toHaveBeenCalledTimes(10);
});

test("command bursts coalesce before cloning, preserve both receipts, and deliver within 100 ms", () => {
  const { world, publication, build } = fixture();
  world.revision++;
  expect(
    publication.request(world, 10, {
      urgent: true,
      receipt: { sender: "host", sequence: 1 },
    }),
  ).toBe(90);
  world.revision++;
  expect(
    publication.request(world, 20, {
      urgent: true,
      receipt: { sender: "guest", sequence: 1, error: "Not enough cash" },
    }),
  ).toBe(80);
  world.revision++;
  publication.request(world, 40);
  expect(build).not.toHaveBeenCalled();
  const views = publication.take(world, 100);
  expect(build).toHaveBeenCalledTimes(2);
  expect(views.host).toEqual({ revision: 3, receipt: { sequence: 1 } });
  expect(views.guest).toEqual({
    revision: 3,
    receipt: { sequence: 1, error: "Not enough cash" },
  });
  expect(publication.request(world, 200)).toBeUndefined();
});

test("duplicate or rejected commands receive a fresh acknowledgement without cloning other seats", () => {
  const { world, publication, build } = fixture();
  expect(
    publication.request(world, 25, {
      urgent: true,
      receipt: { sender: "guest", sequence: 4, error: "Out of order" },
    }),
  ).toBe(75);
  expect(publication.take(world, 100)).toEqual({
    guest: { revision: 0, receipt: { sequence: 4, error: "Out of order" } },
  });
  expect(build).toHaveBeenCalledTimes(1);
  expect(
    publication.request(world, 200, {
      urgent: true,
      receipt: { sender: "outsider", sequence: 1 },
    }),
  ).toBeUndefined();
});

test("safety stops without a new tick publish promptly and reconnects force a complete baseline", () => {
  const { world, publication, build } = fixture();
  world.reason = "A player disconnected";
  expect(publication.request(world, 30, { urgent: true })).toBe(70);
  publication.take(world, 100);
  expect(build).toHaveBeenCalledTimes(2);
  expect(publication.request(world, 101, { force: true })).toBe(0);
  expect(Object.keys(publication.take(world, 101))).toEqual(["host", "guest"]);
  expect(build).toHaveBeenCalledTimes(4);
});

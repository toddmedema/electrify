import type { CrossplayApi } from "./CrossplayApi";
import { onlineSessionServices } from "./OnlineSessionServices";
import { PeerDisconnectedError } from "./SessionTransport";
import type { LobbyMember } from "./SessionTransport";
import { TurnPeers } from "./TurnPeers";

jest.mock("./TurnPeers", () => ({ TurnPeers: jest.fn() }));

const host = { id: "host", name: "Host" };
const guest = { id: "guest", name: "Guest" };
const authority = {
  epoch: "epoch",
  binding: "host-device",
  presence: "presence",
  hostBinding: "host-device",
  leaseRemainingMs: 12_000,
  requiredIds: [],
  locked: false,
  head: null,
};
const reply = (members: LobbyMember[]) => ({
  lobby: {
    available: true,
    lobbyId: "room",
    hostId: "host",
    selfId: "host",
    members,
    connected: [],
  },
  authority,
});

let links: string[];
let peers: {
  update: jest.Mock;
  forget: jest.Mock;
  close: jest.Mock;
  send: jest.Mock;
  retained: jest.Mock;
};

beforeEach(() => {
  jest.useFakeTimers();
  links = [];
  peers = {
    update: jest.fn(),
    forget: jest.fn((id: string) => {
      links = links.filter((link) => link !== id);
    }),
    close: jest.fn(() => {
      links = [];
    }),
    send: jest.fn(async () => undefined),
    retained: jest.fn(() => [...links]),
  };
  (TurnPeers as unknown as jest.Mock).mockImplementation(() => peers);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

/** A host room whose next `remove` reply is released by the test. */
function hostRoom() {
  let release!: (members: LobbyMember[]) => void;
  const request = jest.fn(async (operation: string) => {
    if (operation === "room/create") return reply([host, guest]);
    if (operation === "room/remove")
      return new Promise((resolve) => {
        release = (members) => resolve(reply(members));
      });
    return reply([host, guest]);
  });
  const services = onlineSessionServices(
    { request: request as CrossplayApi["request"] },
    () => "Host",
  );
  const unsubscribe = services.transport.subscribe(() => undefined);
  return {
    transport: services.transport,
    unsubscribe,
    async create() {
      await services.transport.request({ kind: "create", rules: "rules" });
    },
    async remove(after: number) {
      const removed = services.transport.request({
        kind: "remove",
        seatId: "guest",
      });
      await Promise.resolve();
      jest.advanceTimersByTime(after);
      release([host]);
      await removed;
    },
  };
}

test("removing a member closes its relay link before that link is published as connected", async () => {
  const room = hostRoom();
  await room.create();
  // The guest's data channel is negotiating, so status() never reported it.
  links = ["guest"];
  await room.remove(0);
  expect(peers.forget).toHaveBeenCalledWith("guest");
  await expect(
    room.transport.request({
      kind: "send",
      to: "guest",
      payload: { kind: "browse", browse: {} as never },
    }),
  ).rejects.toBeInstanceOf(PeerDisconnectedError);
  expect(peers.send).not.toHaveBeenCalled();
  room.unsubscribe();
});

test("a reply older than the authority window does not tear down relay links", async () => {
  const room = hostRoom();
  await room.create();
  links = ["guest"];
  await room.remove(5_000);
  expect(peers.forget).not.toHaveBeenCalled();
  room.unsubscribe();
});

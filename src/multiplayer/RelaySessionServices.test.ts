import { webcrypto } from "node:crypto";
import { relaySessionServices } from "./RelaySessionServices";
import type { LobbyState } from "./SessionTransport";

test("a failed join preserves the prior room for reconnect until a join succeeds", async () => {
  const empty: LobbyState = {
    available: true,
    selfId: "guest",
    members: [],
    connected: [],
  };
  const original = { ...empty, lobbyId: "first-room", inviteCode: "123456" };
  const next = { ...empty, lobbyId: "second-room", inviteCode: "234567" };
  const roomIds: (string | undefined)[] = [];
  let socket: RelaySocket;
  class RelaySocket {
    static readonly OPEN = 1;
    readonly readyState = RelaySocket.OPEN;
    readonly bufferedAmount = 0;
    onopen?: () => void;
    onclose?: () => void;
    onmessage?: (event: MessageEvent) => void;

    constructor() {
      socket = this;
      queueMicrotask(() => this.onopen?.());
    }

    send(data: string) {
      const { id, input } = JSON.parse(data);
      let result: LobbyState | undefined;
      let error: string | undefined;
      if (input.kind === "hello") result = empty;
      if (input.kind === "join") {
        if (input.lobbyId === original.inviteCode) result = original;
        else if (input.lobbyId === next.inviteCode) result = next;
        else error = "No game found for that invite code.";
      }
      if (input.kind === "reconnect") {
        roomIds.push(input.roomId);
        result = [original, next].find(
          ({ lobbyId }) => lobbyId === input.roomId,
        );
        if (!result) error = "The lobby closed.";
      }
      queueMicrotask(() =>
        this.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({ reply: id, result, error }),
          }),
        ),
      );
    }

    close() {
      this.onclose?.();
    }
  }

  const WebSocket = globalThis.WebSocket;
  const cryptoProperty = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
  globalThis.WebSocket = RelaySocket as unknown as typeof WebSocket;
  const { transport } = relaySessionServices(
    "ws://relay.test/v1",
    () => undefined,
  );
  const unsubscribe = transport.subscribe(() => {});
  try {
    const join = (lobbyId: string) =>
      transport.request({ kind: "join", lobbyId, rules: "same-version" });
    await expect(join(original.inviteCode)).resolves.toEqual(original);
    socket!.close();
    await expect(join("000000")).rejects.toThrow(/No game found/);
    await expect(transport.request({ kind: "reconnect" })).resolves.toEqual(
      original,
    );

    await expect(join(next.inviteCode)).resolves.toEqual(next);
    socket!.close();
    await expect(transport.request({ kind: "reconnect" })).resolves.toEqual(
      next,
    );
    expect(roomIds).toEqual([original.lobbyId, next.lobbyId]);
  } finally {
    unsubscribe();
    globalThis.WebSocket = WebSocket;
    if (cryptoProperty)
      Object.defineProperty(globalThis, "crypto", cryptoProperty);
    else Reflect.deleteProperty(globalThis, "crypto");
  }
});

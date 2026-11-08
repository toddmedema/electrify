import { nextControllerSeat } from "./Bindings";
import { localSeatId } from "./Protocol";

const roster = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: localSeatId(i),
    name: `Company ${i + 1}`,
  }));

describe.each([2, 3, 4])("%i-company controller recovery", (count) => {
  const seats = roster(count);
  const bindings = Object.fromEntries(
    seats.map((seat, i) => [seat.id, `controller-${i + 1}`]),
  );

  it("offers the first unbound company in roster order after an explicit join", () => {
    const connected = new Set(["unused-z", "unused-a"]);
    expect(nextControllerSeat(seats, {}, connected, new Set())).toBe(seats[0]);
    expect(
      nextControllerSeat(
        seats,
        {},
        new Set([...connected].reverse()),
        new Set(),
      ),
    ).toBe(seats[0]);
    expect(bindings).toEqual(
      Object.fromEntries(
        seats.map((seat, i) => [seat.id, `controller-${i + 1}`]),
      ),
    );
  });

  it("allows explicit replacement of a disconnected binding without swapping live companies", () => {
    const connected = new Set(Object.values(bindings));
    connected.delete(bindings[seats[0].id]);
    connected.add("unused-replacement");
    const original = { ...bindings };
    expect(nextControllerSeat(seats, bindings, connected, new Set())).toBe(
      seats[0],
    );
    expect(bindings).toEqual(original);
    expect(
      nextControllerSeat(
        seats,
        bindings,
        new Set(Object.values(bindings)),
        new Set(),
      ),
    ).toBeUndefined();
  });

  it("ignores a retired company's absent controller while active companies remain", () => {
    const retired = new Set([seats[0].id]);
    const connected = new Set(Object.values(bindings).slice(1));
    expect(
      nextControllerSeat(seats, bindings, connected, retired),
    ).toBeUndefined();
    connected.delete(bindings[seats[1].id]);
    expect(nextControllerSeat(seats, bindings, connected, retired)).toBe(
      seats[1],
    );
  });

  it("retries an authoritative native owner without accepting it or stealing an earlier company", () => {
    const connected = new Set(["replacement"]);
    const nativeOwner = seats[1].id;
    const accepted = {};
    expect(
      nextControllerSeat(seats, accepted, connected, new Set(), nativeOwner),
    ).toBe(seats[1]);
    expect(accepted).toEqual({});
    expect(nextControllerSeat(seats, accepted, connected, new Set())).toBe(
      seats[0],
    );
  });

  it("does not redirect a native-owned retry when its company is pending, retired or already accepted", () => {
    const nativeOwner = seats[1].id;
    const connected = new Set(["replacement"]);
    expect(
      nextControllerSeat(
        seats,
        {},
        connected,
        new Set(),
        nativeOwner,
        new Set([nativeOwner]),
      ),
    ).toBeUndefined();
    expect(
      nextControllerSeat(
        seats,
        {},
        connected,
        new Set([nativeOwner]),
        nativeOwner,
      ),
    ).toBeUndefined();
    expect(
      nextControllerSeat(
        seats,
        { [nativeOwner]: "replacement" },
        connected,
        new Set(),
        nativeOwner,
      ),
    ).toBeUndefined();
    expect(
      nextControllerSeat(seats, {}, connected, new Set(), "removed-company"),
    ).toBeUndefined();
    expect(
      nextControllerSeat(
        seats,
        {},
        connected,
        new Set([nativeOwner]),
        nativeOwner,
        new Set(
          seats
            .filter((seat) => seat.id !== nativeOwner)
            .map((seat) => seat.id),
        ),
      ),
    ).toBeUndefined();
  });

  it("retains native ownership and one-controller results fallback when everyone retired", () => {
    const retired = new Set(seats.map((seat) => seat.id));
    const connected = new Set(["replacement"]);
    expect(nextControllerSeat(seats, {}, connected, retired, seats[1].id)).toBe(
      seats[1],
    );
    expect(
      nextControllerSeat(
        seats,
        { [seats[0].id]: "replacement" },
        connected,
        retired,
        seats[1].id,
      ),
    ).toBeUndefined();
    expect(
      nextControllerSeat(
        seats,
        {},
        connected,
        retired,
        seats[1].id,
        new Set([seats[1].id]),
      ),
    ).toBeUndefined();
  });

  it("restores session controls when all companies retired and no assigned controller remains", () => {
    const retired = new Set(seats.map((seat) => seat.id));
    expect(
      nextControllerSeat(
        seats,
        bindings,
        new Set(["unused-replacement"]),
        retired,
      ),
    ).toBe(seats[0]);
    expect(
      nextControllerSeat(seats, {}, new Set(["unused-replacement"]), retired),
    ).toBe(seats[0]);
    expect(
      nextControllerSeat(
        seats,
        bindings,
        new Set([bindings[seats[count - 1].id], "unused-replacement"]),
        retired,
      ),
    ).toBeUndefined();
    expect(retired).toEqual(new Set(seats.map((seat) => seat.id)));
  });
});

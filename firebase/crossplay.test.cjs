const { after, before, beforeEach, test } = require("node:test");
const { readFileSync } = require("node:fs");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  setLogLevel,
  Timestamp,
} = require("firebase/firestore");
setLogLevel("silent");

const PROJECT = "demo-electrify-achievements";
const WRITER = "electrify-coop-authority-v2";
const ID = "room-id";
const HOST = "host-seat";
const GUEST = "guest-seat";

let environment;
const at = (offset) => Timestamp.fromMillis(Date.now() + offset);

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      rules: readFileSync("firebase/firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 9383,
    },
  });
});
beforeEach(async () => environment.clearFirestore());
after(async () => environment?.cleanup());

const writer = () =>
  environment
    .authenticatedContext(WRITER, { electrifyCoopWriter: 2 })
    .firestore();
const client = () =>
  environment
    .authenticatedContext("verified-browser-player", {
      firebase: { sign_in_provider: "google.com" },
    })
    .firestore();

const host = () => ({
  account: "host-account",
  binding: "host-device",
  active: true,
  seenAt: at(0),
});
const guest = () => ({
  account: "guest-account",
  binding: "guest-device",
  active: true,
  seenAt: at(0),
});

function room(leaseOffset = 8000) {
  return {
    room: {
      id: ID,
      epoch: "epoch-before",
      hostId: HOST,
      locked: true,
      head: { revision: 5 },
    },
    roomExpiry: at(60_000),
    leaseExpiry: at(leaseOffset),
    accounts: ["host-account", "guest-account"],
    inviteHashes: [],
    bindings: { [HOST]: host(), [GUEST]: guest() },
    writeGuard: {
      type: "host",
      seatId: HOST,
      account: "host-account",
      binding: "host-device",
      tokenHash: "host-token",
      peerId: "",
      deadline: at(8000),
    },
  };
}

async function seed(data) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, "coopAccounts", "host-account"), {
        binding: "host-device",
        tokenHash: "host-token",
        revoked: false,
        expiresAt: at(30_000),
      }),
      setDoc(doc(database, "coopAccounts", "guest-account"), {
        binding: "guest-device",
        tokenHash: "guest-token",
        revoked: false,
        expiresAt: at(30_000),
      }),
      setDoc(doc(database, "coopRooms", ID), data),
    ]);
  });
}

test("clients and the restricted service writer have no direct lobby or account reads", async () => {
  const data = room();
  await seed(data);
  for (const database of [client(), writer()]) {
    await assertFails(getDoc(doc(database, "coopRooms", ID)));
    await assertFails(getDocs(collection(database, "coopRooms")));
    await assertFails(getDoc(doc(database, "coopAccounts", "host-account")));
  }
  await assertFails(setDoc(doc(client(), "coopRooms", ID), data));
  await assertSucceeds(
    setDoc(doc(writer(), "coopRooms", ID), {
      ...data,
      room: { ...data.room, head: { revision: 6 } },
    }),
  );
});

test("an invite write adds only a single bound seat while the unlocked host lease is live", async () => {
  const before = room();
  before.room.locked = false;
  before.inviteHashes = ["issued-code-hash", "issued-link-hash"];
  const members = [
    { id: HOST, account: "host-account", binding: "host-device" },
  ];
  before.room.members = members;
  before.accounts = ["host-account"];
  delete before.bindings[GUEST];
  const proposed = {
    ...before,
    room: {
      ...before.room,
      members: [
        ...members,
        { id: GUEST, account: "guest-account", binding: "guest-device" },
      ],
    },
    accounts: [...before.accounts, "guest-account"],
    bindings: { ...before.bindings, [GUEST]: guest() },
    writeGuard: {
      ...before.writeGuard,
      type: "invite",
      seatId: GUEST,
      account: "guest-account",
      binding: "guest-device",
      tokenHash: "guest-token",
      inviteHash: "issued-code-hash",
    },
  };
  await seed(before);
  await assertFails(
    setDoc(doc(writer(), "coopRooms", ID), {
      ...proposed,
      writeGuard: { ...proposed.writeGuard, inviteHash: "unknown-code-hash" },
    }),
  );
  await assertFails(
    setDoc(doc(writer(), "coopRooms", ID), {
      ...proposed,
      room: { ...proposed.room, epoch: "unexpected-epoch" },
    }),
  );
  await assertFails(
    setDoc(doc(writer(), "coopRooms", ID), {
      ...proposed,
      bindings: { ...proposed.bindings, [HOST]: { ...host(), active: false } },
    }),
  );
  await assertSucceeds(setDoc(doc(writer(), "coopRooms", ID), proposed));
  before.room.removedAccounts = ["guest-account"];
  await seed(before);
  await assertFails(
    setDoc(doc(writer(), "coopRooms", ID), {
      ...proposed,
      room: { ...proposed.room, removedAccounts: before.room.removedAccounts },
    }),
  );
});

test("host renewal and publication fail at the authoritative write after the original lease expires", async () => {
  const expired = room(-1000);
  await seed(expired);
  await assertFails(
    setDoc(doc(writer(), "coopRooms", ID), {
      ...expired,
      leaseExpiry: at(8000),
      room: { ...expired.room, head: { revision: 6 } },
    }),
  );
  // Only the current host can take the lease again. A guest cannot.
  await assertFails(
    setDoc(doc(writer(), "coopRooms", ID), {
      ...expired,
      leaseExpiry: at(8000),
      room: {
        ...expired.room,
        hostId: GUEST,
        epoch: "epoch-after",
        restoreHead: expired.room.head,
      },
      writeGuard: {
        ...expired.writeGuard,
        type: "acquire",
        binding: "guest-device",
        account: "guest-account",
        seatId: GUEST,
        tokenHash: "guest-token",
      },
    }),
  );
  await assertFails(
    setDoc(doc(writer(), "coopRooms", ID), {
      ...expired,
      leaseExpiry: at(8000),
    }),
  );
});

test("a build change during host acquisition preserves the confirmed checkpoint", async () => {
  const expired = room(-1000);
  expired.room.rules = "published";
  await seed(expired);
  const owned = {
    ...expired,
    leaseExpiry: at(8000),
    room: {
      ...expired.room,
      epoch: "epoch-after",
      rules: "deployed",
      restoreHead: expired.room.head,
    },
    writeGuard: { ...expired.writeGuard, type: "acquire" },
  };
  await assertFails(
    setDoc(doc(writer(), "coopRooms", ID), {
      ...owned,
      room: { ...owned.room, head: { revision: 6 } },
    }),
  );
  await assertSucceeds(setDoc(doc(writer(), "coopRooms", ID), owned));
});

test("locking requires active bindings for every required seat at commit", async () => {
  const data = room();
  data.room.locked = false;
  const locked = {
    ...data,
    room: { ...data.room, locked: true, requiredIds: [HOST, GUEST] },
  };
  await seed(data);
  await assertSucceeds(setDoc(doc(writer(), "coopRooms", ID), locked));
  await seed(data);
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "coopAccounts", "guest-account"), {
      binding: "another-device",
      tokenHash: "another-token",
      revoked: false,
      expiresAt: at(30_000),
    });
  });
  await assertFails(setDoc(doc(writer(), "coopRooms", ID), locked));
});

test("replaced room peers and a runtime emergency stop fence service mutations", async () => {
  const active = room();
  await seed(active);
  const proposed = {
    ...active,
    writeGuard: { ...active.writeGuard, type: "active", peerId: GUEST },
  };
  await assertSucceeds(setDoc(doc(writer(), "coopRooms", ID), proposed));
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "coopAccounts", "guest-account"), {
      binding: "replacement-device",
      tokenHash: "new-token",
      revoked: false,
      expiresAt: at(30_000),
    });
  });
  await assertFails(setDoc(doc(writer(), "coopRooms", ID), proposed));

  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "coopSettings", "runtime"), {
      stopped: true,
    });
  });
  await assertFails(setDoc(doc(writer(), "coopRooms", ID), active));
});

// Run with: firebase emulators:exec --project demo-electrify-cloud-saves --only firestore "node scripts/cloud-save-rules-smoke.js"
// Uses only the local emulator and deliberately never connects to a live database.
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase/app");
const {
  connectFirestoreEmulator,
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  Timestamp,
  serverTimestamp,
} = require("firebase/firestore");

const address = process.env.FIRESTORE_EMULATOR_HOST;
if (!address || !/^(localhost|127\.0\.0\.1):\d+$/.test(address)) {
  throw new Error("Run this script through the local Firebase emulator.");
}
const [host, port] = address.split(":");
const apps = [];
function client(name, uid, admin = false) {
  const app = initializeApp(
    { projectId: "demo-electrify-cloud-saves", apiKey: "emulator" },
    name,
  );
  apps.push(app);
  const db = getFirestore(app);
  connectFirestoreEmulator(
    db,
    host,
    Number(port),
    admin
      ? { mockUserToken: "owner" }
      : uid
        ? { mockUserToken: { sub: uid } }
        : {},
  );
  return db;
}
async function denied(operation) {
  await assert.rejects(
    operation,
    (error) => error.code === "permission-denied",
  );
}

async function main() {
  const owner = client("owner", "owner");
  const stranger = client("stranger", "stranger");
  const visitor = client("visitor");
  // The emulator's administrative token seeds expired/orphaned fixtures only.
  const admin = client("admin", undefined, true);
  const shareId = "Ab12Cd34Ef";
  const chunks = Array.from({ length: 60 }, (_, index) =>
    (index + 1).toString(16).padStart(32, "0"),
  );
  const share = doc(owner, "sharedGames", shareId);
  const expiry = () =>
    Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000);

  await runTransaction(owner, async (transaction) => {
    assert.equal((await transaction.get(share)).exists(), false);
    const expiresAt = expiry();
    chunks.forEach((id) =>
      transaction.set(doc(owner, "saveBlobs", id), {
        uid: "owner",
        shareId,
        data: "frozen snapshot",
        expiresAt,
      }),
    );
    transaction.set(share, {
      uid: "owner",
      chunks,
      lastLoadedAt: serverTimestamp(),
      expiresAt,
    });
  });
  assert.equal(
    (await getDoc(doc(visitor, "sharedGames", shareId))).exists(),
    true,
  );
  assert.equal(
    (await getDoc(doc(visitor, "saveBlobs", chunks[0]))).data().data,
    "frozen snapshot",
  );
  // The maximum chunk count must fit the rules' batched access-call budget.
  await runTransaction(visitor, async (transaction) => {
    await transaction.get(doc(visitor, "sharedGames", shareId));
    const expiresAt = expiry();
    transaction.update(doc(visitor, "sharedGames", shareId), {
      lastLoadedAt: serverTimestamp(),
      expiresAt,
    });
    chunks.forEach((id) =>
      transaction.update(doc(visitor, "saveBlobs", id), { expiresAt }),
    );
  });
  await denied(() => getDocs(collection(visitor, "sharedGames")));
  await denied(() =>
    updateDoc(doc(owner, "saveBlobs", chunks[0]), { data: "changed" }),
  );
  await denied(() => updateDoc(share, { chunks: [] }));
  await denied(() => deleteDoc(share));
  await denied(() =>
    updateDoc(share, {
      lastLoadedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(
        Date.now() + 2 * 365 * 24 * 60 * 60 * 1000,
      ),
    }),
  );
  // Existing shared manifests cannot acquire new payloads later, even from their owner.
  await denied(() =>
    setDoc(doc(stranger, "saveBlobs", "e".repeat(32)), {
      uid: "stranger",
      shareId,
      data: "injected",
      expiresAt: expiry(),
    }),
  );

  // Even an exact missing payload named in an existing manifest stays frozen.
  const orphanId = "Orphan1234";
  const missingId = "b".repeat(32);
  const orphanExpiry = expiry();
  await setDoc(doc(admin, "sharedGames", orphanId), {
    uid: "owner",
    chunks: [missingId],
    lastLoadedAt: serverTimestamp(),
    expiresAt: orphanExpiry,
  });
  for (const [db, uid] of [
    [owner, "owner"],
    [stranger, "stranger"],
  ]) {
    await denied(() =>
      setDoc(doc(db, "saveBlobs", missingId), {
        uid,
        shareId: orphanId,
        data: "late injection into a frozen snapshot",
        expiresAt: orphanExpiry,
      }),
    );
  }

  // TTL deletion is asynchronous; expired documents must become unreadable immediately.
  const expiredId = "Expired123";
  const expiredChunk = "c".repeat(32);
  const expiredAt = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
  await setDoc(doc(admin, "sharedGames", expiredId), {
    uid: "owner",
    chunks: [expiredChunk],
    lastLoadedAt: Timestamp.fromMillis(Date.now() - 366 * 24 * 60 * 60 * 1000),
    expiresAt: expiredAt,
  });
  await setDoc(doc(admin, "saveBlobs", expiredChunk), {
    uid: "owner",
    shareId: expiredId,
    data: "expired frozen snapshot",
    expiresAt: expiredAt,
  });
  await denied(() => getDoc(doc(visitor, "sharedGames", expiredId)));
  await denied(() => getDoc(doc(owner, "sharedGames", expiredId)));
  await denied(() => getDoc(doc(visitor, "saveBlobs", expiredChunk)));
  await denied(() =>
    updateDoc(doc(visitor, "sharedGames", expiredId), {
      lastLoadedAt: serverTimestamp(),
      expiresAt: expiry(),
    }),
  );

  const backup = doc(owner, "users", "owner", "cloudSaves", "game");
  const privateId = "f".repeat(32);
  await setDoc(backup, {
    version: "a".repeat(32),
    deleted: false,
    chunks: [privateId],
    garbage: [],
    writerDeviceId: "device",
  });
  await setDoc(doc(owner, "saveBlobs", privateId), {
    uid: "owner",
    shareId: null,
    data: "private snapshot",
    expiresAt: null,
  });
  assert.equal((await getDoc(backup)).exists(), true);
  await denied(() =>
    getDoc(doc(stranger, "users", "owner", "cloudSaves", "game")),
  );
  await denied(() => getDoc(doc(visitor, "saveBlobs", privateId)));
  await denied(() => deleteDoc(doc(stranger, "saveBlobs", privateId)));
  await denied(() => deleteDoc(backup)); // Cloud deletion must retain a tombstone.
  await deleteDoc(doc(owner, "saveBlobs", privateId));
  await deleteDoc(doc(owner, "saveBlobs", privateId)); // Idempotent interrupted cleanup.
  process.stdout.write(
    "Cloud save rules smoke test passed, including 60-chunk anonymous refresh.\n",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => Promise.all(apps.map(deleteApp)));

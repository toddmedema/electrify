import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  BestScoreType,
  DifficultyType,
  ReplayType,
  ScoreBreakdownType,
  ScoreType,
  UserType,
} from "../Types";
import type { RootState } from "../Store";
import {
  addDoc,
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getDb, logout as signOutOfFirebase } from "../Globals";
import {
  displayNameKey,
  normalizeDisplayName,
  validateDisplayName,
} from "../helpers/DisplayName";
import { encodeReplay, MAX_REPLAY_BYTES, replayByteLength } from "../Replay";

export const initialUser: UserType = {};

/**
 * The only slice these thunks read. Narrower than RootState on purpose: it keeps them dispatchable
 * against a store holding nothing but this reducer, which is what the tests do.
 */
interface UserSliceStateType {
  user: UserType;
}

// How many of a player's own scores a rename backfills. Denormalized names are a display
// convenience, so the cost of keeping them fresh is capped rather than unbounded -- and a
// Firestore batch tops out at 500 writes anyway
const RENAME_BACKFILL_LIMIT = 100;

// Thrown inside the claim transaction, which is the only place that can tell "someone else has
// this name" apart from "the write failed"
const NAME_TAKEN = "display-name-taken";

export interface HighscoreSubmissionType {
  score: number;
  scoreBreakdown: ScoreBreakdownType; // For analytics purposes only
  scenarioId: number;
  difficulty: DifficultyType;
  // The run that set the score, when it was recorded end to end. Stored beside the score rather
  // than in it, so that reading a leaderboard doesn't download fifty runs
  replay?: ReplayType;
}

/**
 * Uploads the replay and hands back the id to hang off the score, or undefined if there is
 * nothing to upload or the upload didn't land.
 *
 * A replay is a bonus on top of a score, so every way this can fail -- an oversized run, a
 * rejected write, a network that dropped -- gives up on the replay rather than on the score.
 */
async function uploadReplay(
  uid: string,
  replay: ReplayType,
): Promise<string | undefined> {
  const doc = encodeReplay(replay);
  const bytes = replayByteLength(doc);
  if (bytes > MAX_REPLAY_BYTES) {
    console.warn(
      `Replay is ${bytes} bytes, past the ${MAX_REPLAY_BYTES} limit; submitting the score without it.`,
    );
    return undefined;
  }
  try {
    const ref = await addDoc(collection(getDb(), "replays"), {
      ...doc,
      uid,
      date: serverTimestamp(),
    });
    return ref.id;
  } catch (err) {
    console.warn("Couldn't save the replay: ", err);
    return undefined;
  }
}

async function submitScore(
  uid: string,
  displayName: string | undefined,
  submission: HighscoreSubmissionType,
) {
  const replayId = submission.replay
    ? await uploadReplay(uid, submission.replay)
    : undefined;
  const scoreSubmission = {
    score: submission.score,
    scoreBreakdown: submission.scoreBreakdown, // For analytics purposes only
    scenarioId: submission.scenarioId,
    difficulty: submission.difficulty,
    date: serverTimestamp(),
    uid,
    // Spread rather than assigned: Firestore rejects a document with an undefined field
    ...(replayId ? { replayId } : {}),
    // Denormalized so that rendering a board is one query rather than one plus a read per row
    ...(displayName ? { displayName } : {}),
  } as ScoreType;
  try {
    await addDoc(collection(getDb(), "scores"), scoreSubmission);
  } catch (err) {
    console.warn("Couldn't submit the score: ", err);
  }
}

/**
 * Mirrors a new personal best onto the profile document. Its own write and its own failure: a
 * board score that landed shouldn't be lost because the profile write didn't.
 */
async function saveBest(uid: string, scenarioId: number, best: BestScoreType) {
  try {
    await setDoc(
      doc(getDb(), "users", uid),
      { bests: { [String(scenarioId)]: best }, updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    console.warn("Couldn't save your best score: ", err);
  }
}

/**
 * Rewrites the denormalized name on the player's own past scores, so old rows don't keep showing
 * the name they just left behind. Best effort by design: the board reads fine either way, and a
 * rename must not fail because a backfill did.
 */
async function backfillScoreNames(uid: string, displayName: string) {
  try {
    const db = getDb();
    const mine = await getDocs(
      query(
        collection(db, "scores"),
        where("uid", "==", uid),
        limit(RENAME_BACKFILL_LIMIT),
      ),
    );
    if (mine.empty) {
      return;
    }
    const batch = writeBatch(db);
    mine.forEach((score) => batch.update(score.ref, { displayName }));
    await batch.commit();
  } catch (err) {
    console.warn("Couldn't update the name on your old scores: ", err);
  }
}

/**
 * Where a score sits on the global board: one aggregate read counting the runs that beat it,
 * rather than downloading them.
 *
 * Counts runs, not distinct players, so someone holding the top three scores occupies three
 * ranks. That matches the board itself, which already lists one row per run.
 */
export async function fetchGlobalRank(
  scenarioId: number,
  score: number,
): Promise<number> {
  const better = await getCountFromServer(
    query(
      collection(getDb(), "scores"),
      where("scenarioId", "==", scenarioId),
      where("score", ">", score),
    ),
  );
  return better.data().count + 1;
}

export interface ProfileType {
  displayName?: string;
  bests?: { [scenarioId: string]: BestScoreType };
}

/**
 * Reads users/{uid} on login, creating it when it isn't there yet. A new profile is created empty
 * rather than with a guessed name: a name has to be unique, and only the claim transaction below
 * can make that true.
 */
export const loadProfile = createAsyncThunk<
  ProfileType,
  { uid: string; googleDisplayName?: string | null }
>("user/loadProfile", async ({ uid }) => {
  const ref = doc(getDb(), "users", uid);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    await setDoc(ref, { createdAt: serverTimestamp() }, { merge: true });
    return {};
  }
  const data = snapshot.data() as ProfileType;
  return { displayName: data.displayName, bests: data.bests };
});

/**
 * Claims a name, or explains why it couldn't be. The document under `usernames` is what makes a
 * name unique -- created only when absent, inside a transaction, so two players racing for the
 * same name cannot both win it.
 */
export const claimDisplayName = createAsyncThunk<
  string,
  string,
  { state: UserSliceStateType; rejectValue: string }
>("user/claimDisplayName", async (requested, { getState, rejectWithValue }) => {
  const { uid, displayName: previous } = getState().user;
  if (!uid) {
    return rejectWithValue("You need to be logged in to pick a name.");
  }
  const invalid = validateDisplayName(requested);
  if (invalid) {
    return rejectWithValue(invalid);
  }
  const name = normalizeDisplayName(requested);
  const key = displayNameKey(name);
  const db = getDb();
  try {
    await runTransaction(db, async (transaction) => {
      const claim = doc(db, "usernames", key);
      const existing = await transaction.get(claim);
      if (existing.exists() && existing.data().uid !== uid) {
        throw new Error(NAME_TAKEN);
      }
      transaction.set(claim, { uid, createdAt: serverTimestamp() });
      // The old claim is released in the same transaction, so a rename can never leave the player
      // holding two names or -- worse -- none
      if (previous && displayNameKey(previous) !== key) {
        transaction.delete(doc(db, "usernames", displayNameKey(previous)));
      }
      transaction.set(
        doc(db, "users", uid),
        {
          displayName: name,
          displayNameLower: key,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });
  } catch (err) {
    if (err instanceof Error && err.message === NAME_TAKEN) {
      return rejectWithValue("That name is taken. Please pick another.");
    }
    console.warn("Couldn't claim the name: ", err);
    return rejectWithValue("Couldn't save that name. Please try again.");
  }
  // Deliberately not awaited: the name is the player's the moment the transaction commits, and
  // refreshing their old rows is cosmetic
  void backfillScoreNames(uid, name);
  return name;
});

export const logout = createAsyncThunk("user/logout", async () => {
  await signOutOfFirebase();
});

/**
 * Writes the score, and the personal best behind it. A thunk rather than the side effect inside a
 * reducer this used to be: it has to be awaitable for anything to know the write landed, and
 * firing network calls out of a reducer is what made that impossible.
 */
export const submitHighscore = createAsyncThunk<
  { scenarioId: number; best?: BestScoreType },
  HighscoreSubmissionType,
  { state: UserSliceStateType }
>("user/submitHighscore", async (submission, { getState }) => {
  const { uid, displayName, bests } = getState().user;
  if (!uid) {
    return { scenarioId: submission.scenarioId };
  }
  await submitScore(uid, displayName, submission);

  const previous = (bests || {})[String(submission.scenarioId)];
  if (previous && previous.score >= submission.score) {
    return { scenarioId: submission.scenarioId };
  }
  const best: BestScoreType = {
    score: submission.score,
    difficulty: submission.difficulty,
    date: Date.now(),
  };
  await saveBest(uid, submission.scenarioId, best);
  return { scenarioId: submission.scenarioId, best };
});

export const userSlice = createSlice({
  name: "user",
  initialState: initialUser,
  reducers: {
    delta: (state, action: PayloadAction<Partial<UserType>>) => {
      return { ...state, ...action.payload };
    },
    // Everything about the signed-in player, gone. Dispatched when auth reports nobody is signed
    // in, so that one player's name and bests can't survive into the next player's session
    reset: () => {
      return { ...initialUser };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadProfile.fulfilled, (state, action) => {
        state.displayName = action.payload.displayName;
        state.bests = action.payload.bests;
        state.profileLoaded = true;
        // Nobody is forced to pick one -- the dialog can be dismissed, and Settings offers it
        // again -- but a board full of Anonymous is worth one prompt
        state.needsDisplayName = !action.payload.displayName;
      })
      .addCase(loadProfile.rejected, (state, action) => {
        // A profile that can't be read (rules not deployed yet, offline) mustn't block play, and
        // mustn't prompt for a name that couldn't be saved either
        console.warn("Couldn't load your profile: ", action.error.message);
        state.profileLoaded = true;
      })
      .addCase(claimDisplayName.fulfilled, (state, action) => {
        state.displayName = action.payload;
        state.needsDisplayName = false;
      })
      .addCase(logout.fulfilled, () => {
        return { ...initialUser };
      })
      .addCase(logout.rejected, (state, action) => {
        // Sign-out failed, so the player is still signed in and the state is still accurate
        console.warn("Couldn't log out: ", action.error.message);
      })
      .addCase(submitHighscore.fulfilled, (state, action) => {
        if (action.payload.best) {
          state.bests = {
            ...state.bests,
            [String(action.payload.scenarioId)]: action.payload.best,
          };
        }
      });
  },
});

export const { delta, reset } = userSlice.actions;

export const selectUid = (state: RootState) => state.user.uid;

export default userSlice.reducer;

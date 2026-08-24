import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  DifficultyType,
  ReplayType,
  ScoreBreakdownType,
  ScoreType,
  UserType,
} from "../Types";
import type { RootState } from "../Store";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "../Globals";
import { encodeReplay, MAX_REPLAY_BYTES, replayByteLength } from "../Replay";

export const initialUser: UserType = {};

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

async function submitScore(uid: string, submission: HighscoreSubmissionType) {
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
  } as ScoreType;
  try {
    await addDoc(collection(getDb(), "scores"), scoreSubmission);
  } catch (err) {
    console.warn("Couldn't submit the score: ", err);
  }
}

export const userSlice = createSlice({
  name: "user",
  initialState: initialUser,
  reducers: {
    delta: (state, action: PayloadAction<Partial<UserType>>) => {
      return { ...state, ...action.payload };
    },
    submitHighscore: (
      state,
      action: PayloadAction<HighscoreSubmissionType>,
    ) => {
      if (state.uid) {
        // Deliberately not awaited: the reducer can't be async, and nothing in the app is
        // waiting on the write. Every failure inside is caught and logged
        void submitScore(state.uid, action.payload);
      }
    },
  },
});

export const { delta, submitHighscore } = userSlice.actions;

export const selectUid = (state: RootState) => state.user.uid;

export default userSlice.reducer;

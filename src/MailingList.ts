import type { Auth, User } from "firebase/auth";
import { getStore } from "./StoreRegistry";

/** Survives the sign-in dialog closing, without delaying login or cloud sync. */
export async function subscribeAfterSignIn(
  auth: Auth,
  user: User,
): Promise<void> {
  let message: string | undefined;
  try {
    const { getFunctions, httpsCallable } = await import("firebase/functions");
    if (auth.currentUser?.uid !== user.uid) return;
    const subscribe = httpsCallable<
      { consent: true },
      { status: "subscribed" | "already-subscribed" }
    >(getFunctions(auth.app, "us-central1"), "subscribeMailingList", {
      timeout: 20000,
    });
    const { data } = await subscribe({ consent: true });
    // A fresh signup needs no confirmation: the player just opted in. Only surface
    // outcomes that differ from what they expected.
    if (data.status === "already-subscribed") {
      message = "You're already on the Electrify mailing list.";
    }
  } catch {
    message =
      "You're signed in, but mailing-list signup didn't finish. You can subscribe from the About page.";
  }
  // Do not surface a result in a different player's session.
  if (auth.currentUser?.uid !== user.uid) return;
  if (!message) return;
  const { snackbarOpen } = await import("./reducers/UI");
  getStore().dispatch(snackbarOpen(message));
}

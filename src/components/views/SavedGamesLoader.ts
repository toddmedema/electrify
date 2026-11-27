/** The Saved games screen's code. Compositor renders it lazily; the home menu calls this early
 * so the chunk is already downloaded by the time the Saves button is pressed. */
export const loadSavedGames = () =>
  import(/* webpackChunkName: "saved-games" */ "./SavedGames");

const { contextBridge, ipcRenderer } = require("electron");

// A deliberately narrow bridge. Never expose ipcRenderer, filesystem paths, native objects,
// or the event argument to the renderer. This preload also runs with Electron's sandbox.
const subscribe = (channel, callback) => {
  if (typeof callback !== "function")
    throw new TypeError("A callback is required");
  const listener = (_event, state) => callback(state);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld(
  "electrifyDesktop",
  Object.freeze({
    apiVersion: 1,
    mods: (input) => ipcRenderer.invoke("desktop:mods", input),
    getState: () => ipcRenderer.invoke("desktop:state"),
    setDisplay: (display) => ipcRenderer.invoke("desktop:display", display),
    quit: () => ipcRenderer.invoke("desktop:quit"),
    readSaveLibrary: () => ipcRenderer.invoke("desktop:read-saves"),
    writeSaveLibrary: (library, syncCloud = false) =>
      ipcRenderer.invoke("desktop:write-saves", library, syncCloud),
    getLeaderboard: (selection) =>
      ipcRenderer.invoke("desktop:leaderboard", selection),
    submitScore: (score) => ipcRenderer.invoke("desktop:score", score),
    submitAchievements: (intent) =>
      ipcRenderer.invoke("desktop:achievements", intent),
    readAchievements: () => ipcRenderer.invoke("desktop:readAchievements"),
    openFriends: () => ipcRenderer.invoke("desktop:friends"),
    multiplayerRequest: (input) =>
      ipcRenderer.invoke("desktop:multiplayer", input),
    onMultiplayerEvent: (callback) =>
      subscribe("desktop:multiplayer-event", callback),
    setActivity: (activity) => ipcRenderer.invoke("desktop:activity", activity),
    addTimelineEvent: (event) =>
      ipcRenderer.invoke("desktop:timeline-event", event),
    onStateChanged: (callback) => subscribe("desktop:state-changed", callback),
    onBeforeQuit: (callback) => subscribe("desktop:before-quit", callback),
    onGameFocusChanged: (callback) =>
      subscribe("desktop:focus-changed", callback),
    readyToQuit: (success = true) =>
      ipcRenderer.send("desktop:ready-to-quit", success),
  }),
);

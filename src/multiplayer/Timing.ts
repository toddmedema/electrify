/** Co-op protocol timings shared by the renderer session and the host's simulation worker. */

/** Shortest gap between published views while the clock runs. */
export const VIEW_INTERVAL_MS = 200;
/** Command receipts and clock changes publish sooner than ordinary ticks. */
export const CONTROL_VIEW_INTERVAL_MS = 100;
/** The host worker's pulse to guests while nothing else changes. */
export const HOST_KEEPALIVE_MS = 1000;
/** The worker pauses the match when the renderer's heartbeat is silent this long. */
export const CONTROL_HEARTBEAT_TIMEOUT_MS = 5000;
/** The host writes a multiplayer save at least this often while a match runs. */
export const CHECKPOINT_INTERVAL_MS = 10000;

/** How often a session sends heartbeats, retries commands and checks host silence. */
export const SESSION_PUMP_MS = 500;
/** An unacknowledged command is sent again after this long. */
export const COMMAND_RESEND_MS = 1500;
/** A guest warns that the host stopped responding after this much silence. */
export const HOST_SILENCE_MS = 5000;
/** A save that has not finished in this long fails, so leaving never hangs. */
export const SAVE_TIMEOUT_MS = 5000;
/** Commands a player can queue behind one that the host has not yet acknowledged. */
export const MAX_QUEUED_COMMANDS = 64;
/** An unchanged scenario selection is resent this often, so guests catch up after a miss. */
export const BROWSE_RESEND_MS = 2000;

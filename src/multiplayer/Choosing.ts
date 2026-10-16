import { DIFFICULTY_LABELS } from "../Constants";
import { getScenario } from "../data/Scenarios";
import type { AppStateType, CoopSelectionType } from "../Types";
import {
  BROWSE_CARDS,
  selectionKey,
  type BrowseCard,
  type BrowseState,
} from "./Browse";
import type { SessionState } from "./Session";

export const isBrowseCard = (name: string): name is BrowseCard =>
  (BROWSE_CARDS as readonly string[]).includes(name);

/** The host's open selection in words, so guests and screen readers hear what changed. */
function viewing(browse?: BrowseState): string | undefined {
  if (!browse) return undefined;
  const difficulty = DIFFICULTY_LABELS[browse.difficulty];
  if (browse.card === "CUSTOM_GAME") return `a custom game on ${difficulty}`;
  const name =
    browse.card === "NEW_GAME_DETAILS" && browse.scenarioId !== undefined
      ? getScenario(browse.scenarioId)?.name
      : undefined;
  return name && `${name} on ${difficulty}`;
}

/** What the lobby shows on the scenario screens while choosing a game together. */
export function coopSelection(
  session: SessionState,
  custom?: CoopSelectionType["custom"],
): CoopSelectionType {
  const { lobby, browse, view, busy } = session;
  const key = browse ? selectionKey(browse) : "";
  const readyFor = (value?: string) => !!key && value === key;
  return {
    role: lobby.hostId === lobby.selfId ? "host" : "guest",
    hostName:
      lobby.members.find((member) => member.id === lobby.hostId)?.name ||
      "The host",
    players: lobby.members.map((member) => ({
      id: member.id,
      name: member.name,
      host: member.id === lobby.hostId,
      connected:
        member.id === lobby.selfId || lobby.connected.includes(member.id),
      ready: readyFor(member.ready),
    })),
    ready: readyFor(
      lobby.members.find((member) => member.id === lobby.selfId)?.ready,
    ),
    starting: !view && (busy || browse?.phase === "playing"),
    custom,
    viewing: viewing(browse),
  };
}

/** The host's selection as it would be mirrored, or undefined off the scenario screens. */
export function hostSelection(
  state: AppStateType,
): Omit<BrowseState, "session" | "revision"> | undefined {
  const card = state.card.name;
  if (!isBrowseCard(card)) return undefined;
  return {
    phase: "browsing",
    card,
    scenarioId:
      card === "NEW_GAME_DETAILS" ? state.ui.scenarioPreview : undefined,
    difficulty: state.ui.previewDifficulty ?? state.game.difficulty,
    custom: card === "CUSTOM_GAME" ? state.ui.coop?.custom : undefined,
  };
}

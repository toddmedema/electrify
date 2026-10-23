import { DIFFICULTY_LABELS } from "../Constants";
import { getScenario } from "../data/Scenarios";
import type { AppStateType, CoopSelectionType, ScenarioType } from "../Types";
import {
  BROWSE_CARDS,
  selectionKey,
  type BrowseCard,
  type BrowseState,
  type HostBrowseSelection,
} from "./Browse";
import { modBrowseSummary } from "./ModBrowse";
import type { SessionState } from "./Session";

export const isBrowseCard = (name: string): name is BrowseCard =>
  (BROWSE_CARDS as readonly string[]).includes(name);

/** The host's open selection in words, so guests and screen readers hear what changed. */
function viewing(browse?: BrowseState): string | undefined {
  if (!browse) return undefined;
  const difficulty = DIFFICULTY_LABELS[browse.difficulty];
  if (browse.mod)
    return `${browse.mod.title} on ${difficulty} · Modded · Unranked`;
  if (browse.card === "MODS") return "Choosing a community scenario…";
  if (browse.card === "CUSTOM_GAME") return `Custom game on ${difficulty}`;
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
  modScenario?: ScenarioType,
): CoopSelectionType {
  const { lobby, browse, view, busy, library } = session;
  const host = lobby.hostId === lobby.selfId;
  const key = browse ? selectionKey(browse) : "";
  const receivingScenario = !!browse?.mod && !session.scenarioSnapshot;
  const readyFor = (value?: string) =>
    !receivingScenario && !!key && value === key;
  return {
    role: host ? "host" : "guest",
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
    modScenario: host ? modScenario : session.scenarioSnapshot,
    modSummary: browse?.mod,
    receivingScenario,
    viewing: viewing(browse),
    ...(host && {
      lobbyId: lobby.lobbyId,
      hasSaves: !!library?.slots.length,
    }),
  };
}

/** The host's selection as it would be mirrored, or undefined off the scenario screens. */
export function hostSelection(
  state: AppStateType,
): HostBrowseSelection | undefined {
  const card = state.card.name;
  if (!isBrowseCard(card)) return undefined;
  const snapshot = card === "MODS" ? state.ui.coop?.modScenario : undefined;
  return {
    phase: "browsing",
    card,
    ...(snapshot?.mod
      ? { mod: modBrowseSummary(snapshot), scenarioSnapshot: snapshot }
      : {}),
    scenarioId:
      card === "NEW_GAME_DETAILS" ? state.ui.scenarioPreview : undefined,
    difficulty: state.ui.previewDifficulty ?? state.game.difficulty,
    custom: card === "CUSTOM_GAME" ? state.ui.coop?.custom : undefined,
  };
}

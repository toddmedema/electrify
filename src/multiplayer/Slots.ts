import type { LobbyMember, PendingCampaign } from "./Native";
import type { Seat } from "./Types";

/**
 * A lobby member's claim on one saved company, stored as Steam member data. The campaign id
 * prefix makes a claim from an earlier campaign in the same lobby meaningless.
 */
export const slotClaim = (campaignId: string, seatId: string) =>
  `${campaignId}:${seatId}`;

/**
 * Who takes each saved company. An explicit claim wins, earliest member first; anyone who has
 * not claimed a company takes back their own saved one while it is free.
 */
export function seatAssignments(
  campaign: PendingCampaign,
  members: LobbyMember[],
): { bySeat: Map<string, LobbyMember>; unseated: LobbyMember[] } {
  const bySeat = new Map<string, LobbyMember>();
  const seated = new Set<string>();
  const seatIds = new Set(campaign.players.map((player) => player.id));
  const retired = (id: string) => !campaign.requiredPlayerIds.includes(id);
  const prefix = `${campaign.id}:`;
  for (const member of members) {
    const seatId = member.slot?.startsWith(prefix)
      ? member.slot.slice(prefix.length)
      : undefined;
    // A retired company keeps its seat, but nobody else can take it over.
    if (!seatId || !seatIds.has(seatId) || bySeat.has(seatId)) continue;
    if (retired(seatId) && seatId !== member.id) continue;
    bySeat.set(seatId, member);
    seated.add(member.id);
  }
  for (const member of members)
    if (
      !seated.has(member.id) &&
      seatIds.has(member.id) &&
      !bySeat.has(member.id)
    ) {
      bySeat.set(member.id, member);
      seated.add(member.id);
    }
  return {
    bySeat,
    unseated: members.filter((member) => !seated.has(member.id)),
  };
}

/**
 * The saved roster with each claimed company handed to the player who took it, in saved order.
 * An unclaimed retired company keeps its saved player unless that id now plays another
 * company; it then takes an id one of the claimed companies gave up, so ids stay unique.
 */
export function resumeSeats(
  campaign: PendingCampaign,
  members: LobbyMember[],
): Seat[] {
  const { bySeat } = seatAssignments(campaign, members);
  const taken = new Set([...bySeat.values()].map((member) => member.id));
  const freed = [...bySeat.keys()].filter((id) => !taken.has(id));
  return campaign.players.map((player) => {
    const member = bySeat.get(player.id);
    if (member) return { id: member.id, name: member.name };
    return taken.has(player.id)
      ? { id: freed.shift()!, name: player.name }
      : { id: player.id, name: player.name };
  });
}

/** Why the host cannot resume yet, or undefined when every company still playing is claimed. */
export function resumeBlocker(
  campaign: PendingCampaign,
  members: LobbyMember[],
  connected: (id: string) => boolean,
): string | undefined {
  const { bySeat, unseated } = seatAssignments(campaign, members);
  if (unseated.length)
    return `${unseated.map((member) => member.name).join(", ")} must pick a company`;
  const open = campaign.players.filter(
    (player) =>
      campaign.requiredPlayerIds.includes(player.id) && !bySeat.has(player.id),
  );
  if (open.length)
    return `Someone must take ${open.map((player) => player.name).join(", ")}'s company`;
  if ([...bySeat.values()].some((member) => !connected(member.id)))
    return "Every player must be connected";
  return undefined;
}

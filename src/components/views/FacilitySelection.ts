import type { reprioritizeFacility } from "../../reducers/Game";

type ReprioritizeAction = ReturnType<typeof reprioritizeFacility>["payload"];

/** Keep both groups in fleet order and place the selection at the pointer's drop boundary. */
export function facilityGroupMoves(
  ids: number[],
  selectedIds: number[],
  sourceIndex: number,
  destinationIndex: number,
): ReprioritizeAction[] {
  if (sourceIndex === destinationIndex) return [];
  const selected = new Set(selectedIds);
  const group = ids.filter((id) => selected.has(id));
  const boundary = destinationIndex + (destinationIndex > sourceIndex ? 1 : 0);
  const insertion = ids
    .slice(0, boundary)
    .filter((id) => !selected.has(id)).length;
  const working = [...ids];
  const moves: ReprioritizeAction[] = [];
  const moveTo = (id: number, index: number) => {
    const from = working.indexOf(id);
    moves.push({ spotInList: from, delta: index - from });
    working.splice(index, 0, working.splice(from, 1)[0]);
  };
  // First bring later selections forward, then earlier selections back. Only selected
  // facilities generate dispatch actions and reforecasts, at most once per facility.
  group.forEach((id, index) => {
    if (working.indexOf(id) > insertion + index) moveTo(id, insertion + index);
  });
  for (let index = group.length - 1; index >= 0; index--) {
    if (working.indexOf(group[index]) < insertion + index)
      moveTo(group[index], insertion + index);
  }
  return moves;
}

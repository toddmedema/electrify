export const HEX_NEIGHBORS = [
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
] as const;

export function closestHexEdge(edges: readonly number[], preferred: number) {
  const distance = (edge: number) => {
    const difference = Math.abs(edge - preferred);
    return Math.min(difference, HEX_NEIGHBORS.length - difference);
  };
  return edges.reduce<number | undefined>(
    (best, edge) =>
      best === undefined || distance(edge) < distance(best) ? edge : best,
    undefined,
  );
}

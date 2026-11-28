import { UTILITY_LOGOS, type UtilityLogoId } from "../data/UtilityLogos";
import { RANDOM_STREAM, newSeed, randomAt } from "./Math";

/** Non-economic seeded assignment, stable across saves and independent of other random draws. */
export function shuffledUtilityLogos(seed: number): UtilityLogoId[] {
  const logos = UTILITY_LOGOS.map(({ id }) => id);
  for (let i = logos.length - 1; i > 0; i--) {
    const position = Math.floor(
      randomAt(seed, RANDOM_STREAM.utilityLogos, i) * (i + 1),
    );
    [logos[i], logos[position]] = [logos[position], logos[i]];
  }
  return logos;
}

export const randomUtilityLogo = () => shuffledUtilityLogos(newSeed())[0];

export function assignUtilityLogos(
  seed: number,
  seats: readonly { id: string; utilityLogo?: UtilityLogoId }[],
): Record<string, UtilityLogoId> {
  const claimed = new Set(seats.map(({ utilityLogo }) => utilityLogo));
  const unclaimed = shuffledUtilityLogos(seed).filter((id) => !claimed.has(id));
  return Object.fromEntries(
    seats.map(({ id, utilityLogo }) => [id, utilityLogo ?? unclaimed.shift()!]),
  );
}

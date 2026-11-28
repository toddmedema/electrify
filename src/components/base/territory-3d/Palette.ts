import type { RGB } from "./Types";

export function rgb(hex: string): RGB {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

export const PALETTE = {
  grass: rgb("#B8D9C3"),
  grassShade: rgb("#9ABDAB"),
  forest: rgb("#587F69"),
  forestLight: rgb("#739A77"),
  earth: rgb("#C6B493"),
  earthShade: rgb("#9A886E"),
  rock: rgb("#A8B4B8"),
  rockShade: rgb("#89979C"),
  water: rgb("#7FC8CE"),
  riverWater: rgb("#6AC3D9"),
  riverShelf: rgb("#9AB9A5"),
  riverShallows: rgb("#78B2AD"),
  deepWater: rgb("#4B929F"),
  cream: rgb("#FFF8E1"),
  steel: rgb("#CFD8DC"),
  steelShade: rgb("#71858A"),
  mint: rgb("#64DFC5"),
  solar: rgb("#3F78A8"),
  ink: rgb("#20353A"),
  timber: rgb("#796B56"),
  smoke: rgb("#D2DDDA"),
} as const;

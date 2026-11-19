import type { CitySizeType, TerrainType } from "../../Types";
export function terrainDetailsLabel(terrain: TerrainType): string {
  return (
    {
      plains: "Open plains",
      forest: "Forested land",
      hills: "Exposed rolling hills",
      mountain: "Developable mountain ridge",
      river: "River and banks",
      lake: "Enclosed lake basin",
      ocean: "Open ocean",
    } as const
  )[terrain];
}

export function citySizeLabel(size: CitySizeType): string {
  return { small: "Small city", medium: "Medium city", large: "Large city" }[
    size
  ];
}

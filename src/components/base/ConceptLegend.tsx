import * as React from "react";
import ConceptIcon, { CONCEPT_LABELS, ConceptNameType } from "./ConceptIcon";

const GROUPS: { label: string; concepts: ConceptNameType[] }[] = [
  {
    label: "Grid",
    concepts: [
      "supply",
      "demand",
      "blackout",
      "customers",
      "generator",
      "storage",
    ],
  },
  {
    label: "Controls & progress",
    concepts: [
      "build",
      "buy",
      "reorder",
      "construction",
      "pause",
      "play",
      "time",
      "goal",
    ],
  },
  {
    label: "Money & rates",
    concepts: ["money", "finances", "rate", "fuel"],
  },
  {
    label: "Forecasts & alerts",
    concepts: ["forecast", "weather", "severeWeather", "danger"],
  },
];

export default function ConceptLegend(): React.JSX.Element {
  return (
    <div className="conceptLegend">
      {GROUPS.map(({ label, concepts }) => (
        <div className="conceptLegendGroup" key={label}>
          <h4>{label}</h4>
          {/* eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops list semantics when markers are hidden. */}
          <ul className="conceptLegendList" role="list">
            {concepts.map((concept) => (
              <li className="conceptLegendItem" key={concept}>
                <span className="conceptLegendIcon">
                  <ConceptIcon concept={concept} decorative />
                </span>
                {CONCEPT_LABELS[concept]}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

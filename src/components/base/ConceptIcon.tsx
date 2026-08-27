import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import BoltIcon from "@mui/icons-material/Bolt";
import BuildIcon from "@mui/icons-material/Build";
import CampaignIcon from "@mui/icons-material/Campaign";
import ConstructionIcon from "@mui/icons-material/Construction";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import FactoryIcon from "@mui/icons-material/Factory";
import FlashOffIcon from "@mui/icons-material/FlashOff";
import FlashOnIcon from "@mui/icons-material/FlashOn";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import LocalGasStationIcon from "@mui/icons-material/LocalGasStation";
import PauseCircleIcon from "@mui/icons-material/PauseCircle";
import PeopleIcon from "@mui/icons-material/People";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import QueryStatsIcon from "@mui/icons-material/QueryStats";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import WarningIcon from "@mui/icons-material/Warning";
import WbSunnyIcon from "@mui/icons-material/WbSunny";
import * as React from "react";

// The game's symbol vocabulary: one glyph per concept, everywhere a concept appears.
// Consistency is what lets the symbols teach themselves - a player who met "blackout"
// in Mission 1 recognizes it in an event row or a dialog without reading anything.
export type ConceptNameType =
  | "money"
  | "supply"
  | "demand"
  | "blackout"
  | "customers"
  | "generator"
  | "storage"
  | "build"
  | "buy"
  | "reorder"
  | "pause"
  | "play"
  | "time"
  | "construction"
  | "finances"
  | "forecast"
  | "marketing"
  | "fuel"
  | "weather"
  | "danger"
  | "goal";

export const CONCEPT_NAMES: ConceptNameType[] = [
  "money",
  "supply",
  "demand",
  "blackout",
  "customers",
  "generator",
  "storage",
  "build",
  "buy",
  "reorder",
  "pause",
  "play",
  "time",
  "construction",
  "finances",
  "forecast",
  "marketing",
  "fuel",
  "weather",
  "danger",
  "goal",
];

// The one place each concept gets its spoken/read name - and the seed of a future
// localization catalog, since screen readers are the only consumer of these words
export const CONCEPT_LABELS: Record<ConceptNameType, string> = {
  money: "Money",
  supply: "Supply",
  demand: "Demand",
  blackout: "Blackout",
  customers: "Customers",
  generator: "Generator",
  storage: "Storage",
  build: "Build",
  buy: "Buy",
  reorder: "Re-order",
  pause: "Pause",
  play: "Play",
  time: "Time",
  construction: "Under construction",
  finances: "Finances",
  forecast: "Forecast",
  marketing: "Marketing",
  fuel: "Fuel",
  weather: "Weather",
  danger: "Danger",
  goal: "Goal",
};

// Storage renders the battery illustration the fleet list already uses, so it's absent here
const CONCEPT_ICONS: Record<
  Exclude<ConceptNameType, "storage">,
  React.ElementType
> = {
  money: AttachMoneyIcon,
  supply: FlashOnIcon,
  demand: BoltIcon,
  blackout: FlashOffIcon,
  customers: PeopleIcon,
  generator: FactoryIcon,
  build: BuildIcon,
  buy: ShoppingCartIcon,
  reorder: SwapVertIcon,
  pause: PauseCircleIcon,
  play: PlayArrowIcon,
  time: HourglassEmptyIcon,
  construction: ConstructionIcon,
  finances: AccountBalanceIcon,
  forecast: QueryStatsIcon,
  marketing: CampaignIcon,
  fuel: LocalGasStationIcon,
  weather: WbSunnyIcon,
  danger: WarningIcon,
  goal: EmojiEventsIcon,
};

// Colour reinforces the meanings the app already assigns: green supply, red blackout
const CONCEPT_COLORS: Partial<
  Record<ConceptNameType, "success" | "error" | "warning">
> = {
  supply: "success",
  blackout: "error",
  danger: "warning",
};

const IMG_SIZES = { small: 20, medium: 24, large: 35 };

export interface ConceptIconProps {
  concept: ConceptNameType;
  fontSize?: "small" | "medium" | "large";
  style?: React.CSSProperties;
}

export default function ConceptIcon({
  concept,
  fontSize = "medium",
  style,
}: ConceptIconProps): React.JSX.Element {
  const label = CONCEPT_LABELS[concept];
  if (concept === "storage") {
    const px = IMG_SIZES[fontSize];
    return (
      <img
        src="/images/battery.svg"
        alt={label}
        aria-label={label}
        data-concept={concept}
        className="conceptIcon"
        style={{ width: px, height: px, ...style }}
      />
    );
  }
  const Icon = CONCEPT_ICONS[concept];
  return (
    <Icon
      className="conceptIcon"
      aria-label={label}
      data-concept={concept}
      fontSize={fontSize}
      color={CONCEPT_COLORS[concept]}
      style={style}
    />
  );
}

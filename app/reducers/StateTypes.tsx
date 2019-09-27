export type GeneratorId = number;
export interface GeneratorDefinition {
  id: GeneratorId;
  name: string;
  description: string;
  size: 'small' | 'medium' | 'large' | 'super';
  type: 'baseline' | 'load-following' | 'peaking';
  costBuild: number;
  costOperate: number;
  costMWh: number;
  lifespanYears: number;
  costAmortizedMWh: number;
  costPercentBuild: number;
  costPercentFixed: number;
  costPercentVariable: number;
  fuel: 'coal' | 'natural gas' | 'solar' | 'wind' | 'geothermal' | 'hydro' | 'nuclear';
  whMin: number;
  whMax: number;
  rampMWh: number;
}

export interface GeneratorState {
  id: GeneratorId;
  dayBuilt: number;
  enabled: boolean;
  currentCapacityMultiplier: number; // aka "Capacity Factor"
}

export interface GeneratorUnderConstructionState {
  id: GeneratorId;
  daysLeft: number;
  enabled: boolean;
}

export type ResearchId = number;
export interface ResearchDefinition {
  id: ResearchId;
}

export interface ResearchInProgress {
  id: ResearchId;
  daysLeft: number;
  enabled: boolean;
}

export interface CompanyState {
  name: string;
  money: number;
  generators: GeneratorState[];
  generatorsUnderConstruction: GeneratorUnderConstructionState[];
  researched: ResearchId[];
  researchInProgress: ResearchInProgress[];
}

export type QuarterType = 'Spring' | 'Summer' | 'Fall' | 'Winter';
export interface TimeState {
  index: number;
  quarter: QuarterType;
  minutesEllapsed: number; // out of 1440
  year: number; // for display; index is the really important one
}

export interface GameState {
  company: CompanyState;
  time: TimeState;
}

export type PageType = 'HOME' | 'TUTORIAL' | 'GENERATORS' | 'BUILD' | 'RESEARCH' | 'SIMULATE';
export type TransitionType = 'NEXT' | 'PREV' | 'INSTANT';
export interface NavigationState {
  page: PageType;
  transition: TransitionType;
  ts: number;
}

export interface SnackbarState {
  open: boolean;
  message: string;
  timeout: number;
}

export interface AppState {
  game: GameState;
  navigation: NavigationState;
  snackbar: SnackbarState;
}

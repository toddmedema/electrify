import { LocationType, ScenarioType } from "../Types";

export interface DataCenterSetupRequest {
  requestId: number;
  location: LocationType;
  startingYear: number;
}

export type DataCenterSetupResponse =
  | { requestId: number; scenario: ScenarioType }
  | { requestId: number; error: string };

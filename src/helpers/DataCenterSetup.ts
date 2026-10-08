import type { DataCenterCustomerProfile } from "../data/DataCenterCustomers";
import { LocationType, ScenarioType } from "../Types";

export interface DataCenterSetupRequest {
  requestId: number;
  location: LocationType;
  startingYear: number;
  /** Resolved on the main thread, so the worker never downloads the customer sources. */
  customerProfile: DataCenterCustomerProfile;
  startingCustomers?: number;
}

export type DataCenterSetupResponse =
  | { requestId: number; scenario: ScenarioType }
  | { requestId: number; error: string };

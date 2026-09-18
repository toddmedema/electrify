import * as React from "react";
import { TableCell, TableRow } from "@mui/material";
import { getViableLocationCount } from "../../data/FacilitySites";
import { LocationType } from "../../Types";

interface BuildAvailability {
  buildable: boolean;
  secondaryText: React.ReactNode;
}

export interface SiteInventory {
  total: number;
  remaining: number;
}

/** "Madrid" rather than "Madrid, Spain": the reason reads as a place, not an address. */
export function shortPlaceName(location?: LocationType): string {
  return (location?.name || "here").split(",")[0];
}

/** Total and unclaimed sites, or undefined for a technology that geography doesn't cap. */
export function getSiteInventory(
  facilityName: string,
  location: LocationType | undefined,
  remaining: number | undefined,
): SiteInventory | undefined {
  if (remaining === undefined) {
    return undefined;
  }
  const total = getViableLocationCount(location, facilityName);
  return total === undefined ? undefined : { total, remaining };
}

export function siteCountLabel(sites: SiteInventory): string {
  return `${sites.remaining} of ${sites.total} ${sites.total === 1 ? "site" : "sites"} left`;
}

// Why the location has none at all. Worded as what the land lacks, since that is the thing a
// player can't fix by waiting or saving up.
const NO_SITE_REASONS: Record<string, (place: string) => string> = {
  Hydro: (place) => `No river near ${place} is suited to a new dam.`,
  "Pumped Hydro": (place) =>
    `No sites near ${place} have the height difference for two reservoirs.`,
  Geothermal: (place) => `No usable underground heat near ${place}.`,
};

/** Shared availability copy and state for generator and storage purchase cards. */
export function getBuildAvailability(options: {
  name: string;
  description: string;
  available: boolean;
  sizeBuildable: boolean;
  maxSizeLabel: React.ReactNode;
  location?: LocationType;
  viableLocationsRemaining?: number;
}): BuildAvailability {
  const place = shortPlaceName(options.location);
  const sites = getSiteInventory(
    options.name,
    options.location,
    options.viableLocationsRemaining,
  );
  if (sites && sites.total === 0) {
    const reason = NO_SITE_REASONS[options.name];
    return {
      buildable: false,
      secondaryText: reason
        ? reason(place)
        : `No suitable sites near ${place}.`,
    };
  }
  if (sites && sites.remaining === 0) {
    return {
      buildable: false,
      secondaryText: `All ${sites.total} ${sites.total === 1 ? "site" : "sites"} near ${place} are in use by your projects.`,
    };
  }
  if (!options.available) {
    return {
      buildable: false,
      secondaryText: "Not available here yet.",
    };
  }
  if (!options.sizeBuildable) {
    return {
      buildable: false,
      secondaryText: (
        <div>
          This project size is not available with technology in this year.
          <br />
          Maximum available size: <strong>{options.maxSizeLabel}</strong>
        </div>
      ),
    };
  }
  return { buildable: true, secondaryText: options.description };
}

/** A detail row shared by every technology with a finite site inventory. */
export function ViableLocationsRow(props: {
  sites?: SiteInventory;
}): React.JSX.Element | null {
  if (!props.sites) {
    return null;
  }
  return (
    <TableRow>
      <TableCell>Sites left</TableCell>
      <TableCell align="right">
        {props.sites.remaining} of {props.sites.total}
      </TableCell>
    </TableRow>
  );
}

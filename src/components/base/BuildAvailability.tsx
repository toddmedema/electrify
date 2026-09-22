import * as React from "react";
import { TableCell, TableRow } from "@mui/material";
import { getViableLocationCount } from "../../data/FacilitySites";
import { getHydroAvailability } from "../../data/HydroSites";
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
  if (sites.remaining === 1 && sites.total > 1) {
    return "Last site left";
  }
  return `${sites.remaining} of ${sites.total} ${sites.total === 1 ? "site" : "sites"} left`;
}

// Site counts are a game limit built from coarse national and survey data, not a map of every
// river or hillside, so the reason says what this game allows rather than what the land lacks.
const SITE_NOUNS: Record<string, string> = {
  Hydro: "hydro",
  "Pumped Hydro": "pumped hydro",
  Geothermal: "geothermal",
};

/** Shared availability copy and state for generator and storage purchase cards. */
export function getBuildAvailability(options: {
  hydroAvailability?: ReturnType<typeof getHydroAvailability>;
  name: string;
  description: string;
  available: boolean;
  sizeBuildable: boolean;
  maxSizeLabel: React.ReactNode;
  location?: LocationType;
  viableLocationsRemaining?: number;
}): BuildAvailability {
  const place = shortPlaceName(options.location);
  if (options.hydroAvailability) {
    const messages: Record<string, string> = {
      prohibited: "New Hydro is prohibited here.",
      unavailable: "Hydro site data unavailable.",
      empty: "No qualifying Hydro sites found.",
      exhausted: "All Hydro sites are used or reserved.",
      "too-large": "Too large for any remaining site.",
    };
    const status = options.hydroAvailability.status;
    if (status !== "available")
      return { buildable: false, secondaryText: messages[status] };
    if (!options.available)
      return { buildable: false, secondaryText: "Not available here yet." };
    return {
      buildable: options.sizeBuildable,
      secondaryText: options.description,
    };
  }
  const sites = getSiteInventory(
    options.name,
    options.location,
    options.viableLocationsRemaining,
  );
  if (sites && sites.total === 0) {
    const noun = SITE_NOUNS[options.name] || options.name.toLowerCase();
    return {
      buildable: false,
      secondaryText: `No ${noun} sites near ${place} in this game.`,
    };
  }
  if (sites && sites.remaining === 0) {
    return {
      buildable: false,
      secondaryText: `You've used all ${sites.total} ${sites.total === 1 ? "site" : "sites"} near ${place}.`,
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

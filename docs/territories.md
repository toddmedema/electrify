# Across the Valley territories

Scenario 116 and mods based on it use a small radial network centered on Champlain.
Territories own their facilities, storage and customers. Local supply serves local
demand first; only a net surplus or deficit crosses an internal connection. This
is a bounded transport model, with shared regional weather, rather than an AC
power-flow or geographic model.

Champlain is the home territory. Valley Electric and Ridge Electric require a
completed connection and an acquisition. Their existing plants, customers, debt
and dated supply contracts transfer together. The inherited regional interfaces
remain separate from the internal connections: Valley's 350 MW regional interface
does not widen the 100 MW Champlain–Valley connection. Power agreements purchase
energy rights through their delivery interface; a wire upgrade adds physical
headroom without creating a supply contract.

Green Uplands has no customers or inherited fleet. Its 120 MW connection costs
$48 million in 2005 dollars, takes two years and adds $960,000 annual operating
costs before inflation. Completion grants development access to wind, solar and
storage sites. This line never provides a regional-market supply source.

## Building sites

The catalogue in `src/data/Territories.ts` owns finite project budgets. Thermal
plants use industrial sites, wind technologies use wind sites, and solar and utility
storage use open-land sites. Industrial projects are capped at 300 MW per site;
wind and open-land projects are capped at 150 MW per site. Storage caps apply to
power, with energy duration governed by the existing technology quote. Inherited
hydro keeps its named site provenance and does not consume an ordinary site; no
new hydro sites are available.

Paused and unfinished projects reserve their sites. Selling an ordinary project
frees its reservation. A completed, enabled internal connection and ownership are
required when ordering a remote project. Pausing a line retains ownership and the
fleet. Its current capacity becomes zero, while local facilities can still serve
local customers. Construction and upgrades use the existing debt, time, emissions
and weather-rating machinery.

Company-wide policies and the evolving customer count keep their current model.
The actual net demand of each sector is apportioned using the owned utilities'
authored customer counts, demand scales and sector weights; the territory totals
sum to the company demand. Green Uplands adds no demand. Tick summaries show local
served load, generation, storage charging and discharging, external imports and
exports, shortages and curtailment. Internal line readings are positive toward
Champlain and negative toward the neighboring territory.

Schema 13 locates old facilities by asset provenance and assigns old player projects
to Champlain without rewriting history or finances. Existing projects remain in
place even if they exceed a current limit; future orders use remaining sites and
the new limits. See [save formats](saves.md).

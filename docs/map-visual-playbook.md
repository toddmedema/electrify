# Electrify terrain and occupants — final visual playbook

## Purpose

Build one coherent illustrated game board: seven natural terrain surfaces beneath four families of upright occupants. The reference lesson is readable land under separate physical pieces. Make original artwork in Electrify's restrained flat SVG language. Terrain must fill the tile and remain identifiable when occupied; a tile must never become a resource glyph on a blank hex.

Each physical hex has one role: a residential OR industrial city, or one facility/build slot. A city has no build slot. Empty developed land shows a transmission tower. Built land shows the actual generator or storage technology. Unowned undeveloped land has terrain only. Automatic network links visualize the pooled company; they are not a new capacity, upkeep, or construction system.

## Locked geometry

Every asset has `viewBox="0 0 500 500"`. Ground hex vertices are `(250,0) (500,125) (500,375) (250,500) (0,375) (0,125)`. Root clips the terrain to this hex and supplies all rims/outlines.

Use displayed ground width W≥88 CSS pixels and height H=0.72W. At W=88 the ground is88×63.36px. Adjacent centers follow axial coordinates: `cx = originX + W*q + (W/2)*r`, `cy = originY + (3*H/4)*r`. The ground-plane mapping is `x=cx+(u-250)*W/500`, `y=cy+(v-250)*H/500`. This is a shallow board projection, not a claim of mathematically exact isometric perspective.

The occupant's shared ground anchor is source `(250,365)`. Place it at the projected ground anchor `G=(cx,cy+115*H/500)`, keeping the foreground uniformly scaled by `s=W/500`. Its mapping is `x=G.x+(u-250)*s`, `y=G.y+(v-365)*s`. Do not apply the terrain's vertical squash to buildings, trees in occupant art, rotors, or pylons.

City, generator and storage path centerlines and filled-body extents fit x135–365/y115–365; a primary12-unit outline can extend to x129–371/y109–371. Broad painted silhouettes therefore measure42.6px at W=88 and46.5px at W=96. **“40–48px foreground” means painted bounds, not the width of its full500-unit SVG viewport.** Its full canvas is W pixels wide. Empty-site towers deliberately use60% painted scale around the same ground anchor and40% ink/fill opacity, so open land reads as quieter than an occupied tile. The terminal cover remains opaque.

For an absolutely positioned foreground SVG of width/height W, its top-left is `(G.x-W/2,G.y-365*W/500)`. Give it visible overflow and no pointer events. Terrain has `preserveAspectRatio="none"` in its W×H viewport. Foreground uses normal uniform preservation in its W×W viewport. Labels and interactive hit areas belong to the renderer.

## Terrain composition

The occupant's projected footprint is taller than the draft's source-space quiet rectangle. Keep the broad central corridor x150–350/y25–390 visually calm. Identifying features belong mainly in the left/right crescents x35–145 and x355–465, and the exposed front band y390–465, always respecting the hex boundary. They can extend into the corridor as low-contrast tonal fields. Do not cut a blank rectangular hole behind the occupant.

Use broad continuous fields across the ground, with two or three deliberate identifying groups. Buildings should sit within a landscape, not in the middle of seven differently decorated wreaths. Let some broad terrain masses pass behind them; preserve enough characteristic shape at the sides/front to identify the terrain without reading its label.

All terrain features are illustrated within the projected ground canvas. Do not add separate upright mountain/tree overlays or another independently transformed layer. Hills and mountains use oblique planar/curved terrain shapes with broad bases; they are simplified ground illustrations, not separate tall pieces competing with occupants.

## Finish and palette

Use flat matte fills and, when useful, one darker facet. Light is consistently upper-left. No gradients, filters, blurred/heavy shadows, text, outer badge discs, or decorative glow. Use deliberate whole-number geometry; exact hex edge midpoints may contain halves. Rounded land contours contrast with controlled planar building forms.

Palette: grass `#B8D9C3`, forest `#587F69`, soil `#C6B493`, rock `#A8B4B8`, cream/snow `#FFF8E1`, water `#7FC8CE`, deep water `#4B929F`; foreground cream `#FFF8E1`, steel `#CFD8DC`, mint `#64DFC5`. One nearby darker tone is allowed for a required facet; avoid proliferating subtly different greens/greys. Technology accents can follow the existing facility icon, using at most one additional accent per variant.

Map artwork uses black `12` primary outlines and `6` secondary detail strokes in canonical 500-unit units, with rounded joins/caps. This map-only exception to the catalogue icon hierarchy is a 40% reduction from the prior `20`/`10` weights. Keep the same ratio across terrain, cities, generators, storage and towers; do not compensate with stronger tower strokes or opacity. Broad terrain base fields, contour bands, and tonal patches may have no stroke. Reserve terrain black outlines for a few essential silhouettes; outlining every patch makes the background fight the structures. Foreground silhouettes have a complete opaque body. At W=88 a `12` stroke is 2.112px; a `6` detail is 1.056px. Do not pack details closer than their stroke widths. Windows, gaps, and lattice openings should retain at least 15 source units of clear interior after stroke extents, preferably 20.

Terrain colors stay natural in light and dark modes. Root adjusts page/panel, edge backing, owner/selection, label and wire contrast tokens. Do not invert artwork or make cream buildings transparent on dark backgrounds.

## Seven terrain assets

- **Plains:** a continuous pale meadow with two broad, gentle bands and a few restrained grass marks near front/side. Open, horizontal, quiet. No sun, crop badge, panels, or lone grass icon.
- **Forest:** overlapping coherent canopy groups in two lateral masses, with a small front group if needed. Use irregular but related rounded canopy silhouettes; dark forest fill against lighter meadow gaps. Keep a recognizable canopy cluster visible on both sides of a wide building. No uniform dots or a ring of identical tree stamps.
- **Hills:** three broad rounded overlapping ridges with grass tops and a restrained soil facet. Their unequal broad arcs must read as rolling land even after vertical projection. Keep a recognizable ridge in the front band. No triangular peaks or snow.
- **Mountain:** angular stone ridge groups with broad rocky bases, one restrained cream snow cap and a darker side facet. Place the principal angular peak to a side; a secondary front rock face preserves identity beneath a building. No tall central mountain completely hidden by the occupant.
- **River:** a substantial continuous winding water channel with contrasting banks, crossing the tile and emerging at explicit edge ports. Channel width is roughly65–85 canonical units before projection. At least two separated exposed channel sections remain visible under an occupant. Do not use a thin blue line. No bridge, dam or building in the terrain asset.
- **Lake:** a clearly enclosed blue basin with a complete visible shoreline inside the hex, including a broad lower/front crescent visible around the occupant. Keep its perimeter comfortably inset from every edge. Use one shore contour and at most two water marks. No channel that touches the tile edge, and no full-hex water field.
- **Ocean:** deeper blue across every edge, with three broad sparse curved swell marks and a quieter center. No surrounding land, enclosed basin, island, dock, or white foam decoration that resembles snow.

The rendered lake/ocean may lie beneath a dam or marine structure. The occupant supplies its own necessary structural footing; do not insert a generic grass island or badge behind all structures. Eligibility should prevent implausible land-only structures on water rather than artwork silently inventing land.

### River edge interface

`RiverTerrain` alone may take optional `ports?: readonly number[]`; default `[0,3]`. Edges are0 northeast,1 east,2 southeast,3 southwest,4 west,5 northwest. Their source midpoints are `(375,62.5) (500,250) (375,437.5) (125,437.5) (0,250) (125,62.5)`. In that exact order, axial neighbor offsets `(dq,dr)` are `(1,-1) (1,0) (0,1) (-1,1) (-1,0) (0,-1)`; reciprocal edge is `(edge+3)%6`.

Root supplies reciprocal ports for adjacent river tiles and optional river mouths against ocean. Normal authored cells have two ports; one-port headwaters may terminate in a narrow internal source. Keep topology simple; no branching networks are required. Draw the channel/banks to these anchors without rotating the entire tile or its lighting. Lake stays enclosed and is not a river-port continuation. Root must review authored waterways at actual seams; the default diagonal alone is not evidence of continuous rivers. If no connectivity metadata is yet available, author the default river pairs along the NE/SW neighbor axis.

## Four occupant families

All occupants use the same anchor, scale, outline grammar, palette discipline and connection terminal. No circular boundary, text, enclosing tile, ground disc, network wire, or owner color. Necessary integral machine bases, dam faces and pumping conduits are part of the structure; surrounding landscape is not.

- **Transmission tower:** one tapered lattice pylon, one broad crossarm, deliberate triangular/open legs and few diagonals. Preserve generous negative-space gaps at88px map size. No cables in the asset. An opaque lower crossbrace/connection box covers the shared wire terminal without turning the pylon into a solid triangle. Optional `platform?: boolean` adds a small integral steel footing for developed water cells; its painted extents and shared anchor stay unchanged. No grass island, water patch, or full-tile platform.
- **City:** `variant="residential" | "industrial"`. Residential uses three stepped connected buildings, including one pitched roof and two generous window groups. Industrial uses a low sawtooth factory and one square chimney, plus a clear wall/window band. Reserve sawtooth roof rhythm for cities; no cooling tower, turbine rotor, or battery terminal.
- **Generator:** actual technology-family silhouette, mapped by root from existing domain fuel/name. Onshore wind uses an unmistakable rotor and mast; offshore wind retains that rotor with a compact integral marine footing; airborne wind uses a clearly tethered kite/airfoil rather than reusing an ordinary mast. Solar uses three equal, separated blue photovoltaic rows: each shares a horizontal200-unit span and a30/−40 depth vector, with four equal modules divided across that span and one cell seam along the depth. Draw pale steel cell seams before the black perimeter so their endpoints stay contained. Regular steel supports sit behind the rows, and an integral cabinet covers the common connection terminal. Blue `#3F78A8` is the one technology accent for solar. Nuclear uses a cooling/reactor form; fossil thermal a compact turbine hall and stack, never the city's sawtooth facade; hydro a dam/spillway face; geothermal a pipe/steam-machine silhouette. Reuse existing technology identity where helpful, simplifying it into the shared footprint. A bolt or generic factory is insufficient. Distinct technologies may share a family only when their silhouette honestly communicates that family; selected-tile text supplies the precise plant name.
- **Storage:** battery is two clear cabinets with terminal blocks; pumped storage is a recognizable two-level pair of integral water chambers connected to a compact pumping machine/conduit. Keep pumped storage different from the generator's single dam/spillway face. Match any additional existing storage family with an honest silhouette rather than rendering every technology as a battery.

The generator/storage implementers export typed variant unions supported by their components; root maps every existing domain option to a deliberate family and exhaustively handles that mapping. Do not independently invent domain fuel strings inside art files.

## Facility state markers

Preserve each technology's complete silhouette, including the solar panel rows. Add one static neutral roundel as a sibling of the facility body in the uniformly scaled 500-unit foreground canvas. `FacilityMapStatusArtwork` accepts only the shared status kind; the status helper owns classification and readable labels. Cities, empty-site towers and completed facilities with unknown operating status receive no marker.

The roundel is centered at `(424,345)`, with a 42-unit radius and the shared 12-unit black outline. Its painted bounds are x376–472/y297–393: about 18px across at W=96, with clearance from the widest plant outline, the `(250,350)` wire terminal and the canvas edges. Use cream `#FFF8E1` backing and a solid black glyph in both themes. Shape carries the state: hardhat for construction or an offline retrofit, pause bars for operation paused, upward arrow for producing or discharging, horizontal minus for idle, and downward arrow for storage charging. Unknown is absent, never an idle minus.

Keep the marker pointer-inert and hidden from assistive technology; the tile's existing description, tooltip and inspector provide the full status and known actual output. Do not add animation, a legend, progress rings, extra click targets or tick-driven live announcements. Construction dims only the facility body to roughly 0.55 opacity while its marker stays legible. Paused and idle bodies remain opaque. The existing fog wrapper fades body and marker together, and owner/selection outlines and labels retain their existing compositing order.

Known construction and active offline retrofit take precedence over pause; the accompanying text retains both facts when operation is paused. Otherwise pause takes precedence over signed actual output, including when a generator is still winding down. Staged work that allows output keeps the actual output glyph and a retrofit text suffix. Global clock pause never changes a facility's marker, and foreign output is never inferred.

## Automatic network and compositing

Draw terrain for all cells, then automatic network paths, then all upright occupants sorted by ground-anchor Y, then owner boundaries/selected outline and floating labels. Root may keep a subtle internal ground seam; ownership outlines surround ownership regions, not arbitrary illustration contours. Keep tile hit regions unobstructed by artwork or paths.

For each developed neighboring pair that belongs to the represented connected company, render one deduplicated link. A shared edge crossing is the transformed actual edge midpoint, never a guessed corner. Each tile has a ground junction at G. Its upright wire terminal is source `(250,350)`, mapped with the foreground transform: `T=(G.x,G.y-15*W/500)`. Route neighbor-edge links to G and continue to T. Do not project T with the terrain transform. The short final segment disappears behind an opaque occupant detail. These are map-level network connections, not a physically simulated hanging-cable system.

Wire contrast must survive forest, mountain and ocean: root uses a narrow dark line with a light neutral casing, with enough separation from owner outlines to remain recognizable. Keep every connector behind the occupant and avoid crowding the exposed terrain with multiple parallel strokes. No links, tower or terminal stubs on unowned undeveloped land. An empty developed cell uses the tower; a built cell replaces that tower with its plant/storage, never stacks both.

## File and component interface

New code-native components live in `src/components/base/territory-art/`. One assigned implementer owns one file/category. Terrain filenames: `PlainsTerrain.tsx`, `ForestTerrain.tsx`, `HillsTerrain.tsx`, `MountainTerrain.tsx`, `RiverTerrain.tsx`, `LakeTerrain.tsx`, `OceanTerrain.tsx`. Foreground: `TowerOccupant.tsx`, `CityOccupant.tsx`, `GeneratorOccupant.tsx`, `StorageOccupant.tsx`.

Each exports a default React SVG component taking optional `className`; city/generator/storage also have a typed variant prop, river the optional ports above, and tower the optional water-platform boolean. Each returns its own500×500 decorative SVG with `aria-hidden="true"`, `focusable="false"`; root supplies accessible tile labels. No theme/context hooks, external files, random values, external shared-style dependency, IDs/defs that collide across repeated instances, or owner state. Use literal palette values so isolated parallel implementation is safe. Root's adapter owns all placement and domain mappings.

Aim for no more than40 SVG primitives per rendered variant and10KB minified per terrain or individual variant. A multi-variant generator file may exceed10KB total; reducing meaningful technology coverage to meet an aggregate file limit is not acceptable. Prefer a few well-composed paths over many tiny details.

## UI and visual acceptance

Keep cells at least88px wide; scroll the expanded board on phones instead of shrinking it to fit. Interactive targets are at least44px, keyboard focus scrolls into view, and selected details stay readable at360px. Utility names and `You` remain floating labels associated with their city/region; keep them clear of critical silhouettes. Exact terrain, occupant, owner and availability are available in accessible tile text and the selected-tile pane. Do not print microscopic explanatory labels on every hex. Ownership and selection need shape/line treatment plus text, not color alone.

Review every terrain empty and under a broad city/plant; review each occupant on pale plains, dark forest, mountain and ocean where eligible. Inspect actual88px tile/44px painted silhouette size, a48px painted silhouette reference, and enlarged craft views. Check transformed anchors, black line weight, open gaps, lateral terrain recognition and edge continuity. A beautiful500px SVG is insufficient if it becomes a blob in the map.

The same visual judge performs three rounds: (1) whole-family contact sheet including representative composites and network terminals, (2) revised actual map including seams, labels and ownership, (3) final light/dark360px and desktop views. Each round provides at most10 concrete findings with file/line evidence and a direct fix. Fix family inconsistencies as well as local blemishes. Root owns final integration, behavior checks and screenshot delivery.

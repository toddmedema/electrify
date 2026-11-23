# Electrify 3D map playbook

The map uses original solid, faceted models, with the economic readability of
Offworld Trading Company, terrain hierarchy of Civilization VI and restrained
cel shading inspired by Borderlands. The catalogue's SVG icons retain their
existing appearance. Their silhouettes, cream/steel/mint industrial palette and
precise blue solar panels inform the map models.

## Geometry and composition

Use tile-width world units, with y as physical height. The existing
`TerritoryHexGeometry` is the ground-projection authority: 128px wide and 0.72
times as high before the map's presentation scale. A regular point-up hex and an
orthographic camera at approximately 38.58 degrees preserve its ground edges,
HTML targets, labels and pan coordinates. Never flatten an upright model to
imitate perspective. `territory-3d/Projection.ts` shares the projection contract.

Every terrain has an extruded substrate and a level receiving surface. Plains
use broad turf facets; forests have angular tree clusters; hills have broad
shoulders; mountains have rear and side peaks. Suppress relief that intersects
an occupant's footprint. The central 55% is a minimum clear corridor, not a cap
on wide solar farms or dams. River ports remain reciprocal across adjacent
cells. Lake banks enclose their water; ocean water reaches tile edges. Opaque
water and raised banks keep the small board readable without transparency
sorting. Empty connected water has cable and no freestanding tower.

Facilities span approximately 65–80% of a tile, cities approximately 60%, and
empty-land towers approximately 18%. Use actual boxes, prisms and low-sided
solids, with open silhouette gaps and restrained dark seams. Residential roofs,
industrial sawtooths, gas turbine halls, oil tanks, coal bunkers, biomass silos,
nuclear cooling towers, bowed hydro dams, geothermal pipes, battery cabinets,
iron-air containers and pumped-storage basins must remain distinguishable.
Solar has three equal tilted blue panel rows on real supports. Wind has three
blades on a tapered mast; offshore and airborne wind retain their marine and
tethered identities. Export real model cable terminals rather than routing
conductors through ground centers or arbitrary facade coordinates.

## Materials, light and motion

Share the `territory-3d/Palette.ts` materials: muted grass, forest, earth, rock,
water, ivory concrete, steel, mint equipment accents and blue photovoltaic
surfaces. Use flat normals, three lighting bands, ambient fill and one
directional key. Terrain contrast remains quieter than facilities, ownership,
selection and status. Both interface themes retain readable terrain and labels.

Sun direction follows the simulation's local day and daylight information. The
moon is a stylized night key, not an astronomical lunar ephemeris. Lighting
does not advance while the simulation clock is paused. Simple projected caster
meshes form bounded ground shadows; clamp horizon length and union shadow
coverage so overlapping casters do not become black patches. A level receiver
and depth testing prevent shadows floating across the board or painting over
nearer structures. This intentionally simplifies shadows on raised relief.

Production motion follows `facilityMapStatus`, including honest storage flow;
unknown foreign operation stays unknown. Preserve each actual facility's phase
through speed changes and operation pause/resume. Decorative playback is 25%
while the game clock is paused, 70% at 1×, 100% at 3×, 120% at 12× and 150% at
24×. Keep celestial and decorative clocks separate. Reduced motion freezes
decorative poses; document hiding suspends drawing and discards hidden elapsed
time. Construction and operation-paused markers remain legible static UI.

## Implementation contract and verification

`Types.ts` describes triangle meshes, material colors, model parts, actual
terminals, bounded scene instances, camera frames and read-only diagnostics.
`MeshBuilder.ts` supplies shared flat-normal primitives; geometry factories cache
models by a bounded visual key. Terrain and structures export separate model
factories. A small WebGL2 renderer batches repeated meshes with instancing and
one imperative animation loop. It owns buffers/programs/VAOs, releases them on
disposal and rebuilds after context restoration. Labeled HTML tile targets and
SVG facility badges overlay the scene. A status message explains when WebGL2
is unavailable or the context is lost.

No render loop dispatches Redux actions, updates React state or writes frame
poses to DOM attributes. Cap device pixel ratio, cull with model/shadow margins,
bound caches and sample diagnostics only on demand. Preserve the budgets and
checks in [the performance plan](perf-plan.md); no ceiling is raised merely to
accommodate the renderer. Verify mobile/desktop alignment, context loss and
restoration, shadow direction, frozen simulation lighting, retained motion
phase, hidden-document suspension and large-map drawing cost.

WebGL API references: [instanced drawing](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/drawArraysInstanced)
and [context-loss testing](https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_lose_context).

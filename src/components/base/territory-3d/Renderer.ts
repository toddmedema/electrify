import { HEX_WIDTH } from "../TerritoryHexGeometry";
import {
  HAIL_MODEL_KEY,
  HAILSTONE_LIMIT,
  hailstoneAge,
  hailstoneRise,
} from "./Hailstones";
import { interpolateMapLighting } from "./Lighting";
import { createMapProgram } from "./MapProgram";
import { COAST_TRIM_HEIGHT } from "./CoastModels";
import {
  OCEAN_FALLBACK_FRAGMENT,
  OCEAN_FRAGMENT,
  OCEAN_WATER_MATERIAL,
} from "./OceanShader";
import { FacilityMotionClock, MOTION_CYCLE } from "./MotionClock";
import {
  CAMERA_COS,
  CAMERA_SIN,
  projectPoint,
  projectionMatrix,
} from "./Projection";
import { WATERSHED_LEVEL_OFFSETS, waterLevelOffset } from "./WaterSurface";
import { rotorAngle } from "./RotorPose";
import { WildfireParticles } from "./WildfireParticles";
import type {
  MapCanvas,
  MapFrame,
  MapInstance,
  MapLighting,
  MapMesh,
  ModelPart,
  RendererDiagnostics,
  RendererSceneInstance,
  Vec3,
} from "./Types";

const INSTANCE_FLOATS = 24;
const RETAINED_MESHES = 64;
const MAX_PIXELS = 2500000;
const CAMERA_OVERSCAN = HEX_WIDTH / 2;
const FOG_MIX = [0, 0.15, 0.35, 0.6];
const FOG_SATURATION = [1, 0.8, 0.45, 0.15];
const CITY_WINDOW_MATERIAL = 5;
const RIVER_WATER_MATERIAL = 6;
const NIGHT_BACKGROUND: Vec3 = [0.022, 0.032, 0.047];
const vertex = (hasOcean: boolean) => `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in mat4 aTransform;
layout(location=7) in vec4 aStyle;
layout(location=8) in vec4 aMaterial;
uniform mat4 uProjection;
uniform vec3 uLight;
uniform bool uShadow;
uniform vec4 uWeather;
uniform float uCityService;
out vec3 vNormal;
out vec3 vColor;
out vec4 vStyle;
flat out vec4 vMaterial;
out vec3 vSurfacePosition;
${hasOcean ? "out vec2 vLocal;\n" : ""}void main() {
  vec4 world = aTransform * vec4(aPosition, 1.0);
  if (aMaterial.z == 2.0 || aMaterial.z == ${RIVER_WATER_MATERIAL}.0) {
    world.y += mix(${WATERSHED_LEVEL_OFFSETS[0]}, ${WATERSHED_LEVEL_OFFSETS[1]}, uWeather.z);
    // Elevated headwater vertices represent a higher *dry* channel only.
    if (aMaterial.z == ${RIVER_WATER_MATERIAL}.0) world.y -= aPosition.y * uWeather.z;
  }
  vSurfacePosition = world.xyz;
${
  hasOcean
    ? `  // Ocean shore masks are in world-axis ring order, around the instance origin.
  vLocal = world.xz - aTransform[3].xz;
`
    : ""
}  if (uShadow) {
    vec2 reach = -uLight.xz * max(0.0, world.y - 0.003) / max(0.25, uLight.y);
    float distance = length(reach);
    if (distance > 3.0) reach *= 3.0 / distance;
    world.xz += reach;
    world.y = 0.003;
  }
  gl_Position = uProjection * world;
  if (aMaterial.z == 4.0 && !uShadow) {
    // Keep territory and selection outlines over coastal cliffs: take the depth
    // of a point raised above the tallest rim, without moving the outline.
    gl_Position.z += uProjection[1][2] * ${(COAST_TRIM_HEIGHT + 0.01).toFixed(4)};
  }
  vNormal = normalize(mat3(aTransform) * aNormal);
  vColor = aColor;
  vStyle = aStyle;
  vMaterial = aMaterial;
  if (aMaterial.z == ${CITY_WINDOW_MATERIAL}.0) {
    float service = mix(1.0, uCityService, aMaterial.x);
    vMaterial.x = step(aColor.r, service);
  }
}`;
const fragment = (ocean = "") => `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec4 vStyle;
flat in vec4 vMaterial;
in vec3 vSurfacePosition;
${ocean ? "in vec2 vLocal;\n" : ""}uniform vec3 uLight;
uniform vec3 uWaterHalfVector;
uniform vec4 uWeather;
uniform vec3 uLightColor;
uniform vec3 uBackground;
uniform float uAmbient;
uniform float uNight;
uniform float uShadowAlpha;
uniform bool uShadow;
out vec4 color;
float surfaceGrain(vec2 point) {
  vec3 hash = fract(vec3(point.xyx) * 0.1031);
  hash += dot(hash, hash.yzx + 33.33);
  return fract((hash.x + hash.y) * hash.z);
}
float surfaceNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 edge = fract(point);
  edge = edge * edge * (3.0 - 2.0 * edge);
  return mix(
    mix(surfaceGrain(cell), surfaceGrain(cell + vec2(1.0, 0.0)), edge.x),
    mix(surfaceGrain(cell + vec2(0.0, 1.0)), surfaceGrain(cell + 1.0), edge.x),
    edge.y
  );
}
${ocean}
void main() {
  float fog = vStyle.x;
  if (uShadow) {
    color = vec4(0.08, 0.13, 0.17, uShadowAlpha * (1.0 - fog * 0.65));
    return;
  }
  if (vMaterial.z == 4.0) {
    color = vec4(vColor, 1.0);
    return;
  }
  vec3 normal = normalize(vNormal);
  float incidence = max(0.0, dot(normal, uLight));
  float band = incidence < 0.25 ? 0.48 : (incidence < 0.7 ? 0.76 : 1.0);
  bool cityWindow = vMaterial.z == ${CITY_WINDOW_MATERIAL}.0;
${ocean ? `  bool ocean = vMaterial.z == ${OCEAN_WATER_MATERIAL}.0;\n` : ""}  vec3 base = cityWindow
    ? mix(vec3(0.22, 0.33, 0.37), vec3(0.39, 0.69, 0.66), vMaterial.x)
    : mix(vColor, vec3(1.0, 0.71, 0.32), vMaterial.x);
  bool riverWater = vMaterial.z == ${RIVER_WATER_MATERIAL}.0;
  vec3 lit;
${
  ocean
    ? `  if (ocean) {
    lit = oceanLit(band);
  } else {
`
    : ""
}    if (vMaterial.z == 3.0) {
      float snowLine = mix(0.75, 0.25, uWeather.w);
      float cap = smoothstep(snowLine, snowLine + 0.13, vSurfacePosition.y);
      // Snow clings more strongly to shoulders than to steep rock faces.
      base = mix(base, vec3(0.88, 0.93, 0.98),
        cap * smoothstep(0.0, 0.18, uWeather.w) * (0.52 + 0.48 * normal.y));
    }
    if (vMaterial.w > 0.0 && normal.y > 0.08) {
      // Anchor the glaze to the landscape. Bare rock and shaded foliage show through.
      vec2 surface = vSurfacePosition.xz + vSurfacePosition.y * vec2(0.22, -0.37);
      float exposure = smoothstep(0.08, 0.76, normal.y);
      float patches = surfaceNoise(surface * vec2(7.0, 10.0));
      vec2 crystal = surface * vec2(28.0, 37.0);
      float grain = surfaceGrain(floor(crystal));
      vec2 facet = fract(crystal) - 0.5;
      float facetEdge = abs(facet.x + facet.y * 0.7) + abs(facet.y) * 0.55;
      float crystals = (1.0 - smoothstep(0.18, 0.39, facetEdge))
        * smoothstep(0.55, 0.86, grain) * smoothstep(0.33, 0.58, patches);
      float crust = smoothstep(0.42, 0.75, patches + (grain - 0.5) * 0.14);
      float deposit = exposure * (0.12 + 0.61 * crust + 0.26 * crystals);
      base = mix(base, vec3(0.88, 0.96, 0.99), deposit);
    }
    lit = base * (uAmbient + (1.0 - uAmbient) * band);
    lit *= mix(vec3(1.0), uLightColor, 0.65);
    if (vMaterial.z == 1.0 || vMaterial.z == 2.0 || riverWater) {
      // A bounded sky tint and broad glint, with the normal shadow pass laid over both.
      float cloud = uWeather.x;
      vec3 sky = mix(uLightColor * uAmbient, uBackground, 0.35 + cloud * 0.35);
      float ripple = sin(dot(vSurfacePosition.xz, vec2(17.0, 43.0)));
      float gloss = clamp(dot(normal, uWaterHalfVector) + ripple * (0.03 + 0.06 * uWeather.y), 0.0, 1.0);
      float glossSquared = gloss * gloss;
      float glint = glossSquared * glossSquared;
      glint *= glint;
      lit = mix(lit, sky, 0.15) + uLightColor * glint * mix(0.16, 0.028, cloud);
    }
${
  ocean
    ? `  }
  // The ocean applies its own night response.
  if (!ocean) `
    : "  "
}lit *= mix(1.0, 0.40, uNight);
  // Preserve a blue-green surface in low light, before applying distance fog.
  if (riverWater) {
    float current = surfaceNoise(vSurfacePosition.xz * 7.0);
    lit += vec3(0.036, 0.106, 0.138) * uNight;
    lit += vec3(0.024, 0.044, 0.054) * (current - 0.42);
  }
  if (cityWindow) {
    lit = mix(lit, vec3(1.0, 0.78, 0.40), vMaterial.x * (0.10 + uNight * 0.83));
  } else {
    lit += base * (vStyle.z + vMaterial.x * 0.42);
  }
  lit *= vMaterial.y;
  float saturation = vStyle.w;
  lit = mix(vec3(dot(lit, vec3(0.2126, 0.7152, 0.0722))), lit, saturation);
  color = vec4(mix(lit, uBackground, fog), vStyle.y);
}`;
interface GpuMesh {
  vao: WebGLVertexArrayObject;
  vertices: WebGLBuffer;
  instances: WebGLBuffer;
  count: number;
  capacity: number;
  uploadedData?: Float32Array;
  uploadedRevision?: number;
}
interface RenderItem {
  instance: MapInstance;
  part: ModelPart;
  pose: Float32Array;
}
interface Batch {
  mesh: GpuMesh;
  items: RenderItem[];
  data: Float32Array;
  animated: boolean;
  revision: number;
}
interface Passes {
  receivers: Batch[];
  opaque: Batch[];
  shadows: Batch[];
  transparent: Batch[];
}
const emptyPasses = (): Passes => ({
  receivers: [],
  opaque: [],
  shadows: [],
  transparent: [],
});
type State = RendererDiagnostics["state"];
type Uniforms = Record<
  | "projection"
  | "light"
  | "lightColor"
  | "weather"
  | "waterHalfVector"
  | "background"
  | "ambient"
  | "night"
  | "cityService"
  | "shadowAlpha"
  | "shadow",
  WebGLUniformLocation | null
>;

function sameProjection(a: MapFrame, b?: MapFrame): boolean {
  return (
    a.width === b?.width &&
    a.height === b.height &&
    a.scale === b.scale &&
    a.cameraX === b.cameraX &&
    a.cameraY === b.cameraY
  );
}

function sameVector(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function sameLighting(a: MapLighting, b: MapLighting): boolean {
  return (
    a === b ||
    (a.ambient === b.ambient &&
      a.night === b.night &&
      a.shadow === b.shadow &&
      sameVector(a.direction, b.direction) &&
      sameVector(a.color, b.color))
  );
}

function sameShaderWeather(
  a: MapFrame["weather"],
  b: MapFrame["weather"],
): boolean {
  return (
    a?.cloud === b?.cloud &&
    a?.wind === b?.wind &&
    a?.waterLevel === b?.waterLevel &&
    a?.snowpack === b?.snowpack
  );
}

/** Bounded solid-mesh WebGL2 presentation; owns no game state or React updates. */
export class MapRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private uniforms: Uniforms | undefined;
  private meshes = new Map<MapMesh, GpuMesh>();
  private passes = emptyPasses();
  private motionItems: RenderItem[] = [];
  private waterBatches: Batch[] = [];
  private projection: Float32Array = new Float32Array(16);
  private instances: readonly MapInstance[] = [];
  private frame: MapFrame | undefined;
  private projectionFrame: MapFrame | undefined;
  private sceneFrame: MapFrame | undefined;
  private sceneInstances: readonly MapInstance[] | undefined;
  private clock = new FacilityMotionClock();
  private wildfire = new WildfireParticles();
  private raf: number | undefined;
  private animationFence: WebGLSync | null = null;
  private state: State = "unavailable";
  private disposed = false;
  private readyPending = false;
  private storageAllocated = false;
  private frames = 0;
  private drawCalls = 0;
  private triangles = 0;
  private sceneInstanceCount = 0;
  private instanceCount = 0;
  private poseRevision = 0;
  private paintedLighting: MapLighting | undefined;
  private paintedFrame: MapFrame | undefined;
  private heldLighting: MapLighting | undefined;
  private lightingTransition:
    { from: MapLighting; started: number; duration: number } | undefined;
  // CPU time for scene preparation and draw submission.
  private frameMs = 0;
  private sampleDiagnostics = (includeScene = false) =>
    this.diagnostics(includeScene);

  constructor(
    private canvas: MapCanvas,
    private hasOcean: boolean,
    private onState?: (state: State) => void,
  ) {
    Object.defineProperty(canvas, "map3DDiagnostics", {
      value: this.sampleDiagnostics,
      configurable: true,
      writable: false,
    });
    canvas.addEventListener("webglcontextlost", this.contextLost);
    canvas.addEventListener("webglcontextrestored", this.contextRestored);
    canvas.ownerDocument.addEventListener(
      "visibilitychange",
      this.visibilityChanged,
    );
    this.initialize();
  }

  update(instances: readonly MapInstance[], frame: MapFrame): void {
    if (this.disposed) return;
    const previous = this.frame;
    const lightingChanged =
      !previous || !sameLighting(frame.lighting, previous.lighting);
    const changed =
      !previous ||
      instances !== this.instances ||
      !sameProjection(frame, previous) ||
      lightingChanged ||
      frame.dpr !== previous.dpr ||
      frame.cityService !== previous.cityService ||
      frame.visible !== previous.visible ||
      frame.motionAllowed !== previous.motionAllowed ||
      frame.playbackRate !== previous.playbackRate ||
      frame.lightingTransitionMs !== previous.lightingTransitionMs ||
      !sameVector(frame.background, previous.background) ||
      !sameShaderWeather(frame.weather, previous.weather);
    if (!changed) return;

    this.instances = instances;
    this.frame = frame;
    const duration = frame.motionAllowed
      ? frame.lightingTransitionMs
      : undefined;
    if (lightingChanged) {
      this.heldLighting = undefined;
      this.lightingTransition =
        duration && this.paintedLighting && this.isVisible()
          ? { from: this.paintedLighting, started: performance.now(), duration }
          : undefined;
    } else if (!duration && this.lightingTransition) {
      // Pausing between ticks keeps the last painted sky until the clock advances.
      this.heldLighting = this.paintedLighting;
      this.lightingTransition = undefined;
    }
    if (!frame.motionAllowed || frame.playbackRate <= 0) {
      this.clock.resetTimestamp();
      this.wildfire.resetTimestamp();
    }
    if (this.isVisible()) this.schedule();
    else this.cancelFrame();
  }

  private prepareScene(frame: MapFrame): void {
    const projectionChanged = !sameProjection(frame, this.projectionFrame);
    if (projectionChanged) {
      this.projection = projectionMatrix(frame);
      this.projectionFrame = frame;
    }
    const scene = this.sceneFrame;
    const viewChanged =
      !scene ||
      scene.width !== frame.width ||
      scene.height !== frame.height ||
      scene.scale !== frame.scale ||
      Math.abs(scene.cameraX - frame.cameraX) >= CAMERA_OVERSCAN ||
      Math.abs(scene.cameraY - frame.cameraY) >= CAMERA_OVERSCAN;
    const instancesChanged = this.sceneInstances !== this.instances;
    if (projectionChanged || instancesChanged)
      this.wildfire.prepare(this.instances, frame);
    const waterOnly =
      instancesChanged &&
      !viewChanged &&
      this.updateReservoirLevels(this.instances);
    if (instancesChanged && !waterOnly) this.clock.sync(this.instances);
    if (viewChanged || (instancesChanged && !waterOnly)) this.buildScene(frame);
    this.sceneInstances = this.instances;
  }

  diagnostics(includeScene = false): RendererDiagnostics {
    return {
      frames: this.frames,
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      meshCount: this.meshes.size,
      instanceCount: this.instanceCount,
      frameMs: this.frameMs,
      cpuFrameMs: this.frameMs,
      phases: this.clock.snapshot(),
      light: this.paintedLighting
        ? [...this.paintedLighting.direction]
        : [0, 1, 0],
      lightColor: this.paintedLighting
        ? [...this.paintedLighting.color]
        : [0, 0, 0],
      state: this.state,
      playbackRate: this.frame?.playbackRate ?? 0,
      motionAllowed: this.frame?.motionAllowed ?? false,
      visible: this.isVisible(),
      wildfire: this.wildfire.diagnostics(),
      ...(includeScene ? { scene: this.sceneDiagnostics() } : {}),
    };
  }

  private sceneDiagnostics(): RendererSceneInstance[] {
    // Inspect the submitted passes, including their actual fog/pose data. This never rebuilds
    // the scene or reads game state, and the ordinary cheap sample never scans these vertices.
    const instances = new Map<string, RenderItem[]>();
    for (const batch of [
      ...this.passes.receivers,
      ...this.passes.opaque,
      ...this.passes.transparent,
    ])
      for (const item of batch.items) {
        const items = instances.get(item.instance.id) ?? [];
        items.push(item);
        instances.set(item.instance.id, items);
      }
    return Array.from(instances.values(), (items) => {
      const { instance } = items[0];
      const min: [number, number, number] = [Infinity, Infinity, Infinity],
        max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      let triangles = 0;
      const waterSurfaceY: number[] = [];
      for (const { part, pose } of items) {
        const vertices = part.mesh.positions;
        triangles += vertices.length / 9;
        const river = part.material === "river-water";
        const watershed = river || part.material === "watershed-water";
        const waterLevel = this.paintedFrame?.weather?.waterLevel;
        const riverRiseFade = river ? waterLevelOffset([0, 1], waterLevel) : 0;
        const surfaceOffset = watershed
          ? waterLevelOffset(WATERSHED_LEVEL_OFFSETS, waterLevel)
          : 0;
        const offsetAt = (y: number) => surfaceOffset - y * riverRiseFade;
        if (
          watershed ||
          part.material === "water" ||
          part.material === "ocean-water"
        )
          waterSurfaceY.push(pose[13] + vertices[1] + offsetAt(vertices[1]));
        for (let i = 0; i < vertices.length; i += 3)
          for (let axis = 0; axis < 3; axis++) {
            const value =
              pose[axis] * vertices[i] +
              pose[axis + 4] * vertices[i + 1] +
              pose[axis + 8] * vertices[i + 2] +
              pose[axis + 12] +
              (axis === 1 ? offsetAt(vertices[i + 1]) : 0);
            min[axis] = Math.min(min[axis], value);
            max[axis] = Math.max(max[axis], value);
          }
      }
      return {
        id: instance.id,
        modelKey: instance.model.key,
        fog: instance.fog,
        fogMix: items[0].pose[16],
        saturation: items[0].pose[19],
        active: instance.active,
        producing: instance.producing ?? false,
        motionKey: instance.motionKey,
        triangles,
        min,
        max,
        ...(waterSurfaceY.length ? { waterSurfaceY } : {}),
        ...(instance.model.connections
          ? {
              connections: instance.model.connections.map((wire) => ({
                ...wire,
                start: [...wire.start] as Vec3,
                end: [...wire.end] as Vec3,
              })),
            }
          : {}),
      };
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelFrame();
    this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.contextRestored,
    );
    this.canvas.ownerDocument.removeEventListener(
      "visibilitychange",
      this.visibilityChanged,
    );
    this.releaseResources(this.state !== "lost");
    this.instances = [];
    this.motionItems = [];
    if (this.canvas.map3DDiagnostics === this.sampleDiagnostics)
      delete this.canvas.map3DDiagnostics;
  }

  private setState(state: State): void {
    this.state = state;
    this.onState?.(state);
  }

  private initialize(): void {
    try {
      this.gl = this.canvas.getContext("webgl2", {
        alpha: false,
        antialias: true,
        depth: true,
        stencil: true,
        powerPreference: "high-performance",
      });
      const gl = this.gl;
      if (!gl || gl.getContextAttributes()?.stencil === false)
        throw new Error("Map requires WebGL2 with a stencil buffer");
      const program = this.createProgram(gl);
      this.program = program;
      this.uniforms = {
        projection: gl.getUniformLocation(program, "uProjection"),
        light: gl.getUniformLocation(program, "uLight"),
        lightColor: gl.getUniformLocation(program, "uLightColor"),
        weather: gl.getUniformLocation(program, "uWeather"),
        waterHalfVector: gl.getUniformLocation(program, "uWaterHalfVector"),
        background: gl.getUniformLocation(program, "uBackground"),
        ambient: gl.getUniformLocation(program, "uAmbient"),
        night: gl.getUniformLocation(program, "uNight"),
        cityService: gl.getUniformLocation(program, "uCityService"),
        shadowAlpha: gl.getUniformLocation(program, "uShadowAlpha"),
        shadow: gl.getUniformLocation(program, "uShadow"),
      };
      this.wildfire.prepareProgram(gl);
    } catch (_error) {
      this.fail();
      return;
    }
    // Notify the host after the first draw so pointer picking uses a painted frame.
    this.state = "ready";
    this.readyPending = true;
    this.schedule();
  }

  private createProgram(gl: WebGL2RenderingContext): WebGLProgram {
    // Even an unused ocean branch slows land draws on software WebGL.
    if (!this.hasOcean) return createMapProgram(gl, vertex(false), fragment());
    const coastalVertex = vertex(true);
    try {
      return createMapProgram(gl, coastalVertex, fragment(OCEAN_FRAGMENT));
    } catch (_error) {
      // Keep the map if one driver rejects the ocean shader: draw a flat sea instead.
      return createMapProgram(
        gl,
        coastalVertex,
        fragment(OCEAN_FALLBACK_FRAGMENT),
      );
    }
  }

  private contextLost = (event: Event): void => {
    event.preventDefault();
    this.loseContext();
  };

  private loseContext(): void {
    if (this.state === "lost") return;
    this.cancelFrame();
    this.releaseResources(false);
    this.readyPending = false;
    this.setState("lost");
  }

  private contextRestored = (): void => {
    if (!this.disposed) this.initialize();
  };

  private visibilityChanged = (): void => {
    this.cancelFrame();
    if (this.isVisible()) this.schedule();
  };

  private isVisible(): boolean {
    return (
      !!this.frame?.visible &&
      this.frame.width > 0 &&
      this.frame.height > 0 &&
      !this.canvas.ownerDocument.hidden
    );
  }

  private allowsMotion(): boolean {
    return (
      this.isVisible() &&
      !!this.frame?.motionAllowed &&
      Number.isFinite(this.frame?.playbackRate) &&
      (this.frame?.playbackRate ?? 0) > 0
    );
  }

  private schedule(): void {
    if (
      this.raf === undefined &&
      !this.disposed &&
      this.state === "ready" &&
      this.isVisible()
    )
      this.raf = this.canvas.ownerDocument.defaultView?.requestAnimationFrame(
        this.animate,
      );
  }

  private cancelFrame(): void {
    if (this.raf !== undefined)
      this.canvas.ownerDocument.defaultView?.cancelAnimationFrame(this.raf);
    this.raf = undefined;
    this.clock.resetTimestamp();
    this.wildfire.resetTimestamp();
  }

  private animate = (timestamp: number): void => {
    this.raf = undefined;
    if (!this.isVisible() || this.disposed || this.state !== "ready") return;
    const started = performance.now();
    try {
      const gl = this.gl!;
      // Repaint changed game or camera inputs on this frame. For decorative motion
      // alone, leave the GPU time to finish the last scene and composite the UI.
      if (this.animationFence) {
        if (
          this.frame === this.paintedFrame &&
          this.instances === this.sceneInstances &&
          gl.clientWaitSync(this.animationFence, 0, 0) === gl.TIMEOUT_EXPIRED
        ) {
          this.schedule();
          return;
        }
        gl.deleteSync(this.animationFence);
        this.animationFence = null;
      }
      this.storageAllocated = false;
      // Camera and simulation updates can arrive before the same paint. Only
      // prepare the scene that will actually be submitted, including on reveal.
      this.prepareScene(this.frame!);
      if (this.state !== "ready") return;
      const allowed = this.allowsMotion();
      const moving = allowed && this.motionItems.length > 0;
      this.clock.tick(timestamp, moving, this.frame!.playbackRate);
      this.wildfire.tick(timestamp, allowed, this.frame!.playbackRate);
      this.draw(moving, this.lightAt(timestamp));
      this.frameMs = performance.now() - started;
      if (this.readyPending) {
        this.readyPending = false;
        this.setState("ready");
      }
      if (
        moving ||
        (allowed && this.wildfire.count) ||
        this.lightingTransition
      ) {
        this.animationFence =
          gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) ?? null;
        if (this.animationFence) gl.flush();
        this.schedule();
      }
    } catch (_error) {
      this.fail();
    }
  };

  private lightAt(timestamp: number): MapLighting {
    const target = this.frame!.lighting;
    const transition = this.lightingTransition;
    if (!transition) return this.heldLighting ?? target;
    const fraction =
      Math.max(0, timestamp - transition.started) / transition.duration;
    if (fraction < 1)
      return interpolateMapLighting(transition.from, target, fraction);
    this.lightingTransition = undefined;
    return target;
  }

  private createMesh(mesh: MapMesh): GpuMesh {
    const gl = this.gl!;
    let vao: WebGLVertexArrayObject | null = null;
    let vertices: WebGLBuffer | null = null;
    let instances: WebGLBuffer | null = null;
    try {
      vao = gl.createVertexArray();
      vertices = gl.createBuffer();
      instances = gl.createBuffer();
      if (!vao || !vertices || !instances)
        throw new Error("Map mesh allocation failed");
      const count = mesh.positions.length / 3;
      const data = new Float32Array(count * 9);
      for (let vertex = 0; vertex < count; vertex++) {
        const offset = vertex * 3;
        data.set(mesh.positions.subarray(offset, offset + 3), vertex * 9);
        data.set(mesh.normals.subarray(offset, offset + 3), vertex * 9 + 3);
        data.set(mesh.colors.subarray(offset, offset + 3), vertex * 9 + 6);
      }
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      this.storageAllocated = true;
      for (let attribute = 0; attribute < 3; attribute++) {
        gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(
          attribute,
          3,
          gl.FLOAT,
          false,
          36,
          attribute * 12,
        );
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, instances);
      for (let column = 0; column < 6; column++) {
        const attribute = 3 + column;
        gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(
          attribute,
          4,
          gl.FLOAT,
          false,
          INSTANCE_FLOATS * 4,
          column * 16,
        );
        gl.vertexAttribDivisor(attribute, 1);
      }
      gl.bindVertexArray(null);
      return { vao, vertices, instances, count, capacity: 0 };
    } catch (error) {
      if (vao) gl.deleteVertexArray(vao);
      if (vertices) gl.deleteBuffer(vertices);
      if (instances) gl.deleteBuffer(instances);
      throw error;
    }
  }

  private updateReservoirLevels(instances: readonly MapInstance[]): boolean {
    const scene = this.sceneInstances;
    if (!scene || instances.length !== scene.length) return false;
    const updates = new Map<string, MapInstance>();
    for (let index = 0; index < instances.length; index++) {
      const previous = scene[index];
      const next = instances[index];
      if (previous === next) continue;
      if (
        previous.id !== next.id ||
        previous.model !== next.model ||
        previous.position !== next.position ||
        previous.fog !== next.fog ||
        previous.active !== next.active ||
        previous.frost !== next.frost ||
        previous.producing !== next.producing ||
        previous.onPlayerGrid !== next.onPlayerGrid ||
        previous.motionKey !== next.motionKey ||
        previous.shore !== next.shore ||
        previous.wildfire !== next.wildfire
      )
        return false;
      if (previous.waterLevel !== next.waterLevel) updates.set(next.id, next);
    }
    if (updates.size === 0) return true;

    // Keep the static geometry and its GPU buffers when only reservoir fill changes.
    for (const batch of this.waterBatches) {
      let data: Float32Array | undefined;
      for (let index = 0; index < batch.items.length; index++) {
        const item = batch.items[index];
        if (!item.part.waterLevelRange) continue;
        const updated = updates.get(item.instance.id);
        if (!updated) continue;
        item.instance = updated;
        this.pose(item);
        data ??= batch.data.slice();
        data.set(item.pose, index * INSTANCE_FLOATS);
      }
      if (data) batch.data = data;
    }
    return true;
  }

  private buildScene(frame: MapFrame): void {
    this.sceneFrame = frame;
    const used = new Set<MapMesh>();
    const grouped = {
      receivers: new Map<GpuMesh, RenderItem[]>(),
      opaque: new Map<GpuMesh, RenderItem[]>(),
      shadows: new Map<GpuMesh, RenderItem[]>(),
      transparent: new Map<GpuMesh, RenderItem[]>(),
    };
    this.motionItems = [];
    this.waterBatches = [];
    this.sceneInstanceCount = 0;
    let hailBudget: number =
      frame.width <= 600 ? HAILSTONE_LIMIT.mobile : HAILSTONE_LIMIT.desktop;
    try {
      for (const instance of this.instances) {
        const hail = instance.model.key === HAIL_MODEL_KEY;
        if (hail && hailBudget === 0) continue;
        const center = projectPoint(instance.position, frame);
        // Include offscreen tall models and the maximum three-tile shadow reach.
        const margin =
          ((hail
            ? 1.25
            : 3 + Math.max(instance.model.height, instance.model.footprint)) *
            HEX_WIDTH +
            CAMERA_OVERSCAN) *
          Math.abs(frame.scale);
        if (
          center.x < -margin ||
          center.x > frame.width + margin ||
          center.y < -margin ||
          center.y > frame.height + margin
        )
          continue;
        this.sceneInstanceCount++;
        for (const part of instance.model.parts) {
          if (hail) {
            if (hailBudget === 0) break;
            hailBudget--;
          }
          if (part.hideWhenInactive && !instance.active) continue;
          let mesh = this.meshes.get(part.mesh);
          if (!mesh) {
            mesh = this.createMesh(part.mesh);
            this.meshes.set(part.mesh, mesh);
          }
          used.add(part.mesh);
          const item: RenderItem = {
            instance,
            part,
            pose: new Float32Array(INSTANCE_FLOATS),
          };
          this.pose(item);
          if (part.motion && instance.active) this.motionItems.push(item);
          const add = (pass: Map<GpuMesh, RenderItem[]>) => {
            const items = pass.get(mesh!);
            if (items) items.push(item);
            else pass.set(mesh!, [item]);
          };
          if (part.motion === "steam") add(grouped.transparent);
          else if (part.receivesShadow) add(grouped.receivers);
          else add(grouped.opaque);
          if (part.castsShadow && part.motion !== "steam") add(grouped.shadows);
        }
      }
      const shared = new Map<GpuMesh, Batch[]>();
      for (const name of Object.keys(grouped) as (keyof Passes)[])
        this.passes[name] = Array.from(grouped[name], ([mesh, items]) => {
          const candidates = shared.get(mesh) ?? [];
          const existing = candidates.find(
            (batch) =>
              batch.items.length === items.length &&
              batch.items.every((item, index) => item === items[index]),
          );
          if (existing) return existing;
          const data = new Float32Array(items.length * INSTANCE_FLOATS);
          for (let index = 0; index < items.length; index++)
            data.set(items[index].pose, index * INSTANCE_FLOATS);
          const batch: Batch = {
            mesh,
            items,
            data,
            animated: items.some(
              (item) => item.part.motion && item.instance.active,
            ),
            revision: this.poseRevision,
          };
          if (items.some((item) => item.part.waterLevelRange))
            this.waterBatches.push(batch);
          candidates.push(batch);
          shared.set(mesh, candidates);
          return batch;
        });
      // Bound the warm cache, without discarding any mesh needed by the visible scene.
      let unused = this.meshes.size - used.size;
      for (const [key, mesh] of this.meshes) {
        if (unused <= RETAINED_MESHES) break;
        if (!used.has(key)) {
          this.deleteMesh(mesh);
          this.meshes.delete(key);
          unused--;
        }
      }
    } catch (_error) {
      this.fail();
    }
  }

  private pose(item: RenderItem): void {
    const { instance, part, pose } = item;
    const phase =
      this.clock.phase(instance.motionKey ?? instance.id) +
      (part.phaseOffset ?? 0) * MOTION_CYCLE;
    let angle = 0,
      scale = 1,
      rise = 0,
      alpha = 1,
      glow = 0;
    switch (part.motion) {
      case "rotor":
        angle = rotorAngle(phase);
        break;
      case "sway":
        angle = Math.sin(phase) * 0.045;
        break;
      case "steam": {
        const cycle = (((phase / MOTION_CYCLE) % 1) + 1) % 1;
        scale = 0.65 + cycle * 0.65;
        rise = cycle * 0.28;
        alpha = (1 - cycle) * 0.65;
        break;
      }
      case "flow":
        rise = Math.sin(phase) * 0.018;
        break;
      case "pulse":
        glow = (1 + Math.sin(phase)) * 0.07;
        break;
      case "hail": {
        const age = hailstoneAge(phase);
        angle = phase * 5;
        rise = hailstoneRise(age);
        // Shrink into the air on spawning and into the ground after settling.
        scale = Math.min(1, age / 0.05, (1 - age) / 0.125);
        glow = 0.26;
        break;
      }
    }
    const c = Math.cos(angle) * scale,
      s = Math.sin(angle) * scale;
    pose.fill(0);
    pose[0] = c;
    pose[1] = s;
    pose[4] = -s;
    pose[5] = c;
    pose[10] = scale;
    pose[15] = 1;
    pose[12] = instance.position[0] + (part.position?.[0] ?? 0);
    const waterOffset = part.waterLevelRange
      ? waterLevelOffset(part.waterLevelRange, instance.waterLevel)
      : 0;
    pose[13] =
      instance.position[1] + (part.position?.[1] ?? 0) + rise + waterOffset;
    pose[14] = instance.position[2] + (part.position?.[2] ?? 0);
    pose[16] = FOG_MIX[instance.fog];
    pose[17] = alpha;
    pose[18] = glow;
    const facility =
      part.material === "facility-surface" ||
      part.material === "facility-window";
    // Fog still caps saturation outside the clear owned foreground.
    const saturation = facility
      ? instance.active
        ? instance.fog === 0
          ? 1.3
          : 1
        : 0.78
      : 1;
    pose[19] = FOG_SATURATION[instance.fog] * saturation;
    const cityWindow = part.material === "city-window";
    pose[20] = (
      cityWindow
        ? instance.onPlayerGrid
        : part.material === "facility-window" && instance.producing
    )
      ? 1
      : 0;
    pose[21] = facility && instance.active ? 1.06 : 1;
    pose[22] =
      part.material === "water"
        ? 1
        : part.material === "watershed-water"
          ? 2
          : part.material === "mountain"
            ? 3
            : part.material === "map-border"
              ? 4
              : cityWindow
                ? CITY_WINDOW_MATERIAL
                : part.material === "river-water"
                  ? RIVER_WATER_MATERIAL
                  : part.material === "ocean-water"
                    ? OCEAN_WATER_MATERIAL
                    : 0;
    // Ocean water reads its shore mask here; other water never takes frost.
    pose[23] =
      pose[22] === OCEAN_WATER_MATERIAL
        ? (instance.shore ?? 0)
        : instance.frost &&
            pose[22] !== 1 &&
            pose[22] !== 2 &&
            pose[22] !== RIVER_WATER_MATERIAL
          ? 1
          : 0;
  }

  private draw(moving: boolean, lighting: MapLighting): void {
    const gl = this.gl,
      frame = this.frame,
      uniforms = this.uniforms;
    if (!gl || !frame || !uniforms || frame.width <= 0 || frame.height <= 0)
      return;
    if (moving) {
      for (const item of this.motionItems) this.pose(item);
      this.poseRevision++;
    }
    const dpr = Math.max(
      0.25,
      Math.min(
        frame.dpr || 1,
        frame.width <= 600 ? 1.5 : 2,
        Math.sqrt(MAX_PIXELS / (frame.width * frame.height)),
      ),
    );
    const width = Math.max(1, Math.round(frame.width * dpr)),
      height = Math.max(1, Math.round(frame.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      this.storageAllocated = true;
    }
    gl.viewport(0, 0, width, height);
    const background: Vec3 = [
      frame.background[0] +
        (NIGHT_BACKGROUND[0] - frame.background[0]) * lighting.night,
      frame.background[1] +
        (NIGHT_BACKGROUND[1] - frame.background[1]) * lighting.night,
      frame.background[2] +
        (NIGHT_BACKGROUND[2] - frame.background[2]) * lighting.night,
    ];
    gl.clearColor(...background, 1);
    gl.clearDepth(1);
    gl.clearStencil(0);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.stencilMask(0xff);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(uniforms.projection, false, this.projection);
    gl.uniform3f(uniforms.light, ...lighting.direction);
    gl.uniform3f(uniforms.lightColor, ...lighting.color);
    gl.uniform4f(
      uniforms.weather,
      frame.weather?.cloud ?? 0,
      frame.weather?.wind ?? 0,
      frame.weather?.waterLevel ?? 0.5,
      frame.weather?.snowpack ?? 0,
    );
    const [lx, ly, lz] = lighting.direction;
    const halfY = ly + CAMERA_SIN,
      halfZ = lz + CAMERA_COS;
    const halfLength = Math.hypot(lx, halfY, halfZ) || 1;
    gl.uniform3f(
      uniforms.waterHalfVector,
      lx / halfLength,
      halfY / halfLength,
      halfZ / halfLength,
    );
    gl.uniform3f(uniforms.background, ...background);
    gl.uniform1f(uniforms.ambient, lighting.ambient);
    gl.uniform1f(uniforms.night, lighting.night);
    gl.uniform1f(uniforms.cityService, frame.cityService);
    gl.uniform1f(uniforms.shadowAlpha, lighting.shadow);
    gl.uniform1i(uniforms.shadow, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    this.drawCalls = 0;
    this.triangles = 0;
    this.drawBatches(this.passes.receivers);
    gl.stencilMask(0);
    this.drawBatches(this.passes.opaque);
    // Receiver value 1 becomes 2 on the first visible shadow fragment. Further
    // casters fail the stencil test: overlap never compounds the shadow alpha.
    gl.stencilMask(0xff);
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1i(uniforms.shadow, 1);
    this.drawBatches(this.passes.shadows);
    gl.uniform1i(uniforms.shadow, 0);
    gl.disable(gl.STENCIL_TEST);
    this.drawBatches(this.passes.transparent);
    if (this.wildfire.count) {
      if (this.wildfire.draw(gl, frame, this.projection))
        this.storageAllocated = true;
      this.drawCalls++;
      this.triangles += this.wildfire.count * 2;
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    // Check new GPU storage before publishing the paint. An instance update
    // fits in its existing buffer, and polling errors there would synchronize
    // with the GPU on every animated frame.
    if (
      (this.readyPending || this.storageAllocated) &&
      gl.getError() !== gl.NO_ERROR
    )
      throw new Error("Map GPU buffer upload or draw failed");
    this.frames++;
    this.paintedLighting = lighting;
    if (frame.width !== this.paintedFrame?.width)
      this.canvas.style.width = `${frame.width}px`;
    if (frame.height !== this.paintedFrame?.height)
      this.canvas.style.height = `${frame.height}px`;
    this.paintedFrame = frame;
    this.instanceCount = this.sceneInstanceCount;
  }

  private drawBatches(batches: readonly Batch[]): void {
    const gl = this.gl!;
    for (const batch of batches) {
      const { mesh, items, data } = batch;
      if (batch.animated && batch.revision !== this.poseRevision) {
        for (let index = 0; index < items.length; index++)
          data.set(items[index].pose, index * INSTANCE_FLOATS);
        batch.revision = this.poseRevision;
      }
      gl.bindVertexArray(mesh.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instances);
      if (mesh.capacity < items.length) {
        mesh.capacity = Math.max(1, mesh.capacity);
        while (mesh.capacity < items.length) mesh.capacity *= 2;
        gl.bufferData(
          gl.ARRAY_BUFFER,
          mesh.capacity * INSTANCE_FLOATS * 4,
          gl.DYNAMIC_DRAW,
        );
        this.storageAllocated = true;
      }
      if (
        mesh.uploadedData !== data ||
        mesh.uploadedRevision !== batch.revision
      ) {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, data.length);
        mesh.uploadedData = data;
        mesh.uploadedRevision = batch.revision;
      }
      gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.count, items.length);
      this.drawCalls++;
      this.triangles += (mesh.count / 3) * items.length;
    }
  }

  private deleteMesh(mesh: GpuMesh): void {
    this.gl?.deleteVertexArray(mesh.vao);
    this.gl?.deleteBuffer(mesh.vertices);
    this.gl?.deleteBuffer(mesh.instances);
  }

  private fail(): void {
    if (this.gl?.isContextLost()) {
      this.loseContext();
      return;
    }
    this.cancelFrame();
    this.releaseResources(true);
    this.readyPending = false;
    this.setState("unavailable");
  }

  private releaseResources(deleteGpu: boolean): void {
    this.wildfire.release(this.gl, deleteGpu);
    if (deleteGpu && this.animationFence)
      this.gl?.deleteSync(this.animationFence);
    this.animationFence = null;
    if (deleteGpu) {
      for (const mesh of this.meshes.values()) this.deleteMesh(mesh);
      if (this.program) this.gl?.deleteProgram(this.program);
    }
    this.meshes.clear();
    this.paintedFrame = undefined;
    this.sceneFrame = undefined;
    this.sceneInstances = undefined;
    this.program = null;
    this.uniforms = undefined;
    this.passes = emptyPasses();
    this.motionItems = [];
    this.waterBatches = [];
  }
}

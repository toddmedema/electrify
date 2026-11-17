import { HEX_WIDTH } from "../TerritoryHexGeometry";
import { FacilityMotionClock, MOTION_CYCLE } from "./MotionClock";
import { projectPoint, projectionMatrix } from "./Projection";
import type {
  MapCanvas,
  MapFrame,
  MapInstance,
  MapMesh,
  ModelPart,
  RendererDiagnostics,
  RendererSceneInstance,
  Vec3,
} from "./Types";

const INSTANCE_FLOATS = 20;
const RETAINED_MESHES = 64;
const MAX_PIXELS = 2500000;
const FOG_MIX = [0, 0.15, 0.35, 0.6];
const FOG_SATURATION = [1, 0.8, 0.45, 0.15];
const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in mat4 aTransform;
layout(location=7) in vec4 aStyle;
uniform mat4 uProjection;
uniform vec3 uLight;
uniform bool uShadow;
out vec3 vNormal;
out vec3 vColor;
out vec4 vStyle;
void main() {
  vec4 world = aTransform * vec4(aPosition, 1.0);
  if (uShadow) {
    vec2 reach = -uLight.xz * max(0.0, world.y - 0.003) / max(0.25, uLight.y);
    float distance = length(reach);
    if (distance > 3.0) reach *= 3.0 / distance;
    world.xz += reach;
    world.y = 0.003;
  }
  gl_Position = uProjection * world;
  vNormal = normalize(mat3(aTransform) * aNormal);
  vColor = aColor;
  vStyle = aStyle;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec4 vStyle;
uniform vec3 uLight;
uniform vec3 uLightColor;
uniform vec3 uBackground;
uniform float uAmbient;
uniform float uShadowAlpha;
uniform bool uShadow;
out vec4 color;
void main() {
  float fog = vStyle.x;
  if (uShadow) {
    color = vec4(0.08, 0.13, 0.17, uShadowAlpha * (1.0 - fog * 0.65));
    return;
  }
  float incidence = max(0.0, dot(normalize(vNormal), uLight));
  float band = incidence < 0.25 ? 0.48 : (incidence < 0.7 ? 0.76 : 1.0);
  vec3 lit = vColor * (uAmbient + (1.0 - uAmbient) * band);
  lit *= mix(vec3(1.0), uLightColor, 0.65);
  lit += vColor * vStyle.z;
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
  | "background"
  | "ambient"
  | "shadowAlpha"
  | "shadow",
  WebGLUniformLocation | null
>;

/** Bounded solid-mesh WebGL2 presentation; owns no game state or React updates. */
export class MapRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private uniforms: Uniforms | undefined;
  private meshes = new Map<MapMesh, GpuMesh>();
  private passes = emptyPasses();
  private motionItems: RenderItem[] = [];
  private projection: Float32Array = new Float32Array(16);
  private instances: readonly MapInstance[] = [];
  private frame: MapFrame | undefined;
  private clock = new FacilityMotionClock();
  private raf: number | undefined;
  private state: State = "unavailable";
  private disposed = false;
  private readyPending = false;
  private frames = 0;
  private drawCalls = 0;
  private triangles = 0;
  private sceneInstanceCount = 0;
  private instanceCount = 0;
  private poseRevision = 0;
  private light: Vec3 = [0, 1, 0];
  // CPU preparation/submission duration; this does not measure GPU completion.
  private frameMs = 0;
  private sampleDiagnostics = (includeScene = false) =>
    this.diagnostics(includeScene);

  constructor(
    private canvas: MapCanvas,
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
    const sceneChanged =
      this.instances !== instances ||
      !previous ||
      previous.width !== frame.width ||
      previous.height !== frame.height ||
      previous.cameraX !== frame.cameraX ||
      previous.cameraY !== frame.cameraY ||
      previous.scale !== frame.scale;
    this.instances = instances;
    this.frame = frame;
    this.projection = projectionMatrix(frame);
    this.clock.sync(instances);
    if (this.state === "ready" && sceneChanged) this.buildScene();
    if (!this.canAnimate()) this.clock.resetTimestamp();
    if (this.isVisible()) this.schedule();
    else this.cancelFrame();
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
      light: [...this.light],
      state: this.state,
      playbackRate: this.frame?.playbackRate ?? 0,
      motionAllowed: this.frame?.motionAllowed ?? false,
      visible: this.isVisible(),
      ...(includeScene ? { scene: this.sceneDiagnostics() } : {}),
    };
  }

  private sceneDiagnostics(): RendererSceneInstance[] {
    // Inspect the submitted passes, including their actual fog/pose data. This never rebuilds
    // the scene or reads game state, and the ordinary cheap sample never scans these vertices.
    const instances = new Map<MapInstance, RenderItem[]>();
    for (const batch of [
      ...this.passes.receivers,
      ...this.passes.opaque,
      ...this.passes.transparent,
    ])
      for (const item of batch.items) {
        const items = instances.get(item.instance) ?? [];
        items.push(item);
        instances.set(item.instance, items);
      }
    return Array.from(instances, ([instance, items]) => {
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      let triangles = 0;
      for (const { part, pose } of items) {
        const vertices = part.mesh.positions;
        triangles += vertices.length / 9;
        for (let i = 0; i < vertices.length; i += 3)
          for (let axis = 0; axis < 3; axis++) {
            const value =
              pose[axis] * vertices[i] +
              pose[axis + 4] * vertices[i + 1] +
              pose[axis + 8] * vertices[i + 2] +
              pose[axis + 12];
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
        motionKey: instance.motionKey,
        triangles,
        min: min as unknown as Vec3,
        max: max as unknown as Vec3,
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
      const shaders: WebGLShader[] = [];
      const program = gl.createProgram();
      if (!program) throw new Error("Map program allocation failed");
      this.program = program;
      try {
        for (const [type, source] of [
          [gl.VERTEX_SHADER, VERTEX],
          [gl.FRAGMENT_SHADER, FRAGMENT],
        ] as const) {
          const shader = gl.createShader(type);
          if (!shader) throw new Error("Map shader allocation failed");
          shaders.push(shader);
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            throw new Error("Map shader compilation failed");
          gl.attachShader(program, shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
          throw new Error("Map program link failed");
      } finally {
        for (const shader of shaders) gl.deleteShader(shader);
      }
      this.uniforms = {
        projection: gl.getUniformLocation(program, "uProjection"),
        light: gl.getUniformLocation(program, "uLight"),
        lightColor: gl.getUniformLocation(program, "uLightColor"),
        background: gl.getUniformLocation(program, "uBackground"),
        ambient: gl.getUniformLocation(program, "uAmbient"),
        shadowAlpha: gl.getUniformLocation(program, "uShadowAlpha"),
        shadow: gl.getUniformLocation(program, "uShadow"),
      };
    } catch (_error) {
      this.releaseResources(true);
      this.setState("unavailable");
      return;
    }
    // Notify the host only after a real clear/draw, so fallback art never
    // disappears between context creation and the first painted frame.
    this.state = "ready";
    this.readyPending = true;
    this.buildScene();
    this.schedule();
  }

  private contextLost = (event: Event): void => {
    event.preventDefault();
    this.cancelFrame();
    this.releaseResources(false);
    this.setState("lost");
  };

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

  private canAnimate(): boolean {
    return (
      this.isVisible() &&
      !!this.frame?.motionAllowed &&
      (this.frame?.playbackRate ?? 0) > 0 &&
      this.motionItems.length > 0
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
  }

  private animate = (timestamp: number): void => {
    this.raf = undefined;
    if (!this.isVisible() || this.disposed || this.state !== "ready") return;
    const moving = this.canAnimate();
    this.clock.tick(timestamp, moving, this.frame?.playbackRate ?? 0);
    try {
      this.draw(moving);
    } catch (_error) {
      this.fail();
      return;
    }
    if (moving) this.schedule();
  };

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
      for (let column = 0; column < 5; column++) {
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

  private buildScene(): void {
    if (!this.frame || !this.gl) return;
    const frame = this.frame;
    const used = new Set<MapMesh>();
    const grouped = {
      receivers: new Map<GpuMesh, RenderItem[]>(),
      opaque: new Map<GpuMesh, RenderItem[]>(),
      shadows: new Map<GpuMesh, RenderItem[]>(),
      transparent: new Map<GpuMesh, RenderItem[]>(),
    };
    this.motionItems = [];
    this.sceneInstanceCount = 0;
    try {
      for (const instance of this.instances) {
        const center = projectPoint(instance.position, frame);
        // Include offscreen tall models and the maximum three-tile shadow reach.
        const margin =
          (3 + Math.max(instance.model.height, instance.model.footprint)) *
          HEX_WIDTH *
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
        angle = phase;
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
    pose[13] = instance.position[1] + (part.position?.[1] ?? 0) + rise;
    pose[14] = instance.position[2] + (part.position?.[2] ?? 0);
    pose[16] = FOG_MIX[instance.fog];
    pose[17] = alpha;
    pose[18] = glow;
    pose[19] = FOG_SATURATION[instance.fog];
  }

  private draw(moving: boolean): void {
    const gl = this.gl,
      frame = this.frame,
      uniforms = this.uniforms;
    if (!gl || !frame || !uniforms || frame.width <= 0 || frame.height <= 0)
      return;
    const started = performance.now();
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
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.clearColor(...frame.background, 1);
    gl.clearDepth(1);
    gl.clearStencil(0);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.stencilMask(0xff);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(uniforms.projection, false, this.projection);
    gl.uniform3f(uniforms.light, ...frame.lighting.direction);
    gl.uniform3f(uniforms.lightColor, ...frame.lighting.color);
    gl.uniform3f(uniforms.background, ...frame.background);
    gl.uniform1f(uniforms.ambient, frame.lighting.ambient);
    gl.uniform1f(uniforms.shadowAlpha, frame.lighting.shadow);
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
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    this.frames++;
    this.light = frame.lighting.direction;
    this.instanceCount = this.sceneInstanceCount;
    this.frameMs = performance.now() - started;
    if (this.readyPending) {
      this.readyPending = false;
      this.setState("ready");
    }
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
    this.cancelFrame();
    this.releaseResources(true);
    this.readyPending = false;
    this.setState("unavailable");
  }

  private releaseResources(deleteGpu: boolean): void {
    if (deleteGpu) {
      for (const mesh of this.meshes.values()) this.deleteMesh(mesh);
      if (this.program) this.gl?.deleteProgram(this.program);
    }
    this.meshes.clear();
    this.program = null;
    this.uniforms = undefined;
    this.passes = emptyPasses();
    this.motionItems = [];
  }
}

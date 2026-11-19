import { TICK_MS } from "../../../Constants";
import { MeshBuilder } from "./MeshBuilder";
import { MapRenderer } from "./Renderer";
import { projectPoint } from "./Projection";
import { getStructureModel } from "./StructureModels";
import { getTerrainModel } from "./TerrainModels";
import type { MapCanvas, MapFrame, MapInstance, MapModel, Vec3 } from "./Types";

function mockContext() {
  let identity = 0;
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    DYNAMIC_DRAW: 7,
    FLOAT: 8,
    TRIANGLES: 9,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x100,
    STENCIL_BUFFER_BIT: 0x400,
    DEPTH_TEST: 10,
    LEQUAL: 11,
    CULL_FACE: 12,
    BLEND: 13,
    STENCIL_TEST: 14,
    ALWAYS: 15,
    KEEP: 16,
    REPLACE: 17,
    EQUAL: 18,
    INCR: 19,
    SRC_ALPHA: 20,
    ONE_MINUS_SRC_ALPHA: 21,
    NO_ERROR: 0,
    OUT_OF_MEMORY: 0x0505,
    CONTEXT_LOST_WEBGL: 0x9242,
    getError: jest.fn((): number => 0),
    isContextLost: jest.fn(() => false),
    getContextAttributes: jest.fn(() => ({ stencil: true })),
    createProgram: jest.fn(() => ({ id: ++identity })),
    createShader: jest.fn(() => ({ id: ++identity })),
    createBuffer: jest.fn(() => ({ id: ++identity })),
    createVertexArray: jest.fn(() => ({ id: ++identity })),
    getShaderParameter: jest.fn(() => true),
    getProgramParameter: jest.fn(() => true),
    getUniformLocation: jest.fn((_program, name: string) => ({ name })),
    shaderSource: jest.fn(),
    compileShader: jest.fn(),
    attachShader: jest.fn(),
    linkProgram: jest.fn(),
    deleteShader: jest.fn(),
    deleteProgram: jest.fn(),
    deleteBuffer: jest.fn(),
    deleteVertexArray: jest.fn(),
    bindVertexArray: jest.fn(),
    bindBuffer: jest.fn(),
    bufferData: jest.fn(),
    bufferSubData: jest.fn(),
    enableVertexAttribArray: jest.fn(),
    vertexAttribPointer: jest.fn(),
    vertexAttribDivisor: jest.fn(),
    viewport: jest.fn(),
    clearColor: jest.fn(),
    clearDepth: jest.fn(),
    clearStencil: jest.fn(),
    clear: jest.fn(),
    colorMask: jest.fn(),
    depthMask: jest.fn(),
    stencilMask: jest.fn(),
    useProgram: jest.fn(),
    uniformMatrix4fv: jest.fn(),
    uniform3f: jest.fn(),
    uniform4f: jest.fn(),
    uniform1f: jest.fn(),
    uniform1i: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    depthFunc: jest.fn(),
    stencilFunc: jest.fn(),
    stencilOp: jest.fn(),
    blendFunc: jest.fn(),
    drawArraysInstanced: jest.fn(),
  };
  return gl;
}
const model: MapModel = {
  key: "test-wind",
  footprint: 0.6,
  height: 1,
  terminals: [[0, 0.5, 0]],
  parts: [
    {
      mesh: new MeshBuilder()
        .box([0, -0.02, 0], [1, 0.04, 1], [0.5, 0.7, 0.5])
        .build(),
      receivesShadow: true,
    },
    {
      mesh: new MeshBuilder()
        .box([0, 0.5, 0], [0.1, 1, 0.1], [0.8, 0.8, 0.8])
        .build(),
      castsShadow: true,
      motion: "rotor",
    },
    {
      mesh: new MeshBuilder()
        .box([0, 0.9, 0], [0.1, 0.1, 0.1], [0.8, 0.8, 0.8])
        .build(),
      motion: "steam",
      hideWhenInactive: true,
    },
  ],
};
const scene = (active = true): MapInstance[] =>
  [0, 1].map((x) => ({
    id: `tile-${x}`,
    motionKey: `facility-${x}`,
    model,
    position: [x, 0, 0],
    active,
    fog: x === 0 ? 0 : 3,
  }));
const frame: MapFrame = {
  width: 390,
  height: 720,
  dpr: 3,
  cameraX: 0,
  cameraY: 0,
  scale: 0.75,
  background: [0.2, 0.3, 0.4],
  lighting: {
    direction: [0.4, 0.8, -0.4],
    color: [1, 0.95, 0.82],
    ambient: 0.5,
    shadow: 0.2,
  },
  visible: true,
  motionAllowed: true,
  playbackRate: 1,
};
let callbacks: Map<number, FrameRequestCallback>,
  nextFrame: number,
  hidden: boolean;
function flush(timestamp: number) {
  const pending = [...callbacks.values()];
  callbacks.clear();
  for (const callback of pending) callback(timestamp);
}
function setup(gl = mockContext()) {
  const canvas = document.createElement("canvas") as MapCanvas;
  jest
    .spyOn(canvas, "getContext")
    .mockReturnValue(gl as unknown as WebGL2RenderingContext);
  const state = jest.fn();
  const renderer = new MapRenderer(canvas, state);
  return { canvas, gl, state, renderer };
}
beforeEach(() => {
  callbacks = new Map();
  nextFrame = 0;
  hidden = false;
  jest.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callbacks.set(++nextFrame, callback);
    return nextFrame;
  });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    callbacks.delete(id);
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});
it.each(["wind", "offshore-wind"] as const)(
  "turns the actual %s mesh clockwise from its upwind hub and shares its shadow pose",
  (kind) => {
    const { renderer, gl } = setup(),
      wind = getStructureModel(kind),
      rotor = wind.parts.find((part) => part.motion === "rotor")!,
      drawn: { vao: unknown; shadow: boolean; vertices: number }[] = [];
    let vao: unknown,
      shadow = false;
    gl.bindVertexArray.mockImplementation((value) => {
      vao = value;
    });
    gl.uniform1i.mockImplementation((uniform, value) => {
      if (uniform?.name === "uShadow") shadow = value === 1;
    });
    gl.drawArraysInstanced.mockImplementation((_mode, _start, vertices) => {
      drawn.push({ vao, shadow, vertices });
    });
    renderer.update([{ ...scene()[0], model: wind }], frame);
    flush(0);
    gl.bufferSubData.mockClear();
    drawn.length = 0;
    const phase = 0.2;
    flush((phase * 8000) / (Math.PI * 2));
    expect(renderer.diagnostics().phases["facility-0"]).toBeCloseTo(phase);
    // The opaque rotor and its shadow reuse one uploaded instance matrix.
    expect(gl.bufferSubData).toHaveBeenCalledTimes(1);
    const pose = gl.bufferSubData.mock.calls[0][2] as Float32Array;
    expect(pose[1]).toBeCloseTo(-Math.sin(phase));
    expect(pose[4]).toBeCloseTo(Math.sin(phase));
    const rotorDraws = drawn.filter(
      (draw) => draw.vertices === rotor.mesh.positions.length / 3,
    );
    expect(rotorDraws).toEqual([
      {
        vao: expect.anything(),
        shadow: false,
        vertices: rotor.mesh.positions.length / 3,
      },
      {
        vao: rotorDraws[0].vao,
        shadow: true,
        vertices: rotor.mesh.positions.length / 3,
      },
    ]);
    let tip: Vec3 = [0, 0, 0];
    for (let i = 0; i < rotor.mesh.positions.length; i += 3)
      if (rotor.mesh.positions[i + 1] > tip[1])
        tip = [
          rotor.mesh.positions[i],
          rotor.mesh.positions[i + 1],
          rotor.mesh.positions[i + 2],
        ];
    const initial = projectPoint(
        [
          tip[0] + rotor.position![0],
          tip[1] + rotor.position![1],
          tip[2] + rotor.position![2],
        ],
        frame,
      ),
      moved = projectPoint(
        [
          pose[0] * tip[0] + pose[4] * tip[1] + pose[12],
          pose[1] * tip[0] + pose[5] * tip[1] + pose[13],
          tip[2] + pose[14],
        ],
        frame,
      );
    expect(moved.x).toBeGreaterThan(initial.x + 4);
    renderer.dispose();
  },
);
it("batches actual geometry, caps physical resolution, reuses buffers and exposes read-only samples", () => {
  const { renderer, canvas, gl, state } = setup();
  expect(state).not.toHaveBeenCalled();
  renderer.update(scene(), frame);
  flush(0);
  expect(state).toHaveBeenCalledTimes(1);
  expect(state).toHaveBeenLastCalledWith("ready");
  expect(canvas.width).toBe(585);
  expect(canvas.height).toBe(1080);
  expect(gl.drawArraysInstanced.mock.calls.map((call) => call[3])).toEqual([
    2, 2, 2, 2,
  ]);
  expect(gl.stencilFunc).toHaveBeenCalledWith(gl.EQUAL, 1, 0xff);
  expect(gl.stencilOp).toHaveBeenCalledWith(gl.KEEP, gl.KEEP, gl.INCR);
  expect(canvas.map3DDiagnostics?.()).toMatchObject({
    frames: 1,
    drawCalls: 4,
    triangles: 96,
    meshCount: 3,
    instanceCount: 2,
    light: frame.lighting.direction,
    state: "ready",
  });
  expect(
    Object.getOwnPropertyDescriptor(canvas, "map3DDiagnostics")?.writable,
  ).toBe(false);
  const allocations = gl.bufferData.mock.calls.length;
  const initialPose = Array.from(
    gl.bufferSubData.mock.calls[1][2] as Float32Array,
  );
  flush(1000);
  expect(
    Array.from(gl.bufferSubData.mock.calls[3][2] as Float32Array),
  ).not.toEqual(initialPose);
  expect(gl.bufferData).toHaveBeenCalledTimes(allocations);
  expect(renderer.diagnostics().phases["facility-0"]).toBeGreaterThan(0);
  renderer.dispose();
  expect(canvas.map3DDiagnostics).toBeUndefined();
  expect(callbacks.size).toBe(0);
  expect(gl.deleteBuffer).toHaveBeenCalledTimes(6);
  expect(gl.deleteVertexArray).toHaveBeenCalledTimes(3);
  expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  renderer.dispose();
  expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
});
it("samples submitted geometry and GPU instance styles only when explicitly requested", () => {
  const { renderer, canvas } = setup();
  const connections = [
    {
      from: "a",
      to: "b",
      kind: "overhead" as const,
      start: [0, 0.5, 0] as const,
      end: [1, 0.5, 0] as const,
      lowY: 0.4,
    },
  ];
  const instances = scene(false);
  instances[0] = { ...instances[0], model: { ...model, connections } };
  renderer.update(instances, frame);
  flush(0);
  expect(renderer.diagnostics().scene).toBeUndefined();
  const diagnostic = canvas.map3DDiagnostics!(true);
  expect(diagnostic.cpuFrameMs).toBe(diagnostic.frameMs);
  expect(diagnostic).toMatchObject({
    playbackRate: 1,
    motionAllowed: true,
    visible: true,
  });
  expect(diagnostic.scene).toHaveLength(2);
  expect(diagnostic.scene![0]).toMatchObject({
    id: "tile-0",
    modelKey: "test-wind",
    triangles: 24,
    active: false,
    min: [-0.5, expect.any(Number), -0.5],
    max: [0.5, 1, 0.5],
    fogMix: 0,
    saturation: 1,
    connections,
  });
  expect(diagnostic.scene![1].min[0]).toBe(0.5);
  expect(diagnostic.scene![1].fogMix).toBeCloseTo(0.6);
  expect(diagnostic.scene![1].saturation).toBeCloseTo(0.15);
  expect(diagnostic.scene![0].connections![0].start).not.toBe(
    connections[0].start,
  );
  renderer.update(instances, { ...frame, cameraX: 100000 });
  flush(1);
  expect(renderer.diagnostics(true).scene).toEqual([]);
  renderer.dispose();
});
it("draws idle/reduced scenes once, retains stopped poses and suspends hidden documents", () => {
  const { renderer, gl } = setup();
  renderer.update(scene(), frame);
  flush(0);
  flush(1000);
  const phase = renderer.diagnostics().phases["facility-0"];
  renderer.update(scene(false), frame);
  flush(2000);
  expect(callbacks.size).toBe(0);
  expect(renderer.diagnostics().phases["facility-0"]).toBe(phase);
  expect(renderer.diagnostics().drawCalls).toBe(3);
  renderer.update(scene(), { ...frame, motionAllowed: false });
  flush(3000);
  expect(callbacks.size).toBe(0);
  expect(renderer.diagnostics().phases["facility-0"]).toBe(phase);
  renderer.update(scene(), frame);
  flush(4000);
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(callbacks.size).toBe(0);
  const draws = gl.drawArraysInstanced.mock.calls.length;
  renderer.update(scene(), {
    ...frame,
    lighting: { ...frame.lighting, direction: [-0.4, 0.8, 0.4] },
  });
  flush(900000);
  expect(gl.drawArraysInstanced).toHaveBeenCalledTimes(draws);
  expect(renderer.diagnostics().light).toEqual(frame.lighting.direction);
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  document.dispatchEvent(new Event("visibilitychange"));
  flush(1000000);
  expect(renderer.diagnostics().phases["facility-0"]).toBe(phase);
  flush(1001000);
  expect(renderer.diagnostics().phases["facility-0"]).toBeGreaterThan(phase);
  renderer.dispose();
});
it("keeps the idle canvas asleep when React recreates equivalent frame inputs", () => {
  const { renderer, gl } = setup();
  const instances = scene(false);
  const idleFrame = {
    ...frame,
    weather: {
      rain: 0,
      snowfall: 0,
      cloud: 0.4,
      wind: 0.3,
      waterLevel: 0.5,
      snowpack: 0,
    },
  };
  renderer.update(instances, idleFrame);
  flush(0);
  gl.drawArraysInstanced.mockClear();

  renderer.update(instances, {
    ...idleFrame,
    background: [...idleFrame.background],
    lighting: {
      ...idleFrame.lighting,
      direction: [...idleFrame.lighting.direction],
    },
    weather: { ...idleFrame.weather, rain: 0.1 },
  });
  flush(16);
  expect(gl.drawArraysInstanced).not.toHaveBeenCalled();
  expect(renderer.diagnostics().frames).toBe(1);

  renderer.update(instances, { ...idleFrame, cameraX: 5 });
  flush(32);
  expect(renderer.diagnostics().frames).toBe(2);
  renderer.dispose();
});

it("uploads only the latest visible scene when several updates arrive before paint", () => {
  const { renderer, gl } = setup();
  const first = scene(false);
  const latest = [{ ...first[0], id: "latest" }];
  renderer.update(first, frame);
  renderer.update(latest, { ...frame, cameraX: 100, visible: false });
  flush(0);
  expect(gl.createBuffer).not.toHaveBeenCalled();

  renderer.update(first, frame);
  renderer.update(latest, frame);
  expect(callbacks.size).toBe(1);
  expect(gl.createBuffer).not.toHaveBeenCalled();
  flush(16);
  expect(gl.bufferSubData).toHaveBeenCalledTimes(2);
  expect(renderer.diagnostics(true).scene?.map(({ id }) => id)).toEqual([
    "latest",
  ]);
  renderer.dispose();
});

it.each([TICK_MS.SLOW, TICK_MS.NORMAL])(
  "moves light and shadows between updates at a %i ms tick interval",
  (lightingTransitionMs) => {
    const { renderer, gl } = setup();
    const instances = scene(false);
    const before = { ...frame, lightingTransitionMs };
    renderer.update(instances, before);
    flush(0);
    expect(callbacks.size).toBe(0);

    jest.spyOn(performance, "now").mockReturnValue(1000);
    const after: MapFrame = {
      ...before,
      lighting: { ...frame.lighting, direction: [0, 1, 0], shadow: 0.3 },
    };
    renderer.update(instances, after);
    flush(1000 + lightingTransitionMs / 4);
    const first = renderer.diagnostics().light;
    expect(first[0]).toBeLessThan(before.lighting.direction[0]);
    expect(first[0]).toBeGreaterThan(after.lighting.direction[0]);
    const shadows = gl.uniform1f.mock.calls.filter(
      ([uniform]) => uniform.name === "uShadowAlpha",
    );
    expect(shadows[shadows.length - 1][1]).toBeCloseTo(0.225);

    // Changing camera position during the same simulation tick retains the transition.
    renderer.update(instances, {
      ...after,
      cameraX: 5,
      lighting: { ...after.lighting },
    });
    flush(1000 + lightingTransitionMs / 2);
    expect(renderer.diagnostics().light[0]).toBeLessThan(first[0]);
    flush(1000 + lightingTransitionMs);
    expect(renderer.diagnostics().light).toEqual(after.lighting.direction);
    expect(callbacks.size).toBe(0);
    renderer.dispose();
  },
);
it.each([false, true])(
  "holds the painted sky when paused during a lighting transition (hidden: %s)",
  (hide) => {
    const { renderer } = setup();
    const instances = scene(false);
    const before = { ...frame, lightingTransitionMs: TICK_MS.SLOW };
    renderer.update(instances, before);
    flush(0);

    const after: MapFrame = {
      ...before,
      lighting: { ...frame.lighting, direction: [0, 1, 0] },
    };
    jest.spyOn(performance, "now").mockReturnValue(1000);
    renderer.update(instances, after);
    flush(1050);
    const light = renderer.diagnostics().light;
    if (hide) {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    }
    renderer.update(instances, { ...after, lightingTransitionMs: undefined });
    if (hide) {
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    }
    flush(1200);
    expect(renderer.diagnostics().light).toEqual(light);
    expect(callbacks.size).toBe(0);
    renderer.dispose();
  },
);
it("rebuilds lost GPU resources and notifies readiness only after restored drawing", () => {
  const { renderer, canvas, gl, state } = setup();
  renderer.update(scene(), frame);
  flush(0);
  flush(1000);
  const phase = renderer.diagnostics().phases["facility-0"];
  const lost = new Event("webglcontextlost", { cancelable: true });
  canvas.dispatchEvent(lost);
  expect(lost.defaultPrevented).toBe(true);
  expect(callbacks.size).toBe(0);
  expect(state).toHaveBeenLastCalledWith("lost");
  expect(renderer.diagnostics().meshCount).toBe(0);
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  expect(state).toHaveBeenLastCalledWith("lost");
  expect(gl.createProgram).toHaveBeenCalledTimes(2);
  expect(gl.createBuffer).toHaveBeenCalledTimes(6);
  flush(1000000);
  expect(gl.createBuffer).toHaveBeenCalledTimes(12);
  expect(state).toHaveBeenLastCalledWith("ready");
  expect(renderer.diagnostics().phases["facility-0"]).toBe(phase);
  renderer.dispose();
});
it("fails gracefully without WebGL2 or when shader compilation fails", () => {
  const canvas = document.createElement("canvas") as MapCanvas;
  jest.spyOn(canvas, "getContext").mockReturnValue(null);
  const state = jest.fn(),
    renderer = new MapRenderer(canvas, state);
  renderer.update(scene(), frame);
  expect(state).toHaveBeenCalledWith("unavailable");
  expect(callbacks.size).toBe(0);
  renderer.dispose();
  const gl = mockContext();
  gl.getShaderParameter.mockReturnValue(false);
  const broken = setup(gl);
  expect(broken.state).toHaveBeenCalledWith("unavailable");
  expect(gl.deleteShader).toHaveBeenCalledTimes(1);
  expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  broken.renderer.dispose();
});

it("bounds inactive GPU caches while keeping the current visible geometry", () => {
  const { renderer, gl } = setup();
  for (let i = 0; i < 150; i++) {
    const mesh = new MeshBuilder()
      .box([0, 0.2, 0], [0.2, 0.4, 0.2], [0.5, 0.6, 0.7])
      .build();
    renderer.update(
      [
        {
          ...scene(false)[0],
          model: { ...model, key: `variant-${i}`, parts: [{ mesh }] },
        },
      ],
      frame,
    );
    flush(i * 16);
  }
  expect(renderer.diagnostics().meshCount).toBeLessThanOrEqual(65);
  expect(renderer.diagnostics().instanceCount).toBe(1);
  expect(renderer.diagnostics().drawCalls).toBe(1);
  expect(gl.deleteBuffer.mock.calls.length).toBeGreaterThan(0);
  renderer.dispose();
  expect(gl.deleteBuffer).toHaveBeenCalledTimes(
    gl.createBuffer.mock.calls.length,
  );
  expect(gl.deleteVertexArray).toHaveBeenCalledTimes(
    gl.createVertexArray.mock.calls.length,
  );
});

it("stops requesting frames when active models are offscreen or the surface has no size", () => {
  const { renderer } = setup();
  renderer.update(
    [scene(false)[0], { ...scene()[1], position: [100, 0, 100] }],
    frame,
  );
  flush(0);
  expect(renderer.diagnostics().instanceCount).toBe(1);
  expect(callbacks.size).toBe(0);
  renderer.update(scene(), { ...frame, width: 0 });
  expect(callbacks.size).toBe(0);
  renderer.update(scene(), frame);
  flush(1000000);
  expect(renderer.diagnostics().phases["facility-0"]).toBe(0);
  expect(callbacks.size).toBe(1);
  renderer.dispose();
});

it("retains static uploads across animation and lighting-only updates", () => {
  const { renderer, gl } = setup();
  const instances = scene();
  renderer.update(instances, frame);
  flush(0);
  // Receivers, the shared opaque/shadow batch, and steam upload once each.
  expect(gl.bufferSubData).toHaveBeenCalledTimes(3);
  flush(1000);
  expect(gl.bufferSubData).toHaveBeenCalledTimes(5);
  renderer.update(instances, { ...frame, motionAllowed: false });
  flush(2000);
  const uploads = gl.bufferSubData.mock.calls.length;
  renderer.update(instances, {
    ...frame,
    motionAllowed: false,
    lighting: { ...frame.lighting, direction: [-0.4, 0.8, 0.4] },
  });
  flush(3000);
  expect(gl.bufferSubData).toHaveBeenCalledTimes(uploads);
  expect(renderer.diagnostics().light).toEqual([-0.4, 0.8, 0.4]);
  expect(callbacks.size).toBe(0);
  renderer.dispose();
});

it("releases resources and exposes fallback when a frame upload fails", () => {
  const { renderer, gl, state } = setup();
  renderer.update(scene(), frame);
  gl.bufferSubData.mockImplementationOnce(() => {
    throw new Error("GPU upload failed");
  });
  expect(() => flush(0)).not.toThrow();
  expect(state).toHaveBeenLastCalledWith("unavailable");
  expect(renderer.diagnostics().meshCount).toBe(0);
  expect(callbacks.size).toBe(0);
  expect(gl.deleteBuffer).toHaveBeenCalledTimes(6);
  expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  renderer.dispose();
  expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
});

it("keeps the fallback and discards buffers after an allocation reports OUT_OF_MEMORY", () => {
  const { renderer, gl, state } = setup();
  gl.bufferData.mockImplementation((_target, _data, usage) => {
    if (usage === gl.DYNAMIC_DRAW)
      gl.getError.mockReturnValue(gl.OUT_OF_MEMORY);
  });
  renderer.update(scene(), frame);
  flush(0);
  expect(state.mock.calls).toEqual([["unavailable"]]);
  expect(renderer.diagnostics().meshCount).toBe(0);
  expect(gl.deleteBuffer).toHaveBeenCalledTimes(6);
  expect(callbacks.size).toBe(0);
  renderer.dispose();
});

it("can restore a context lost during the first buffer upload", () => {
  const { renderer, canvas, gl, state } = setup();
  gl.bufferSubData.mockImplementationOnce(() => {
    gl.getError.mockReturnValueOnce(gl.CONTEXT_LOST_WEBGL);
    gl.isContextLost.mockReturnValueOnce(true);
  });
  renderer.update(scene(), frame);
  flush(0);
  expect(state.mock.calls).toEqual([["lost"]]);
  expect(gl.deleteBuffer).not.toHaveBeenCalled();
  const lost = new Event("webglcontextlost", { cancelable: true });
  canvas.dispatchEvent(lost);
  expect(lost.defaultPrevented).toBe(true);
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  flush(1000);
  expect(state.mock.calls).toEqual([["lost"], ["ready"]]);
  renderer.dispose();
});

it("keeps distinct caster subsets correct when a mesh is shared across passes", () => {
  const { renderer, gl } = setup();
  const mesh = model.parts[1].mesh;
  const sharedModel: MapModel = {
    ...model,
    parts: [
      { mesh, castsShadow: true, position: [-0.2, 0, 0] },
      { mesh, position: [0.2, 0, 0] },
    ],
  };
  renderer.update([{ ...scene(false)[0], model: sharedModel }], frame);
  flush(0);
  expect(gl.drawArraysInstanced.mock.calls.map((call) => call[3])).toEqual([
    2, 1,
  ]);
  expect(
    gl.bufferSubData.mock.calls.map((call) => (call[2] as Float32Array).length),
  ).toEqual([48, 24]);
  renderer.update([{ ...scene(false)[0], model: sharedModel }], frame);
  flush(1000);
  expect(gl.drawArraysInstanced.mock.calls.map((call) => call[3])).toEqual([
    2, 1, 2, 1,
  ]);
  expect(gl.bufferSubData).toHaveBeenCalledTimes(4);
  renderer.dispose();
});

it("releases partially initialized geometry when a vertex upload fails", () => {
  const { renderer, gl, state } = setup();
  gl.bufferData.mockImplementationOnce(() => {
    throw new Error("GPU vertex upload failed");
  });
  renderer.update(scene(), frame);
  expect(() => flush(0)).not.toThrow();
  expect(state).toHaveBeenLastCalledWith("unavailable");
  expect(gl.deleteBuffer).toHaveBeenCalledTimes(2);
  expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
  expect(callbacks.size).toBe(0);
  renderer.dispose();
});

it("batches explicit facility materials, lights only producing windows, and preserves fog", () => {
  const { renderer, gl } = setup();
  const mesh = model.parts[0].mesh;
  const materials: MapModel = {
    ...model,
    parts: [
      { mesh, material: "facility-surface" },
      { mesh, material: "facility-window" },
      { mesh },
    ],
  };
  let allocations: number | undefined;
  for (const fog of [0, 3] as const) {
    let idleSaturation = 0;
    for (const state of [
      { active: false, producing: false },
      { active: true, producing: false },
      { active: true, producing: true },
    ]) {
      renderer.update(
        [{ ...scene()[0], ...state, fog, model: materials }],
        frame,
      );
      gl.bufferSubData.mockClear();
      flush(0);
      expect(gl.bufferSubData).toHaveBeenCalledTimes(1);
      const pose = gl.bufferSubData.mock.calls[0][2] as Float32Array;
      const surface = pose.subarray(0, 24),
        window = pose.subarray(24, 48),
        ordinary = pose.subarray(48, 72);
      if (!state.active) idleSaturation = surface[19];
      expect(surface[19] - idleSaturation).toBeGreaterThanOrEqual(
        state.active ? 0.01 : 0,
      );
      expect(surface[20]).toBe(0);
      expect(window[20]).toBe(state.producing ? 1 : 0);
      expect(ordinary[19]).toBeCloseTo(fog === 0 ? 1 : 0.15);
      expect(ordinary[20]).toBe(0);
      expect(ordinary[21]).toBe(1);
      expect(surface[16]).toBeCloseTo(fog === 0 ? 0 : 0.6);
      expect(surface[19]).toBeLessThanOrEqual(fog === 0 ? 1.31 : 0.151);
      expect(renderer.diagnostics(true).scene![0].producing).toBe(
        state.producing,
      );
      expect(renderer.diagnostics().drawCalls).toBe(1);
      expect(renderer.diagnostics().meshCount).toBe(1);
      expect(callbacks.size).toBe(0);
      allocations ??= gl.bufferData.mock.calls.length;
      expect(gl.bufferData).toHaveBeenCalledTimes(allocations);
    }
  }
  renderer.dispose();
});

it("retains the motion phase while charging switches to discharge and materials rebuild", () => {
  const { renderer } = setup();
  const charging = { ...scene()[0], active: true, producing: false };
  renderer.update([charging], frame);
  flush(0);
  flush(1000);
  const phase = renderer.diagnostics().phases["facility-0"];
  expect(phase).toBeGreaterThan(0);
  renderer.update([{ ...charging, producing: true }], {
    ...frame,
    playbackRate: 0.7,
  });
  flush(2000);
  expect(renderer.diagnostics().phases["facility-0"]).toBeCloseTo(
    phase + (0.7 * Math.PI * 2) / 8,
  );
  renderer.dispose();
});

it("raises river and lake water in the same draw passes when the watershed gets wetter", () => {
  const { renderer, gl } = setup();
  const instances: MapInstance[] = (["lake", "river", "ocean"] as const).map(
    (kind, index) => ({
      id: kind,
      model: getTerrainModel(kind),
      position: [index, 0, 0],
      active: false,
      fog: 0,
    }),
  );
  const weather = {
    rain: 0,
    snowfall: 0,
    cloud: 0.4,
    wind: 0.25,
    waterLevel: 0,
    snowpack: 0.2,
  };
  renderer.update(instances, { ...frame, weather: weather });
  flush(0);
  const dry = renderer.diagnostics(true);
  const surfaces = (stats: typeof dry) =>
    stats.scene!.map(
      ({ id, waterSurfaceY }) => [id, waterSurfaceY?.[0]] as const,
    );
  const dryLevels = Object.fromEntries(surfaces(dry));
  expect(dryLevels.lake).toBeCloseTo(-0.045);
  expect(dryLevels.river).toBeCloseTo(dryLevels.lake!);
  expect(dryLevels.ocean).toBe(0);
  expect(gl.uniform4f).toHaveBeenCalledWith(
    { name: "uWeather" },
    0.4,
    0.25,
    0,
    0.2,
  );

  gl.bufferSubData.mockClear();
  renderer.update(instances, {
    ...frame,
    weather: { ...weather, waterLevel: 1 },
  });
  expect(renderer.diagnostics(true).scene).toEqual(dry.scene);
  flush(100);
  const wet = renderer.diagnostics(true);
  const wetLevels = Object.fromEntries(surfaces(wet));
  expect(wetLevels.lake).toBeGreaterThan(dryLevels.lake! + 0.04);
  expect(wetLevels.river).toBeCloseTo(wetLevels.lake!);
  expect(wetLevels.ocean).toBe(dryLevels.ocean);
  expect(wet.drawCalls).toBe(dry.drawCalls);
  expect(gl.bufferSubData).not.toHaveBeenCalled();
  expect(callbacks.size).toBe(0);
  renderer.dispose();
});

it("provides the last submitted camera and instances while a newer frame waits to draw", () => {
  const { renderer } = setup();
  const original = scene(false);
  const next = original.slice(1);
  const shifted = { ...frame, cameraX: 100 };
  renderer.update(original, frame);
  expect(renderer.getPaintedScene()).toBeUndefined();
  flush(0);
  renderer.update(next, shifted);
  expect(renderer.getPaintedScene()).toEqual({ frame, instances: original });
  flush(50);
  expect(renderer.getPaintedScene()).toEqual({
    frame: shifted,
    instances: next,
  });
  renderer.dispose();
  expect(renderer.getPaintedScene()).toBeUndefined();
});

it("raises real Hydro and upper Pumped Hydro water while lowering the lower basin", () => {
  const { renderer, gl } = setup();
  const instances: MapInstance[] = (["hydro", "pumped-hydro"] as const).map(
    (kind, index) => ({
      id: kind,
      model: getStructureModel(kind),
      position: [index, 0, 0],
      active: false,
      fog: 0,
      waterLevel: 0,
    }),
  );
  const staticTiles = scene(false);
  renderer.update([...staticTiles, ...instances], frame);
  flush(0);
  const water = () =>
    renderer
      .diagnostics(true)
      .scene!.flatMap(({ waterSurfaceY }) =>
        waterSurfaceY ? [waterSurfaceY] : [],
      );
  const empty = water();
  expect(empty.map((surfaces) => surfaces.length)).toEqual([1, 2]);

  gl.bufferSubData.mockClear();
  const filled = instances.map((instance) => ({ ...instance, waterLevel: 1 }));
  renderer.update([...staticTiles, ...filled], frame);
  flush(100);
  const full = water();
  expect(gl.bufferSubData).toHaveBeenCalledTimes(3);
  expect(full[0][0]).toBeGreaterThan(empty[0][0] + 0.18);
  expect(full[1][0]).toBeGreaterThan(empty[1][0] + 0.18);
  expect(full[1][1]).toBeLessThan(empty[1][1] - 0.04);

  gl.bufferSubData.mockClear();
  renderer.update([...staticTiles, instances[0], filled[1]], frame);
  flush(200);
  expect(water()).toEqual([empty[0], full[1]]);
  expect(gl.bufferSubData).toHaveBeenCalledTimes(1);
  renderer.dispose();
});

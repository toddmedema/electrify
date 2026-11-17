import { MeshBuilder } from "./MeshBuilder";
import { MapRenderer } from "./Renderer";
import type { MapCanvas, MapFrame, MapInstance, MapModel } from "./Types";

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
  expect(gl.createBuffer).toHaveBeenCalledTimes(12);
  flush(1000000);
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
  }
  flush(0);
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
  ).toEqual([40, 20]);
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
  expect(() => renderer.update(scene(), frame)).not.toThrow();
  expect(state).toHaveBeenLastCalledWith("unavailable");
  expect(gl.deleteBuffer).toHaveBeenCalledTimes(2);
  expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
  expect(callbacks.size).toBe(0);
  renderer.dispose();
});

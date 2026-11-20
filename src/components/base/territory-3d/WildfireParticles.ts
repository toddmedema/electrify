import { HEX_WIDTH } from "../TerritoryHexGeometry";
import { createMapProgram } from "./MapProgram";
import { CAMERA_COS, CAMERA_SIN, projectPoint } from "./Projection";
import type { MapFrame, MapInstance } from "./Types";
import {
  buildWildfireEmitters,
  fireVariation,
  isBurningTerrain,
  type BurningTerrain,
  type WildfireEmitter,
} from "./WildfireFront";

const MOBILE_WIDTH = 600;
const MOBILE_EMITTERS = 36;
const DESKTOP_EMITTERS = 60;
const PARTICLES_PER_EMITTER = 6;
const FLOATS_PER_PARTICLE = 8;
const CLOCK_SECONDS = 60;
const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aOrigin;
layout(location=2) in vec4 aParticle;
uniform mat4 uProjection;
uniform float uFireTime;
uniform float uWind;
uniform float uSizeLimit;
out mediump vec2 vShape;
flat out mediump vec4 vParticle;
flat out mediump float vFog;
void main() {
  float phase = aParticle.x, seed = aParticle.y, kind = aParticle.z;
  float strength = aOrigin.w;
  bool smoke = kind == 0.0, ember = kind == 2.0, base = kind == 3.0;
  // Each period fits the clock wheel an integer number of times, including at wrap.
  float cycles = floor(smoke ? mix(19.0, 25.0, seed) :
    (ember ? mix(33.0, 46.0, seed) : mix(51.0, 75.0, seed)));
  float age = fract(uFireTime * (cycles / ${CLOCK_SECONDS}.0) + phase);
  float life = smoothstep(0.0, 0.14, age) * (1.0 - smoothstep(0.49, 1.0, age));
  float shapeAge = base ? life * 0.58 : age;
  vec3 center = aOrigin.xyz;
  vec2 size;
  float opacity;
  if (smoke) {
    center.y += (0.18 + age * mix(0.21, 0.40, seed)) * strength;
    size = vec2(0.09 + 0.13 * age, 0.08 + 0.11 * age) * strength;
    opacity = 0.22 * life;
  } else if (ember) {
    center.y += (0.10 + 0.60 * age) * strength;
    size = vec2(0.009, 0.014) * mix(0.65, 1.35, seed);
    opacity = 0.8 * life;
  } else {
    center.y += (base ? 0.063 + 0.09 * shapeAge : 0.085 + age * mix(0.14, 0.29, seed)) * strength;
    size = vec2(mix(0.066, 0.136, seed), mix(0.102, 0.172, seed)) * strength * (1.04 - 0.48 * shapeAge);
    if (base) size *= vec2(1.18, 0.86);
    opacity = base ? (0.74 + life * 0.20) : 0.91 * life;
  }
  float wave = sin(shapeAge * 6.283 + phase * 23.0);
  float travel = shapeAge * shapeAge * (smoke || ember ? 1.0 : 0.25);
  center.xz += vec2(0.055 + 0.23 * uWind, -(0.028 + 0.08 * uWind)) * travel;
  center.xz += vec2(wave, sin(shapeAge * 4.0 + phase * 37.0)) * (0.019 + 0.06 * shapeAge) * (base ? 0.4 : 1.0);
  vec2 corner = aCorner * min(size, vec2(uSizeLimit));
  // A camera-facing quad with a physical X/Y/Z center. Shadows and solid geometry
  // share this projection and its depth buffer.
  center += vec3(corner.x, corner.y * ${CAMERA_COS}, -corner.y * ${CAMERA_SIN});
  gl_Position = uProjection * vec4(center, 1.0);
  vShape = aCorner;
  vParticle = vec4(kind, shapeAge, opacity, phase);
  vFog = aParticle.w;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 vShape;
flat in vec4 vParticle;
flat in float vFog;
uniform vec3 uBackground;
out vec4 color;
void main() {
  vec2 p = vShape;
  float kind = vParticle.x, age = vParticle.y, phase = vParticle.w;
  float alpha;
  vec3 tint;
  if (kind == 0.0) {
    // Two billowing lobes with a broken edge, fading before they obscure the board.
    float curl = sin(p.y * 7.4 + phase * 28.0 + age * 5.0);
    p.x += curl * 0.11;
    float edge = min(length((p - vec2(0.12, 0.14)) * vec2(1.22, 1.12)),
      length((p + vec2(0.23, 0.19)) * vec2(1.40, 1.63)));
    alpha = 1.0 - smoothstep(0.16, 0.99, edge + 0.05 * curl);
    tint = mix(vec3(0.20, 0.17, 0.16), vec3(0.42, 0.40, 0.39), age);
  } else if (kind == 2.0) {
    alpha = 1.0 - smoothstep(0.15, 0.96, length(p));
    tint = vec3(1.0, 0.68, 0.21);
  } else {
    float tip = smoothstep(-0.81, 0.93, p.y);
    float lick = sin(p.y * 4.7 + phase * 22.0 + age * 4.0);
    float center = lick * (0.09 + 0.23 * tip);
    float edge = length(vec2((p.x - center) / (1.16 - 0.79 * tip), (p.y + 0.12) * 0.98));
    edge += (sin(p.x * 12.0 - p.y * 18.0 + phase * 30.0 - age * 7.0) + lick) * 0.055;
    alpha = 1.0 - smoothstep(0.62, 0.99, edge);
    float heat = (1.0 - edge) * 0.87 - p.y * 0.27 - age * 0.22;
    tint = mix(vec3(0.76, 0.16, 0.052), vec3(1.0, 0.47, 0.075), smoothstep(0.10, 0.54, heat));
    tint = mix(tint, vec3(1.0, 0.91, 0.48), smoothstep(0.43, 0.86, heat));
  }
  if (alpha < 0.02) discard;
  color = vec4(mix(tint, uBackground, vFog), alpha * vParticle.z * (1.0 - vFog * 0.62));
}`;

interface FireGpu {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  quad: WebGLBuffer;
  instances: WebGLBuffer;
  projection: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  wind: WebGLUniformLocation | null;
  background: WebGLUniformLocation | null;
  sizeLimit: WebGLUniformLocation | null;
}

function createGpu(gl: WebGL2RenderingContext): FireGpu {
  const program = createMapProgram(gl, VERTEX, FRAGMENT);
  const vao = gl.createVertexArray();
  const quad = gl.createBuffer();
  const instances = gl.createBuffer();
  if (!vao || !quad || !instances) {
    gl.deleteProgram(program);
    gl.deleteVertexArray(vao);
    gl.deleteBuffer(quad);
    gl.deleteBuffer(instances);
    throw new Error("Wildfire particle buffer allocation failed");
  }
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    DESKTOP_EMITTERS * PARTICLES_PER_EMITTER * FLOATS_PER_PARTICLE * 4,
    gl.DYNAMIC_DRAW,
  );
  for (let attribute = 1; attribute <= 2; attribute++) {
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(
      attribute,
      4,
      gl.FLOAT,
      false,
      FLOATS_PER_PARTICLE * 4,
      (attribute - 1) * 16,
    );
    gl.vertexAttribDivisor(attribute, 1);
  }
  return {
    program,
    vao,
    quad,
    instances,
    projection: gl.getUniformLocation(program, "uProjection"),
    time: gl.getUniformLocation(program, "uFireTime"),
    wind: gl.getUniformLocation(program, "uWind"),
    background: gl.getUniformLocation(program, "uBackground"),
    sizeLimit: gl.getUniformLocation(program, "uSizeLimit"),
  };
}

const FOG = [0, 0.15, 0.35, 0.6];

export class WildfireParticles {
  private terrain: readonly MapInstance[] | undefined;
  private burning: BurningTerrain[] = [];
  private emitters: WildfireEmitter[] = [];
  private visible: WildfireEmitter[] = [];
  private data: Float32Array | undefined;
  private gpu: FireGpu | undefined;
  private upload = false;
  private time = 0;
  private timestamp: number | undefined;

  prepare(terrain: readonly MapInstance[], frame: MapFrame): void {
    if (terrain !== this.terrain) {
      this.terrain = terrain;
      const burning = terrain.filter(isBurningTerrain);
      if (
        burning.length !== this.burning.length ||
        burning.some((cell, i) => {
          const prior = this.burning[i];
          return (
            cell.wildfire !== prior.wildfire ||
            cell.position !== prior.position ||
            cell.fog !== prior.fog
          );
        })
      ) {
        this.burning = burning;
        this.emitters = buildWildfireEmitters(burning);
      }
    }
    if (!this.emitters.length && !this.visible.length) return;
    const scale = Math.abs(frame.scale) * HEX_WIDTH;
    const visible = this.emitters.filter(({ origin }) => {
      const { x, y } = projectPoint(origin, frame);
      return (
        x >= -0.48 * scale &&
        x <= frame.width + 0.26 * scale &&
        y >= -0.25 * scale &&
        y <= frame.height + 0.73 * scale
      );
    });
    const limit =
      frame.width <= MOBILE_WIDTH ? MOBILE_EMITTERS : DESKTOP_EMITTERS;
    if (visible.length > limit) {
      const distance = ({ origin }: WildfireEmitter) => {
        const { x, y } = projectPoint(origin, frame);
        return (x - frame.width / 2) ** 2 + (y - frame.height / 2) ** 2;
      };
      visible.sort((a, b) => distance(a) - distance(b));
      visible.length = limit;
    }
    const depth = ({ origin }: WildfireEmitter) =>
      origin[1] * CAMERA_SIN + origin[2] * CAMERA_COS;
    visible.sort((a, b) => depth(a) - depth(b));
    if (
      visible.length === this.visible.length &&
      visible.every((emitter, i) => emitter === this.visible[i])
    )
      return;
    this.visible = visible;
    if (!visible.length) return;
    this.data ??= new Float32Array(
      DESKTOP_EMITTERS * PARTICLES_PER_EMITTER * FLOATS_PER_PARTICLE,
    );
    let cursor = 0;
    // Submit smoke first, followed by glowing bases, free flames and stray embers.
    for (let slot = 0; slot < PARTICLES_PER_EMITTER; slot++) {
      const kind = slot === 0 ? 0 : slot === 1 ? 3 : slot === 5 ? 2 : 1;
      for (const { origin, strength, seed, fog } of visible) {
        this.data[cursor++] = origin[0];
        this.data[cursor++] = origin[1];
        this.data[cursor++] = origin[2];
        this.data[cursor++] = strength;
        this.data[cursor++] = fireVariation(seed, 41 + slot * 13);
        this.data[cursor++] = fireVariation(seed, 101 + slot * 13);
        this.data[cursor++] = kind;
        this.data[cursor++] = FOG[fog];
      }
    }
    this.upload = true;
  }

  get count(): number {
    return this.visible.length * PARTICLES_PER_EMITTER;
  }

  tick(timestamp: number, allowed: boolean, rate: number): void {
    if (!allowed || !this.count) {
      this.resetTimestamp();
      return;
    }
    const delta =
      this.timestamp === undefined
        ? 0
        : Math.max(0, timestamp - this.timestamp);
    this.timestamp = timestamp;
    this.time =
      (this.time + (Math.min(64, delta) * rate) / 1000) % CLOCK_SECONDS;
  }

  resetTimestamp(): void {
    this.timestamp = undefined;
  }

  diagnostics() {
    return {
      emitters: this.visible.length,
      particles: this.count,
      drawCalls: this.count && this.gpu ? 1 : 0,
      time: this.time,
    };
  }

  /** Submit after the solid passes, with depth testing and blending already enabled. */
  draw(
    gl: WebGL2RenderingContext,
    frame: MapFrame,
    projection: Float32Array,
  ): boolean {
    if (!this.count || !this.data) return false;
    this.gpu ??= createGpu(gl);
    const { program, vao, instances, time, wind, background, sizeLimit } =
      this.gpu;
    const uploaded = this.upload;
    gl.useProgram(program);
    gl.uniformMatrix4fv(this.gpu.projection, false, projection);
    gl.uniform1f(time, this.time);
    gl.uniform1f(wind, frame.weather?.wind ?? 0);
    gl.uniform3f(background, ...frame.background);
    gl.uniform1f(
      sizeLimit,
      (frame.width <= MOBILE_WIDTH ? 22 : 34) /
        (HEX_WIDTH * Math.max(0.01, frame.scale)),
    );
    gl.bindVertexArray(vao);
    if (uploaded) {
      gl.bindBuffer(gl.ARRAY_BUFFER, instances);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.data,
        0,
        this.count * FLOATS_PER_PARTICLE,
      );
      this.upload = false;
    }
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    return uploaded;
  }

  release(gl: WebGL2RenderingContext | null, deleteGpu: boolean): void {
    if (gl && this.gpu && deleteGpu) {
      gl.deleteVertexArray(this.gpu.vao);
      gl.deleteBuffer(this.gpu.quad);
      gl.deleteBuffer(this.gpu.instances);
      gl.deleteProgram(this.gpu.program);
    }
    this.gpu = undefined;
    this.visible = [];
    this.upload = true;
  }
}

import { Page } from "@playwright/test";

export interface FeedbackAudioAudit {
  decoded: Array<{ url: string; duration: number }>;
  starts: Array<{
    id: number;
    url: string;
    duration: number;
    peak: number;
    at: number;
  }>;
  stops: Array<{ id: number; at: number }>;
  contextStates: string[];
}

declare global {
  interface Window {
    feedbackAudioAudit: FeedbackAudioAudit;
  }
}

/** Observe native decoding/playback; preserve the real audio implementation. */
export async function auditFeedbackAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const audit = {
      decoded: [] as Array<{ url: string; duration: number }>,
      starts: [] as Array<{
        id: number;
        url: string;
        duration: number;
        peak: number;
        at: number;
      }>,
      stops: [] as Array<{ id: number; at: number }>,
      get contextStates() {
        return [...contexts].map((context) => context.state);
      },
    };
    window.feedbackAudioAudit = audit;
    const contexts = new Set<BaseAudioContext>();
    const inputs = new WeakMap<ArrayBuffer, string>();
    const buffers = new WeakMap<AudioBuffer, string>();
    const sources = new WeakMap<AudioBufferSourceNode, number>();
    let sequence = 0;
    const arrayBuffer = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = async function () {
      const result = await arrayBuffer.call(this);
      inputs.set(result, this.url);
      return result;
    };
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args) {
      const url = new URL(String(args[1]), document.baseURI).href;
      this.addEventListener("load", () => {
        if (this.response instanceof ArrayBuffer)
          inputs.set(this.response, url);
      });
      return Reflect.apply(open, this, args);
    } as typeof open;
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (
      input,
      success,
      failure,
    ) {
      contexts.add(this);
      const record = (buffer: AudioBuffer) => {
        if (!buffers.has(buffer)) {
          const url = inputs.get(input) || "";
          buffers.set(buffer, url);
          audit.decoded.push({ url, duration: buffer.duration });
        }
        return buffer;
      };
      return decode
        .call(
          this,
          input,
          (buffer) => {
            record(buffer);
            success?.(buffer);
          },
          failure,
        )
        .then(record);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      Reflect.apply(start, this, args);
      const buffer = this.buffer;
      if (!buffer) return;
      const id = ++sequence;
      sources.set(this, id);
      // Only inspect short cues, avoiding a scan over long music buffers.
      let peak = 0;
      if (buffer.duration <= 1)
        for (const value of buffer.getChannelData(0))
          peak = Math.max(peak, Math.abs(value));
      audit.starts.push({
        id,
        url: buffers.get(buffer) || "",
        duration: buffer.duration,
        peak,
        at: performance.now(),
      });
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (...args) {
      Reflect.apply(stop, this, args);
      const id = sources.get(this);
      if (id !== undefined) audit.stops.push({ id, at: performance.now() });
    };
  });
}

export async function feedbackAudio(page: Page): Promise<FeedbackAudioAudit> {
  return page.evaluate(() => window.feedbackAudioAudit);
}

export async function settleInput(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

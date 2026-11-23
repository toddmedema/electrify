import { expect, Page } from "./fixtures";

export async function expectOpeningMusic(page: Page, previousSources: number) {
  await expect
    .poll(() => page.evaluate(() => window.electrifyMusicStarts.length))
    .toBe(previousSources + 4);
  const [intro, ...stems] = await page.evaluate(
    (count) =>
      window.electrifyMusicPlayback.slice(count).map((entry) => ({
        startsAt: entry.startTime,
        duration: entry.source.buffer!.duration,
        loop: entry.source.loop,
        offset: entry.offset,
      })),
    previousSources,
  );
  expect(intro.duration).toBeCloseTo(29.3, 1);
  expect(intro.loop).toBe(false);
  expect(intro.offset).toBe(0);
  const loopStart = stems[0].startsAt;
  expect(loopStart).toBeGreaterThan(intro.startsAt);
  expect(intro.startsAt + intro.duration - loopStart).toBeCloseTo(2, 3);
  for (const stem of stems) {
    expect(stem.loop).toBe(true);
    expect(stem.duration).toBeGreaterThan(391);
    expect(stem.offset).toBe(0);
    expect(stem.startsAt).toBe(loopStart);
  }
}

export async function waitForGameplayLoop(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          window.electrifyMusicPlayback
            .filter(
              ({ source, startTime, stopped, ended }) =>
                !stopped && !ended && source.context.currentTime >= startTime,
            )
            .map(({ source }) => source.loop && source.buffer!.duration > 391),
        ),
      {
        timeout: 45000,
        message: "The intro ends and the three gameplay stems keep playing",
      },
    )
    .toEqual([true, true, true]);
}

declare global {
  interface Window {
    electrifyMusicDocument: string;
    electrifyMusicContexts: AudioContext[];
    electrifyMusicSeekTail: boolean;
    electrifyMusicResumes: { active: boolean; at: number }[];
    electrifyMusicDecodes: {
      bytes: number;
      sampleRate: number;
      state: "decoding" | "decoded" | "error";
      elapsedMs?: number;
      error?: string;
    }[];
    electrifyMusicStarts: {
      duration: number;
      loop: boolean;
      offset: number;
      at: number;
    }[];
    electrifyMusicPlayback: {
      source: AudioBufferSourceNode;
      startTime: number;
      offset: number;
      stopped: boolean;
      ended: boolean;
    }[];
  }
}

export async function installMusicAudit(
  page: Page,
  preferences = { enabled: true, installed: false, firstTutorial: false },
) {
  await page.addInitScript(({ enabled, installed, firstTutorial }) => {
    // Render the native graph against a silent sink. The real audio clock still runs,
    // including suspend/resume, without depending on the host's physical output device.
    window.electrifyMusicContexts = [];
    window.electrifyMusicSeekTail = false;
    const BrowserAudioContext = window.AudioContext;
    window.AudioContext = class extends BrowserAudioContext {
      constructor(options?: AudioContextOptions) {
        const silentOptions = { ...options, sinkId: { type: "none" } };
        super(silentOptions);
        window.electrifyMusicContexts.push(this);
      }
    };
    localStorage.clear();
    localStorage.setItem("audioEnabled", String(enabled));
    if (installed)
      Object.defineProperty(navigator, "standalone", { value: true });
    if (!firstTutorial)
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: [
            { scenarioId: 0, timesPlayed: 1, date: new Date().toString() },
          ],
        }),
      );
    window.electrifyMusicResumes = [];
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function (this: AudioContext) {
      window.electrifyMusicResumes.push({
        active: navigator.userActivation.isActive,
        at: performance.now(),
      });
      return resume.call(this);
    };
    window.electrifyMusicDocument = crypto.randomUUID();
    window.electrifyMusicDecodes = [];
    window.electrifyMusicStarts = [];
    window.electrifyMusicPlayback = [];
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (
      this: AudioContext,
      ...args: Parameters<AudioContext["decodeAudioData"]>
    ) {
      const entry: Window["electrifyMusicDecodes"][number] = {
        bytes: args[0].byteLength,
        sampleRate: this.sampleRate,
        state: "decoding",
      };
      window.electrifyMusicDecodes.push(entry);
      const startedAt = performance.now();
      const pending = decode.apply(this, args);
      void pending.then(
        () => {
          entry.state = "decoded";
          entry.elapsedMs = performance.now() - startedAt;
        },
        (error: unknown) => {
          entry.state = "error";
          entry.elapsedMs = performance.now() - startedAt;
          entry.error = String(error);
        },
      );
      return pending;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (
      this: AudioBufferSourceNode,
      ...args: Parameters<AudioBufferSourceNode["start"]>
    ) {
      if (this.buffer && this.buffer.duration > 20) {
        // Boundary QA can seek the real source into the final 200 ms without accelerating its
        // rendering clock or waiting six minutes. Ordinary startup assertions use the app offset.
        if (window.electrifyMusicSeekTail && this.buffer.duration > 100) {
          args[1] = this.buffer.duration - 0.2;
        }
        window.electrifyMusicStarts.push({
          at: performance.now(),
          duration: this.buffer.duration,
          loop: this.loop,
          offset: args[1] || 0,
        });
        const playback = {
          source: this,
          startTime: Math.max(this.context.currentTime, args[0] || 0),
          offset: args[1] || 0,
          stopped: false,
          ended: false,
        };
        window.electrifyMusicPlayback.push(playback);
        this.addEventListener(
          "ended",
          () => {
            playback.ended = true;
          },
          { once: true },
        );
      }
      start.apply(this, args);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (
      this: AudioBufferSourceNode,
      ...args: Parameters<AudioBufferSourceNode["stop"]>
    ) {
      const playback = window.electrifyMusicPlayback.find(
        (entry) => entry.source === this,
      );
      if (playback) playback.stopped = true;
      stop.apply(this, args);
    };
  }, preferences);
}

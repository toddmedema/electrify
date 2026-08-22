import { TICK_MINUTES } from "../Constants";

/**
 * Frame skipping for the panes that are too expensive to redraw on every tick at FAST speed.
 *
 * The obvious way to write this -- "render when the tick counter divides evenly by N" -- looks
 * right and quietly falls apart on a slow device. The tick action catches the simulation up
 * several ticks at a time when a frame overruns, so React only ever sees every second or third
 * value of the counter, and a remainder test can step straight over every multiple of N. At a
 * stride of exactly N the pane then freezes for as long as the machine stays behind.
 *
 * Asking how far the game clock has moved since the last render instead is independent of the
 * stride, and a clock that has gone backwards (a new game starting) always renders.
 */
export class TickThrottle {
  private lastRenderedMinute = -Infinity;

  /** True if at least `everyTicks` game ticks have passed since the last render. */
  public due(minute: number, everyTicks: number): boolean {
    const elapsed = minute - this.lastRenderedMinute;
    return elapsed < 0 || elapsed >= everyTicks * TICK_MINUTES;
  }

  /** Call from componentDidUpdate, so only renders that actually happened count. */
  public rendered(minute: number) {
    this.lastRenderedMinute = minute;
  }
}

import { act, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterPaint, useAfterPaintValue } from "./AfterPaint";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("afterPaint", () => {
  it("runs after the next animation frame, not synchronously", () => {
    const callback = jest.fn();
    afterPaint(callback);
    expect(callback).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled before it runs", () => {
    const callback = jest.fn();
    const cancel = afterPaint(callback);
    cancel();
    jest.runAllTimers();
    expect(callback).not.toHaveBeenCalled();
  });

  it("falls back to a timeout without requestAnimationFrame", () => {
    const raf = window.requestAnimationFrame;
    // @ts-expect-error: simulating an environment without animation frames
    delete window.requestAnimationFrame;
    try {
      const callback = jest.fn();
      afterPaint(callback);
      expect(callback).not.toHaveBeenCalled();
      jest.runAllTimers();
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      window.requestAnimationFrame = raf;
    }
  });
});

describe("useAfterPaintValue", () => {
  function Probe(props: {
    valueKey: string | undefined;
    compute: (key: string) => string;
    onRender: () => void;
  }) {
    props.onRender();
    const value = useAfterPaintValue(props.valueKey, () =>
      props.compute(props.valueKey!),
    );
    return <span data-testid="value">{value ?? "none"}</span>;
  }

  function setup(initialKey: string | undefined) {
    const compute = jest.fn((key: string) => `value for ${key}`);
    const onRender = jest.fn();
    const view = render(
      <Probe valueKey={initialKey} compute={compute} onRender={onRender} />,
    );
    const shown = () => screen.getByTestId("value").textContent;
    const rerender = (key: string | undefined) =>
      view.rerender(
        <Probe valueKey={key} compute={compute} onRender={onRender} />,
      );
    return { compute, onRender, shown, rerender, view };
  }

  it("computes synchronously on mount, so there is no empty frame", () => {
    const { compute, shown } = setup("a");
    expect(shown()).toBe("value for a");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous value on screen until the new key's value lands after paint", () => {
    const { compute, shown, rerender } = setup("a");
    rerender("b");
    expect(shown()).toBe("value for a");
    expect(compute).toHaveBeenCalledTimes(1);
    act(() => {
      jest.runAllTimers();
    });
    expect(shown()).toBe("value for b");
    expect(compute).toHaveBeenCalledTimes(2);
    expect(compute).toHaveBeenLastCalledWith("b");
  });

  it("does not recompute or re-render while the key stays the same", () => {
    const { compute, onRender, rerender } = setup("a");
    rerender("a");
    rerender("a");
    act(() => {
      jest.runAllTimers();
    });
    expect(compute).toHaveBeenCalledTimes(1);
    // One render per rerender call, and none from a deferred update
    expect(onRender).toHaveBeenCalledTimes(3);
  });

  it("drops work for a key that was replaced before it ran", () => {
    const { compute, shown, rerender } = setup("a");
    rerender("b");
    rerender("c");
    act(() => {
      jest.runAllTimers();
    });
    expect(shown()).toBe("value for c");
    expect(compute.mock.calls.map(([key]) => key)).toEqual(["a", "c"]);
  });

  it("cancels pending work when the key returns to the value on screen", () => {
    const { compute, shown, rerender } = setup("a");
    rerender("b");
    rerender("a");
    act(() => {
      jest.runAllTimers();
    });
    expect(shown()).toBe("value for a");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("uses the inputs from the render that first saw the new key", () => {
    const seen: number[] = [];
    function Tick(props: { month: number; minute: number }) {
      const value = useAfterPaintValue(String(props.month), () => {
        seen.push(props.minute);
        return props.minute;
      });
      return <span data-testid="value">{value}</span>;
    }
    const view = render(<Tick month={1} minute={10} />);
    view.rerender(<Tick month={2} minute={20} />);
    view.rerender(<Tick month={2} minute={30} />);
    act(() => {
      jest.runAllTimers();
    });
    expect(seen).toEqual([10, 20]);
    expect(screen.getByTestId("value").textContent).toBe("20");
  });

  it("cancels pending work on unmount", () => {
    const { compute, rerender, view } = setup("a");
    rerender("b");
    view.unmount();
    act(() => {
      jest.runAllTimers();
    });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("shows nothing while disabled, and computes at once when enabled with a new key", () => {
    const { compute, shown, rerender } = setup(undefined);
    expect(shown()).toBe("none");
    expect(compute).not.toHaveBeenCalled();
    rerender("a");
    expect(shown()).toBe("value for a");
    rerender(undefined);
    expect(shown()).toBe("none");
    // Nothing was on screen to keep, so a changed key doesn't wait for paint
    rerender("b");
    expect(shown()).toBe("value for b");
    // An unchanged key reuses the value it already has
    rerender(undefined);
    rerender("b");
    expect(shown()).toBe("value for b");
    expect(compute.mock.calls.map(([key]) => key)).toEqual(["a", "b"]);
  });
});

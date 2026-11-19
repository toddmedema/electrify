import { render } from "@testing-library/react";
import { FACILITY_MAP_PLAYBACK_RATE } from "../useFacilityMapMotion";
import WeatherAtmosphere from "./WeatherAtmosphere";

it("retimes visible weather through pause and fast play while respecting reduced motion", () => {
  const weather = {
    rain: 0.8,
    snowfall: 0,
    cloud: 1,
    wind: 0.7,
    waterLevel: 0.5,
    snowpack: 0,
  };
  const getAnimations = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "getAnimations",
  );
  const animation = {
    playbackRate: 1,
    playState: "paused",
    updatePlaybackRate: jest.fn((rate: number) => {
      animation.playbackRate = rate;
    }),
    play: jest.fn(() => {
      animation.playState = "running";
    }),
    pause: jest.fn(() => {
      animation.playState = "paused";
    }),
  };
  // jsdom does not supply animation timelines.
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [animation],
  });
  try {
    const rates = FACILITY_MAP_PLAYBACK_RATE;
    const { rerender } = render(
      <WeatherAtmosphere
        dark
        weather={weather}
        motion={{ allowed: true, rate: rates.PAUSED }}
      />,
    );
    expect(animation.playState).toBe("running");
    expect(animation.playbackRate).toBe(rates.PAUSED);
    rerender(
      <WeatherAtmosphere
        dark
        weather={weather}
        motion={{ allowed: true, rate: rates.FAST }}
      />,
    );
    expect(animation.play).toHaveBeenCalledTimes(1);
    expect(animation.playbackRate).toBe(rates.FAST);
    rerender(
      <WeatherAtmosphere
        dark
        weather={weather}
        motion={{ allowed: false, rate: rates.FAST }}
      />,
    );
    expect(animation.playState).toBe("paused");
  } finally {
    if (getAnimations)
      Object.defineProperty(Element.prototype, "getAnimations", getAnimations);
    else Reflect.deleteProperty(Element.prototype, "getAnimations");
  }
});

import { mapLighting } from "./Lighting";

const day = {
  minute: 720,
  sunrise: 360,
  sunset: 1080,
  daylight: "normal" as const,
  dark: false,
};
it("follows simulated day/night and keeps the stylized moon cool", () => {
  const noon = mapLighting(day),
    night = mapLighting({ ...day, minute: 0 });
  expect(noon.color[0]).toBeGreaterThan(noon.color[2]);
  expect(night.color[2]).toBeGreaterThan(night.color[0]);
  expect(noon.ambient).toBeGreaterThan(night.ambient);
  expect(noon.direction[2]).toBeGreaterThan(0);
  expect(mapLighting({ ...day, minute: 480 }).direction[0]).toBeGreaterThan(0);
  expect(mapLighting({ ...day, minute: 960 }).direction[0]).toBeLessThan(0);
  expect(mapLighting(day)).toEqual(noon);
  expect(mapLighting({ ...day, dark: true }).ambient).toBeLessThan(
    noon.ambient,
  );
});
it("crosses both horizons continuously, with fading bounded shadows", () => {
  for (const minute of [360, 1080]) {
    const before = mapLighting({ ...day, minute: minute - 0.1 });
    const after = mapLighting({ ...day, minute: minute + 0.1 });
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(before.direction[i] - after.direction[i])).toBeLessThan(
        0.005,
      );
      expect(Math.abs(before.color[i] - after.color[i])).toBeLessThan(0.005);
    }
    expect(before.shadow).toBeLessThan(0.001);
    expect(after.shadow).toBeLessThan(0.001);
  }
});
it("handles midnight-spanning daylight, polar days/nights and wrapped minutes", () => {
  const wrapped = mapLighting({
    ...day,
    sunrise: 1320,
    sunset: 360,
    minute: 120,
  });
  expect(wrapped.color[0]).toBeGreaterThan(wrapped.color[2]);
  expect(mapLighting({ ...day, minute: -720 })).toEqual(mapLighting(day));
  for (const daylight of ["normal", "polar-day", "polar-night"] as const)
    for (let minute = 0; minute < 1440; minute += 30) {
      const light = mapLighting({ ...day, daylight, minute });
      expect(Math.hypot(...light.direction)).toBeCloseTo(1, 8);
      expect(light.direction[1]).toBeGreaterThan(0);
      expect(light.shadow).toBeGreaterThanOrEqual(0);
      expect(light.shadow).toBeLessThanOrEqual(0.25);
      expect(
        [...light.direction, ...light.color, light.ambient, light.shadow].every(
          Number.isFinite,
        ),
      ).toBe(true);
    }
});

it.each(["polar-day", "polar-night"] as const)(
  "keeps %s in the appropriate palette throughout the day",
  (daylight) => {
    const redMinusBlue = Array.from({ length: 48 }, (_, i) => {
      const light = mapLighting({ ...day, daylight, minute: i * 30 });
      return light.color[0] - light.color[2];
    });
    const sign = daylight === "polar-day" ? 1 : -1;
    expect(redMinusBlue.every((difference) => difference * sign > 0)).toBe(
      true,
    );
  },
);

it("softens shadows as a cloud deck builds without moving the sun", () => {
  const clear = mapLighting(day);
  const scattered = mapLighting({ ...day, cloud: 0.65 });
  const overcast = mapLighting({ ...day, cloud: 1 });
  expect(overcast.direction).toEqual(clear.direction);
  expect(clear.shadow).toBeGreaterThan(scattered.shadow);
  expect(scattered.shadow).toBeGreaterThan(overcast.shadow);
  expect(overcast.color[0]).toBeLessThan(clear.color[0]);
  expect(overcast.ambient).toBeGreaterThan(clear.ambient);
});

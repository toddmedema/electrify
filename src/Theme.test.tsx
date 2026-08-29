import { facilityColor, getThemeMode, setThemeMode } from "./Theme";

describe("facility fuel colors", () => {
  const originalMode = getThemeMode();

  afterAll(() => setThemeMode(originalMode));

  it.each(["light", "dark"] as const)(
    "gives Airborne Wind a distinct %s palette color",
    (mode) => {
      setThemeMode(mode);
      const airborne = facilityColor("Airborne Wind");
      expect(airborne).toMatch(/^#[0-9a-f]{6}$/i);
      expect(airborne).not.toBe(facilityColor("Wind"));
      expect(airborne).not.toBe(facilityColor("Offshore Wind"));
    },
  );
});

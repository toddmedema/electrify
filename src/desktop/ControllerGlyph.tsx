import paths from "./ControllerGlyphPaths.json";

// Kenney Input Prompts 1.5A, CC0. See legal/kenney-input-prompts-LICENSE.txt.
// Match the supplied physical origin only: actions may have arbitrary remaps.
const aliases: [keyof typeof paths, string[]][] = [
  ["xbox_button_a", ["A", "A button", "Button A"]],
  ["xbox_button_b", ["B", "B button", "Button B"]],
  ["xbox_button_x", ["X", "X button", "Button X"]],
  ["xbox_button_y", ["Y", "Y button", "Button Y"]],
  ["playstation_button_cross", ["Cross", "Cross button"]],
  ["playstation_button_circle", ["Circle", "Circle button"]],
  ["playstation_button_square", ["Square", "Square button"]],
  ["playstation_button_triangle", ["Triangle", "Triangle button"]],
  ["xbox_lb", ["LB", "Left bumper", "Left shoulder"]],
  ["xbox_rb", ["RB", "Right bumper", "Right shoulder"]],
  ["xbox_lt", ["LT", "Left trigger"]],
  ["xbox_rt", ["RT", "Right trigger"]],
  ["playstation_trigger_l1", ["L1", "L1 button"]],
  ["playstation_trigger_r1", ["R1", "R1 button"]],
  ["playstation_trigger_l2", ["L2", "L2 trigger"]],
  ["playstation_trigger_r2", ["R2", "R2 trigger"]],
  ["playstation_button_l3", ["L3", "L3 button"]],
  ["playstation_button_r3", ["R3", "R3 button"]],
  ["xbox_button_menu", ["Menu", "Menu button"]],
  ["xbox_button_start_icon", ["Start", "Start button"]],
  ["xbox_button_back_icon", ["Back", "Back button"]],
  ["xbox_button_view", ["View", "View button"]],
  ["xbox_button_share", ["Share", "Share button"]],
  ["playstation5_button_options", ["Options", "Options button"]],
  ["playstation4_button_share", ["PlayStation Share"]],
  ["switch_button_plus", ["Plus", "Plus button", "+"]],
  ["switch_button_minus", ["Minus", "Minus button", "−", "-"]],
  ["switch_button_zl", ["ZL", "ZL trigger"]],
  ["switch_button_zr", ["ZR", "ZR trigger"]],
  ["switch_button_l", ["L", "L button"]],
  ["switch_button_r", ["R", "R button"]],
  ["xbox_dpad", ["D-pad", "Dpad"]],
  ["xbox_dpad_up_outline", ["D-pad up", "Dpad up"]],
  ["xbox_dpad_down_outline", ["D-pad down", "Dpad down"]],
  ["xbox_dpad_left_outline", ["D-pad left", "Dpad left"]],
  ["xbox_dpad_right_outline", ["D-pad right", "Dpad right"]],
  ["xbox_stick_l", ["Left stick", "Left thumbstick"]],
  ["xbox_stick_r", ["Right stick", "Right thumbstick"]],
  ["xbox_stick_l_up", ["Left stick up", "Left thumbstick up"]],
  ["xbox_stick_l_down", ["Left stick down", "Left thumbstick down"]],
  ["xbox_stick_l_left", ["Left stick left", "Left thumbstick left"]],
  ["xbox_stick_l_right", ["Left stick right", "Left thumbstick right"]],
  ["xbox_stick_r_up", ["Right stick up", "Right thumbstick up"]],
  ["xbox_stick_r_down", ["Right stick down", "Right thumbstick down"]],
  ["xbox_stick_r_left", ["Right stick left", "Right thumbstick left"]],
  ["xbox_stick_r_right", ["Right stick right", "Right thumbstick right"]],
  [
    "xbox_stick_l_press",
    ["Left stick press", "Left stick click", "Left thumbstick click", "LS"],
  ],
  [
    "xbox_stick_r_press",
    ["Right stick press", "Right stick click", "Right thumbstick click", "RS"],
  ],
];

/** Match harmless spelling variants of an actual physical-origin label.
 * Preserve a bare minus sign because it identifies a Switch button, not a word separator. */
function normalize(label: string) {
  const normalized = label.trim().toLowerCase();
  return normalized === "-" ? normalized : normalized.replace(/[-_\s]+/g, " ");
}

const originPaths = new Map(
  aliases.flatMap(([key, labels]) =>
    labels.map((label) => [normalize(label), paths[key]] as const),
  ),
);

/** Native Steam glyphs preserve device identity and remaps; known labels cover other hosts. */
export default function ControllerGlyph({
  glyph,
}: {
  glyph: { label: string; image?: string };
}) {
  if (glyph.image)
    return (
      <img className="controllerGlyph" src={glyph.image} alt={glyph.label} />
    );
  const origin = originPaths.get(normalize(glyph.label));
  if (!origin)
    return <span className="controllerHintBinding">{glyph.label}</span>;
  return (
    <svg
      className="controllerGlyph"
      role="img"
      aria-label={glyph.label}
      viewBox="0 0 64 64"
      focusable="false"
      fill="currentColor"
    >
      {origin.map((path, index) => (
        <path key={index} d={path} />
      ))}
    </svg>
  );
}

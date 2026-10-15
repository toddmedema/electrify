import { ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import useMediaQuery from "@mui/material/useMediaQuery";
import { INTERFACE_SCALES } from "../../InterfaceScale";
import { useAppDispatch, useAppSelector } from "../../Store";
import { change } from "../../reducers/Settings";

/** The same eligible surfaces as Globals.isPaneLayout; a phone's layout is unchanged. */
export default function InterfaceSizeSettings(): React.JSX.Element | null {
  const applicable = useMediaQuery(
    "(min-width:1024px), (min-width:700px) and (min-height:600px) and (min-aspect-ratio:4/5) and (max-aspect-ratio:5/4)",
  );
  const value = useAppSelector((state) => state.settings.interfaceScale ?? 1);
  const dispatch = useAppDispatch();
  if (!applicable) return null;
  return (
    <div className="settingsRow interfaceSizeSettings">
      <div>
        <Typography sx={{ fontWeight: 600 }}>Interface size</Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          id="interface-size-help"
        >
          Enlarge text, icons, controls and charts. Panels reflow to fit. Your
          phone keeps its standard size.
        </Typography>
      </div>
      <ToggleButtonGroup
        exclusive
        value={value}
        aria-label="Interface size"
        aria-describedby="interface-size-help"
        onChange={(_event, interfaceScale) => {
          if (INTERFACE_SCALES.includes(interfaceScale))
            dispatch(change({ interfaceScale }));
        }}
      >
        {INTERFACE_SCALES.map((scale) => (
          <ToggleButton key={scale} value={scale}>
            {scale * 100}%
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </div>
  );
}

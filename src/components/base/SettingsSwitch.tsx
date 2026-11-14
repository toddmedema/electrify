import { styled } from "@mui/material/styles";
import Switch from "@mui/material/Switch";

const SettingsSwitch = styled(Switch)({
  height: 44,
  padding: "15px 12px",
  "& .MuiSwitch-switchBase": { padding: "12px 9px" },
});

export default SettingsSwitch;

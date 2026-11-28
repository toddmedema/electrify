import { useId } from "react";
import { FormControl, InputLabel, MenuItem, Select } from "@mui/material";
import QuestionMarkIcon from "@mui/icons-material/QuestionMark";
import {
  UTILITY_LOGOS,
  isUtilityLogo,
  utilityLogoName,
  type UtilityLogoId,
} from "../../data/UtilityLogos";

import UtilityLogoIcon from "./UtilityLogoIcon";

function Choice({ logo }: { logo?: UtilityLogoId }) {
  return (
    <span className="utilityLogoChoice">
      {logo ? (
        <UtilityLogoIcon logo={logo} />
      ) : (
        <QuestionMarkIcon className="utilityLogoIcon" aria-hidden />
      )}
      <span>{logo ? utilityLogoName(logo) : "Random"}</span>
    </span>
  );
}

export default function UtilityLogoPicker({
  logo,
  onChange,
  taken,
  disabled,
  label = "Company logo",
}: {
  logo?: UtilityLogoId;
  onChange: (logo: UtilityLogoId | null) => void;
  taken?: ReadonlyMap<UtilityLogoId, string>;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  return (
    <FormControl size="small" className="utilityLogoPicker" disabled={disabled}>
      <InputLabel id={id}>{label}</InputLabel>
      <Select
        labelId={id}
        label={label}
        value={logo ?? "random"}
        onChange={({ target: { value } }) =>
          onChange(isUtilityLogo(value) ? value : null)
        }
        renderValue={(value) => (
          <Choice logo={isUtilityLogo(value) ? value : undefined} />
        )}
        MenuProps={{ slotProps: { paper: { sx: { maxHeight: 320 } } } }}
      >
        <MenuItem value="random" className="utilityLogoOption">
          <Choice />
        </MenuItem>
        {UTILITY_LOGOS.map(({ id }) => (
          <MenuItem
            key={id}
            value={id}
            disabled={taken?.has(id)}
            className="utilityLogoOption"
          >
            <Choice logo={id} />
            {taken?.has(id) && (
              <span className="utilityLogoTaken">
                {" "}
                · Taken by {taken.get(id)}
              </span>
            )}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

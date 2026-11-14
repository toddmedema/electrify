import * as React from "react";
import { Box, Typography } from "@mui/material";

interface Props {
  label: string;
  htmlFor?: string;
  description?: React.ReactNode;
  descriptionId?: string;
  children: React.ReactNode;
  stackOnMobile?: boolean;
}

export default function SettingRow({
  label,
  htmlFor,
  description,
  descriptionId,
  children,
  stackOnMobile = false,
}: Props): React.JSX.Element {
  return (
    <Box
      className="settingsRow"
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: stackOnMobile ? "minmax(0, 1fr)" : "minmax(0, 1fr) auto",
          sm: "minmax(180px, 1fr) auto",
        },
        alignItems: "center",
        gap: { xs: stackOnMobile ? 1.5 : 1, sm: 3 },
        minHeight: 56,
        px: 2,
        py: 1.5,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          component={htmlFor ? "label" : "p"}
          htmlFor={htmlFor}
          sx={{ fontWeight: 600 }}
        >
          {label}
        </Typography>
        {description && (
          <Typography
            id={descriptionId}
            component="div"
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.25, lineHeight: 1.45 }}
          >
            {description}
          </Typography>
        )}
      </Box>
      <Box
        sx={{
          minWidth: 0,
          // Controls hug their content at the row's right edge; stacked phone rows stretch instead
          justifySelf: { xs: stackOnMobile ? "stretch" : "end", sm: "end" },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

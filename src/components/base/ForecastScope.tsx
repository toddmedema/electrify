import { Box, Typography } from "@mui/material";

/** Keep model limits beside the results, with details available when needed. */
export default function ForecastScope() {
  return (
    <Box
      component="details"
      className="forecastScope"
      sx={{ mx: 2, my: 0, color: "text.secondary" }}
    >
      <Box
        component="summary"
        sx={{
          cursor: "pointer",
          minHeight: 44,
          py: 1,
          boxSizing: "border-box",
          fontSize: "0.875rem",
        }}
      >
        About these estimates
      </Box>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Each simulated day stands for a month, so multi-day cloudy or windless
        spells aren't modeled.
      </Typography>
    </Box>
  );
}

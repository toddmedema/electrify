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
        Estimates · one representative day per month
      </Box>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Each simulated day represents a month. Energy and bills scale to that
        month, while a four-hour battery still lasts four simulated hours. These
        estimates help compare choices; they cannot establish whether storage
        will survive several consecutive cloudy or windless days.
      </Typography>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Practice tougher conditions in Deep Freeze and Heatwave + Drought from
        the scenario menu. Those authored emergencies test different tradeoffs;
        they also use representative days, not a full year of hourly weather.
      </Typography>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Future fuel prices and economic cycles are game assumptions. Compare
        possible costs and leave room for surprises before borrowing to build.
      </Typography>
    </Box>
  );
}

import { Button, Tooltip } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { fireEvent, render, screen } from "@testing-library/react";
import { createAppTheme } from "./Theme";

it.each(["light", "dark"] as const)(
  "%s tooltips are labels that never intercept the pointer",
  async (mode) => {
    render(
      <ThemeProvider theme={createAppTheme(mode)}>
        <Tooltip title="All requirements" open>
          <Button>Info</Button>
        </Tooltip>
      </ThemeProvider>,
    );
    const tooltip = await screen.findByRole("tooltip");
    fireEvent.mouseOver(tooltip);
    // A non-interactive popper has pointer-events: none, so clicks reach what lies beneath.
    expect(tooltip).not.toHaveClass("MuiTooltip-popperInteractive");
  },
);

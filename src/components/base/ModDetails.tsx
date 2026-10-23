import { useMemo } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { ScenarioType } from "../../Types";
import type { ModDiagnostic, ModPackage } from "../../mods/ModSchema";
import {
  modPlayerFacts,
  type ModFactSection,
  type ModRuleFacts,
} from "../../mods/ModAuthoring";

const sectionLabel = (section: ModFactSection, author = false) =>
  author
    ? section.title
    : section.id === "objectives"
      ? "Scenario objectives"
      : section.id === "timeline"
        ? "Announced timeline"
        : section.title;

function FactRows({ section }: { section: ModFactSection }) {
  return (
    <>
      {section.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {section.description}
        </Typography>
      )}
      <Box component="dl" sx={{ m: 0 }}>
        {section.rows.map((row, index) => (
          <Box
            key={`${row.label}:${index}`}
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "minmax(120px, 1fr) 3fr" },
              columnGap: 2,
              rowGap: 0.5,
              mt: index ? 1.5 : 0,
              alignItems: "baseline",
            }}
          >
            <Typography component="dt" variant="body2" sx={{ fontWeight: 600 }}>
              {row.label}
            </Typography>
            <Box component="dd" sx={{ m: 0, minWidth: 0 }}>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                {row.value}
              </Typography>
              {row.details?.map((detail, detailIndex) => (
                <Typography
                  key={detailIndex}
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5 }}
                >
                  {detail}
                </Typography>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    </>
  );
}

function Diagnostics({ facts }: { facts: ModRuleFacts }) {
  return (
    <Box component="section" aria-label="Scenario diagnostics">
      <Typography
        component="h3"
        variant="subtitle1"
        sx={{ fontWeight: 600, mb: 1 }}
      >
        Validation issues
      </Typography>
      {!facts.diagnostics.length ? (
        <Typography variant="body2" color="text.secondary">
          No validation issues.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {facts.diagnostics.map((diagnostic, index) => (
            <Alert
              key={`${diagnostic.path}:${index}`}
              severity={diagnostic.severity}
            >
              <strong>{diagnostic.path}</strong>: {diagnostic.message}
            </Alert>
          ))}
        </Stack>
      )}
    </Box>
  );
}

/** Display-ready facts come from the shared authoring owner, also used by the CLI. */
export function ModFacts({
  facts,
  author = false,
}: {
  facts: ModRuleFacts;
  author?: boolean;
}) {
  return (
    <Stack
      className="modRuleFacts"
      spacing={2}
      sx={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      {author && <Diagnostics facts={facts} />}
      {!author && (
        <Box component="section" aria-label="Author description">
          <Typography
            component="h3"
            variant="subtitle1"
            sx={{ fontWeight: 600 }}
          >
            Author description
          </Typography>
          <Typography variant="body2">{facts.description}</Typography>
        </Box>
      )}
      {facts.sections.map((section) => {
        const expandable =
          author || !["setup", "objectives", "timeline"].includes(section.id);
        return expandable ? (
          <Accordion
            key={section.id}
            disableGutters
            elevation={0}
            slotProps={{ transition: { unmountOnExit: true } }}
            sx={{
              background: "transparent",
              borderTop: 1,
              borderColor: "divider",
              "&::before": { display: "none" },
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              sx={{ px: 0, minHeight: 44, "&.Mui-expanded": { minHeight: 44 } }}
            >
              <Typography
                component="h3"
                variant="subtitle1"
                sx={{ fontWeight: 600 }}
              >
                {section.title}
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0, pb: 1 }}>
              <Box
                component="section"
                aria-label={sectionLabel(section, author)}
              >
                <FactRows section={section} />
              </Box>
            </AccordionDetails>
          </Accordion>
        ) : (
          <Box
            component="section"
            aria-label={sectionLabel(section, author)}
            key={section.id}
          >
            <Typography component="h3" variant="h6" sx={{ mb: 1 }}>
              {section.title}
            </Typography>
            <FactRows section={section} />
          </Box>
        );
      })}
      {!author && <Diagnostics facts={facts} />}
    </Stack>
  );
}

/** Solo and co-op read the same generated definitions and consequences from frozen rules. */
export default function ModDetails({
  scenario,
  objectiveIntent,
  diagnostics,
}: {
  scenario: ScenarioType;
  objectiveIntent?: ModPackage["objectives"]["mode"];
  diagnostics?: ModDiagnostic[];
}) {
  const facts = useMemo(
    () => modPlayerFacts(scenario, { objectiveIntent, diagnostics }),
    [scenario, objectiveIntent, diagnostics],
  );
  return <ModFacts facts={facts} />;
}

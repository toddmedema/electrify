# Demand by load type

Electrify models demand using the four end-use sectors used by the U.S. Energy Information
Administration—residential, commercial, industrial, and transportation—plus data centers as a
fifth explicit category. Data centers are normally counted inside the commercial sector; they are
separated here because their recent growth is large enough to be a distinct planning problem.

Each forecast tick now carries a five-part demand breakdown. The components have different daily
shapes: residential demand peaks in the morning and evening, commercial demand in the daytime,
transportation demand leans toward overnight charging, and industrial and data-center demand are
comparatively flat. At a scenario's opening instant the five components are normalized to the
scenario's previous total demand, preserving authored starting balance. From there they follow
regional and local structural trends and their sum becomes the load the player must serve.

The broad regional sector mixes and growth rates are game-scale assumptions, not city forecasts.
They let mature markets flatten, high-growth markets expand, and industrial demand decline in
parts of the U.S. Midwest while growing in faster-growing states. Customer growth remains the
common demographic baseline, so these rates represent changes in consumption per customer.

## Data centers

The U.S. data-center curve is interpolated between published historical and projected anchors:

- 2000: 28.2 TWh, about 0.8% of U.S. electricity use
- 2006: 61.4 TWh, about 1.5%
- 2014: 58 TWh, about 1.5%
- 2018: 1.9%
- 2023: 176 TWh, 4.4%
- 2028: 9.35%, the midpoint of Berkeley Lab's 6.7%–12.0% scenario range

Before 2000 the category is zero. After 2028 the curve tapers and is capped, since extrapolating
near-term AI buildout indefinitely would overwhelm century-long sandbox games. Berkeley Lab
identifies Virginia as the largest U.S. data-center electricity load, followed by California and
Texas; local multipliers reflect that ordering but are scenario parameters rather than measured
state market shares. Other countries use conservative regional exposure factors.

Sources:

- [EIA international end-use sector definitions](https://www.eia.gov/tools/faqs/faq.php?id=447&t=1)
- [DOE data-center energy usage profile](https://www1.eere.energy.gov/manufacturing/datacenters/pdfs/chp_data_centers.pdf)
- [Berkeley Lab 2024 U.S. Data Center Energy Usage Report](https://eta-publications.lbl.gov/sites/default/files/2024-12/lbnl-2024-united-states-data-center-energy-usage-report_1.pdf)

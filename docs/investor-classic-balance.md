# Investor classic objectives

Carbon Fee (100), Rise of Renewables (101), The End of an Era (102), The Shale
Boom (103), and Paradise (105) require 80% of their initial customer base at
term end and at least one material grid investment. The shared objective
evaluator, mission status and pre-game requirements all expose these rules.
An impossible retention target still ends the run early using the existing
conservative recovery bound. Temporary attrition is recoverable.

Retention alone is insufficient: Employee price-only runs at 1.1 times the
starting rate still won Carbon Fee and Rise of Renewables, and Shale could
win at 1.25 times its rate. The investment requirement closes that path
without imposing an investor rate cap or changing the demand model. A
cancelled retrofit refunds its cost and removes its decision credit. Cancelling
unfinished construction also removes its investment credit and earns no sale credit.

Before this change, the CEO reference plans ended Rise of Renewables with
4.6% retention, End of an Era with 0.25%, and Shale with 0.12%. Their apparent
wins depended on serving a nearly empty market. The revised Renewables plan
builds a 600 MW combined cycle and charges $0.075/kWh. End of an Era and Shale
reduce their early turnaround rates after ten years to win customers back,
while keeping their replacement generation. Carbon Fee and Paradise retain
their existing investment plans. These are reproducible examples, not the
only allowed strategies.

Validation lives in `InvestorObjectives.test.tsx` (price-only shortcuts),
`SimulationEconomics.test.tsx` (Intern accessibility), and the CEO economics
suites (active playbooks and seeds 1, 7, 20).

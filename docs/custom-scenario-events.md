# Custom scenario events

Custom setup can layer official scenario events onto the player's chosen location, era,
ownership and starting fleet. The selected scenario IDs are part of the custom scenario
saved with the game. Custom games remain ineligible for the authored leaderboard.

Event dates retain their relative position and calendar month, including at least three years
of preparation before a material shock. Selecting an event extends the run to include its
source scenario's duration. Players can combine events; percentage effects compose through
the existing event resolver. Story decisions tied to an authored city's grants, contracts or
starting assets are not imported.

Translation preserves dimensionless changes to demand, weather, runoff, fuel prices,
construction costs and generator output. Fixed restoration spending scales by starting
customers times the authored demand calibration, then by the game's existing era-money
index. This preserves the approximate burden per unit of grid demand. Equipment losses
resolve against the receiving fleet; a nuclear trip targets its largest operating reactor.
Future campus additions scale with the same grid-demand ratio. Existing source-city loads
such as Copperbelt mines are not added to a receiving grid.

Selected wildfire events support the ongoing preparedness program in any location. Its
normal budget and twelve-month ramp apply; protection is sampled at the incident's onset.
Full preparedness halves disconnected load and output losses, while restoration costs stay
unchanged. Selecting wildfire events does not invent a recurring wildfire profile for the
new location. Places with existing recurring hazards retain those hazards independently.

The opening electricity rate is automatic: use an official location's authored tariff when
available, or the existing custom-game default otherwise, re-quoted through the historical
retail-rate index for the selected year. The event selection does not replace that tariff.

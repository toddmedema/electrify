# Chernobyl: Recovery

This scenario puts the player in charge of restoring electricity service after the
Chernobyl disaster. The term begins in March 1986, one month before the accident,
and lasts 60 months. It ends before the Soviet Union's dissolution introduces a
separate political and economic crisis.

There is no minimum reliability requirement or blackout dismissal. Service,
affordability and emissions still affect the score. Customers remain in the
utility's territory during shortages, so lost demand cannot make the recovery
problem disappear. Cash below zero at month-end ends the run through bankruptcy.
The player must weigh restoring service against the cost of replacement generation
and continuing recovery spending.

## Historical timeline

The accident destroyed Unit 4 on 26 April 1986. The other three units shut down
afterward. The [official plant chronology](https://www2.chnpp.gov.ua/en/101-2011-06-10-13-28-26)
records their restarts:

- Unit 1: 1 October 1986.
- Unit 2: 5 November 1986.
- Unit 3: 4 December 1987.

Unit 4 never returned. The [plant's account of the accident](https://www2.chnpp.gov.ua/en/about/history-of-the-chnpp/accident-of-1986)
describes the destruction and the response. The setting is the Ukrainian SSR,
then part of the Soviet Union; the location data uses present-day Ukraine for
geographic lookup.

Each simulated month represents one day of operation. The accident therefore
affects April's representative day, and each restart affects its corresponding
month. This deliberately compresses the days between the explosion and shutdown
of the surviving units. Only the original four Chernobyl assets receive these
scripted outages; replacement plants remain available.

## Gameplay scale and economics

The starting nuclear fleet represents one tenth of the site's four 1,000 MW units.
The coal and oil plants stand for regional support. Customer counts, demand,
tariffs, cash, construction options and recovery spending are calibrated for the
game's electricity-market model. They are not historical estimates of the Soviet
grid or its administered prices. The four inherited Chernobyl units have no resale
value, including before the accident. Their sale therefore cannot bypass the
starting cash and recovery budget. Newly built plants keep the ordinary resale
rules.

The continuing recovery charge reflects a documented economic pressure. The
[UN recovery strategy, sections 1.03 and 5.04–5.07](https://www.iaea.org/sites/default/files/strategy_for_recovery.pdf)
describes cleanup, compensation, recovery spending and the cost of replacing lost
electricity. It also cautions that estimates of total monetary losses are
uncertain. The charge in the scenario is a gameplay budget, with its amount and
displayed message drawn from the same constant.

The score measures the electricity service delivered during the term. Human
health, displacement, contamination and environmental recovery extend far beyond
that term; the ending text makes that distinction explicit.

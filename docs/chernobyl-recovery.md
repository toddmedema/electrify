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

The starting nuclear fleet uses the site's full nameplate capacity: four 1,000 MW
reactors, totaling 4,000 MW. The [IAEA's 1989 cleanup report, Annex A, page 101](https://www-pub.iaea.org/MTCD/Publications/PDF/trs300_web.pdf)
records four operating 1,000 MW electric reactors in early 1986. Reactor capacities
and the reported historical recovery budget therefore use their full absolute
scale.

The utility serves 1.5 million modeled customers, supported by 1,000 MW of coal and
250 MW of oil generation. Those customer counts and support plants, along with
demand, tariffs, cash and construction options, remain game assumptions. The
scenario models an electricity-service territory; it does not reconstruct the
Soviet national grid or its administered prices. The four inherited Chernobyl units
have no resale value. Unit 4 cannot be sold or removed, including before the
accident. From April 1986, it is permanently paused and has no operating or sale
controls. Newly built plants keep the ordinary resale rules.

Unit 4's mandatory maintenance becomes **$250 million per month from April 1986**.
It replaces the destroyed reactor's ordinary operating upkeep and appears in the
unit's upkeep and lifetime expenses, with no duplicate company-level recovery fee.

The [UN recovery assessment, section 2.08](https://www.iaea.org/sites/default/files/strategy_for_recovery.pdf)
reports **$18 billion** in Soviet rehabilitation spending during **1986–1991**,
citing Ukraine's national report. A flat average across those six calendar years
gives:

`$18 billion ÷ 72 months = $250 million per month`

The scenario charges 59 months, April 1986 through February 1991, for a modeled
total of **$14.75 billion**. This approximates a share of the reported period,
rather than charging all six years during a five-year mission. The report includes
social assistance (35%) and resettlement (17%); it is a broad **cleanup and
recovery** proxy, not a measured reactor-maintenance bill. It does not specify a
constant-dollar price year or exchange-rate method, so the game uses its reported
historical dollar figure without claiming a modern-dollar conversion. Actual
spending was not uniform each month.

The opening **$12 billion recovery reserve** is a gameplay calibration, not a
historical appropriation. It funds the unavoidable obligation while preserving
tradeoffs between rates, replacement generation and solvency.

The score measures the electricity service delivered during the term. Human
health, displacement, contamination and environmental recovery extend far beyond
that term; the ending text makes that distinction explicit.

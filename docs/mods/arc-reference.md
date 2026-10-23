# Official arc reference

Use these phase, choice and load IDs when importing bundled challenge arcs with `officialArcs`.

Month 1 is the receiving grid's January opening; offsets start at 0. Dates include preparation time, and ranges show every possible onset. Durations use Easy (Employee); check Author report for other difficulties and your grid's resolved load sizes and costs.

Conditions use `{arc: scenarioId, choiceId, optionIds}`; load replacements use `{arc: scenarioId, loadId}`. With `includeChoices: false`, each choice takes its listed free response automatically, including any grant and associated rules.

## 100 · Carbon Fee

Preparation lead: 0 months.

| Phase ID            | Relocated offset | Playable month | Active duration (Easy) |
| ------------------- | ---------------- | -------------- | ---------------------- |
| `published-ratchet` | 12               | 13             | Message only           |
| `ratchet-onset`     | 48               | 49             | 96 months              |

No choices.

No permanent loads.

## 101 · Rise of Renewables

Preparation lead: 0 months.

| Phase ID                  | Relocated offset | Playable month | Active duration (Easy) |
| ------------------------- | ---------------- | -------------- | ---------------------- |
| `bridge-contracts`        | 0                | 1              | 144 months             |
| `manufacturing-warning`   | 72               | 73             | Message only           |
| `procurement-step`        | 84               | 85             | 60 months              |
| `clean-tech-load-warning` | 114              | 115            | Message only           |
| `clean-tech-load`         | 120              | 121            | 24 months              |
| `integration-review`      | 132              | 133            | Message only           |

No choices.

No permanent loads.

## 102 · The End of an Era

Preparation lead: 0 months.

| Phase ID             | Relocated offset | Playable month | Active duration (Easy) |
| -------------------- | ---------------- | -------------- | ---------------------- |
| `aging-warning`      | 48               | 49             | Message only           |
| `aging-derate`       | 72               | 73             | 24 months              |
| `aging-restoration`  | 96               | 97             | Message only           |
| `compliance-warning` | 130              | 131            | Message only           |
| `compliance`         | 180              | 181            | 60 months              |
| `successor-review`   | 216              | 217            | Message only           |

No choices.

No permanent loads.

## 103 · The Shale Boom

Preparation lead: 0 months.

| Phase ID                | Relocated offset | Playable month | Active duration (Easy) |
| ----------------------- | ---------------- | -------------- | ---------------------- |
| `regional-glut-warning` | 12               | 13             | Message only           |
| `regional-glut`         | 48               | 49             | 74 months              |
| `freeze-warning`        | 95               | 96             | Message only           |
| `freeze`                | 96               | 97             | 3 months               |
| `freeze-recovery`       | 99               | 100            | Message only           |
| `normalization`         | 122              | 123            | Message only           |

No choices.

No permanent loads.

## 104 · Hurricane Season

Preparation lead: 0 months.

| Phase ID      | Relocated offset | Playable month | Active duration (Easy) |
| ------------- | ---------------- | -------------- | ---------------------- |
| `outlook`     | 60               | 61             | Message only           |
| `landfall`    | 101–106          | 102–107        | 3 months               |
| `restoration` | 104–109          | 105–110        | Message only           |

No choices.

No permanent loads.

## 105 · Paradise

Preparation lead: 12 months.

| Phase ID              | Relocated offset | Playable month | Active duration (Easy) |
| --------------------- | ---------------- | -------------- | ---------------------- |
| `visitor-warning`     | 33               | 34             | Message only           |
| `visitor-peak`        | 40               | 41             | 18 months              |
| `visitor-recovery`    | 58               | 59             | Message only           |
| `cargo-warning`       | 113              | 114            | Message only           |
| `oil-shock`           | 128              | 129            | 3 months               |
| `cargo-restored`      | 131              | 132            | Message only           |
| `local-energy-review` | 132              | 133            | Message only           |

No choices.

No permanent loads.

## 106 · Data Center Boom

Preparation lead: 0 months.

This arc has no timed phases; its load and decision are listed below.

| Choice ID    | Due month | Option IDs             | Automatic response without choices |
| ------------ | --------- | ---------------------- | ---------------------------------- |
| `connection` | 49        | `fast-track`, `phased` | `fast-track`                       |

| Load ID                           | Starts in playable month | Branch                                 |
| --------------------------------- | ------------------------ | -------------------------------------- |
| `manassas-data-centers`           | 73                       | Base schedule; replaceable by a choice |
| `manassas-data-centers-phase-one` | 73                       | `connection/phased`                    |
| `manassas-data-centers-phase-two` | 97                       | `connection/phased`                    |

## 107 · Deep Freeze

Preparation lead: 0 months.

| Phase ID | Relocated offset | Playable month | Active duration (Easy) |
| -------- | ---------------- | -------------- | ---------------------- |
| `uri`    | 49               | 50             | 1 month                |
| `thaw`   | 50               | 51             | Message only           |

| Choice ID       | Due month | Option IDs              | Automatic response without choices |
| --------------- | --------- | ----------------------- | ---------------------------------- |
| `winterization` | 37        | `standard`, `winterize` | `standard`                         |

No permanent loads.

## 108 · Heatwave + Drought

Preparation lead: 12 months.

| Phase ID           | Relocated offset | Playable month | Active duration (Easy) |
| ------------------ | ---------------- | -------------- | ---------------------- |
| `seasonal-warning` | 18               | 19             | Message only           |
| `heatwave-month-1` | 41               | 42             | 1 month                |
| `heatwave-month-2` | 42               | 43             | 1 month                |
| `heatwave-month-3` | 43               | 44             | 1 month                |
| `cooler-weather`   | 44               | 45             | Message only           |

No choices.

No permanent loads.

## 110 · Sudden Nuclear Shutdown

Preparation lead: 12 months.

| Phase ID             | Relocated offset | Playable month | Active duration (Easy) |
| -------------------- | ---------------- | -------------- | ---------------------- |
| `contingency-review` | 13               | 14             | Message only           |
| `trip`               | 42–48            | 43–49          | 48 months              |

No choices.

No permanent loads.

## 111 · Wildfire Emergency

Preparation lead: 24 months.

| Phase ID    | Relocated offset | Playable month | Active duration (Easy) |
| ----------- | ---------------- | -------------- | ---------------------- |
| `readiness` | 25               | 26             | Message only           |
| `outage`    | 36               | 37             | 2 months               |
| `restored`  | 38               | 39             | Message only           |

No choices.

No permanent loads.

## 113 · Load Shedding

Preparation lead: 24 months.

| Phase ID              | Relocated offset | Playable month | Active duration (Easy) |
| --------------------- | ---------------- | -------------- | ---------------------- |
| `maintenance-backlog` | 30               | 31             | Message only           |
| `availability-step-1` | 36               | 37             | 12 months              |
| `availability-step-2` | 48               | 49             | 12 months              |
| `availability-step-3` | 60               | 61             | 12 months              |
| `availability-step-4` | 72               | 73             | 12 months              |

No choices.

No permanent loads.

## 114 · The River Runs Dry

Preparation lead: 24 months.

| Phase ID              | Relocated offset | Playable month | Active duration (Easy) |
| --------------------- | ---------------- | -------------- | ---------------------- |
| `poor-rains-forecast` | 32               | 33             | Message only           |
| `reservoir-step-1`    | 36               | 37             | 6 months               |
| `reservoir-step-2`    | 42               | 43             | 6 months               |
| `reservoir-step-3`    | 48               | 49             | 12 months              |
| `reservoir-step-4`    | 60               | 61             | 12 months              |

No choices.

| Load ID            | Starts in playable month | Branch                                 |
| ------------------ | ------------------------ | -------------------------------------- |
| `copperbelt-mines` | 1                        | Base schedule; replaceable by a choice |

## 115 · Delhi Summer

Preparation lead: 36 months.

| Phase ID         | Relocated offset | Playable month | Active duration (Easy) |
| ---------------- | ---------------- | -------------- | ---------------------- |
| `summer-outlook` | 38               | 39             | Message only           |
| `summer-peak-1`  | 40               | 41             | 3 months               |
| `summer-peak-2`  | 52               | 53             | 3 months               |
| `summer-peak-3`  | 64               | 65             | 3 months               |
| `summer-peak-4`  | 76               | 77             | 3 months               |

No choices.

No permanent loads.

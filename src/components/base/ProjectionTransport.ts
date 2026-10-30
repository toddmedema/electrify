import cloneDeep from "lodash.clonedeep";
import { monthMinute, ProjectionView } from "../../helpers/Projection";
import { GAME_TO_REAL_YEARS } from "../../Constants";
import {
  DeferredResidentialLoad,
  GameType,
  TickPresentFutureType,
} from "../../Types";

type NumericTickKey = {
  [K in keyof TickPresentFutureType]-?: Exclude<
    TickPresentFutureType[K],
    undefined
  > extends number
    ? K
    : never;
}[keyof TickPresentFutureType];
type ObjectTickKey = Exclude<keyof TickPresentFutureType, NumericTickKey>;
// Exhaustive: a new nonnumeric tick field needs an explicit transport representation.
const objectFields = {
  areaTicks: "areas",
  supplyByFuel: "dictionary",
  demandByType: "dictionary",
  renewableCapacityFactors: "dictionary",
  transmissionCapacityLimitsWByCorridor: "dictionary",
  deferredResidential: "queue",
  deferredResidentialStart: "queue",
  deferredThermal: "queue",
  deferredThermalStart: "queue",
  deferredCharging: "queue",
  deferredChargingStart: "queue",
} as const satisfies Record<ObjectTickKey, "dictionary" | "queue" | "areas">;
type DictionaryKey = {
  [K in ObjectTickKey]: (typeof objectFields)[K] extends "dictionary"
    ? K
    : never;
}[ObjectTickKey];
type QueueKey = {
  [K in ObjectTickKey]: (typeof objectFields)[K] extends "queue" ? K : never;
}[ObjectTickKey];
const dictionaryKeys = Object.keys(objectFields).filter(
  (key) => objectFields[key as ObjectTickKey] === "dictionary",
) as DictionaryKey[];
const queueKeys = Object.keys(objectFields).filter(
  (key) => objectFields[key as ObjectTickKey] === "queue",
) as QueueKey[];

interface PackedNumbers {
  keys: string[];
  count: number;
  values: Float64Array<ArrayBuffer>;
  // 0: absent, 1: explicitly undefined, 2: number (including NaN and infinities).
  presence: Uint8Array<ArrayBuffer>;
}
interface PackedDictionary {
  numbers: PackedNumbers;
  presence: Uint8Array<ArrayBuffer>;
}
interface PackedQueue {
  presence: Uint8Array<ArrayBuffer>;
  offsets: Uint32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
  arrayIds: Uint32Array<ArrayBuffer>;
}
export interface ProjectionTransport {
  ticks: {
    numbers: PackedNumbers;
    areas: {
      presence: Uint8Array<ArrayBuffer>;
      values: TickPresentFutureType["areaTicks"][];
    };
    dictionaries: Record<DictionaryKey, PackedDictionary>;
    queues: Record<QueueKey, PackedQueue>;
    queueEntries: PackedNumbers;
  };
  sampledIndices: Uint32Array<ArrayBuffer>;
  cashMonths: number;
  view: Omit<
    ProjectionView,
    | "timeline"
    | "sampled"
    | "supplyDemandTimeline"
    | "forecast"
    | "financePast"
    | "cashProjected"
    | "cashBaseline"
  >;
}

function presence(row: object, key: string): number {
  return Object.prototype.hasOwnProperty.call(row, key)
    ? (row as Record<string, unknown>)[key] === undefined
      ? 1
      : 2
    : 0;
}

function packNumbers(
  rows: readonly object[],
  omit?: ReadonlySet<string>,
): PackedNumbers {
  const keys = Array.from(
    new Set(
      rows.flatMap((row) => Object.keys(row).filter((key) => !omit?.has(key))),
    ),
  );
  const values = new Float64Array(rows.length * keys.length);
  const states = new Uint8Array(values.length);
  rows.forEach((row, i) => {
    keys.forEach((key, j) => {
      const index = i * keys.length + j;
      states[index] = presence(row, key);
      if (states[index] === 2) {
        const value = (row as Record<string, unknown>)[key];
        if (typeof value !== "number")
          throw new Error("Nonnumeric forecast field");
        values[index] = value;
      }
    });
  });
  return { keys, count: rows.length, values, presence: states };
}

function readNumbers(
  packed: PackedNumbers,
  row: number,
): Record<string, number | undefined> {
  const result: Record<string, number | undefined> = {};
  packed.keys.forEach((key, j) => {
    const index = row * packed.keys.length + j;
    if (packed.presence[index])
      result[key] =
        packed.presence[index] === 1 ? undefined : packed.values[index];
  });
  return result;
}

/** Transfer buffers instead of making the browser deserialize thousands of rich tick graphs. */
export function packProjection(projection: ProjectionView): {
  transport: ProjectionTransport;
  transfers: ArrayBuffer[];
} {
  const forecast = projection.forecast;
  const dictionaries = {} as Record<DictionaryKey, PackedDictionary>;
  const queues = {} as Record<QueueKey, PackedQueue>;
  const transfers: ArrayBuffer[] = [];
  const addNumbers = (numbers: PackedNumbers) => {
    transfers.push(numbers.values.buffer, numbers.presence.buffer);
    return numbers;
  };
  const numbers = addNumbers(
    packNumbers(forecast, new Set(Object.keys(objectFields))),
  );
  dictionaryKeys.forEach((key) => {
    const states = Uint8Array.from(forecast, (tick) => presence(tick, key));
    dictionaries[key] = {
      presence: states,
      numbers: addNumbers(packNumbers(forecast.map((tick) => tick[key] ?? {}))),
    };
    transfers.push(states.buffer);
  });
  const entries: DeferredResidentialLoad[] = [];
  const entryIndices = new Map<DeferredResidentialLoad, number>();
  const arrayIds = new Map<DeferredResidentialLoad[], number>();
  queueKeys.forEach((key) => {
    const indices: number[] = [];
    const offsets = new Uint32Array(forecast.length + 1);
    const ids = new Uint32Array(forecast.length);
    forecast.forEach((tick, i) => {
      const queue = tick[key];
      if (queue) {
        if (!arrayIds.has(queue)) arrayIds.set(queue, arrayIds.size + 1);
        ids[i] = arrayIds.get(queue)!;
        queue.forEach((entry) => {
          let index = entryIndices.get(entry);
          if (index === undefined) {
            index = entries.length;
            entries.push(entry);
            entryIndices.set(entry, index);
          }
          indices.push(index);
        });
      }
      offsets[i + 1] = indices.length;
    });
    const states = Uint8Array.from(forecast, (tick) => presence(tick, key));
    queues[key] = {
      presence: states,
      offsets,
      indices: Uint32Array.from(indices),
      arrayIds: ids,
    };
    transfers.push(
      states.buffer,
      offsets.buffer,
      queues[key].indices.buffer,
      ids.buffer,
    );
  });
  const queueEntries = addNumbers(packNumbers(entries));
  const areas = {
    presence: Uint8Array.from(forecast, (tick) => presence(tick, "areaTicks")),
    values: cloneDeep(forecast.map((tick) => tick.areaTicks)),
  };
  transfers.push(areas.presence.buffer);
  const indices = new Map(forecast.map((tick, index) => [tick, index]));
  const historicalCount = projection.timeline.length - forecast.length;
  const sampledIndices = Uint32Array.from(
    projection.sampled.slice(historicalCount),
    (tick) => indices.get(tick)!,
  );
  transfers.push(sampledIndices.buffer);
  const {
    timeline: _timeline,
    sampled: _sampled,
    supplyDemandTimeline: _supplyDemand,
    forecast: _forecast,
    financePast: _financePast,
    cashBaseline: _cashBaseline,
    cashProjected: _cashProjected,
    ...view
  } = projection;
  return {
    transport: {
      ticks: { numbers, dictionaries, queues, queueEntries, areas },
      sampledIndices,
      cashMonths: projection.cashProjected.length,
      view,
    },
    transfers,
  };
}

/** A decoder that can yield between ticks; no simulation or numeric rounding occurs here. */
export function projectionDecoder(
  transport: ProjectionTransport,
  game: GameType,
  now: TickPresentFutureType,
): (deadline: number) => ProjectionView | undefined {
  const forecast: TickPresentFutureType[] = [];
  const historicalCharts: TickPresentFutureType[] = [];
  const historicalSupplyDemand: TickPresentFutureType[] = [];
  const queueArrays = new Map<number, DeferredResidentialLoad[]>();
  const queueEntries: DeferredResidentialLoad[] = [];
  let tickIndex = 0;
  let historyIndex = game.monthlyHistory.length - 1;
  return (deadline) => {
    while (tickIndex < transport.ticks.numbers.count) {
      const rowIndex = tickIndex;
      const row = readNumbers(
        transport.ticks.numbers,
        rowIndex,
      ) as Partial<TickPresentFutureType>;
      dictionaryKeys.forEach((key) => {
        const packed = transport.ticks.dictionaries[key];
        if (packed.presence[rowIndex])
          Object.assign(row, {
            [key]:
              packed.presence[rowIndex] === 1
                ? undefined
                : readNumbers(packed.numbers, rowIndex),
          });
      });
      queueKeys.forEach((key) => {
        const packed = transport.ticks.queues[key];
        if (!packed.presence[rowIndex]) return;
        if (packed.presence[rowIndex] === 1) row[key] = undefined;
        else {
          const id = packed.arrayIds[rowIndex];
          let entries = queueArrays.get(id);
          if (!entries) {
            entries = [];
            for (
              let i = packed.offsets[rowIndex];
              i < packed.offsets[rowIndex + 1];
              i++
            ) {
              const entry = packed.indices[i];
              queueEntries[entry] ??= readNumbers(
                transport.ticks.queueEntries,
                entry,
              ) as unknown as DeferredResidentialLoad;
              entries.push(queueEntries[entry]);
            }
            queueArrays.set(id, entries);
          }
          row[key] = entries;
        }
      });
      if (transport.ticks.areas.presence[rowIndex])
        row.areaTicks =
          transport.ticks.areas.presence[rowIndex] === 1
            ? undefined
            : cloneDeep(transport.ticks.areas.values[rowIndex]);
      forecast.push(row as TickPresentFutureType);
      tickIndex++;
      if (performance.now() >= deadline) return undefined;
    }
    while (historyIndex >= 0) {
      const month = game.monthlyHistory[historyIndex--];
      const minute = monthMinute(month, game.startingYear);
      historicalSupplyDemand.push({
        ...now,
        minute,
        supplyW: month.supplyWh / (24 * GAME_TO_REAL_YEARS),
        demandW: month.demandWh / (24 * GAME_TO_REAL_YEARS),
      });
      if (month.chartAverage)
        historicalCharts.push({ ...month.chartAverage, minute });
      if (performance.now() >= deadline) return undefined;
    }
    return {
      ...transport.view,
      forecast,
      timeline: [...historicalCharts, ...forecast],
      sampled: [
        ...historicalCharts,
        ...Array.from(transport.sampledIndices, (index) => forecast[index]),
      ],
      supplyDemandTimeline: [...historicalSupplyDemand, ...forecast],
      financePast: game.monthlyHistory,
      cashBaseline: game.timeline,
      cashProjected: transport.view.financeProjected.slice(
        0,
        transport.cashMonths,
      ),
    };
  };
}

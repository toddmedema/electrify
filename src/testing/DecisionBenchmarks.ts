import { DifficultyType } from "../Types";

/** Internal playbook benchmarks only; never a player victory condition. */
export const MEANINGFUL_DECISION_REQUIREMENTS: Record<
  DifficultyType,
  { count: number; categories: number }
> = {
  Intern: { count: 1, categories: 1 },
  Employee: { count: 1, categories: 1 },
  Manager: { count: 2, categories: 1 },
  VP: { count: 4, categories: 2 },
  CEO: {
    count: 10,
    categories: 4,
  },
};

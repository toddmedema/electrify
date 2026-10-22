import type {
  CompiledRuleChoice,
  CompiledScenarioRules,
  RuleCondition,
  RuleDiagnostic,
} from "../data/ScenarioRules";

type ChoiceReference = Pick<RuleCondition, "arc" | "choiceId">;
type RuleChoiceCollections = Pick<
  CompiledScenarioRules,
  "choices" | "arcChoices"
>;
export interface RuleDependencyOptions {
  /** Only the author-only compiler may defer arcs until their detached choices are assembled. */
  allowUnresolvedArcChoices?: boolean;
}

const byId = (a: CompiledRuleChoice, b: CompiledRuleChoice) =>
  a.id < b.id
    ? -1
    : a.id > b.id
      ? 1
      : a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : 0;
const referenceKey = (reference: ChoiceReference) =>
  `${reference.arc === undefined ? "own" : reference.arc}:${reference.choiceId}`;

/** Package and catalog choices share ordering, while their reference namespaces stay separate. */
export function ruleChoices(
  rules: RuleChoiceCollections,
): CompiledRuleChoice[] {
  return [...rules.choices, ...(rules.arcChoices ?? [])].sort(byId);
}

export function resolveScenarioRuleChoice(
  reference: ChoiceReference,
  rules: RuleChoiceCollections,
): CompiledRuleChoice | undefined {
  return reference.arc === undefined
    ? rules.choices.find((choice) => choice.id === reference.choiceId)
    : ruleChoices(rules).find((choice) => {
        const source = choice.source;
        return (
          source !== undefined &&
          source.scenarioId === reference.arc &&
          source.choiceId === reference.choiceId
        );
      });
}

export interface ScenarioRuleChoiceNode {
  choice: CompiledRuleChoice;
  path: string;
  parent?: ScenarioRuleChoiceNode;
  children: ScenarioRuleChoiceNode[];
  /** A branch may be valid data and still never be offered (an automatic answer excludes it). */
  reachable: boolean;
  deferred: boolean;
}

export interface ScenarioRuleChoiceGraph {
  choices: CompiledRuleChoice[];
  nodes: ScenarioRuleChoiceNode[];
  roots: ScenarioRuleChoiceNode[];
  byReference: ReadonlyMap<string, ScenarioRuleChoiceNode>;
  diagnostics: RuleDiagnostic[];
}

const optionsFor = (choice: CompiledRuleChoice) =>
  choice.automatic
    ? choice.options.filter((option) => option.id === choice.freeOptionId)
    : choice.options;

/** One prerequisite per choice makes the dependency graph a forest, never a Boolean expression. */
export function createScenarioRuleChoiceGraph(
  rules: CompiledScenarioRules,
  options: RuleDependencyOptions = {},
): ScenarioRuleChoiceGraph {
  const diagnostics: RuleDiagnostic[] = [];
  const add = (code: string, path: string, message: string) =>
    diagnostics.push({ code, path, severity: "error", message });
  const own = new Set(rules.choices);
  const paths = new Map<CompiledRuleChoice, string>([
    ...rules.choices.map(
      (choice, index) => [choice, `choices[${index}]`] as const,
    ),
    ...(rules.arcChoices ?? []).map(
      (choice, index) => [choice, `arcChoices[${index}]`] as const,
    ),
  ]);
  const choices = ruleChoices(rules);
  const nodes: ScenarioRuleChoiceNode[] = choices.map((choice) => ({
    choice,
    path: paths.get(choice)!,
    children: [],
    reachable: false,
    deferred: false,
  }));
  const byReference = new Map<string, ScenarioRuleChoiceNode>();
  const register = (key: string, node: ScenarioRuleChoiceNode) => {
    const previous = byReference.get(key);
    if (previous && previous !== node)
      add(
        "duplicate-choice-reference",
        node.path,
        `Choice reference ${key} is defined twice.`,
      );
    else byReference.set(key, node);
  };
  nodes.forEach((node) => {
    const { choice } = node;
    if (own.has(choice)) register(referenceKey({ choiceId: choice.id }), node);
    if (choice.source)
      register(
        referenceKey({
          arc: choice.source.scenarioId,
          choiceId: choice.source.choiceId,
        }),
        node,
      );
    if (
      !choice.options.some(
        (option) => option.id === choice.freeOptionId && option.cost === 0,
      )
    )
      add(
        "invalid-free-option",
        `${node.path}.freeOptionId`,
        "The free option must name an existing option with zero cost.",
      );
    if (choice.dueMonth < 0 || choice.dueMonth >= rules.durationMonths)
      add(
        "outside-term",
        `${node.path}.dueMonth`,
        `Choice ${choice.id} is outside the run's term.`,
      );
  });
  nodes.forEach((node) => {
    const condition = node.choice.requiresChoice;
    if (!condition) return;
    const parent = byReference.get(referenceKey(condition));
    if (
      !parent &&
      condition.arc !== undefined &&
      options.allowUnresolvedArcChoices
    ) {
      node.deferred = true;
      return;
    }
    node.parent = parent;
    parent?.children.push(node);
    diagnostics.push(
      ...conditionDiagnostics(
        condition,
        node.choice.dueMonth,
        `${node.path}.requiresChoice`,
        parent,
      ),
    );
  });

  const complete = new Set<ScenarioRuleChoiceNode>();
  const visiting = new Set<ScenarioRuleChoiceNode>();
  const cyclic = new Set<ScenarioRuleChoiceNode>();
  const visit = (node: ScenarioRuleChoiceNode): void => {
    if (complete.has(node)) return;
    if (visiting.has(node)) {
      if (!cyclic.has(node))
        add(
          "choice-cycle",
          `${node.path}.requiresChoice`,
          `Choice dependency cycle includes ${node.choice.id}.`,
        );
      visiting.forEach((current) => cyclic.add(current));
      return;
    }
    visiting.add(node);
    if (node.parent) visit(node.parent);
    visiting.delete(node);
    complete.add(node);
  };
  nodes.forEach(visit);
  const reached = new Set<ScenarioRuleChoiceNode>();
  const reach = (node: ScenarioRuleChoiceNode): boolean => {
    if (reached.has(node)) return node.reachable;
    reached.add(node);
    if (cyclic.has(node)) return false;
    if (!node.choice.requiresChoice) node.reachable = true;
    else if (node.parent) {
      const parentReachable = reach(node.parent);
      node.deferred ||= node.parent.deferred;
      node.reachable =
        parentReachable &&
        optionsFor(node.parent.choice).some((option) =>
          node.choice.requiresChoice!.optionIds.includes(option.id),
        );
    }
    return node.reachable;
  };
  nodes.forEach((node) => {
    reach(node);
    if (!node.reachable && !node.deferred && !cyclic.has(node) && node.parent)
      diagnostics.push({
        code: "unreachable-choice",
        path: node.path,
        severity: "warning",
        message: `Choice ${node.choice.id} is never offered: its prerequisite is excluded on every reachable branch.`,
      });
  });
  return {
    choices,
    nodes,
    roots: nodes.filter((node) => !node.choice.requiresChoice),
    byReference,
    diagnostics,
  };
}

function conditionDiagnostics(
  condition: RuleCondition,
  firstMonth: number,
  path: string,
  node: ScenarioRuleChoiceNode | undefined,
): RuleDiagnostic[] {
  const diagnostics: RuleDiagnostic[] = [];
  const add = (code: string, field: string, message: string) =>
    diagnostics.push({
      code,
      path: `${path}${field}`,
      severity: "error",
      message,
    });
  if (!node) {
    add(
      "unknown-choice",
      ".choiceId",
      `${condition.choiceId} is not a defined ${condition.arc === undefined ? "package" : `arc ${condition.arc}`} choice.`,
    );
    return diagnostics;
  }
  if (node.choice.dueMonth > firstMonth)
    add(
      "later-decision",
      "",
      `The dependency is due in month ${node.choice.dueMonth + 1}, after month ${firstMonth + 1}. Every possible event placement must follow its decision.`,
    );
  if (!condition.optionIds.length)
    add(
      "empty-options",
      ".optionIds",
      "requiresChoice must name at least one option.",
    );
  if (new Set(condition.optionIds).size !== condition.optionIds.length)
    add(
      "duplicate-option-reference",
      ".optionIds",
      "requiresChoice option IDs must be unique.",
    );
  const available = new Set(node.choice.options.map((option) => option.id));
  for (const id of condition.optionIds)
    if (!available.has(id))
      add(
        "unknown-option",
        ".optionIds",
        `${id} is not an option of ${node.choice.id}.`,
      );
  if (
    condition.optionIds.length === available.size &&
    condition.optionIds.every((id) => available.has(id))
  )
    add(
      "unnecessary-condition",
      "",
      "This names every option. Remove requiresChoice instead.",
    );
  return diagnostics;
}

/** Validate the fully assembled detached rules, including imported choice dependencies. */
export function scenarioRuleDependencyDiagnostics(
  rules: CompiledScenarioRules,
  options: RuleDependencyOptions = {},
): RuleDiagnostic[] {
  const graph = createScenarioRuleChoiceGraph(rules, options);
  const diagnostics = [...graph.diagnostics];
  for (const [collection, events] of [
    ["events", rules.events],
    ["arcEvents", rules.arcEvents ?? []],
  ] as const) {
    events.forEach((event, index) => {
      const condition = event.requiresChoice;
      if (!condition) return;
      const node = graph.byReference.get(referenceKey(condition));
      if (
        !node &&
        condition.arc !== undefined &&
        options.allowUnresolvedArcChoices
      )
        return;
      const path = `${collection}[${index}].requiresChoice`;
      diagnostics.push(
        ...conditionDiagnostics(
          condition,
          event.possibleStartMonths.from,
          path,
          node,
        ),
      );
      if (
        node &&
        !node.deferred &&
        !scenarioRuleConditionsCanCoexist(graph, [condition])
      )
        diagnostics.push({
          code: "unreachable-event",
          path,
          severity: "warning",
          message: `Event ${event.id} is never activated on a reachable choice branch.`,
        });
    });
  }
  graph.nodes.forEach((node) =>
    node.choice.options.forEach((option, optionIndex) => {
      option.replaceLoad?.with.forEach((load, loadIndex) => {
        if (load.startMonth < node.choice.dueMonth)
          diagnostics.push({
            code: "replacement-before-decision",
            path: `${node.path}.options[${optionIndex}].replaceLoad.with[${loadIndex}].startMonth`,
            severity: "error",
            message:
              "A replacement load cannot start before the choice that creates it.",
          });
      });
    }),
  );
  const own = new Set(rules.choices);
  const replacements = new Map<
    string,
    Array<{
      node: ScenarioRuleChoiceNode;
      condition: RuleCondition;
      path: string;
    }>
  >();
  graph.nodes.forEach((node) =>
    node.choice.options.forEach((option, index) => {
      const replacement = option.replaceLoad;
      if (!replacement) return;
      const reference = own.has(node.choice)
        ? { choiceId: node.choice.id }
        : node.choice.source
          ? {
              arc: node.choice.source.scenarioId,
              choiceId: node.choice.source.choiceId,
            }
          : undefined;
      if (!reference) return;
      const target = `${replacement.arc ?? "own"}:${replacement.loadId}`;
      replacements.set(target, [
        ...(replacements.get(target) ?? []),
        {
          node,
          condition: { ...reference, optionIds: [option.id] },
          path: `${node.path}.options[${index}].replaceLoad`,
        },
      ]);
    }),
  );
  replacements.forEach((entries, target) => {
    const reported = new Set<string>();
    entries.forEach((entry, index) => {
      entries.slice(index + 1).forEach((other) => {
        const pair = `${entry.node.choice.key}|${other.node.choice.key}`;
        if (
          reported.has(pair) ||
          !scenarioRuleConditionsCanCoexist(graph, [
            entry.condition,
            other.condition,
          ])
        )
          return;
        reported.add(pair);
        diagnostics.push({
          code: "overlapping-load-replacement",
          path: other.path,
          severity: "error",
          message: `Choices ${entry.node.choice.id} and ${other.node.choice.id} can both replace ${target}. Replace each load in one choice, or make these choices mutually exclusive.`,
        });
      });
    });
  });
  return diagnostics;
}

/** Intersect option constraints up each ancestry chain; no complete response matrix is needed. */
export function scenarioRuleConditionsCanCoexist(
  graph: ScenarioRuleChoiceGraph,
  conditions: readonly (RuleCondition | undefined)[],
  month = Infinity,
): boolean {
  const constraints = new Map<ScenarioRuleChoiceNode, Set<string>>();
  for (const condition of conditions) {
    if (!condition) continue;
    let current: RuleCondition | undefined = condition;
    const visited = new Set<ScenarioRuleChoiceNode>();
    while (current) {
      const node = graph.byReference.get(referenceKey(current));
      if (
        !node ||
        node.deferred ||
        visited.has(node) ||
        node.choice.dueMonth > month
      )
        return false;
      visited.add(node);
      const prior = constraints.get(node);
      const eligible = new Set(
        optionsFor(node.choice).map((option) => option.id),
      );
      const allowed = new Set(
        current.optionIds.filter(
          (id) => eligible.has(id) && (!prior || prior.has(id)),
        ),
      );
      if (!allowed.size) return false;
      constraints.set(node, allowed);
      current = node.choice.requiresChoice;
    }
  }
  return true;
}

export interface RuleChoiceFactor {
  requiresChoice?: RuleCondition;
  min: number;
  max: number;
  /** Zero inflow is valid, but cannot hide an otherwise unsafe positive factor. */
  positiveMin: number;
}
export interface RuleChoiceEnvelope {
  min: number;
  max: number;
  positiveMin: number;
}
const neutral = (): RuleChoiceEnvelope => ({ min: 1, max: 1, positiveMin: 1 });
const multiply = (
  left: RuleChoiceEnvelope,
  right: RuleChoiceEnvelope,
): RuleChoiceEnvelope => ({
  min: left.min * right.min,
  max: left.max * right.max,
  positiveMin: left.positiveMin * right.positiveMin,
});

/** Linear forest dynamic programming in choices × options × attached effects, per month. */
export function scenarioRuleChoiceEnvelope(
  graph: ScenarioRuleChoiceGraph,
  month: number,
  factors: readonly RuleChoiceFactor[],
  algebra: {
    neutral: () => RuleChoiceEnvelope;
    combine: (
      left: RuleChoiceEnvelope,
      right: RuleChoiceEnvelope,
    ) => RuleChoiceEnvelope;
  } = { neutral, combine: multiply },
): RuleChoiceEnvelope {
  const weights = new Map<ScenarioRuleChoiceNode, RuleChoiceFactor[]>();
  let result = algebra.neutral();
  factors.forEach((factor) => {
    if (!factor.requiresChoice) result = algebra.combine(result, factor);
    else {
      const node = graph.byReference.get(referenceKey(factor.requiresChoice));
      // A deferred arc is checked after compilation assembles its detached choices.
      if (node) weights.set(node, [...(weights.get(node) ?? []), factor]);
    }
  });
  // A child reached by several parent options has the same outcomes each time. Without this
  // memo, a deep chain allowing seven of eight options would expand to seven to that depth.
  const memo = new Map<ScenarioRuleChoiceNode, RuleChoiceEnvelope>();
  const visit = (node: ScenarioRuleChoiceNode): RuleChoiceEnvelope => {
    const cached = memo.get(node);
    if (cached) return cached;
    if (node.choice.dueMonth > month || node.deferred) return algebra.neutral();
    const outcomes = optionsFor(node.choice).map((option) => {
      let outcome = algebra.neutral();
      (weights.get(node) ?? []).forEach((factor) => {
        if (factor.requiresChoice!.optionIds.includes(option.id))
          outcome = algebra.combine(outcome, factor);
      });
      node.children.forEach((child) => {
        if (child.choice.requiresChoice!.optionIds.includes(option.id))
          outcome = algebra.combine(outcome, visit(child));
      });
      return outcome;
    });
    const result = outcomes.length
      ? {
          min: Math.min(...outcomes.map((outcome) => outcome.min)),
          max: Math.max(...outcomes.map((outcome) => outcome.max)),
          positiveMin: Math.min(
            ...outcomes.map((outcome) => outcome.positiveMin),
          ),
        }
      : algebra.neutral();
    memo.set(node, result);
    return result;
  };
  graph.roots.forEach((root) => {
    result = algebra.combine(result, visit(root));
  });
  return result;
}

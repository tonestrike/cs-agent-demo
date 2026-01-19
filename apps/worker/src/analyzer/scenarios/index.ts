import type { ScenarioCategory, ScenarioDefinition } from "../types";
import { cancelScenarios } from "./cancel";
import { rescheduleScenarios } from "./reschedule";
import { verificationScenarios } from "./verification";

/**
 * All registered scenarios
 */
export const scenarioRegistry: ScenarioDefinition[] = [
  ...verificationScenarios,
  ...rescheduleScenarios,
  ...cancelScenarios,
];

/**
 * Get a scenario by ID
 */
export function getScenario(id: string): ScenarioDefinition | undefined {
  return scenarioRegistry.find((s) => s.id === id);
}

/**
 * List scenarios with optional filtering
 */
export function listScenarios(options?: {
  category?: ScenarioCategory;
}): Array<{
  id: string;
  name: string;
  description: string;
  category: ScenarioCategory;
  stepCount: number;
}> {
  let scenarios = scenarioRegistry;

  if (options?.category) {
    scenarios = scenarios.filter((s) => s.category === options.category);
  }

  return scenarios.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    stepCount: s.steps.length,
  }));
}

/**
 * Get all scenarios in a category
 */
export function getScenariosByCategory(
  category: ScenarioCategory,
): ScenarioDefinition[] {
  return scenarioRegistry.filter((s) => s.category === category);
}

/**
 * Get all unique categories
 */
export function getCategories(): ScenarioCategory[] {
  const categories = new Set<ScenarioCategory>();
  for (const scenario of scenarioRegistry) {
    categories.add(scenario.category);
  }
  return Array.from(categories);
}

// Re-export individual scenario modules
export { verificationScenarios } from "./verification";
export { rescheduleScenarios } from "./reschedule";
export { cancelScenarios } from "./cancel";

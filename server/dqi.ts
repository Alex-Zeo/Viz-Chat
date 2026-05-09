import type { DqiDimensions, DashboardDqi, VerifyIssue, AgentStatus } from './types.js';
import type { InteractionTestSuite } from './interaction-tests.js';
import type { FrameStore } from './frame-store.js';

const WEIGHTS: Record<keyof DqiDimensions, number> = {
  completeness: 0.20,
  accuracy: 0.20,
  fidelity: 0.15,
  consistency: 0.15,
  interactivity: 0.10,
  consoleHealth: 0.10,
  performance: 0.10,
};

const CONVERGENCE_PQI = 0.85;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function computeDqi(
  testSuite: InteractionTestSuite,
  agents: AgentStatus[],
  frameStore: FrameStore,
  renderTimeMs: number,
  cycle: number,
): DashboardDqi {
  const expectedPanels = 4;

  // Completeness: fraction of panels with rendered chart canvas
  const panelTest = testSuite.results.find((r) => r.name.includes('T1'));
  const panelCriticals = panelTest?.issues.filter((i) => i.severity === 'CRITICAL').length ?? 0;
  const completeness = clamp01((expectedPanels - panelCriticals) / expectedPanels);

  // Accuracy: panel data series match source — approximated by checking
  // converged agents' PQI accuracy pillar (A in PQI formula)
  let accuracySum = 0;
  let accuracyCount = 0;
  for (const agent of agents) {
    const best = frameStore.getBestFrame(agent.agentId);
    if (best) {
      accuracySum += best.eval.pillars.A;
      accuracyCount++;
    }
  }
  const accuracy = accuracyCount > 0 ? clamp01(accuracySum / accuracyCount) : 0;

  // Fidelity: all panels PQI >= 0.85, weighted by how many pass
  let fidelityPassCount = 0;
  let avgPqi = 0;
  for (const agent of agents) {
    const best = frameStore.getBestFrame(agent.agentId);
    if (best) {
      avgPqi += best.eval.pqi;
      if (best.eval.pqi >= CONVERGENCE_PQI) fidelityPassCount++;
    }
  }
  if (agents.length > 0) avgPqi /= agents.length;
  const fidelityPassRate = agents.length > 0 ? fidelityPassCount / agents.length : 0;
  const fidelity = clamp01(fidelityPassRate * 0.6 + avgPqi * 0.4);

  // Consistency: design token checks (T6)
  const designTest = testSuite.results.find((r) => r.name.includes('T6'));
  const designIssueCount = designTest?.issues.length ?? 0;
  const consistency = clamp01(1 - designIssueCount * 0.15);

  // Interactivity: tooltip/hover checks — approximated from PQI interactivity pillar
  let interactivitySum = 0;
  let interactivityCount = 0;
  for (const agent of agents) {
    const best = frameStore.getBestFrame(agent.agentId);
    if (best) {
      interactivitySum += best.eval.pillars.I;
      interactivityCount++;
    }
  }
  const interactivity = interactivityCount > 0
    ? clamp01(interactivitySum / interactivityCount)
    : 0.5;

  // Console Health: 1.0 if zero errors, degrades per error
  const consoleTest = testSuite.results.find((r) => r.name.includes('T2'));
  const consoleErrors = consoleTest?.issues.length ?? 0;
  const consoleHealth = clamp01(1 - consoleErrors * 0.25);

  // Performance: all panels render in < 2s
  const performance = clamp01(renderTimeMs < 2000 ? 1.0 : 2000 / renderTimeMs);

  const dimensions: DqiDimensions = {
    completeness,
    accuracy,
    fidelity,
    consistency,
    interactivity,
    consoleHealth,
    performance,
  };

  const score =
    WEIGHTS.completeness * completeness +
    WEIGHTS.accuracy * accuracy +
    WEIGHTS.fidelity * fidelity +
    WEIGHTS.consistency * consistency +
    WEIGHTS.interactivity * interactivity +
    WEIGHTS.consoleHealth * consoleHealth +
    WEIGHTS.performance * performance;

  return {
    score: Math.round(score * 10000) / 10000,
    dimensions,
    cycle,
    issues: testSuite.totalIssues,
  };
}

export function formatDqiReport(dqi: DashboardDqi): string {
  const d = dqi.dimensions;
  const lines = [
    `DQI: ${dqi.score.toFixed(4)} (cycle ${dqi.cycle})`,
    `  Completeness:  ${d.completeness.toFixed(2)} (×0.20)`,
    `  Accuracy:      ${d.accuracy.toFixed(2)} (×0.20)`,
    `  Fidelity:      ${d.fidelity.toFixed(2)} (×0.15)`,
    `  Consistency:   ${d.consistency.toFixed(2)} (×0.15)`,
    `  Interactivity: ${d.interactivity.toFixed(2)} (×0.10)`,
    `  Console:       ${d.consoleHealth.toFixed(2)} (×0.10)`,
    `  Performance:   ${d.performance.toFixed(2)} (×0.10)`,
  ];

  if (dqi.issues.length > 0) {
    lines.push('');
    const criticals = dqi.issues.filter((i) => i.severity === 'CRITICAL');
    const highs = dqi.issues.filter((i) => i.severity === 'HIGH');
    const mediums = dqi.issues.filter((i) => i.severity === 'MEDIUM');

    if (criticals.length > 0) {
      lines.push(`  CRITICAL (${criticals.length}):`);
      for (const i of criticals) lines.push(`    - [${i.element}] ${i.symptom}`);
    }
    if (highs.length > 0) {
      lines.push(`  HIGH (${highs.length}):`);
      for (const i of highs) lines.push(`    - [${i.element}] ${i.symptom}`);
    }
    if (mediums.length > 0) {
      lines.push(`  MEDIUM (${mediums.length}):`);
      for (const i of mediums) lines.push(`    - [${i.element}] ${i.symptom}`);
    }
  }

  const status =
    dqi.score >= 0.95
      ? 'PRODUCTION-READY'
      : dqi.score >= 0.90
        ? 'HACKATHON-READY'
        : dqi.score >= 0.85
          ? 'NEEDS REMEDIATION'
          : 'FAILING';

  lines.push(`\n  Status: ${status}`);
  return lines.join('\n');
}

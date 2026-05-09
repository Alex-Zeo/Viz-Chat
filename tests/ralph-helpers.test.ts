import { describe, it, expect } from 'vitest';
import { structuralFingerprint, escalateFixes, buildDiagnostics } from '../server/ralph.js';
import type { AgentSpec, PanelEval } from '../server/types.js';

describe('structuralFingerprint', () => {
  it('produces same hash when only cosmetic properties differ', () => {
    const a = {
      title: { text: 'Revenue A' },
      tooltip: { trigger: 'axis' },
      series: [{ type: 'bar', data: [10, 20, 30] }],
      xAxis: { type: 'category', data: ['Jan', 'Feb', 'Mar'] },
      yAxis: { type: 'value' },
    };
    const b = {
      title: { text: 'Revenue B — different title' },
      tooltip: { trigger: 'item' },
      color: ['#ff0000'],
      series: [{ type: 'bar', data: [10, 20, 30] }],
      xAxis: { type: 'category', data: ['Jan', 'Feb', 'Mar'] },
      yAxis: { type: 'value' },
    };
    expect(structuralFingerprint(a)).toBe(structuralFingerprint(b));
  });

  it('produces different hash when series data differs', () => {
    const a = {
      series: [{ type: 'bar', data: [10, 20, 30] }],
      xAxis: { type: 'category', data: ['Jan', 'Feb', 'Mar'] },
    };
    const b = {
      series: [{ type: 'bar', data: [10, 20, 99] }],
      xAxis: { type: 'category', data: ['Jan', 'Feb', 'Mar'] },
    };
    expect(structuralFingerprint(a)).not.toBe(structuralFingerprint(b));
  });

  it('produces different hash when axis labels differ', () => {
    const a = {
      series: [{ type: 'line', data: [1, 2] }],
      xAxis: { type: 'category', data: ['Q1', 'Q2'] },
    };
    const b = {
      series: [{ type: 'line', data: [1, 2] }],
      xAxis: { type: 'category', data: ['H1', 'H2'] },
    };
    expect(structuralFingerprint(a)).not.toBe(structuralFingerprint(b));
  });

  it('produces different hash when series type differs', () => {
    const a = { series: [{ type: 'bar', data: [1] }] };
    const b = { series: [{ type: 'line', data: [1] }] };
    expect(structuralFingerprint(a)).not.toBe(structuralFingerprint(b));
  });

  it('includes encode in fingerprint when present', () => {
    const a = { series: [{ type: 'scatter', data: [[1, 2]], encode: { x: 0, y: 1 } }] };
    const b = { series: [{ type: 'scatter', data: [[1, 2]], encode: { x: 1, y: 0 } }] };
    expect(structuralFingerprint(a)).not.toBe(structuralFingerprint(b));
  });

  it('handles radar and geo in skeleton', () => {
    const a = { radar: { indicator: [{ name: 'A' }] }, series: [{ type: 'radar', data: [1] }] };
    const b = { radar: { indicator: [{ name: 'B' }] }, series: [{ type: 'radar', data: [1] }] };
    expect(structuralFingerprint(a)).not.toBe(structuralFingerprint(b));
  });
});

function makeSpec(dataSlice: Record<string, unknown>[]): AgentSpec {
  return {
    agentId: 'test-agent',
    vizType: { id: 'bar', name: 'Bar Chart', echartsType: 'bar', category: 'comparison' } as any,
    dataSlice: dataSlice as any,
    goals: [],
    designTokens: '',
    query: { rawQuery: 'test' } as any,
    companySlug: 'test-co',
  };
}

describe('escalateFixes', () => {
  it('passes through unchanged when no overlap with previous', () => {
    const fixes = ['Add tooltip', 'Fix title'];
    const prev = ['Add axis labels'];
    const result = escalateFixes(fixes, prev, makeSpec([{ category: 'Sales', value: 100 }]));
    expect(result).toEqual(fixes);
  });

  it('escalates with column hints when fixes overlap', () => {
    const fixes = ['Add tooltip', 'Fix title'];
    const prev = ['Add tooltip', 'Add axis labels'];
    const result = escalateFixes(fixes, prev, makeSpec([{ category: 'Sales', value: 100 }]));
    expect(result.some(f => f.includes('WARNING'))).toBe(true);
    expect(result.some(f => f.includes('Available data columns'))).toBe(true);
    expect(result.some(f => f.includes('DIFFERENT chart structure'))).toBe(true);
  });

  it('includes column names from data slice', () => {
    const data = [{ period: '2025-01', metric: 'Revenue', value: 500 }];
    const result = escalateFixes(['Fix it'], ['Fix it'], makeSpec(data));
    expect(result.some(f => f.includes('period'))).toBe(true);
    expect(result.some(f => f.includes('metric'))).toBe(true);
    expect(result.some(f => f.includes('value'))).toBe(true);
  });

  it('handles empty data slice gracefully', () => {
    const result = escalateFixes(['Fix it'], ['Fix it'], makeSpec([]));
    expect(result.some(f => f.includes('WARNING'))).toBe(true);
  });
});

describe('buildDiagnostics', () => {
  const eval_: PanelEval = {
    pqi: 0.65,
    pillars: { Q: 0.7, D: 0.6, F: 0.8, I: 0.5, A: 0.6, P: 0.4 },
    fixes: ['Fix tooltip'],
    mechanicalScore: 0.72,
    tier: 'both',
    typeCompliant: true,
  };

  it('assembles all fields correctly', () => {
    const diag = buildDiagnostics('agent-1', 2, eval_, ['Fix tooltip'], [], false);
    expect(diag.agentId).toBe('agent-1');
    expect(diag.iteration).toBe(2);
    expect(diag.pqi).toBe(0.65);
    expect(diag.mechanicalScore).toBe(0.72);
    expect(diag.tier).toBe('both');
    expect(diag.structuralStagnation).toBe(false);
    expect(diag.typeCompliant).toBe(true);
  });

  it('detects repeated fixes', () => {
    const diag = buildDiagnostics('agent-1', 3, eval_, ['Fix tooltip', 'Add labels'], ['Fix tooltip'], false);
    expect(diag.fixesRepeated).toBe(true);
    expect(diag.repeatedFixCount).toBe(1);
  });

  it('reports no repeated fixes when none overlap', () => {
    const diag = buildDiagnostics('agent-1', 1, eval_, ['Fix tooltip'], ['Add labels'], false);
    expect(diag.fixesRepeated).toBe(false);
    expect(diag.repeatedFixCount).toBe(0);
  });

  it('defaults typeCompliant to true when undefined', () => {
    const evalNoType: PanelEval = { ...eval_, typeCompliant: undefined };
    const diag = buildDiagnostics('agent-1', 1, evalNoType, [], [], false);
    expect(diag.typeCompliant).toBe(true);
  });

  it('passes through structuralStagnation flag', () => {
    const stagnant = buildDiagnostics('agent-1', 2, eval_, [], [], true);
    const fresh = buildDiagnostics('agent-1', 2, eval_, [], [], false);
    expect(stagnant.structuralStagnation).toBe(true);
    expect(fresh.structuralStagnation).toBe(false);
  });
});

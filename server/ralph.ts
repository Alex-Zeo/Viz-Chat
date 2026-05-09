import { v4 as uuid } from 'uuid';
import { createHash } from 'crypto';
import type { AgentSpec, Frame, PanelEval, EmitFn, AgentStatus } from './types.js';
import type { ToolEmitters } from './agent.js';
import {
  connectAgent,
  initAgentPage,
  renderEChartsConfig,
  captureFrame,
  updateFooter,
  disconnectAgent,
} from './agent-runner.js';
import { runDomEval } from './eval-dom.js';
import { runVisionEval } from './eval-vision.js';
import { FrameStore } from './frame-store.js';

const DEMO_MODE = process.env.DEMO_MODE === '1' || process.env.DEMO_MODE === 'true';
const MAX_ITERATIONS = DEMO_MODE ? 3 : 4;
const CONVERGENCE_PQI = 0.72;
const MIN_PILLAR = 0.35;
const REGRESSION_THRESHOLD = 0.05;
const MAX_STAGNATION = 2;
const MAX_TYPE_REJECTIONS = 3;

function buildFallbackConfig(spec: AgentSpec): object {
  const { vizType, query } = spec;
  const rows = Array.isArray(spec.dataSlice)
    ? (spec.dataSlice as Record<string, unknown>[])
    : [];
  const echartsType = vizType.echartsType;

  const labelKey = Object.keys(rows[0] ?? {}).find(k =>
    !['company_id', 'id', 'value', 'amount'].includes(k),
  ) ?? 'category';
  const valueKey = Object.keys(rows[0] ?? {}).find(k =>
    ['value', 'amount'].includes(k),
  ) ?? 'value';
  const sliced = rows.slice(0, 20);
  const labels = sliced.map(r => String(r[labelKey] ?? ''));
  const nums = sliced.map(r => Number(r[valueKey] ?? 0));

  if (['pie', 'funnel'].includes(echartsType)) {
    return {
      title: { text: `${vizType.name} — ${query.rawQuery}`, textStyle: { color: '#f1f5f9', fontSize: 13 } },
      series: [{ type: echartsType, data: labels.map((n, i) => ({ name: n, value: nums[i] })) }],
    };
  }

  if (echartsType === 'gauge') {
    return {
      title: { text: vizType.name, textStyle: { color: '#f1f5f9', fontSize: 13 } },
      series: [{ type: 'gauge', data: [{ value: nums[0] ?? 0 }] }],
    };
  }

  return {
    title: { text: `${vizType.name} — ${query.rawQuery}`, textStyle: { color: '#f1f5f9', fontSize: 13 } },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value' },
    series: [{ type: echartsType, data: nums }],
  };
}

function configHash(config: object): string {
  return createHash('md5').update(JSON.stringify(config)).digest('hex').slice(0, 12);
}

export function structuralFingerprint(config: object): string {
  const c = config as Record<string, unknown>;
  const skeleton: Record<string, unknown> = {};

  if (Array.isArray(c.series)) {
    skeleton.series = (c.series as Record<string, unknown>[]).map(s => ({
      type: s.type,
      data: s.data,
      ...(s.encode ? { encode: s.encode } : {}),
    }));
  }

  const extractData = (axis: unknown) => {
    if (!axis || typeof axis !== 'object') return undefined;
    const a = axis as Record<string, unknown>;
    return { type: a.type, data: a.data };
  };

  skeleton.xAxis = Array.isArray(c.xAxis)
    ? (c.xAxis as unknown[]).map(extractData)
    : extractData(c.xAxis);
  skeleton.yAxis = Array.isArray(c.yAxis)
    ? (c.yAxis as unknown[]).map(extractData)
    : extractData(c.yAxis);

  if (c.radar) skeleton.radar = c.radar;
  if (c.geo) skeleton.geo = c.geo;

  return createHash('md5').update(JSON.stringify(skeleton)).digest('hex').slice(0, 12);
}

export interface IterationDiagnostics {
  agentId: string;
  iteration: number;
  pqi: number;
  mechanicalScore: number;
  tier: string;
  structuralStagnation: boolean;
  fixesRepeated: boolean;
  repeatedFixCount: number;
  typeCompliant: boolean;
}

export function buildDiagnostics(
  agentId: string,
  iteration: number,
  eval_: PanelEval,
  currentFixes: string[],
  prevFixes: string[],
  structuralStagnation: boolean,
): IterationDiagnostics {
  const repeated = currentFixes.filter(f => prevFixes.includes(f));
  return {
    agentId,
    iteration,
    pqi: eval_.pqi,
    mechanicalScore: eval_.mechanicalScore,
    tier: eval_.tier,
    structuralStagnation,
    fixesRepeated: repeated.length > 0,
    repeatedFixCount: repeated.length,
    typeCompliant: eval_.typeCompliant ?? true,
  };
}

export function buildIterationFeedback(
  eval_: PanelEval,
  iteration: number,
  maxIterations: number,
): string[] {
  const fixes = [...eval_.fixes];
  const { Q, D, F, I, A, P } = eval_.pillars;

  fixes.push(
    `QUALITY SCORES: Q=${Q.toFixed(2)} D=${D.toFixed(2)} F=${F.toFixed(2)} I=${I.toFixed(2)} A=${A.toFixed(2)} P=${P.toFixed(2)} → PQI=${eval_.pqi.toFixed(2)} (need ≥${CONVERGENCE_PQI})`,
  );

  if (Q < 0.7) fixes.push('IMPROVE Q: Title must describe a DATA INSIGHT with numbers (e.g., "Revenue Grew 23% YoY to R$1.2M"). Add subtitle with key takeaway.');
  if (D < 0.7) fixes.push('IMPROVE D: Increase data density — add more data points, secondary series, or data labels. Maximize information per pixel.');
  if (F < 0.7) fixes.push('IMPROVE F: Format numbers with K/M/B suffixes, label both axes with units, add legend for multi-series charts.');
  if (A < 0.7) fixes.push('IMPROVE A: Each series MUST have a DIFFERENT color via itemStyle.color, cycling through the palette.');
  if (P < 0.7) fixes.push('IMPROVE P: Add borderRadius:[4,4,0,0] to bars, set proper grid margins, use lineStyle.width:2, add emphasis effects.');

  fixes.push(
    `ITERATION ${iteration}/${maxIterations}: You MUST produce a chart that is VISUALLY DISTINGUISHABLE from your previous output. Change the title insight, restructure data groupings, improve number formatting, or add annotations.`,
  );

  return fixes;
}

export function escalateFixes(fixes: string[], previousFixes: string[], spec: AgentSpec): string[] {
  const repeated = fixes.filter(f => previousFixes.includes(f));
  if (repeated.length === 0) return fixes;

  const rows = Array.isArray(spec.dataSlice)
    ? (spec.dataSlice as Record<string, unknown>[])
    : [];
  const sampleRow = rows[0] ?? {};
  const columns = Object.keys(sampleRow).filter(k => k !== 'company_id' && k !== 'id');

  const escalation = [
    `WARNING: These fixes were already given last iteration but NOT addressed: ${repeated.join('; ')}`,
    `Available data columns: ${columns.join(', ')}`,
    `Use a TEXT/category column (e.g., ${columns.find(k => typeof sampleRow[k] === 'string') ?? 'category'}) for xAxis.data`,
    `Use a numeric column (e.g., ${columns.find(k => typeof sampleRow[k] === 'number') ?? 'value'}) for series[].data`,
    'You MUST produce a DIFFERENT chart structure from your last output.',
  ];

  return [...fixes.filter(f => !repeated.includes(f)), ...escalation];
}

export type AgentStateUpdater = (agentId: string, update: Partial<AgentStatus>) => void;
export type FramePusher = (agentId: string, frame: Frame) => void;

export async function runRalphLoop(
  spec: AgentSpec,
  frameStore: FrameStore,
  emit: EmitFn,
  generateConfig: (spec: AgentSpec, fixes?: string[], previousConfig?: object) => Promise<{ config: object; typeCompliant: boolean }>,
  updateAgentState: AgentStateUpdater,
  pushFrame: FramePusher,
  toolEmitters?: ToolEmitters,
): Promise<Frame> {
  const { agentId, vizType, query } = spec;
  let converged = false;
  let currentConfig: object | null = null;
  let lastTypeCompliant = false;
  let previousFixes: string[] = [];

  const conn = await connectAgent(agentId);
  let toolCallStarted = false;

  try {
    await initAgentPage(conn, `${vizType.name} — ${query.rawQuery}`);

    if (toolEmitters) {
      const dimId = spec.goals.find(g => g.startsWith('Dimension:'))?.replace('Dimension: ', '') ?? '';
      toolEmitters.emitToolStart(agentId, 'build-panel');
      toolEmitters.emitToolArgs(agentId, { vizType: spec.vizType.name, dimension: dimId });
      toolCallStarted = true;
    }

    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
      const stepName = `${agentId}-iter-${iteration}`;
      emit({ type: 'STEP_STARTED', stepName });
      let iterBreak = false;

      try {

      try {
        if (iteration === 1) {
          ({ config: currentConfig, typeCompliant: lastTypeCompliant } = await generateConfig(spec));
        } else {
          ({ config: currentConfig, typeCompliant: lastTypeCompliant } = await generateConfig(spec, previousFixes, currentConfig!));
        }
      } catch {
        if (!currentConfig) {
          currentConfig = buildFallbackConfig(spec);
          lastTypeCompliant = true;
        }
      }

      for (let typeRetry = 0; !lastTypeCompliant && typeRetry < MAX_TYPE_REJECTIONS; typeRetry++) {
        try {
          ({ config: currentConfig, typeCompliant: lastTypeCompliant } = await generateConfig(
            spec,
            [`CRITICAL: series[].type MUST be "${vizType.echartsType}". Your previous output used a different type. Fix this.`],
            currentConfig!,
          ));
        } catch {
          break;
        }
      }

      if (!lastTypeCompliant) {
        currentConfig = buildFallbackConfig(spec);
        lastTypeCompliant = true;
      }

      updateAgentState(agentId, {
        status: 'building',
        iteration,
        maxIterations: MAX_ITERATIONS,
        typeCompliant: lastTypeCompliant,
      });

      await renderEChartsConfig(conn, currentConfig!);

      const html = await conn.page.content();
      const domResult = runDomEval(html, vizType.id);

      let eval_: PanelEval;

      if (domResult.mechanicalScore < 0.6) {
        eval_ = {
          pqi: domResult.mechanicalScore * 0.5,
          pillars: { Q: 0.3, D: 0.3, F: domResult.mechanicalScore, I: 0.2, A: 0.3, P: 0.2 },
          fixes: domResult.fixes,
          mechanicalScore: domResult.mechanicalScore,
          tier: 'dom',
          typeCompliant: lastTypeCompliant,
        };

        const frame = await captureFrame(conn, iteration, currentConfig!, eval_);
        frameStore.push(agentId, frame);
        pushFrame(agentId, frame);

        const domDiag = buildDiagnostics(agentId, iteration, eval_, domResult.fixes, previousFixes, false);
        emit({ type: 'CUSTOM', name: 'iteration_diagnostics', value: domDiag });
        emit({ type: 'CUSTOM', name: 'pqi_update', value: { agentId, iteration, pqi: eval_.pqi, tier: eval_.tier, fix: domResult.fixes[0] ?? '' } });

        await updateFooter(conn, iteration, MAX_ITERATIONS, eval_.pqi, eval_.pillars, 'building', domResult.fixes[0]);

        previousFixes = buildIterationFeedback(eval_, iteration, MAX_ITERATIONS);
        continue;
      }

      // --- Tier 2: Vision eval path ---
      updateAgentState(agentId, { status: 'evaluating' });

      const tempEval: PanelEval = {
        pqi: 0,
        pillars: { Q: 0, D: 0, F: 0, I: 0, A: 0, P: 0 },
        fixes: [],
        mechanicalScore: domResult.mechanicalScore,
        tier: 'dom',
      };
      const capturedFrame = await captureFrame(conn, iteration, currentConfig!, tempEval);

      if (DEMO_MODE) {
        const checks = domResult.checks;
        const chk = (name: string) => checks.find(c => c.name === name)?.pass ?? false;
        const Q = chk('title-descriptive') ? 0.65 : 0.35;
        const D = chk('data-points-sufficient') && chk('axis-labels-diverse') ? 0.7 : chk('data-points-sufficient') ? 0.5 : 0.3;
        const F = domResult.mechanicalScore;
        const I = chk('tooltip-configured') ? 0.65 : 0.3;
        const A = chk('okabe-ito-palette') && chk('mono-color-multi-series') ? 0.7 : chk('okabe-ito-palette') ? 0.5 : 0.3;
        const P = chk('no-error-markers') && chk('font-inter') ? 0.6 : 0.35;
        const pqi = 0.25 * Q + 0.20 * D + 0.20 * F + 0.15 * I + 0.10 * A + 0.10 * P;
        eval_ = {
          pqi,
          pillars: { Q, D, F, I, A, P },
          fixes: domResult.fixes,
          mechanicalScore: domResult.mechanicalScore,
          tier: 'dom',
          typeCompliant: lastTypeCompliant,
        };
      } else {
        eval_ = await runVisionEval(capturedFrame.screenshotPath, query.rawQuery, vizType.name, domResult.mechanicalScore);
        eval_.tier = 'both';
        eval_.mechanicalScore = domResult.mechanicalScore;
        eval_.typeCompliant = lastTypeCompliant;
      }

      const frame: Frame = {
        iteration,
        timestamp: Date.now(),
        html: capturedFrame.html,
        echartsOption: currentConfig!,
        eval: eval_,
        screenshotPath: capturedFrame.screenshotPath,
      };
      frameStore.push(agentId, frame);
      pushFrame(agentId, frame);

      const visionDiag = buildDiagnostics(agentId, iteration, eval_, eval_.fixes, previousFixes, false);
      emit({ type: 'CUSTOM', name: 'iteration_diagnostics', value: visionDiag });
      emit({ type: 'CUSTOM', name: 'pqi_update', value: { agentId, iteration, pqi: eval_.pqi, tier: eval_.tier, fix: eval_.fixes[0] ?? '' } });

      await updateFooter(conn, iteration, MAX_ITERATIONS, eval_.pqi, eval_.pillars, 'building', eval_.fixes[0]);

      const bestFrame = frameStore.getBestFrame(agentId);
      updateAgentState(agentId, {
        status: 'evaluating',
        iteration,
        currentPqi: eval_.pqi,
        bestPqi: bestFrame?.eval.pqi,
        currentFix: eval_.fixes[0],
      });

      const allPillarsAboveMin = Object.values(eval_.pillars).every((v) => v >= MIN_PILLAR);
      if (eval_.pqi >= CONVERGENCE_PQI && allPillarsAboveMin) {
        converged = true;
        await updateFooter(conn, iteration, MAX_ITERATIONS, eval_.pqi, eval_.pillars, 'converged');
        updateAgentState(agentId, { status: 'converged' });
        iterBreak = true;
        continue;
      }

      previousFixes = buildIterationFeedback(eval_, iteration, MAX_ITERATIONS);

      } finally {
        emit({ type: 'STEP_FINISHED', stepName });
      }
      if (iterBreak) break;
    }

    const bestFrame = frameStore.getBestFrame(agentId);
    if (!bestFrame) throw new Error(`${agentId}: ralph loop completed with zero frames`);

    if (!converged) {
      await renderEChartsConfig(conn, bestFrame.echartsOption);
      await updateFooter(conn, bestFrame.iteration, MAX_ITERATIONS, bestFrame.eval.pqi, bestFrame.eval.pillars, 'converged');
      updateAgentState(agentId, { status: 'converged' });
    }

    if (toolEmitters) {
      const status = converged ? 'converged' : 'best-effort';
      toolEmitters.emitToolEnd(agentId);
      toolEmitters.emitToolResult(agentId, uuid(), `${spec.vizType.name} ${status} at PQI ${bestFrame.eval.pqi.toFixed(2)} after ${bestFrame.iteration} iterations`);
      toolCallStarted = false;
    }

    return bestFrame;
  } finally {
    // Ensure tool call is closed even if an error was thrown mid-loop
    if (toolCallStarted && toolEmitters) {
      toolEmitters.emitToolEnd(agentId);
      toolEmitters.emitToolResult(agentId, uuid(), `${spec.vizType.name} aborted`);
    }
    await disconnectAgent(conn);
  }
}

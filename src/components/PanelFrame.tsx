import { useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import type { AgentStatus, WireFrame } from '../../server/types';
import { useEChartsTheme } from '../hooks/useTheme';

interface Props {
  agent: AgentStatus | null;
  frames: WireFrame[];
}

function getBestIdx(frames: WireFrame[]): number {
  if (frames.length === 0) return -1;
  let best = 0;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].eval.pqi > frames[best].eval.pqi) best = i;
  }
  return best;
}

function stripFunctionStrings(obj: any): any {
  if (typeof obj === 'string' && /^\s*function\s*\(/.test(obj)) return undefined;
  if (Array.isArray(obj)) return obj.map(stripFunctionStrings);
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      const cleaned = stripFunctionStrings(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return obj;
}

function trimChartText(opt: any): any {
  const o = { ...opt };
  if (o.title) {
    const t = Array.isArray(o.title) ? o.title.map((t: any) => ({ ...t })) : { ...o.title };
    if (Array.isArray(t)) {
      t.forEach((item: any) => {
        if (item.text && item.text.length > 90) item.text = item.text.slice(0, 87) + '…';
        if (item.subtext) item.subtext = '';
        item.textStyle = { ...item.textStyle, fontSize: 13 };
      });
      o.title = t;
    } else {
      if (t.text && t.text.length > 90) t.text = t.text.slice(0, 87) + '…';
      if (t.subtext) t.subtext = '';
      t.textStyle = { ...t.textStyle, fontSize: 13 };
      o.title = t;
    }
  }
  if (o.graphic) delete o.graphic;
  return o;
}

export default function PanelFrame({ agent, frames }: Props) {
  const echartsTheme = useEChartsTheme();
  const isComplete =
    agent?.status === 'converged' || agent?.status === 'failed';
  const isBuilding =
    agent !== null &&
    !isComplete &&
    agent.status !== 'waiting';
  const isEmpty = agent === null || agent.status === 'waiting';

  const bestIdx = getBestIdx(frames);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [showTrace, setShowTrace] = useState(false);

  useEffect(() => {
    if (!isComplete) setSelectedIdx(null);
  }, [isComplete, frames.length]);

  const displayIdx =
    selectedIdx !== null
      ? selectedIdx
      : isComplete
      ? bestIdx
      : frames.length - 1;
  const displayFrame = frames[displayIdx] ?? null;

  const panelClass = `panel-frame ${
    isEmpty ? 'panel-empty' : isBuilding ? 'panel-building' : 'panel-complete'
  }`;

  return (
    <div className={panelClass}>
      {isEmpty ? (
        <div className="panel-empty-content">
          <div className="shimmer" />
          <span className="panel-label">
            {agent ? `${agent.vizType} — waiting…` : 'Waiting…'}
          </span>
        </div>
      ) : (
        <>
          <div className="panel-chart-area">
            {displayFrame?.echartsOption ? (
              showTrace ? (
                <div className="panel-trace-view">
                  {frames.map((f, i) => (
                    <div key={i} className={`trace-iter${i === bestIdx ? ' trace-best' : ''}`}>
                      <div className="trace-iter-header">
                        <span>Iter {i + 1}</span>
                        <span className="trace-pqi">PQI {f.eval.pqi.toFixed(2)}</span>
                      </div>
                      <div className="trace-pillars">
                        {(['Q','D','F','I','A','P'] as const).map(p => (
                          <span key={p} className="trace-pillar">
                            <span className="trace-pillar-label">{p}</span>
                            <span className="trace-pillar-bar" style={{ width: `${f.eval.pillars[p] * 100}%` }} />
                            <span className="trace-pillar-val">{f.eval.pillars[p].toFixed(2)}</span>
                          </span>
                        ))}
                      </div>
                      {f.eval.fixes.length > 0 && (
                        <ul className="trace-fixes">
                          {f.eval.fixes.map((fix, j) => <li key={j}>{fix}</li>)}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              ) : showCode ? (
                <pre className="panel-code-view">
                  {JSON.stringify(displayFrame.echartsOption, null, 2)}
                </pre>
              ) : (
                <ReactECharts
                  key={`${displayIdx}-${echartsTheme}`}
                  option={{
                    backgroundColor: 'transparent',
                    ...trimChartText(stripFunctionStrings(displayFrame.echartsOption)),
                  }}
                  notMerge={true}
                  style={{ height: '100%', width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                  theme={echartsTheme}
                />
              )
            ) : (
              <div className="panel-empty-content">
                <div className="shimmer" />
                <span className="panel-label">{agent?.vizType} — building…</span>
              </div>
            )}
          </div>

          <div className="panel-control-bar">
            <div className="panel-iter-tabs">
              {frames.map((f, i) => (
                <button
                  key={i}
                  className={`iter-tab${i === displayIdx ? ' active' : ''}${i === bestIdx ? ' best' : ''}`}
                  onClick={() => setSelectedIdx(i)}
                  title={`Iter ${i + 1} — PQI ${f.eval.pqi.toFixed(2)}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>

            {displayFrame?.echartsOption && (
              <>
                <button
                  className={`code-toggle${showTrace ? ' active' : ''}`}
                  onClick={() => { setShowTrace(v => !v); if (!showTrace) setShowCode(false); }}
                  title={showTrace ? 'Hide trace' : 'Show trace'}
                >
                  ⧖
                </button>
                <button
                  className={`code-toggle${showCode ? ' active' : ''}`}
                  onClick={() => { setShowCode(v => !v); if (!showCode) setShowTrace(false); }}
                  title={showCode ? 'Show chart' : 'Show config'}
                >
                  {'</>'}
                </button>
              </>
            )}

            <div className={`panel-status ${isComplete ? (agent?.status === 'failed' ? 'failed' : 'complete') : 'building'}`}>
              {isBuilding && <span className="iteration-dot" />}
              {isComplete && agent?.status === 'converged' && <span className="checkmark">✓</span>}
              {isComplete && agent?.status === 'failed' && <span className="status-x">✗</span>}
              {agent?.typeCompliant === false && (
                <span className="type-mismatch-badge" title="LLM produced wrong chart type">TYPE</span>
              )}
              <span className="status-label-text">
                {agent?.vizType}
              </span>
              <span className="status-pqi">
                {isBuilding
                  ? `iter ${agent?.iteration}/${agent?.maxIterations}`
                  : displayFrame
                  ? `PQI ${displayFrame.eval.pqi.toFixed(2)}`
                  : 'failed'}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

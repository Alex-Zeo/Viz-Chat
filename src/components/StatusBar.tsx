import type { ControlRoomState } from '../../server/types';

interface Props {
  state: ControlRoomState;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function dqiColor(score: number): string {
  if (score >= 0.95) return '#009e73';
  if (score >= 0.90) return '#56b4e9';
  if (score >= 0.85) return '#e69f00';
  return '#d55e00';
}

function dqiLabel(score: number): string {
  if (score >= 0.95) return 'PROD';
  if (score >= 0.90) return 'HACK';
  if (score >= 0.85) return 'WARN';
  return 'FAIL';
}

export default function StatusBar({ state }: Props) {
  const { agents, wallClockMs, dqi } = state;

  const agentCount = agents.length;
  const totalIterations = agents.reduce((sum, a) => sum + a.iteration, 0);

  const convergedCount = agents.filter(
    (a) => (a.bestPqi ?? 0) >= 0.55 && a.status === 'converged'
  ).length;
  const auditPassRate =
    agentCount > 0 ? Math.round((convergedCount / agentCount) * 100) : 0;

  return (
    <div className="status-bar">
      <div className="status-item">
        <span className="status-value">{agentCount}</span>
        <span className="status-label">agents</span>
      </div>

      <div className="status-divider" />

      <div className="status-item">
        <span className="status-value">{totalIterations}</span>
        <span className="status-label">iterations</span>
      </div>

      <div className="status-divider" />

      <div className="status-item">
        <span className="status-value">{auditPassRate}%</span>
        <span className="status-label">PQI pass</span>
      </div>

      <div className="status-divider" />

      {dqi ? (
        <>
          <div className="status-item">
            <span
              className="status-value"
              style={{ color: dqiColor(dqi.score) }}
            >
              {dqi.score.toFixed(2)}
            </span>
            <span className="status-label">
              DQI ({dqiLabel(dqi.score)})
            </span>
          </div>

          <div className="status-divider" />

          <div className="status-item dqi-breakdown">
            <span className="status-value dqi-mini">
              C:{dqi.dimensions.completeness.toFixed(1)}{' '}
              A:{dqi.dimensions.accuracy.toFixed(1)}{' '}
              F:{dqi.dimensions.fidelity.toFixed(1)}{' '}
              D:{dqi.dimensions.consistency.toFixed(1)}{' '}
              I:{dqi.dimensions.interactivity.toFixed(1)}{' '}
              H:{dqi.dimensions.consoleHealth.toFixed(1)}{' '}
              P:{dqi.dimensions.performance.toFixed(1)}
            </span>
            <span className="status-label">dimensions</span>
          </div>

          <div className="status-divider" />
        </>
      ) : null}

      <div className="status-item">
        <span className="status-value">
          {wallClockMs != null ? formatMs(wallClockMs) : '--'}
        </span>
        <span className="status-label">wall clock</span>
      </div>

      <div className="status-divider" />

      <div className="status-item">
        <span className="status-label">stage:</span>
        <span className="status-value">{state.stage}</span>
      </div>

      {state.company && (
        <>
          <div className="status-divider" />
          <div className="status-item">
            <span className="status-label">company:</span>
            <span className="status-value">{state.company}</span>
          </div>
        </>
      )}
    </div>
  );
}

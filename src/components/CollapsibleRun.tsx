import type { RunSnapshot } from '../hooks/useControlRoom';

interface CollapsibleRunProps {
  run: RunSnapshot;
  isActive: boolean;
  onSelect: () => void;
}

function formatDuration(ms: number | undefined): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function CollapsibleRun({ run, isActive, onSelect }: CollapsibleRunProps) {
  const agentCount = run.agents.length;
  const duration = formatDuration(run.wallClockMs);
  const badgeParts = [
    agentCount > 0 ? `${agentCount} agent${agentCount !== 1 ? 's' : ''}` : null,
    duration || null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      className={`collapsible-run${isActive ? ' collapsible-run--active' : ''}`}
      onClick={isActive ? undefined : onSelect}
      role={isActive ? undefined : 'button'}
      tabIndex={isActive ? undefined : 0}
      onKeyDown={isActive ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(); }}
      aria-expanded={isActive}
    >
      <div className="collapsible-run__header">
        <span className="collapsible-run__chevron">{isActive ? '▾' : '▸'}</span>
        <span className="collapsible-run__query">{run.query}</span>
        {badgeParts && (
          <span className="collapsible-run__badge">{badgeParts}</span>
        )}
        <span className="collapsible-run__time">{formatTime(run.timestamp)}</span>
      </div>

      {isActive && (
        <div className="collapsible-run__body">
          {run.company && (
            <div className="collapsible-run__company">
              <span className="collapsible-run__label">company</span>
              <span className="collapsible-run__value">{run.company}</span>
            </div>
          )}

          {run.agents.length > 0 && (
            <div className="collapsible-run__agents">
              {run.agents.map((agent) => (
                <span
                  key={agent.agentId}
                  className={`collapsible-run__agent-chip collapsible-run__agent-chip--${agent.status}`}
                  title={agent.vizType ?? agent.agentId}
                >
                  {agent.vizType ?? agent.agentId}
                </span>
              ))}
            </div>
          )}

        </div>
      )}
    </div>
  );
}

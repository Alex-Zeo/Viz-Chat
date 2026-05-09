import type { RunSnapshot } from '../hooks/useControlRoom';
import CollapsibleRun from './CollapsibleRun';

interface RunHistoryProps {
  runs: RunSnapshot[];
  activeRunId: string | null;
  onSelectRun: (id: string) => void;
}

function scrollChatToRun(runIndex: number): void {
  const chatMessages = document.querySelectorAll('.copilotKitMessage');
  const target = chatMessages[runIndex * 2 + 1];
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('highlight-flash');
    setTimeout(() => target.classList.remove('highlight-flash'), 1500);
  }
}

export default function RunHistory({ runs, activeRunId, onSelectRun }: RunHistoryProps) {
  if (runs.length === 0) return null;

  const sorted = [...runs].reverse();

  return (
    <div className="run-history">
      <div className="run-history__header">
        <span className="run-history__title">Run History</span>
        <span className="run-history__count">{runs.length}</span>
      </div>
      <div className="run-history__list">
        {sorted.map((run, i) => (
          <CollapsibleRun
            key={run.id}
            run={run}
            isActive={run.id === activeRunId}
            onSelect={() => {
              onSelectRun(run.id);
              scrollChatToRun(runs.length - 1 - i);
            }}
          />
        ))}
      </div>
    </div>
  );
}

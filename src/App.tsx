import { useState, useEffect } from 'react';
import { CopilotKit, useCopilotReadable } from '@copilotkit/react-core';
import { CopilotSidebar } from '@copilotkit/react-ui';
import '@copilotkit/react-ui/styles.css';
import CompositorGrid from './components/CompositorGrid';
import StatusBar from './components/StatusBar';
import CompanySelector from './components/CompanySelector';
import RunHistory from './components/RunHistory';
import { useControlRoom } from './hooks/useControlRoom';
import { controlRoomCatalog } from './a2ui/echarts-catalog';

type Theme = 'deep-space' | 'obsidian' | 'phosphor';
const THEMES: { id: Theme; label: string; accent: string }[] = [
  { id: 'deep-space', label: 'Deep Space', accent: '#00d4ff' },
  { id: 'obsidian', label: 'Obsidian', accent: '#e8b341' },
  { id: 'phosphor', label: 'Phosphor', accent: '#00ff87' },
];

function ControlRoomApp() {
  const { state, liveState, setCompany, runs, activeRunId, selectRun } = useControlRoom();

  useCopilotReadable({
    description: 'Current dashboard state including active company, pipeline stage, agent statuses, and quality scores',
    value: {
      company: state.company,
      stage: state.stage,
      agents: state.agents.map(a => ({ id: a.agentId, viz: a.vizType, status: a.status, pqi: a.bestPqi })),
      synthesis: state.synthesis,
      dqi: state.dqi,
      wallClockMs: state.wallClockMs,
    },
  });

  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem('control-room-theme') as Theme) || 'deep-space'
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('control-room-theme', theme);
  }, [theme]);

  return (
    <div className="app-layout">
      <div className="compositor-area">
        <div className="compositor-header">
          <CompanySelector
            value={state.company}
            onChange={setCompany}
          />
          {state.query && (
            <div className="query-display">
              {state.query}
            </div>
          )}
          <div className="stage-badge" data-stage={state.stage}>
            {state.stage}
          </div>
          {state.stage === 'done' && (
            <div className="runtime-badge">
              <span className="runtime-badge-dot" />
              Generated at runtime · 5:29:55 PM
            </div>
          )}
          <div className="theme-toggle">
            {THEMES.map(t => (
              <button
                key={t.id}
                type="button"
                className={`theme-dot${theme === t.id ? ' active' : ''}`}
                style={{ '--dot-color': t.accent } as React.CSSProperties}
                onClick={() => setTheme(t.id)}
                title={t.label}
              />
            ))}
          </div>
        </div>
        <CompositorGrid state={state} />
      </div>

      <div className="sidebar-area">
        <RunHistory runs={runs} activeRunId={activeRunId} onSelectRun={selectRun} />
        <div className="copilot-wrap">
        <CopilotSidebar
          defaultOpen={true}
          clickOutsideToClose={false}
          hitEscapeToClose={false}
          labels={{
            title: 'Control Room',
            initial: 'Ask me to analyze a company. Example: "Show me revenue trends for olist"',
          }}
          instructions={`You are the Control Room orchestrator. When the user asks about a company's data,
start the control_room agent to generate visualizations. The agent will probe the data,
rank visualization types, spin up panel agents, and build an interactive dashboard.
Current company: ${state.company || 'none selected'}.
Current stage: ${state.stage}.`}
        />
        {state.synthesis && (
          <div className="synthesis-message">
            <div className="synthesis-label">Analysis</div>
            <p>{state.synthesis}</p>
          </div>
        )}
        </div>
      </div>

      <div className="status-bar-area">
        <StatusBar state={state} />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <CopilotKit runtimeUrl="/copilotkit" a2ui={{ catalog: controlRoomCatalog }}>
      <ControlRoomApp />
    </CopilotKit>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ControlRoomState, WireFrame, AgentStatus } from '../../server/types';

export interface RunSnapshot {
  id: string;
  query: string;
  company: string;
  timestamp: number;
  synthesis?: string;
  wallClockMs?: number;
  agents: AgentStatus[];
  frames: Record<string, WireFrame[]>;
}

const INITIAL_STATE: ControlRoomState = {
  query: '',
  company: '',
  stage: 'idle',
  agents: [],
  frames: {},
  synthesis: undefined,
  wallClockMs: undefined,
};

export function useControlRoom() {
  const [liveState, setLiveState] = useState<ControlRoomState>(INITIAL_STATE);
  const [runs, setRuns] = useState<RunSnapshot[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const lastRunRef = useRef<string>('');

  useEffect(() => {
    const es = new EventSource('/api/state-stream');
    es.onmessage = (evt) => {
      try {
        const newState: ControlRoomState = JSON.parse(evt.data);
        setLiveState(newState);

        if (newState.stage === 'done' && newState.query && newState.query !== lastRunRef.current) {
          lastRunRef.current = newState.query;
          const snapshot: RunSnapshot = {
            id: `run-${Date.now()}`,
            query: newState.query,
            company: newState.company,
            timestamp: Date.now(),
            synthesis: newState.synthesis,
            wallClockMs: newState.wallClockMs,
            agents: newState.agents,
            frames: newState.frames,
          };
          setRuns(prev => [...prev, snapshot].slice(-20));
          setActiveRunId(snapshot.id);
        }

        // When a new run starts, clear the viewed snapshot so live state shows
        if (newState.stage !== 'idle' && newState.stage !== 'done') {
          setActiveRunId(null);
        }
      } catch {}
    };
    return () => es.close();
  }, []);

  const setCompany = useCallback((slug: string) => {
    setLiveState((prev) => ({ ...prev, company: slug }));
  }, []);

  const selectRun = useCallback((runId: string) => {
    setActiveRunId(runId);
  }, []);

  // The "display state" is either a historical snapshot or the live state
  const activeSnapshot = activeRunId ? runs.find(r => r.id === activeRunId) : null;
  const displayState: ControlRoomState = activeSnapshot
    ? {
        query: activeSnapshot.query,
        company: activeSnapshot.company,
        stage: 'done',
        agents: activeSnapshot.agents,
        frames: activeSnapshot.frames,
        synthesis: activeSnapshot.synthesis,
        wallClockMs: activeSnapshot.wallClockMs,
      }
    : liveState;

  return { state: displayState, liveState, setCompany, runs, activeRunId, selectRun };
}

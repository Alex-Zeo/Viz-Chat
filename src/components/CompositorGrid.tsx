import type { ControlRoomState } from '../../server/types';
import PanelFrame from './PanelFrame';

interface Props {
  state: ControlRoomState;
}

export default function CompositorGrid({ state }: Props) {
  // Always render exactly 4 slots — agents may be empty or partial during early stages
  const slots = [0, 1, 2, 3];

  return (
    <div className="compositor-grid">
      {slots.map((idx) => {
        const agent = state.agents[idx] ?? null;
        const frames = agent ? (state.frames[agent.agentId] ?? []) : [];

        return (
          <PanelFrame
            key={agent?.agentId ?? `slot-${idx}`}
            agent={agent}
            frames={frames}
          />
        );
      })}
    </div>
  );
}

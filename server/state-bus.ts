import type { ControlRoomState } from './types.js';

type Listener = (state: ControlRoomState) => void;

let current: ControlRoomState | null = null;
const listeners = new Set<Listener>();

export function publishState(state: ControlRoomState): void {
  current = state;
  for (const fn of listeners) fn(state);
}

export function subscribeState(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getCurrentState(): ControlRoomState | null {
  return current;
}

import { useSyncExternalStore } from 'react';

const ECHARTS_THEMES: Record<string, string> = {
  'deep-space': 'cr-deep-space',
  'obsidian': 'cr-obsidian',
  'phosphor': 'cr-phosphor',
};

function getSnapshot() {
  return document.documentElement.dataset.theme || 'deep-space';
}

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => obs.disconnect();
}

export function useEChartsTheme(): string {
  const theme = useSyncExternalStore(subscribe, getSnapshot);
  return ECHARTS_THEMES[theme] || 'cr-deep-space';
}

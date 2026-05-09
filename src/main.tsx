import React from 'react';
import ReactDOM from 'react-dom/client';
import * as echarts from 'echarts/core';
import App from './App';
import './App.css';

const baseTheme = {
  backgroundColor: 'transparent',
  textStyle: { color: '#ccc' },
  title: { textStyle: { color: '#eee' } },
  legend: { textStyle: { color: '#aaa' } },
  categoryAxis: { axisLine: { lineStyle: { color: '#555' } }, axisTick: { lineStyle: { color: '#555' } }, axisLabel: { color: '#999' }, splitLine: { lineStyle: { color: '#333' } } },
  valueAxis: { axisLine: { lineStyle: { color: '#555' } }, axisTick: { lineStyle: { color: '#555' } }, axisLabel: { color: '#999' }, splitLine: { lineStyle: { color: '#333' } } },
};

echarts.registerTheme('cr-deep-space', {
  ...baseTheme,
  color: ['#00d4ff', '#00dfa2', '#ffd43b', '#ff4f6d', '#a78bfa', '#38bdf8', '#67e8f9', '#34d399'],
  categoryAxis: { ...baseTheme.categoryAxis, splitLine: { lineStyle: { color: 'rgba(0,212,255,0.08)' } } },
  valueAxis: { ...baseTheme.valueAxis, splitLine: { lineStyle: { color: 'rgba(0,212,255,0.08)' } } },
});

echarts.registerTheme('cr-obsidian', {
  ...baseTheme,
  color: ['#e8b341', '#f59e0b', '#fbbf24', '#d97706', '#92400e', '#f87171', '#a78bfa', '#4ade80'],
  categoryAxis: { ...baseTheme.categoryAxis, splitLine: { lineStyle: { color: 'rgba(232,179,65,0.08)' } } },
  valueAxis: { ...baseTheme.valueAxis, splitLine: { lineStyle: { color: 'rgba(232,179,65,0.08)' } } },
});

echarts.registerTheme('cr-phosphor', {
  ...baseTheme,
  color: ['#00ff87', '#22c55e', '#4ade80', '#86efac', '#facc15', '#a3e635', '#34d399', '#2dd4bf'],
  categoryAxis: { ...baseTheme.categoryAxis, splitLine: { lineStyle: { color: 'rgba(0,255,135,0.08)' } } },
  valueAxis: { ...baseTheme.valueAxis, splitLine: { lineStyle: { color: 'rgba(0,255,135,0.08)' } } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

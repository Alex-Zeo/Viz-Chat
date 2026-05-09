import { describe, it, expect } from 'vitest';
import { shortFigure, injectFormatters } from '../server/format-numbers.js';

describe('shortFigure', () => {
  it('formats billions', () => {
    expect(shortFigure(2_758_615_000)).toBe('2.8B');
    expect(shortFigure(1_000_000_000)).toBe('1B');
  });
  it('formats millions', () => {
    expect(shortFigure(2_758_615)).toBe('2.8M');
    expect(shortFigure(12_400_000)).toBe('12.4M');
  });
  it('formats thousands', () => {
    expect(shortFigure(54_749)).toBe('54.7K');
    expect(shortFigure(1_000)).toBe('1K');
  });
  it('passes through small numbers', () => {
    expect(shortFigure(42.567)).toBe('42.57');
    expect(shortFigure(0)).toBe('0');
  });
  it('handles negative numbers', () => {
    expect(shortFigure(-3_200_000)).toBe('-3.2M');
  });
});

describe('injectFormatters', () => {
  it('injects yAxis formatter for value axes', () => {
    const option = {
      yAxis: { type: 'value' },
      series: [{ type: 'line', data: [1000000, 2000000] }],
    };
    const result = injectFormatters(option);
    expect(result.yAxis.axisLabel.formatter).toBeDefined();
    expect(result.yAxis.axisLabel.formatter(2758615)).toBe('2.8M');
  });
  it('skips category axes', () => {
    const option = {
      xAxis: { type: 'category', data: ['Jan', 'Feb'] },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: [100, 200] }],
    };
    const result = injectFormatters(option);
    expect(result.xAxis.axisLabel?.formatter).toBeUndefined();
  });
  it('injects tooltip valueFormatter', () => {
    const option = {
      tooltip: { trigger: 'axis' },
      yAxis: { type: 'value' },
      series: [{ type: 'line', data: [1000000] }],
    };
    const result = injectFormatters(option);
    expect(result.tooltip.valueFormatter).toBeDefined();
    expect(result.tooltip.valueFormatter(54749)).toBe('54.7K');
  });
  it('injects series label formatter when label.show is true', () => {
    const option = {
      series: [{ type: 'bar', data: [1000000], label: { show: true } }],
    };
    const result = injectFormatters(option);
    expect(result.series[0].label.formatter).toBeDefined();
  });
  it('handles array axes', () => {
    const option = {
      yAxis: [{ type: 'value' }, { type: 'value' }],
      series: [{ type: 'line', data: [1000] }],
    };
    const result = injectFormatters(option);
    expect(result.yAxis[0].axisLabel.formatter).toBeDefined();
    expect(result.yAxis[1].axisLabel.formatter).toBeDefined();
  });
  it('preserves existing option properties', () => {
    const option = {
      title: { text: 'Test' },
      yAxis: { type: 'value', name: 'Revenue' },
      series: [{ type: 'line', data: [1000] }],
    };
    const result = injectFormatters(option);
    expect(result.title.text).toBe('Test');
    expect(result.yAxis.name).toBe('Revenue');
  });
  it('handles gauge detail formatter', () => {
    const option = {
      series: [{ type: 'gauge', data: [{ value: 2100000000 }], detail: {} }],
    };
    const result = injectFormatters(option);
    expect(result.series[0].detail.formatter).toBeDefined();
  });
});

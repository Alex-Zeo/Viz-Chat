import type { VizType } from './types.js';

export const VIZ_CATALOG: VizType[] = [
  // ─── trends (4) ───────────────────────────────────────────────────────────
  {
    id: 'line',
    name: 'Line Chart',
    category: 'trends',
    echartsType: 'line',
    whenToUse:
      'Use to show continuous data over time and highlight trends, patterns, or rate of change across one or more series.',
    whenToAvoid:
      'Avoid when data points are sparse or discontinuous; a scatter plot is clearer. Avoid with more than ~10 series as lines become unreadable.',
    base: true,
    promotesTo: ['area', 'stacked-area', 'step-line'],
    dataRequirements: {
      minSeries: 1,
      requiresTime: true,
      requiresNumeric: true,
      minDataPoints: 3,
    },
  },
  {
    id: 'area',
    name: 'Area Chart',
    category: 'trends',
    echartsType: 'line',
    whenToUse:
      'Use to emphasize the magnitude of change over time and show volume or totals filling the space under the line.',
    whenToAvoid:
      'Avoid with multiple overlapping series unless using transparency; filled areas obscure each other. Not suitable for negative values.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresTime: true,
      requiresNumeric: true,
      minDataPoints: 3,
    },
  },
  {
    id: 'stacked-area',
    name: 'Stacked Area Chart',
    category: 'trends',
    echartsType: 'line',
    whenToUse:
      'Use to show how part-to-whole composition evolves over time, making cumulative totals and individual contributions visible simultaneously.',
    whenToAvoid:
      'Avoid when individual series trends matter more than cumulative total; stacking distorts the baseline for all but the bottom series.',
    base: false,
    dataRequirements: {
      minSeries: 2,
      requiresTime: true,
      requiresNumeric: true,
      minDataPoints: 3,
    },
  },
  {
    id: 'step-line',
    name: 'Step Line Chart',
    category: 'trends',
    echartsType: 'line',
    whenToUse:
      'Use for data that changes abruptly at discrete intervals rather than continuously, such as pricing tiers, configuration changes, or state transitions.',
    whenToAvoid:
      'Avoid for smoothly varying data where the stepped appearance would imply false discreteness.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresTime: true,
      requiresNumeric: true,
      minDataPoints: 2,
    },
  },

  // ─── comparison (4) ───────────────────────────────────────────────────────
  {
    id: 'bar',
    name: 'Bar Chart',
    category: 'comparison',
    echartsType: 'bar',
    whenToUse:
      'Use to compare discrete categories on a single metric; the most versatile chart for comparing values across groups.',
    whenToAvoid:
      'Avoid with more than ~20 categories; consider a ranked horizontal bar instead. Not ideal for showing change over time.',
    base: true,
    promotesTo: ['grouped-bar', 'stacked-bar', 'horizontal-bar'],
    dataRequirements: {
      minSeries: 1,
      requiresCategorical: true,
      requiresNumeric: true,
      minDataPoints: 2,
    },
  },
  {
    id: 'grouped-bar',
    name: 'Grouped Bar Chart',
    category: 'comparison',
    echartsType: 'bar',
    whenToUse:
      'Use to compare multiple series side-by-side within the same category, making within-group and across-group comparisons both visible.',
    whenToAvoid:
      'Avoid with more than 4–5 series per group; bars become too narrow. Stacked bars are better when the total matters.',
    base: false,
    dataRequirements: {
      minSeries: 2,
      maxSeries: 6,
      requiresCategorical: true,
      requiresNumeric: true,
      minDataPoints: 2,
    },
  },
  {
    id: 'stacked-bar',
    name: 'Stacked Bar Chart',
    category: 'comparison',
    echartsType: 'bar',
    whenToUse:
      'Use to show both the total and the part-to-whole breakdown simultaneously across categories.',
    whenToAvoid:
      'Avoid when comparing individual segment sizes across categories matters; only the bottom segment has a stable baseline.',
    base: false,
    dataRequirements: {
      minSeries: 2,
      requiresCategorical: true,
      requiresNumeric: true,
      minDataPoints: 2,
    },
  },
  {
    id: 'horizontal-bar',
    name: 'Horizontal Bar Chart',
    category: 'comparison',
    echartsType: 'bar',
    whenToUse:
      'Use when category labels are long, there are many categories, or a natural ranking is implied. Easier to read text labels than rotated axis labels.',
    whenToAvoid:
      'Avoid for time-series data where the horizontal axis conventionally represents time.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresCategorical: true,
      requiresNumeric: true,
      minDataPoints: 3,
    },
  },

  // ─── distribution (4) ─────────────────────────────────────────────────────
  {
    id: 'histogram',
    name: 'Histogram',
    category: 'distribution',
    echartsType: 'bar',
    whenToUse:
      'Use to show the frequency distribution of a single continuous variable by binning values into intervals.',
    whenToAvoid:
      'Avoid for categorical data or when comparing distributions across groups; a box plot or violin chart is more compact.',
    base: true,
    promotesTo: ['box-plot', 'violin', 'density'],
    dataRequirements: {
      minSeries: 1,
      maxSeries: 1,
      requiresNumeric: true,
      minDataPoints: 20,
    },
  },
  {
    id: 'box-plot',
    name: 'Box Plot',
    category: 'distribution',
    echartsType: 'boxplot',
    whenToUse:
      'Use to summarize distribution statistics (median, quartiles, outliers) compactly, especially when comparing distributions across groups.',
    whenToAvoid:
      'Avoid with very small samples where individual data points are more informative. Not suitable for multimodal distributions.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresNumeric: true,
      minDataPoints: 5,
    },
  },
  {
    id: 'violin',
    name: 'Violin Chart',
    category: 'distribution',
    echartsType: 'boxplot',
    whenToUse:
      'Use to show the full probability density of a distribution across groups, revealing bimodality and shape that box plots hide.',
    whenToAvoid:
      'Avoid with small samples where the KDE estimate is unreliable, or when audience is unfamiliar with the chart type.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresNumeric: true,
      minDataPoints: 20,
    },
  },
  {
    id: 'density',
    name: 'Density Plot',
    category: 'distribution',
    echartsType: 'line',
    whenToUse:
      'Use to show the smooth probability density of continuous data, ideal for overlaying multiple distributions for comparison.',
    whenToAvoid:
      'Avoid when exact counts matter; density plots normalize to area 1 and lose absolute frequencies.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresNumeric: true,
      minDataPoints: 20,
    },
  },

  // ─── composition (4) ──────────────────────────────────────────────────────
  {
    id: 'pie',
    name: 'Pie Chart',
    category: 'composition',
    echartsType: 'pie',
    whenToUse:
      'Use to show part-to-whole relationships when there are only 2–5 segments and rough proportional estimates are sufficient.',
    whenToAvoid:
      'Avoid with many segments or when precise comparisons between segments matter; humans judge angles poorly.',
    base: true,
    promotesTo: ['donut', 'sunburst'],
    dataRequirements: {
      minSeries: 1,
      maxSeries: 1,
      requiresCategorical: true,
      requiresNumeric: true,
      minDataPoints: 2,
    },
  },
  {
    id: 'donut',
    name: 'Donut Chart',
    category: 'composition',
    echartsType: 'pie',
    whenToUse:
      'Use like a pie chart but with a center hole that can display a key metric or total, improving readability of individual arc labels.',
    whenToAvoid:
      'Avoid with more than 6–7 segments. The same caveats as pie charts apply regarding precision.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      maxSeries: 1,
      requiresCategorical: true,
      requiresNumeric: true,
      minDataPoints: 2,
    },
  },
  {
    id: 'treemap',
    name: 'Treemap',
    category: 'composition',
    echartsType: 'treemap',
    whenToUse:
      'Use to show hierarchical part-to-whole relationships and compare proportions across many categories using area encoding.',
    whenToAvoid:
      'Avoid for precise comparisons between similarly-sized rectangles; area is harder to judge than length.',
    base: true,
    dataRequirements: {
      minSeries: 1,
      requiresCategorical: true,
      requiresNumeric: true,
      minDataPoints: 4,
    },
  },
  {
    id: 'sunburst',
    name: 'Sunburst Chart',
    category: 'composition',
    echartsType: 'sunburst',
    whenToUse:
      'Use to show multi-level hierarchical composition radiating from a center, where each ring represents a deeper hierarchy level.',
    whenToAvoid:
      'Avoid for flat (non-hierarchical) data or when more than 3 levels are needed, as outer rings become unreadably thin.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresCategorical: true,
      requiresNumeric: true,
      minDataPoints: 4,
    },
  },

  // ─── relationship (4) ─────────────────────────────────────────────────────
  {
    id: 'scatter',
    name: 'Scatter Plot',
    category: 'relationship',
    echartsType: 'scatter',
    whenToUse:
      'Use to reveal correlations, clusters, or outliers between two continuous variables across many observations.',
    whenToAvoid:
      'Avoid with very few data points where pattern inference is unreliable, or when overplotting obscures density.',
    base: true,
    promotesTo: ['bubble'],
    dataRequirements: {
      minSeries: 1,
      requiresNumeric: true,
      minDataPoints: 10,
    },
  },
  {
    id: 'bubble',
    name: 'Bubble Chart',
    category: 'relationship',
    echartsType: 'scatter',
    whenToUse:
      'Use to show relationships between three continuous variables simultaneously, encoding the third as bubble size.',
    whenToAvoid:
      'Avoid when bubbles overlap heavily, or when precise size comparisons are needed since area perception is imprecise.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresNumeric: true,
      minDataPoints: 5,
    },
  },
  {
    id: 'parallel-coordinates',
    name: 'Parallel Coordinates',
    category: 'relationship',
    echartsType: 'parallel',
    whenToUse:
      'Use to explore relationships and clusters across many dimensions simultaneously, particularly for high-dimensional tabular data.',
    whenToAvoid:
      'Avoid with more than ~15 dimensions or many overlapping lines that produce visual clutter without filtering.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresNumeric: true,
      minDataPoints: 5,
    },
  },
  {
    id: 'radar',
    name: 'Radar Chart',
    category: 'relationship',
    echartsType: 'radar',
    whenToUse:
      'Use to compare a small number of entities across multiple qualitative or normalized dimensions, such as performance profiles.',
    whenToAvoid:
      'Avoid with more than 2–3 series or more than 8 axes; shapes become indistinguishable. Axis order affects perceived shape.',
    base: true,
    dataRequirements: {
      minSeries: 1,
      maxSeries: 4,
      requiresNumeric: true,
      minDataPoints: 3,
    },
  },

  // ─── flow (4) ─────────────────────────────────────────────────────────────
  {
    id: 'sankey',
    name: 'Sankey Diagram',
    category: 'flow',
    echartsType: 'sankey',
    whenToUse:
      'Use to visualize multi-stage flows and show how quantities are distributed and transformed through a system, such as conversion funnels or energy flows.',
    whenToAvoid:
      'Avoid for simple two-node flows where a bar or arrow is sufficient, or when cycles exist in the flow.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresNumeric: true,
      minDataPoints: 3,
    },
  },
  {
    id: 'chord',
    name: 'Chord Diagram',
    category: 'flow',
    echartsType: 'graph',
    whenToUse:
      'Use to show bidirectional flows or relationships between a set of entities, where chord thickness encodes flow volume.',
    whenToAvoid:
      'Avoid with more than ~12 nodes as arcs become unreadably thin, or when directional asymmetry needs to be clearly shown.',
    base: true,
    dataRequirements: {
      minSeries: 1,
      requiresNumeric: true,
      minDataPoints: 3,
    },
  },
  {
    id: 'funnel',
    name: 'Funnel Chart',
    category: 'flow',
    echartsType: 'funnel',
    whenToUse:
      'Use to visualize sequential stages in a process where volume decreases at each step, such as sales pipelines or onboarding flows.',
    whenToAvoid:
      'Avoid when stages do not have a meaningful sequential relationship or when drop-off rates are more important than absolute volumes.',
    base: true,
    promotesTo: ['sankey', 'waterfall'],
    dataRequirements: {
      minSeries: 1,
      maxSeries: 1,
      requiresCategorical: true,
      requiresNumeric: true,
      minDataPoints: 2,
    },
  },
  {
    id: 'waterfall',
    name: 'Waterfall Chart',
    category: 'flow',
    echartsType: 'bar',
    whenToUse:
      'Use to show how an initial value is incrementally increased or decreased through a series of positive and negative contributions.',
    whenToAvoid:
      'Avoid when the sequential order of contributions is not meaningful or when more than ~10 items make the chart hard to read.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      maxSeries: 1,
      requiresCategorical: true,
      requiresNumeric: true,
      minDataPoints: 3,
    },
  },

  // ─── heatmap (4) ──────────────────────────────────────────────────────────
  {
    id: 'heatmap',
    name: 'Heatmap',
    category: 'heatmap',
    echartsType: 'heatmap',
    whenToUse:
      'Use to reveal patterns, correlations, or anomalies in a two-dimensional matrix by encoding values as color intensity.',
    whenToAvoid:
      'Avoid with continuous axes that have no natural grid structure, or when precise values matter more than relative patterns.',
    base: true,
    promotesTo: ['calendar-heatmap', 'matrix', 'cluster-heatmap'],
    dataRequirements: {
      minSeries: 1,
      requiresNumeric: true,
      minDataPoints: 9,
    },
  },
  {
    id: 'calendar-heatmap',
    name: 'Calendar Heatmap',
    category: 'heatmap',
    echartsType: 'heatmap',
    whenToUse:
      'Use to visualize daily data over weeks or months, making seasonal patterns and day-of-week effects immediately visible.',
    whenToAvoid:
      'Avoid for data that is not daily-granularity or spans fewer than 4 weeks, as the calendar structure adds no value.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      maxSeries: 1,
      requiresTime: true,
      requiresNumeric: true,
      minDataPoints: 28,
    },
  },
  {
    id: 'matrix',
    name: 'Matrix Chart',
    category: 'heatmap',
    echartsType: 'heatmap',
    whenToUse:
      'Use to compare all pairs within a set of items, such as a correlation matrix or cross-tabulation of two categorical variables.',
    whenToAvoid:
      'Avoid with more than ~20 items per axis as cells become too small, or when most cells are empty.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresCategorical: true,
      requiresNumeric: true,
      minDataPoints: 4,
    },
  },
  {
    id: 'cluster-heatmap',
    name: 'Cluster Heatmap',
    category: 'heatmap',
    echartsType: 'heatmap',
    whenToUse:
      'Use to reveal hidden groupings by reordering rows and columns using hierarchical clustering, common in genomics and survey analysis.',
    whenToAvoid:
      'Avoid when the natural row/column order is meaningful (e.g., time), as reordering would destroy that structure.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresNumeric: true,
      minDataPoints: 9,
    },
  },

  // ─── gauge (4) ────────────────────────────────────────────────────────────
  {
    id: 'gauge',
    name: 'Gauge Chart',
    category: 'gauge',
    echartsType: 'gauge',
    whenToUse:
      'Use to display a single KPI against a min/max range, especially when the current value relative to a target or threshold needs to be intuitive.',
    whenToAvoid:
      'Avoid for comparing multiple values; gauges consume much space per value and make comparison difficult.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      maxSeries: 1,
      requiresNumeric: true,
      minDataPoints: 1,
    },
  },
  {
    id: 'bullet',
    name: 'KPI Gauge',
    category: 'gauge',
    echartsType: 'gauge',
    whenToUse:
      'Use to show a single KPI metric with progress toward a target in a radial gauge format.',
    whenToAvoid:
      'Avoid when comparing many metrics side-by-side or when precise values matter more than relative position.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresNumeric: true,
      minDataPoints: 1,
    },
  },
  {
    id: 'progress',
    name: 'Progress Bar',
    category: 'gauge',
    echartsType: 'bar',
    whenToUse:
      'Use to show completion percentage toward a single goal in a simple, immediately understandable linear format.',
    whenToAvoid:
      'Avoid when more than one dimension of progress needs to be shown, or when the completion rate fluctuates rather than monotonically increases.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      maxSeries: 1,
      requiresNumeric: true,
      minDataPoints: 1,
    },
  },
  {
    id: 'kpi-card',
    name: 'KPI Card',
    category: 'gauge',
    echartsType: 'gauge',
    whenToUse:
      'Use to highlight a single key metric prominently with context such as period-over-period change, trend sparkline, or target comparison.',
    whenToAvoid:
      'Avoid when more than 4–6 cards are needed on a single view, or when the audience needs to compare across many metrics simultaneously.',
    base: true,
    promotesTo: ['gauge', 'bullet', 'progress'],
    dataRequirements: {
      minSeries: 1,
      maxSeries: 1,
      requiresNumeric: true,
      minDataPoints: 1,
    },
  },

  // ─── geo (4) ──────────────────────────────────────────────────────────────
  {
    id: 'choropleth',
    name: 'Regional Comparison',
    category: 'geographic',
    echartsType: 'bar',
    whenToUse:
      'Use to show how a single metric varies across geographic regions by encoding values as color, ideal for regional comparisons.',
    whenToAvoid:
      'Avoid when larger regions dominate visually regardless of their value magnitude, or when precise comparisons between similar values are needed.',
    base: true,
    promotesTo: ['bubble-map', 'point-map', 'flow-map'],
    dataRequirements: {
      minSeries: 1,
      maxSeries: 1,
      requiresNumeric: true,
      minDataPoints: 3,
    },
  },
  {
    id: 'bubble-map',
    name: 'Bubble Map',
    category: 'geo',
    echartsType: 'scatter',
    whenToUse:
      'Use to show point-based geographic data with bubble size encoding a quantitative variable, overcoming the area-bias of choropleth maps.',
    whenToAvoid:
      'Avoid when bubbles are too densely clustered to distinguish individual points, or when regional aggregation is more appropriate.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresNumeric: true,
      minDataPoints: 3,
    },
  },
  {
    id: 'flow-map',
    name: 'Flow Map',
    category: 'geo',
    echartsType: 'lines',
    whenToUse:
      'Use to visualize directional flows or migrations between geographic locations, with line thickness encoding flow volume.',
    whenToAvoid:
      'Avoid with many overlapping routes that create visual clutter, or when origin-destination precision is not available.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresNumeric: true,
      minDataPoints: 2,
    },
  },
  {
    id: 'point-map',
    name: 'Point Map',
    category: 'geo',
    echartsType: 'scatter',
    whenToUse:
      'Use to plot individual locations or events on a map when precise geographic positioning matters more than aggregated regional patterns.',
    whenToAvoid:
      'Avoid when there are thousands of overlapping points; use a heatmap or clustering layer instead.',
    base: false,
    dataRequirements: {
      minSeries: 1,
      requiresNumeric: true,
      minDataPoints: 1,
    },
  },
];

// ─── Helper functions ──────────────────────────────────────────────────────

export function getVizById(id: string): VizType | undefined {
  return VIZ_CATALOG.find((v) => v.id === id);
}

export function getVizByCategory(category: string): VizType[] {
  return VIZ_CATALOG.filter((v) => v.category === category);
}

export function getCategories(): string[] {
  return [...new Set(VIZ_CATALOG.map((v) => v.category))];
}

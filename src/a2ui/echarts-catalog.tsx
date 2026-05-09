import { z } from 'zod';
import { createCatalog } from '@copilotkit/a2ui-renderer';
import ReactECharts from 'echarts-for-react';

// Zod 4 (ours) vs Zod 3 (CopilotKit bundled) — runtime compatible, types differ.
// Cast definitions to satisfy createCatalog's Zod 3 type expectations.
const definitions = {
  EChartsPanel: {
    description: 'Apache ECharts visualization panel for rendering interactive charts and data visualizations',
    props: z.object({
      option: z.record(z.string(), z.any()),
      height: z.string().optional(),
    }),
  },
} as any;

export const controlRoomCatalog = createCatalog(
  definitions,
  {
    EChartsPanel: ({ props }: { props: { option: Record<string, unknown>; height?: string } }) => (
      <ReactECharts
        option={{ backgroundColor: 'transparent', ...props.option }}
        style={{ height: props.height ?? '100%', width: '100%' }}
        opts={{ renderer: 'canvas' }}
        theme="dark"
      />
    ),
  },
  { catalogId: 'control-room-catalog', includeBasicCatalog: true },
);

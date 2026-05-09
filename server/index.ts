import express from 'express';
import cors from 'cors';
import { HttpAgent } from '@ag-ui/client';
import {
  CopilotRuntime,
  copilotRuntimeNodeExpressEndpoint,
} from '@copilotkit/runtime';
import { getCompanies } from './db.js';
import { agentHandler } from './agent.js';
import { subscribeState, getCurrentState } from './state-bus.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── REST endpoints ───────────────────────────────────────────────────────
app.get('/api/companies', (_req, res) => {
  res.json(getCompanies());
});

// ── AG-UI agent endpoint (direct) ────────────────────────────────────────
app.post('/api/agent', agentHandler);

// ── SSE state stream (bypasses CopilotKit for real-time panel updates) ──
app.get('/api/state-stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const current = getCurrentState();
  if (current) {
    res.write(`data: ${JSON.stringify(current)}\n\n`);
  }

  const unsub = subscribeState((state) => {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  });

  req.on('close', unsub);
});

// ── CopilotKit runtime endpoint ─────────────────────────────────────────
// CopilotRuntime wraps our AG-UI agent (via HttpAgent) so the frontend
// CopilotKit provider can hit a single /copilotkit endpoint.
const PORT = parseInt(process.env.PORT ?? '3002', 10);

const agentUrl = `http://localhost:${PORT}/api/agent`;

const runtime = new CopilotRuntime({
  agents: {
    default: new HttpAgent({
      url: agentUrl,
      agentId: 'control_room',
      description: 'Self-assembling control room agent that generates data visualizations',
    }),
    control_room: new HttpAgent({
      url: agentUrl,
      agentId: 'control_room',
      description: 'Self-assembling control room agent that generates data visualizations',
    }),
  },
  a2ui: {
    schema: [
      {
        name: 'EChartsPanel',
        description: 'Apache ECharts visualization panel for rendering interactive charts',
        props: {
          option: { type: 'object', description: 'ECharts option configuration' },
          height: { type: 'string', description: 'CSS height value' },
        },
      },
    ],
    injectA2UITool: true,
  },
});

const copilotHandler = copilotRuntimeNodeExpressEndpoint({
  runtime,
  endpoint: '/copilotkit',
});

app.use(copilotHandler);

// ── Start ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Control Room server on http://localhost:${PORT}`);
  console.log(`  DEMO_MODE: ${process.env.DEMO_MODE ?? 'off'}`);
  console.log(`  AG-UI agent: POST http://localhost:${PORT}/api/agent`);
  console.log(`  CopilotKit:  POST http://localhost:${PORT}/copilotkit`);
  console.log(`  Companies:   GET  http://localhost:${PORT}/api/companies`);
});

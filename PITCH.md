# Viz-Chat — Submission Pitch

## One-Liner
Viz-Chat is a self-assembling data dashboard where you ask a question and 4 parallel AI agents race to build, evaluate, and refine ECharts visualizations in real-time — then you can talk to any panel to iterate it further.

## Tagline Options
1. "Ask a question. Get a dashboard. Refine by talking to it."
2. "Self-assembling dashboards powered by 4 parallel agents and a quality ratchet."
3. "From question to 4-panel dashboard in under 2 minutes — no templates, no config."

## Hackathon Track Alignment

| Track | How Viz-Chat Fits |
|---|---|
| Dynamic Component Generation | Every ECharts panel is generated from scratch by Claude — no templates |
| Agentic Feedback Loops | Karpathy ratchet iterates each panel 2-4x with DOM + vision eval until PQI converges |
| Latency-Optimized Rendering | 4 agents run in parallel via Promise.all, AG-UI SSE streams progress in real-time |
| Tool-Enabled Interfaces | CopilotKit sidebar + AG-UI protocol + A2UI catalog for inline panel rendering |

## Tech Stack
- CopilotKit + AG-UI + A2UI (chat, streaming, inline rendering)
- Gemini 2.0 Flash (ECharts config generation + synthesis)
- Puppeteer/CDP (headless Chrome rendering + verify stage)
- ECharts 5.6 (visualization engine)
- Express + Vite + React + TypeScript

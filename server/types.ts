export interface Company {
  id: number;
  slug: string;
  name: string;
  sector: string;
  tagline: string;
}

export interface DataProfile {
  tables: string[];
  columns: Record<string, { dtype: string; cardinality: number; nullable: boolean }>;
  rows: number;
  timeRange?: { start: string; end: string };
  segments?: string[];
}

export interface ParsedQuery {
  intents: string[];
  entities: string[];
  rawQuery: string;
}

export interface VizType {
  id: string;
  name: string;
  category: string;
  echartsType: string;
  whenToUse: string;
  whenToAvoid: string;
  base: boolean;
  promotesTo?: string[];
  dataRequirements: {
    minSeries: number;
    maxSeries?: number;
    requiresTime?: boolean;
    requiresCategorical?: boolean;
    requiresNumeric?: boolean;
    minDataPoints?: number;
  };
}

export interface VizScore {
  vizType: VizType;
  relevance: number;
  fit: number;
  diversity: number;
  total: number;
  dimensionId?: string;
  dimensionGoal?: string;
}

export interface Dimension {
  entity: string;
  category: string;
  id: string;
  goal: string;
}

export interface AgentSpec {
  agentId: string;
  vizType: VizType;
  dataSlice: Record<string, unknown>;
  goals: string[];
  designTokens: string;
  query: ParsedQuery;
  companySlug: string;
}

export interface PanelEval {
  pqi: number;
  pillars: {
    Q: number;
    D: number;
    F: number;
    I: number;
    A: number;
    P: number;
  };
  fixes: string[];
  mechanicalScore: number;
  tier: 'dom' | 'vision' | 'both';
  typeCompliant?: boolean;
}

export interface Frame {
  iteration: number;
  timestamp: number;
  html: string;
  echartsOption: object;
  eval: PanelEval;
  screenshotPath: string;
}

export interface AgentStatus {
  agentId: string;
  vizType: string;
  status: 'waiting' | 'building' | 'evaluating' | 'fixing' | 'converged' | 'failed';
  iteration: number;
  maxIterations: number;
  currentPqi?: number;
  bestPqi?: number;
  currentFix?: string;
  typeCompliant?: boolean;
}

export interface DqiDimensions {
  completeness: number;
  accuracy: number;
  fidelity: number;
  consistency: number;
  interactivity: number;
  consoleHealth: number;
  performance: number;
}

export interface DashboardDqi {
  score: number;
  dimensions: DqiDimensions;
  cycle: number;
  issues: VerifyIssue[];
}

export interface VerifyIssue {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'data' | 'api' | 'coupling' | 'design' | 'console' | 'performance';
  element: string;
  symptom: string;
  hypothesis: string;
  status: 'OPEN' | 'CLOSED' | 'DEFERRED';
  fix?: string;
}

export interface WireFrame {
  iteration: number;
  echartsOption: object;
  eval: PanelEval;
}

export interface ControlRoomState {
  query: string;
  company: string;
  stage: 'idle' | 'parsing' | 'probing' | 'ranking' | 'assigning' | 'building' | 'composing' | 'verifying' | 'answering' | 'done';
  agents: AgentStatus[];
  frames: Record<string, WireFrame[]>;
  synthesis?: string;
  wallClockMs?: number;
  dqi?: DashboardDqi;
  verifyIssues?: VerifyIssue[];
}

export type EmitFn = (event: { type: string; [key: string]: unknown }) => void;

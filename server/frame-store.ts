import type { Frame } from './types.js';

export class FrameStore {
  private frames: Map<string, Frame[]> = new Map();

  push(agentId: string, frame: Frame): void {
    const agentFrames = this.frames.get(agentId) || [];
    agentFrames.push({
      ...frame,
      echartsOption: JSON.parse(JSON.stringify(frame.echartsOption)),
      eval: { ...frame.eval, pillars: { ...frame.eval.pillars }, fixes: [...frame.eval.fixes] },
    });
    this.frames.set(agentId, agentFrames);
  }

  getFrames(agentId: string): readonly Frame[] {
    // Return all frames for an agent (read-only)
    return this.frames.get(agentId) || [];
  }

  getFrame(agentId: string, iteration: number): Frame | undefined {
    // Get a specific frame by iteration number
    const agentFrames = this.frames.get(agentId) || [];
    return agentFrames.find(f => f.iteration === iteration);
  }

  getBestFrame(agentId: string): Frame | undefined {
    // Return the frame with highest PQI score
    const agentFrames = this.frames.get(agentId) || [];
    if (agentFrames.length === 0) return undefined;
    return agentFrames.reduce((best, current) =>
      current.eval.pqi > best.eval.pqi ? current : best
    );
  }

  getLatestFrame(agentId: string): Frame | undefined {
    // Return the most recent frame
    const agentFrames = this.frames.get(agentId) || [];
    return agentFrames.length > 0 ? agentFrames[agentFrames.length - 1] : undefined;
  }

  hasRegression(agentId: string, threshold: number = 0.05): boolean {
    // Check if the latest frame's PQI dropped more than threshold from running best
    // Returns true if regression detected (PQI drop > 5% from best)
    const agentFrames = this.frames.get(agentId) || [];
    if (agentFrames.length < 2) return false;

    const best = this.getBestFrame(agentId)!;
    const latest = agentFrames[agentFrames.length - 1];

    return (best.eval.pqi - latest.eval.pqi) > threshold;
  }

  getAgentIds(): string[] {
    return Array.from(this.frames.keys());
  }

  clear(agentId?: string): void {
    if (agentId) {
      this.frames.delete(agentId);
    } else {
      this.frames.clear();
    }
  }
}

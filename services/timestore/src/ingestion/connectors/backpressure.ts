import type { ConnectorBackpressureConfig } from '../../config/serviceConfig';

export interface BackpressureDecision {
  shouldPause: boolean;
  delayMs: number;
}

export class BackpressureController {
  private paused = false;
  private delayMs: number;

  constructor(private readonly config: ConnectorBackpressureConfig) {
    this.delayMs = Math.max(this.config.minPauseMs, 1);
  }

  evaluate(queueDepth: number): BackpressureDecision {
    if (queueDepth >= this.config.highWatermark) {
      if (this.paused) {
        this.delayMs = Math.min(this.delayMs * 2, this.config.maxPauseMs);
      } else {
        this.paused = true;
        this.delayMs = this.config.minPauseMs;
      }
      return {
        shouldPause: true,
        delayMs: this.delayMs
      } satisfies BackpressureDecision;
    }

    if (!this.paused) {
      return {
        shouldPause: false,
        delayMs: 0
      } satisfies BackpressureDecision;
    }

    if (queueDepth <= this.config.lowWatermark) {
      this.paused = false;
      this.delayMs = this.config.minPauseMs;
      return {
        shouldPause: false,
        delayMs: 0
      } satisfies BackpressureDecision;
    }

    this.delayMs = Math.min(this.delayMs * 2, this.config.maxPauseMs);
    return {
      shouldPause: true,
      delayMs: this.delayMs
    } satisfies BackpressureDecision;
  }

  isPaused(): boolean {
    return this.paused;
  }

  currentDelay(): number {
    return this.paused ? this.delayMs : 0;
  }
}

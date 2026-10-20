import { Injectable } from '@nestjs/common';

export interface AiMetricEvent {
  feature: string;
  model: string;
  latencyMs: number;
  inputChars: number;
  success: boolean;
}

export interface MetricSummary {
  calls: number;
  failures: number;
  p50: number;
  p95: number;
}

export interface AiMetricsReport {
  overall: MetricSummary;
  byFeature: Record<string, MetricSummary>;
  lastRecordedAt?: string;
}

export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

class InflightMetrics {
  calls = 0;
  failures = 0;
  private readonly latencies: number[] = [];

  record(latencyMs: number, success: boolean): void {
    this.calls++;
    if (!success) {
      this.failures++;
    }
    this.latencies.push(latencyMs);
    if (this.latencies.length > 100) {
      this.latencies.shift();
    }
  }

  getSummary(): MetricSummary {
    return {
      calls: this.calls,
      failures: this.failures,
      p50: calculatePercentile(this.latencies, 50),
      p95: calculatePercentile(this.latencies, 95),
    };
  }
}

@Injectable()
export class AiMetricsService {
  private readonly overall = new InflightMetrics();
  private readonly byFeature = new Map<string, InflightMetrics>();
  private lastRecordedAt?: Date;

  record(event: AiMetricEvent): void {
    this.lastRecordedAt = new Date();
    this.overall.record(event.latencyMs, event.success);

    let featureMetrics = this.byFeature.get(event.feature);
    if (!featureMetrics) {
      featureMetrics = new InflightMetrics();
      this.byFeature.set(event.feature, featureMetrics);
    }
    featureMetrics.record(event.latencyMs, event.success);
  }

  getReport(): AiMetricsReport {
    const featureReport: Record<string, MetricSummary> = {};
    for (const [feat, metrics] of this.byFeature.entries()) {
      featureReport[feat] = metrics.getSummary();
    }

    return {
      overall: this.overall.getSummary(),
      byFeature: featureReport,
      lastRecordedAt: this.lastRecordedAt ? this.lastRecordedAt.toISOString() : undefined,
    };
  }

  reset(): void {
    this.byFeature.clear();
    // Re-create overall
    (this as any).overall = new InflightMetrics();
    this.lastRecordedAt = undefined;
  }
}

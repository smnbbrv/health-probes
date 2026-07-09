import { checks } from './checks.js';
import type { HealthProbe, HealthProbeResult, HealthResult, HealthStatusProbe } from './types.js';

/**
 * Manages probe state and provides probe endpoints.
 */
export class HealthProbes {
  private state = {
    live: false,
    startup: false,
    ready: false,
  };

  readonly live: HealthProbe = {
    enable: () => {
      this.state.live = true;
    },
    disable: () => {
      this.state.live = false;
    },
    get: (): Promise<HealthProbeResult> => {
      return Promise.resolve({ passing: this.state.live });
    },
    response: async (): Promise<Response> => {
      return this.createProbeResponse(await this.live.get());
    },
  };

  readonly startup: HealthProbe = {
    enable: () => {
      this.state.startup = true;
    },
    disable: () => {
      this.state.startup = false;
    },
    get: (): Promise<HealthProbeResult> => {
      return Promise.resolve({ passing: this.state.startup });
    },
    response: async (): Promise<Response> => {
      return this.createProbeResponse(await this.startup.get());
    },
  };

  readonly ready: HealthProbe = {
    enable: () => {
      this.state.ready = true;
    },
    disable: () => {
      this.state.ready = false;
    },
    get: async (): Promise<HealthProbeResult> => {
      return { passing: this.state.ready ? await checks.runRequired() : false };
    },
    response: async (): Promise<Response> => {
      return this.createProbeResponse(await this.ready.get());
    },
  };

  readonly health: HealthStatusProbe = {
    get: async (): Promise<HealthResult> => {
      const checkResults = await checks.runAll();
      const registered = checks.getChecks();

      const hasUnhealthy = Object.values(checkResults).some((c) => c.status === 'unhealthy');

      const hasRequiredUnhealthy = registered
        .filter((check) => !check.optional)
        .some((check) => checkResults[check.name]?.status !== 'healthy');

      let status: HealthResult['status'] = 'healthy';

      if (hasRequiredUnhealthy) {
        status = 'unhealthy';
      } else if (hasUnhealthy) {
        status = 'degraded';
      }

      return {
        status,
        probes: { live: this.state.live, startup: this.state.startup, ready: this.state.ready },
        checks: checkResults,
      };
    },
    response: async (): Promise<Response> => {
      const result = await this.health.get();

      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };

  private createProbeResponse(result: HealthProbeResult): Response {
    return new Response(result.passing ? 'OK' : 'Service Unavailable', {
      status: result.passing ? 200 : 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

export const probes = new HealthProbes();

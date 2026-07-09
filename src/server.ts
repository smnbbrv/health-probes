import { type Server, createServer } from 'node:http';

import { K8sPaths } from './paths.js';
import { probes } from './probes.js';
import type { HealthServerOptions, ProbePaths } from './types.js';

/**
 * Manages the HTTP server for health endpoints.
 */
export class HealthServer {
  private instance: Server | null = null;

  private async handleRequest(pathname: string, paths: Required<ProbePaths>): Promise<Response> {
    switch (pathname) {
      case paths.live: {
        return probes.live.response();
      }
      case paths.startup: {
        return probes.startup.response();
      }
      case paths.ready: {
        return probes.ready.response();
      }
      case paths.health: {
        return probes.health.response();
      }
      default: {
        return new Response('Not Found', { status: 404 });
      }
    }
  }

  /**
   * Start the health check HTTP server.
   */
  start(options: HealthServerOptions = {}): void {
    if (this.instance) {
      return;
    }

    const host = options.host ?? process.env['HEALTH_HOST'] ?? '127.0.0.1';
    const port = options.port ?? (process.env['HEALTH_PORT'] ? Number(process.env['HEALTH_PORT']) : 9090);
    const paths = { ...K8sPaths, ...options.paths };

    const instance = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const response = await this.handleRequest(url.pathname, paths);

        res.statusCode = response.status;

        for (const [key, value] of response.headers.entries()) {
          res.setHeader(key, value);
        }

        const body = await response.text();

        res.end(body);
      } catch {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Internal Server Error');
      }
    });

    instance.listen(port, host);
    this.instance = instance;
  }

  /**
   * Stop the health check HTTP server.
   */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.instance) {
        resolve();

        return;
      }

      this.instance.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.instance = null;
          resolve();
        }
      });
    });
  }
}

export const server = new HealthServer();

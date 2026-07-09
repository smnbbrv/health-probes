# health-probes

Health check probes for Node.js. Provides liveness, readiness, startup, and health status endpoints on a separate HTTP server. Framework-agnostic — works with any Node.js application.

## Installation

```bash
npm install @entwico/health-probes
```

## Usage

```ts
import { checks, probes, server } from '@entwico/health-probes';

// start health server on a separate port
// default host is '127.0.0.1' for security reasons
// use host: '0.0.0.0' in k8s containers so the kubelet can reach the probes
server.start({ host: '0.0.0.0', port: 9090 });

// enable liveness immediately
probes.live.enable();

// initialize your app...
await connectToDatabase();

// register health checks
checks.register('database', () => db.ping());

// enable startup probe (initialization complete)
probes.startup.enable();

// enable readiness probe (ready for traffic)
probes.ready.enable();
```

### Graceful shutdown

```ts
// disable readiness first (stop receiving traffic)
probes.ready.disable();

await disconnectFromDatabase();

// stop health server
await server.stop();
```

## Probes

### Liveness Probe

Indicates if the process is running. If this fails, the orchestrator should restart the container.

```ts
probes.live.enable(); // returns 200 OK
probes.live.disable(); // returns 503 Service Unavailable
```

### Startup Probe

Indicates if the application has finished initializing.

```ts
probes.startup.enable();
probes.startup.disable();
```

### Readiness Probe

Indicates if the application is ready to receive traffic. When disabled or when required health checks fail, returns 503.

```ts
probes.ready.enable();
probes.ready.disable();
```

The readiness probe automatically runs all non-optional health checks and returns 503 if any fail.

### Health Status

Returns detailed JSON status of all probes and health checks. Useful for debugging and dashboards.

```json
{
  "status": "healthy",
  "probes": {
    "live": true,
    "startup": true,
    "ready": true
  },
  "checks": {
    "database": {
      "status": "healthy",
      "latency": 12
    },
    "redis": {
      "status": "unhealthy",
      "latency": 5003,
      "error": "check \"redis\" timed out after 5000ms"
    }
  }
}
```

Status values:

- `healthy` — all checks pass
- `degraded` — optional checks failing, required checks pass
- `unhealthy` — required checks failing

## Health Checks

Register health checks to verify dependencies are working:

```ts
import { checks } from '@entwico/health-probes';

// return result (recommended for boolean checks)
checks.register('database', () => ({
  status: db.isConnected() ? 'healthy' : 'unhealthy',
  error: db.isConnected() ? undefined : 'connection lost',
}));

// throw-based (classic pattern)
checks.register('cache', async () => {
  await redis.ping(); // throws if fails
});

// with options
checks.register({
  name: 'external-api',
  check: () => fetch('https://api.example.com/health').then(() => {}),
  optional: true, // doesn't affect readiness, only health status
  timeout: 10000, // custom timeout (default: 5000ms)
});
```

The check function can either:

- Return `HealthCheckResult` with status and optional error
- Return `void` (completing without error = healthy)
- Throw an error (= unhealthy with error message)

### Unregistering Checks

`register()` returns an unregister function:

```ts
const unregister = checks.register({
  name: 'database',
  check: () => db.ping(),
});

// later...
unregister();
```

## Server Options

```ts
server.start({
  host: '0.0.0.0', // default: '127.0.0.1'
  port: 9090, // default: 9090
});
```

Resolution order: **explicit option > environment variable > default**.

| Setting | Env Variable    | Default       |
| ------- | --------------- | ------------- |
| host    | `HEALTH_HOST`   | `127.0.0.1`   |
| port    | `HEALTH_PORT`   | `9090`        |

This means `server.start()` with no arguments will pick up `HEALTH_HOST` / `HEALTH_PORT` from the environment if set.

### Custom Paths

By default, endpoints use Kubernetes-style paths (`/livez`, `/readyz`, `/startupz`, `/healthz`). You can customize them:

```ts
import { SimplePaths } from '@entwico/health-probes';

// use simple paths: /live, /ready, /startup, /health
server.start({ paths: SimplePaths });

// or mix and match
server.start({
  paths: {
    live: '/healthcheck',
    ready: '/ready',
  },
});
```

Built-in path presets:

| Preset               | live     | startup     | ready     | health     |
| -------------------- | -------- | ----------- | --------- | ---------- |
| `K8sPaths` (default) | `/livez` | `/startupz` | `/readyz` | `/healthz` |
| `SimplePaths`        | `/live`  | `/startup`  | `/ready`  | `/health`  |

## Kubernetes Configuration

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: app
      ports:
        - containerPort: 3000 # app
        - containerPort: 9090 # health
      livenessProbe:
        httpGet:
          path: /livez
          port: 9090
        initialDelaySeconds: 0
        periodSeconds: 10
      startupProbe:
        httpGet:
          path: /startupz
          port: 9090
        failureThreshold: 30
        periodSeconds: 2
      readinessProbe:
        httpGet:
          path: /readyz
          port: 9090
        periodSeconds: 5
```

## API Reference

### Server

```ts
import { server } from '@entwico/health-probes';

server.start(options?: HealthServerOptions): void;
server.stop(): Promise<void>;
```

### Probes

```ts
import { probes } from '@entwico/health-probes';

probes.live.enable(): void;
probes.live.disable(): void;
probes.live.get(): Promise<HealthProbeResult>;
probes.live.response(): Promise<Response>;

// same for startup, ready

probes.health.get(): Promise<HealthResult>;
probes.health.response(): Promise<Response>;
```

### Checks

```ts
import { checks } from '@entwico/health-probes';

checks.register(name: string, check: CheckFn): () => void;
checks.register(check: HealthCheck): () => void;

// CheckFn = () => Promise<HealthCheckResult | void> | HealthCheckResult | void
checks.getChecks(): HealthCheck[];
checks.runAll(): Promise<Record<string, HealthCheckResult>>;
checks.runRequired(): Promise<boolean>;
```

## Types

```ts
interface ProbePaths {
  live?: string;
  startup?: string;
  ready?: string;
  health?: string;
}

interface HealthServerOptions {
  host?: string; // env: HEALTH_HOST, default: '127.0.0.1'
  port?: number; // env: HEALTH_PORT, default: 9090
  paths?: ProbePaths; // default: K8sPaths
}

interface HealthCheck {
  name: string;
  check: () => Promise<HealthCheckResult | void> | HealthCheckResult | void;
  optional?: boolean; // default: false
  timeout?: number; // default: 5000
}

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  latency?: number;
  error?: string;
}

interface HealthProbeResult {
  passing: boolean;
}

interface HealthResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  probes: {
    live: boolean;
    startup: boolean;
    ready: boolean;
  };
  checks: Record<string, HealthCheckResult>;
}
```

## License

MIT

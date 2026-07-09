import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { afterEach, describe, it } from 'node:test';

import { HealthChecks, HealthProbes, HealthServer } from './index.js';

function waitForPort(port: number, host = '127.0.0.1'): Promise<void> {
  return new Promise((resolve) => {
    const retry = () => {
      const socket = connect(port, host);

      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });

      socket.on('error', () => {
        setTimeout(retry, 10);
      });
    };

    retry();
  });
}

describe('HealthChecks', () => {
  let hc: HealthChecks;

  afterEach(() => {
    hc = new HealthChecks();
  });

  it('should register and retrieve checks', () => {
    hc = new HealthChecks();
    hc.register('db', () => {});

    assert.equal(hc.getChecks().length, 1);
    assert.equal(hc.getChecks()[0]?.name, 'db');
  });

  it('should unregister checks', () => {
    hc = new HealthChecks();
    const unregister = hc.register('db', () => {});

    assert.equal(hc.getChecks().length, 1);

    unregister();

    assert.equal(hc.getChecks().length, 0);
  });

  it('should register checks with object syntax', () => {
    hc = new HealthChecks();
    hc.register({ name: 'db', check: () => {}, optional: true, timeout: 1000 });

    const check = hc.getChecks()[0];

    assert.equal(check?.name, 'db');
    assert.equal(check?.optional, true);
    assert.equal(check?.timeout, 1000);
  });

  it('should return healthy for a passing void check', async () => {
    hc = new HealthChecks();
    hc.register('db', () => {});

    const results = await hc.runAll();

    assert.equal(results['db']?.status, 'healthy');
    assert.equal(typeof results['db']?.latency, 'number');
  });

  it('should return healthy for a check returning healthy result', async () => {
    hc = new HealthChecks();
    hc.register('db', () => ({ status: 'healthy' as const }));

    const results = await hc.runAll();

    assert.equal(results['db']?.status, 'healthy');
  });

  it('should return unhealthy for a throwing check', async () => {
    hc = new HealthChecks();
    hc.register('db', () => {
      throw new Error('connection refused');
    });

    const results = await hc.runAll();

    assert.equal(results['db']?.status, 'unhealthy');
    assert.equal(results['db']?.error, 'connection refused');
  });

  it('should return unhealthy for a check returning unhealthy result', async () => {
    hc = new HealthChecks();
    hc.register('db', () => ({ status: 'unhealthy' as const, error: 'down' }));

    const results = await hc.runAll();

    assert.equal(results['db']?.status, 'unhealthy');
    assert.equal(results['db']?.error, 'down');
  });

  it('should timeout slow checks', async () => {
    hc = new HealthChecks();
    hc.register({
      name: 'slow',
      check: () => new Promise((resolve) => setTimeout(resolve, 5000)),
      timeout: 50,
    });

    const results = await hc.runAll();

    assert.equal(results['slow']?.status, 'unhealthy');
    assert.match(results['slow']!.error!, /timed out/);
  });

  it('should handle async checks', async () => {
    hc = new HealthChecks();
    hc.register('async-check', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const results = await hc.runAll();

    assert.equal(results['async-check']?.status, 'healthy');
  });

  it('should run required checks only', async () => {
    hc = new HealthChecks();
    hc.register({ name: 'required', check: () => {} });
    hc.register({
      name: 'optional',
      check: () => {
        throw new Error('fail');
      },
      optional: true,
    });

    const passing = await hc.runRequired();

    assert.equal(passing, true);
  });

  it('should fail runRequired when a required check fails', async () => {
    hc = new HealthChecks();
    hc.register('required', () => {
      throw new Error('fail');
    });

    const passing = await hc.runRequired();

    assert.equal(passing, false);
  });

  it('should return true for runRequired with no checks registered', async () => {
    hc = new HealthChecks();

    const passing = await hc.runRequired();

    assert.equal(passing, true);
  });
});

describe('HealthProbes', () => {
  it('should start with all probes disabled', async () => {
    const hp = new HealthProbes();

    const live = await hp.live.get();
    const startup = await hp.startup.get();
    const ready = await hp.ready.get();

    assert.equal(live.passing, false);
    assert.equal(startup.passing, false);
    assert.equal(ready.passing, false);
  });

  it('should enable and disable live', async () => {
    const hp = new HealthProbes();

    hp.live.enable();

    const enabled = await hp.live.get();

    assert.equal(enabled.passing, true);

    hp.live.disable();

    const disabled = await hp.live.get();

    assert.equal(disabled.passing, false);
  });

  it('should enable and disable startup', async () => {
    const hp = new HealthProbes();

    hp.startup.enable();

    const enabled = await hp.startup.get();

    assert.equal(enabled.passing, true);

    hp.startup.disable();

    const disabled = await hp.startup.get();

    assert.equal(disabled.passing, false);
  });

  it('should return 200 response when probe is enabled', async () => {
    const hp = new HealthProbes();

    hp.live.enable();
    const response = await hp.live.response();

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'OK');
  });

  it('should return 503 response when probe is disabled', async () => {
    const hp = new HealthProbes();

    const response = await hp.live.response();

    assert.equal(response.status, 503);
    assert.equal(await response.text(), 'Service Unavailable');
  });

  it('should return health JSON response', async () => {
    const hp = new HealthProbes();

    hp.live.enable();
    hp.startup.enable();

    const response = await hp.health.response();
    const body = JSON.parse(await response.text());

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    assert.equal(body.probes.live, true);
    assert.equal(body.probes.startup, true);
    assert.equal(body.probes.ready, false);
  });
});

describe('HealthServer', () => {
  let hs: HealthServer;

  afterEach(async () => {
    await hs?.stop();
  });

  it('should start and stop without error', async () => {
    hs = new HealthServer();

    hs.start({ port: 19_091 });
    await waitForPort(19_091);
    await hs.stop();
  });

  it('should not throw when stopping without starting', async () => {
    hs = new HealthServer();

    await hs.stop();
  });

  it('should ignore duplicate start calls', async () => {
    hs = new HealthServer();

    hs.start({ port: 19_092 });
    hs.start({ port: 19_092 });
    await waitForPort(19_092);
  });

  it('should use HEALTH_PORT env var when no port option is given', async () => {
    process.env['HEALTH_PORT'] = '19093';
    hs = new HealthServer();

    try {
      hs.start();
      await waitForPort(19_093);
    } finally {
      delete process.env['HEALTH_PORT'];
    }
  });

  it('should prefer explicit port over HEALTH_PORT env var', async () => {
    process.env['HEALTH_PORT'] = '19099';
    hs = new HealthServer();

    try {
      hs.start({ port: 19_094 });
      await waitForPort(19_094);
    } finally {
      delete process.env['HEALTH_PORT'];
    }
  });
});

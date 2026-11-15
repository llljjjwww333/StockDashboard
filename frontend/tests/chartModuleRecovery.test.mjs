import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverChartModule } from '../src/lib/chartModuleRecovery.ts';

const missingModule = new TypeError('Failed to fetch dynamically imported module: /assets/old.js');
function fixture(next = '/assets/new.js') {
  let seen = null, reloads = 0, probes = 0;
  const controller = new AbortController();
  const port = { currentEntry: '/assets/old.js', latestEntry: async () => { probes++; return next; },
    lastReloadedEntry: () => seen, rememberEntry: entry => { seen = entry; }, canReload: () => true, reload: () => { reloads++; } };
  return { port, controller, read: () => ({ seen, reloads, probes }) };
}

test('a missing chart module reloads a newer entry once and remembers the attempted version', async () => {
  const f = fixture();
  assert.equal(await recoverChartModule(missingModule, f.port, f.controller.signal), true);
  assert.deepEqual(f.read(), { seen: '/assets/new.js', reloads: 1, probes: 1 });
  assert.equal(await recoverChartModule(missingModule, f.port, f.controller.signal), false);
  assert.equal(f.read().reloads, 1);
});

test('same-version failures, unavailable HTML and ordinary render errors do not trigger automatic reloads', async () => {
  for (const next of ['/assets/old.js', null]) {
    const f = fixture(next);
    assert.equal(await recoverChartModule(missingModule, f.port, f.controller.signal), false);
    assert.equal(f.read().reloads, 0);
  }
  const f = fixture();
  assert.equal(await recoverChartModule(new TypeError('Invalid candle range'), f.port, f.controller.signal), false);
  assert.equal(f.read().probes, 0);
  f.port.latestEntry = async () => { throw new Error('offline'); };
  assert.equal(await recoverChartModule(missingModule, f.port, f.controller.signal), false);
});

test('leaving the chart cancels recovery, including an already completed version probe', async () => {
  const f = fixture();
  f.port.latestEntry = async () => { f.controller.abort(); return '/assets/new.js'; };
  assert.equal(await recoverChartModule(missingModule, f.port, f.controller.signal), false);
  assert.equal(f.read().reloads, 0);
  assert.equal(await recoverChartModule(missingModule, f.port, f.controller.signal), false);
});

test('Safari dynamic-import and Vite CSS preload failures recover through the same version check', async () => {
  for (const message of ['Importing a module script failed.', 'error loading dynamically imported module', 'Unable to preload CSS for /assets/chart.css']) {
    const f = fixture();
    assert.equal(await recoverChartModule(new Error(message), f.port, f.controller.signal), true);
    assert.equal(f.read().reloads, 1);
  }
});

test('editing settings or a form defers automatic reload without consuming the version attempt', async () => {
  const f = fixture();
  f.port.canReload = () => false;
  assert.equal(await recoverChartModule(missingModule, f.port, f.controller.signal), false);
  assert.deepEqual(f.read(), { seen: null, reloads: 0, probes: 1 });
});

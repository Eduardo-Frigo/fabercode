'use strict';

const assert = require('assert');

const {
  SANDBOX_A1_REQUIRED_FEATURES,
} = require('../main/capabilities/sandbox_backend_contract');
const {
  EXECUTION_ISOLATION_RUNTIME_SERVICES_VERSION,
} = require('../main/services/execution_isolation_runtime_services');
const {
  EXECUTION_ISOLATION_BROKER_SANDBOX_REGISTRY_VERSION,
  createExecutionIsolationBrokerSandboxRegistry,
} = require('../main/services/execution_isolation_broker_sandbox_registry');

function createRuntimeServices(state) {
  return Object.freeze({
    version: EXECUTION_ISOLATION_RUNTIME_SERVICES_VERSION,
    diagnostics() {
      return Object.freeze({
        version: EXECUTION_ISOLATION_RUNTIME_SERVICES_VERSION,
        state: state.value,
        selectionStatus: state.selectionStatus,
        selectionReasonCode: state.reasonCode,
      });
    },
  });
}

(async () => {
  const state = {
    value: 'ready',
    selectionStatus: 'enforced',
    reasonCode: 'ENFORCED',
  };
  const registry = createExecutionIsolationBrokerSandboxRegistry({
    runtimeServices: createRuntimeServices(state),
  });
  assert.strictEqual(Object.isFrozen(registry), true);
  assert.deepStrictEqual(Reflect.ownKeys(registry), ['version', 'select', 'diagnostics']);
  assert.strictEqual(
    registry.version,
    EXECUTION_ISOLATION_BROKER_SANDBOX_REGISTRY_VERSION
  );

  const enforced = await registry.select(Object.freeze({
    requiredFeatures: SANDBOX_A1_REQUIRED_FEATURES,
    projectSession: Object.freeze({
      sessionId: 'session-a',
      projectId: 'project-a',
      rootPath: '/projects/a',
      realRootPath: '/projects/a',
      jobId: 'job-a',
    }),
    execution: Object.freeze({
      requestId: 'request-a',
      capability: 'process',
      action: 'run',
    }),
  }));
  assert.strictEqual(enforced.matched, true);
  assert.strictEqual(enforced.probe.state, 'enforced');
  assert.deepStrictEqual(enforced.probe.features, SANDBOX_A1_REQUIRED_FEATURES);
  assert.strictEqual(enforced.backend.id, 'execution-isolation-authorized-job-executor');
  assert.strictEqual(
    typeof Object.getOwnPropertyDescriptor(enforced.backend, 'execute').value,
    'function'
  );
  await assert.rejects(
    enforced.backend.execute(),
    (error) => error && error.code === 'SANDBOX_EXECUTOR_REQUIRED'
  );

  state.value = 'disposing';
  const disposing = await registry.select({ requiredFeatures: SANDBOX_A1_REQUIRED_FEATURES });
  assert.strictEqual(disposing.matched, false);
  assert.strictEqual(disposing.probe.state, 'unavailable');
  assert.deepStrictEqual(disposing.probe.features, []);
  assert.strictEqual(registry.diagnostics().state, 'unavailable');

  state.value = 'ready';
  state.selectionStatus = 'unsupported';
  state.reasonCode = 'PROVIDER_UNAVAILABLE';
  const unsupported = await registry.select({ requiredFeatures: SANDBOX_A1_REQUIRED_FEATURES });
  assert.strictEqual(unsupported.matched, false);
  assert.strictEqual(unsupported.probe.state, 'unavailable');
  assert.strictEqual(registry.diagnostics().reasonCode, 'PROVIDER_UNAVAILABLE');

  let getterCalls = 0;
  const accessorRuntime = Object.freeze(Object.defineProperties({}, {
    version: {
      enumerable: true,
      value: EXECUTION_ISOLATION_RUNTIME_SERVICES_VERSION,
    },
    diagnostics: {
      enumerable: true,
      get() {
        getterCalls += 1;
        return () => ({});
      },
    },
  }));
  assert.throws(
    () => createExecutionIsolationBrokerSandboxRegistry({
      runtimeServices: accessorRuntime,
    }),
    TypeError
  );
  assert.strictEqual(getterCalls, 0);
  assert.throws(
    () => createExecutionIsolationBrokerSandboxRegistry({
      runtimeServices: new Proxy(createRuntimeServices(state), {}),
    }),
    TypeError
  );
  assert.throws(
    () => createExecutionIsolationBrokerSandboxRegistry({
      runtimeServices: createRuntimeServices(state),
      unexpected: true,
    }),
    /invalid/i
  );

  console.log('execution-isolation-broker-sandbox-registry.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

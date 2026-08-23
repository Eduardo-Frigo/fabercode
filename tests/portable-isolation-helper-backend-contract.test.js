'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  PORTABLE_ISOLATION_BACKEND_CONTRACT_VERSION,
  PORTABLE_ISOLATION_BACKEND_REQUEST_VERSION,
  PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION,
  PORTABLE_ISOLATION_ROOT_LEASE_DESCRIPTOR_VERSION,
  PortableIsolationHelperBackendContractError,
  assertPortableIsolationHelperBackendRequest,
  assertPortableIsolationHelperBackendResponse,
  assertPortableIsolationHelperRootLeaseDescriptor,
  createPortableIsolationHelperBackendRequest,
  createPortableIsolationHelperBackendResponse,
  createPortableIsolationHelperRootLeaseDescriptor,
} = require('../main/capabilities/portable_isolation_helper_backend_contract');
const adapterModule = require('../main/services/portable_isolation_helper_provider_adapter');

const digest = (character) => `sha256:${character.repeat(64)}`;

function exactFrozen(value, keys) {
  assert.ok(Object.isFrozen(value));
  assert.deepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function expectCode(action, code) {
  assert.throws(
    action,
    (error) => error instanceof PortableIsolationHelperBackendContractError
      && error.code === code
  );
}

(() => {
  assert.strictEqual(
    PORTABLE_ISOLATION_BACKEND_CONTRACT_VERSION,
    'portable-isolation-backend-contract.v1'
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_BACKEND_REQUEST_VERSION,
    'portable-isolation-backend-request.v1'
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION,
    'portable-isolation-backend-response.v1'
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_ROOT_LEASE_DESCRIPTOR_VERSION,
    'portable-isolation-root-lease-descriptor.v1'
  );

  const mutableInput = {
    leaseId: 'workspace-lease-a',
    binding: {
      projectId: 'project-a',
      jobId: 'job-a',
    },
  };
  const request = createPortableIsolationHelperBackendRequest({
    backendId: 'portable-private-workspace',
    input: mutableInput,
  });
  exactFrozen(request, ['version', 'backendId', 'input']);
  assert.strictEqual(request.version, PORTABLE_ISOLATION_BACKEND_REQUEST_VERSION);
  assert.strictEqual(request.backendId, 'portable-private-workspace');
  assert.ok(Object.isFrozen(request.input));
  assert.ok(Object.isFrozen(request.input.binding));
  assert.notStrictEqual(request.input, mutableInput);
  mutableInput.leaseId = 'mutated';
  mutableInput.binding.projectId = 'mutated';
  assert.strictEqual(request.input.leaseId, 'workspace-lease-a');
  assert.strictEqual(request.input.binding.projectId, 'project-a');
  assert.deepStrictEqual(
    assertPortableIsolationHelperBackendRequest(request),
    request
  );

  const mutableResult = {
    ok: true,
    lease: {
      leaseId: 'workspace-lease-a',
    },
  };
  const response = createPortableIsolationHelperBackendResponse({
    backendId: request.backendId,
    result: mutableResult,
  });
  exactFrozen(response, ['version', 'backendId', 'result']);
  assert.strictEqual(response.version, PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION);
  assert.strictEqual(response.backendId, request.backendId);
  assert.ok(Object.isFrozen(response.result));
  assert.ok(Object.isFrozen(response.result.lease));
  mutableResult.lease.leaseId = 'mutated';
  assert.strictEqual(response.result.lease.leaseId, 'workspace-lease-a');
  assert.deepStrictEqual(
    assertPortableIsolationHelperBackendResponse(response),
    response
  );

  const descriptor = createPortableIsolationHelperRootLeaseDescriptor({
    leaseId: 'root-lease-a',
    jobId: 'job-a',
    projectId: 'project-a',
    purpose: 'project_scan',
    physicalRootIdentityDigest: digest('a'),
    authorityDigest: digest('b'),
  });
  exactFrozen(descriptor, [
    'version',
    'leaseId',
    'jobId',
    'projectId',
    'purpose',
    'physicalRootIdentityDigest',
    'authorityDigest',
  ]);
  assert.strictEqual(
    descriptor.version,
    PORTABLE_ISOLATION_ROOT_LEASE_DESCRIPTOR_VERSION
  );
  assert.deepStrictEqual(
    assertPortableIsolationHelperRootLeaseDescriptor(descriptor),
    descriptor
  );

  expectCode(
    () => createPortableIsolationHelperBackendRequest({
      backendId: '../escape',
      input: {},
    }),
    'BACKEND_REQUEST_INVALID'
  );
  expectCode(
    () => assertPortableIsolationHelperBackendRequest({
      ...request,
      version: 'portable-isolation-backend-request.v0',
    }),
    'BACKEND_REQUEST_INVALID'
  );
  expectCode(
    () => assertPortableIsolationHelperBackendRequest({
      ...request,
      unexpected: true,
    }),
    'BACKEND_REQUEST_INVALID'
  );
  expectCode(
    () => createPortableIsolationHelperBackendResponse({
      backendId: request.backendId,
      result: Promise.resolve({ ok: true }),
    }),
    'BACKEND_RESPONSE_INVALID'
  );
  expectCode(
    () => assertPortableIsolationHelperBackendResponse({
      ...response,
      backendId: '',
    }),
    'BACKEND_RESPONSE_INVALID'
  );
  expectCode(
    () => createPortableIsolationHelperRootLeaseDescriptor({
      ...descriptor,
      physicalRootIdentityDigest: digest('A'),
    }),
    'ROOT_LEASE_DESCRIPTOR_INVALID'
  );
  expectCode(
    () => assertPortableIsolationHelperRootLeaseDescriptor({
      ...descriptor,
      purpose: '../escape',
    }),
    'ROOT_LEASE_DESCRIPTOR_INVALID'
  );

  const cyclic = {};
  cyclic.self = cyclic;
  expectCode(
    () => createPortableIsolationHelperBackendRequest({
      backendId: request.backendId,
      input: cyclic,
    }),
    'BACKEND_REQUEST_INVALID'
  );

  let getterTouched = false;
  const hostile = {};
  Object.defineProperty(hostile, 'backendId', {
    enumerable: true,
    get() {
      getterTouched = true;
      return request.backendId;
    },
  });
  Object.defineProperty(hostile, 'input', {
    enumerable: true,
    value: {},
  });
  expectCode(
    () => createPortableIsolationHelperBackendRequest(hostile),
    'BACKEND_REQUEST_INVALID'
  );
  assert.strictEqual(getterTouched, false);

  assert.strictEqual(
    adapterModule.PORTABLE_ISOLATION_BACKEND_REQUEST_VERSION,
    PORTABLE_ISOLATION_BACKEND_REQUEST_VERSION
  );
  assert.strictEqual(
    adapterModule.PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION,
    PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION
  );
  assert.strictEqual(
    adapterModule.PORTABLE_ISOLATION_ROOT_LEASE_DESCRIPTOR_VERSION,
    PORTABLE_ISOLATION_ROOT_LEASE_DESCRIPTOR_VERSION
  );

  const contractSource = fs.readFileSync(path.join(
    __dirname,
    '..',
    'main',
    'capabilities',
    'portable_isolation_helper_backend_contract.js'
  ), 'utf8');
  assert.doesNotMatch(
    contractSource,
    /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bprocess\.env\b|\b__dirname\b|\bspawn\s*\(|\bexecFile\s*\(|\bimport\s*\(/
  );
  assert.match(contractSource, /preflightDataGraph/);
  assert.match(contractSource, /immutableSnapshot/);

  const adapterSource = fs.readFileSync(path.join(
    __dirname,
    '..',
    'main',
    'services',
    'portable_isolation_helper_provider_adapter.js'
  ), 'utf8');
  assert.match(
    adapterSource,
    /require\(['"]\.\.\/capabilities\/portable_isolation_helper_backend_contract['"]\)/
  );
  assert.doesNotMatch(
    adapterSource,
    /const PORTABLE_ISOLATION_BACKEND_REQUEST_VERSION\s*=|const PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION\s*=|const PORTABLE_ISOLATION_ROOT_LEASE_DESCRIPTOR_VERSION\s*=/
  );

  console.log('portable isolation helper backend contract tests passed');
})();

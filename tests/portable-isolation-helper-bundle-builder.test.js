'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const {
  PORTABLE_ISOLATION_HELPER_BUNDLE_BUILDER_VERSION,
  PORTABLE_ISOLATION_HELPER_BUNDLE_ENTRY_MODULE_ID,
  PORTABLE_ISOLATION_HELPER_BUNDLE_MODULE_IDS,
  PortableIsolationHelperBundleBuilderError,
  createPortableIsolationHelperBundleBuilder,
} = require('../build/portable_isolation_helper_bundle_builder');

const EXPECTED_MODULE_IDS = Object.freeze([
  'main/capabilities/capability_delegation_contracts.js',
  'main/capabilities/execution_workspace_contract.js',
  'main/capabilities/portable_isolation_helper_backend_contract.js',
  'main/capabilities/portable_isolation_helper_distribution_attestation_contract.js',
  'main/capabilities/portable_isolation_helper_private_transport_contract.js',
  'main/capabilities/portable_isolation_helper_protocol.js',
  'main/capabilities/process_supervisor_contract.js',
  'main/capabilities/project_root_authority_contract.js',
  'main/capabilities/sandbox_backend_contract.js',
  'main/capabilities/transactional_delete_contracts.js',
  'main/services/portable_isolation_helper_backend_dispatcher.js',
  'main/services/portable_isolation_helper_execution_workspace_backend.js',
  'main/services/portable_isolation_helper_physical_runtime.js',
  'main/services/portable_isolation_helper_process_supervisor_backend.js',
  'main/services/portable_isolation_helper_project_root_authority_backend.js',
  'main/services/portable_isolation_helper_runtime_session.js',
  'main/portable_isolation_helper/utility_entry.js',
]);

const tempRoots = [];

function tempRoot() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-helper-bundle-'));
  tempRoots.push(value);
  return value;
}

function assertCode(code) {
  return (error) => error instanceof PortableIsolationHelperBundleBuilderError
    && error.code === code
    && error.message === code;
}

function minimalFixture() {
  const root = tempRoot();
  for (const moduleId of EXPECTED_MODULE_IDS) {
    const location = path.join(root, ...moduleId.split('/'));
    fs.mkdirSync(path.dirname(location), { recursive: true });
    fs.writeFileSync(location, "'use strict';\nmodule.exports = {};\n", 'utf8');
  }
  return root;
}

try {
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_BUNDLE_BUILDER_VERSION,
    'portable-isolation-helper-bundle-builder.v1'
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_BUNDLE_ENTRY_MODULE_ID,
    'main/portable_isolation_helper/utility_entry.js'
  );
  assert.ok(Object.isFrozen(PORTABLE_ISOLATION_HELPER_BUNDLE_MODULE_IDS));
  assert.deepStrictEqual(
    PORTABLE_ISOLATION_HELPER_BUNDLE_MODULE_IDS,
    EXPECTED_MODULE_IDS
  );

  let trapCount = 0;
  const hostile = new Proxy({}, {
    getPrototypeOf() {
      trapCount += 1;
      throw new Error('must not run');
    },
    ownKeys() {
      trapCount += 1;
      throw new Error('must not run');
    },
  });
  assert.throws(
    () => createPortableIsolationHelperBundleBuilder(hostile),
    assertCode('BUNDLE_BUILDER_OPTIONS_INVALID')
  );
  assert.strictEqual(trapCount, 0);
  assert.throws(
    () => createPortableIsolationHelperBundleBuilder({
      projectRootPath: __dirname,
      moduleIds: [],
    }),
    assertCode('BUNDLE_BUILDER_OPTIONS_INVALID')
  );
  assert.throws(
    () => createPortableIsolationHelperBundleBuilder({ projectRootPath: '/' }),
    assertCode('BUNDLE_BUILDER_OPTIONS_INVALID')
  );

  const projectRootPath = path.resolve(__dirname, '..');
  const builder = createPortableIsolationHelperBundleBuilder({ projectRootPath });
  assert.ok(Object.isFrozen(builder));
  assert.deepStrictEqual(Reflect.ownKeys(builder), ['version', 'build']);
  assert.strictEqual(builder.version, PORTABLE_ISOLATION_HELPER_BUNDLE_BUILDER_VERSION);
  const first = builder.build();
  const second = builder.build();
  assert.ok(Object.isFrozen(first));
  assert.deepStrictEqual(Reflect.ownKeys(first), [
    'version',
    'entryModuleId',
    'moduleIds',
    'entrySourceDigest',
    'sourceIdentityDigest',
    'bundleDigest',
    'bundleBytes',
    'bundleSource',
  ]);
  assert.strictEqual(first.version, 'portable-isolation-helper-bundle-result.v1');
  assert.strictEqual(first.entryModuleId, PORTABLE_ISOLATION_HELPER_BUNDLE_ENTRY_MODULE_ID);
  assert.deepStrictEqual(first.moduleIds, EXPECTED_MODULE_IDS);
  assert.ok(Object.isFrozen(first.moduleIds));
  assert.match(first.entrySourceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.sourceIdentityDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.bundleDigest, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(first.bundleBytes, Buffer.byteLength(first.bundleSource, 'utf8'));
  assert.ok(first.bundleBytes > 300_000);
  assert.ok(first.bundleBytes < 1024 * 1024);
  assert.strictEqual(first.bundleSource.includes(projectRootPath), false);
  assert.match(first.bundleSource, /portable-physical-execution-workspace/);
  assert.match(first.bundleSource, /portable-physical-project-root-authority/);
  assert.match(first.bundleSource, /portable-physical-process-supervisor/);
  assert.match(first.bundleSource, /__faberLoad\(/);
  assert.strictEqual(first.bundleSource, second.bundleSource);
  assert.strictEqual(first.bundleDigest, second.bundleDigest);
  assert.strictEqual(first.sourceIdentityDigest, second.sourceIdentityDigest);
  new vm.Script(first.bundleSource, { filename: 'utility_entry.js' });

  const symlinkRoot = minimalFixture();
  const symlinkModule = path.join(
    symlinkRoot,
    'main/services/portable_isolation_helper_physical_runtime.js'
  );
  const outside = path.join(tempRoot(), 'outside.js');
  fs.writeFileSync(outside, "'use strict';\n", 'utf8');
  fs.unlinkSync(symlinkModule);
  fs.symlinkSync(outside, symlinkModule);
  assert.throws(
    () => createPortableIsolationHelperBundleBuilder({
      projectRootPath: symlinkRoot,
    }).build(),
    assertCode('BUNDLE_SOURCE_INVALID')
  );

  const missingRoot = minimalFixture();
  fs.unlinkSync(path.join(missingRoot, ...EXPECTED_MODULE_IDS[0].split('/')));
  assert.throws(
    () => createPortableIsolationHelperBundleBuilder({
      projectRootPath: missingRoot,
    }).build(),
    assertCode('BUNDLE_SOURCE_INVALID')
  );

  const source = fs.readFileSync(path.join(
    __dirname,
    '../build/portable_isolation_helper_bundle_builder.js'
  ), 'utf8');
  assert.doesNotMatch(
    source,
    /process\.cwd|process\.env|\bglob\b|readdirSync|opendirSync|\beval\s*\(|new Function|require\(['"]child_process['"]\)|\bimport\s*\(/
  );
  assert.match(source, /O_NOFOLLOW/);
  assert.match(source, /PORTABLE_ISOLATION_HELPER_BUNDLE_MODULE_IDS/);
  console.log('portable isolation helper bundle builder tests passed');
} finally {
  for (const root of tempRoots.reverse()) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* cleanup */ }
  }
}

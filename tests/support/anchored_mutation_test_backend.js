'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES,
  ANCHORED_FILESYSTEM_MUTATION_ROOT_NAMESPACE_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
  createAnchoredFilesystemMutationProbe,
} = require('../../main/capabilities/anchored_filesystem_mutation_backend_contract');
const {
  assertAnchoredMutationIdentityReceipt,
  createAnchoredMutationIdentityReceipt,
} = require('../../main/capabilities/anchored_mutation_identity_receipt_contract');
const {
  canonicalSha256Digest,
} = require('../../main/capabilities/transactional_delete_contracts');

const NAMESPACE_IO_INTEGRATION_VERSION =
  ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION;
const ROOT_NAMESPACE_VERSION = ANCHORED_FILESYSTEM_MUTATION_ROOT_NAMESPACE_VERSION;
const namespaceClosers = new WeakMap();

function exists(fsImpl, entryPath) {
  try {
    fsImpl.lstatSync(entryPath);
    return true;
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return false;
    throw error;
  }
}

function digestBytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function identityDigest(fsImpl, entryPath) {
  return physicalIdentity(fsImpl, entryPath).identityDigest;
}

function physicalIdentity(fsImpl, entryPath) {
  const stat = fsImpl.lstatSync(entryPath);
  const volumeIdentityDigest = digestBytes(Buffer.from(
    `test-volume:${String(stat.dev)}`,
    'utf8'
  ));
  const objectIdentityDigest = digestBytes(Buffer.from(
    `test-object:${String(stat.dev)}:${String(stat.ino)}`,
    'utf8'
  ));
  const generationIdentityDigest = digestBytes(Buffer.from([
    'test-generation',
    String(stat.dev),
    String(stat.ino),
    String(stat.birthtimeMs),
    String(stat.mode),
  ].join(':'), 'utf8'));
  const core = {
    volumeIdentityDigest,
    objectIdentityDigest,
    generationIdentityDigest,
  };
  return Object.freeze({
    ...core,
    identityDigest: canonicalSha256Digest(core),
  });
}

function deterministicDigest(value) {
  return canonicalSha256Digest(value);
}

function receiptEntryPath(fsImpl, rootPath, privatePathSet, targets, relativePath) {
  const target = targets.find((candidate) => (
    relativePath === candidate.relativePath
      || relativePath.startsWith(`${candidate.relativePath}/`)
  ));
  if (!target) throw Object.assign(new Error('checkpoint entry is outside its target set'), {
    code: 'PROTOCOL_DATA_INVALID',
  });
  const sourceRoot = path.join(rootPath, ...target.relativePath.split('/'));
  if (exists(fsImpl, sourceRoot)) {
    return path.join(rootPath, ...relativePath.split('/'));
  }
  const suffix = relativePath === target.relativePath
    ? []
    : relativePath.slice(target.relativePath.length + 1).split('/');
  return path.join(privatePathSet.payloadPath, target.payloadName, ...suffix);
}

function createPhysicalIdentityReceipt(fsImpl, input, privatePathSet, targets) {
  const entryCores = input.checkpointEntries.map((entry) => {
    const entryPath = receiptEntryPath(
      fsImpl,
      input.rootPath,
      privatePathSet,
      targets,
      entry.relativePath
    );
    const identity = physicalIdentity(fsImpl, entryPath);
    const linkIdentityDigest = entry.kind === 'symlink'
      ? digestBytes(Buffer.from(`test-link:${fsImpl.readlinkSync(entryPath)}`, 'utf8'))
      : null;
    return Object.freeze({
      relativePath: entry.relativePath,
      kind: entry.kind,
      identity,
      closureDigest: null,
      linkIdentityDigest,
    });
  });
  const entries = entryCores.map((entry) => {
    if (entry.kind !== 'directory') return entry;
    const prefix = `${entry.relativePath}/`;
    const closure = entryCores
      .filter((candidate) => (
        candidate.relativePath === entry.relativePath
          || candidate.relativePath.startsWith(prefix)
      ))
      .map((candidate) => Object.freeze({
        relativePath: candidate.relativePath,
        kind: candidate.kind,
        identityDigest: candidate.identity.identityDigest,
        linkIdentityDigest: candidate.linkIdentityDigest,
      }));
    return Object.freeze({
      ...entry,
      closureDigest: deterministicDigest(closure),
    });
  });
  const entriesByPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
  const receiptTargets = targets.map((target) => {
    const entry = entriesByPath.get(target.relativePath);
    if (!entry) throw Object.assign(new Error('target omitted from checkpoint entries'), {
      code: 'PROTOCOL_DATA_INVALID',
    });
    return Object.freeze({
      relativePath: target.relativePath,
      payloadName: target.payloadName,
      kind: entry.kind,
      identity: entry.identity,
      closureDigest: entry.closureDigest,
      linkIdentityDigest: entry.linkIdentityDigest,
    });
  });
  const platform = Object.freeze({
    os: process.platform,
    architecture: process.arch,
    filesystemType: 'node-test-filesystem',
    capabilityDigest: deterministicDigest({
      helper: 'anchored-mutation-test-helper-build-v1',
      scope: 'tests-only',
    }),
  });
  return createAnchoredMutationIdentityReceipt({
    helperBuildId: 'anchored-mutation-test-helper-build-v1',
    platform,
    bindingDigest: input.bindingDigest,
    checkpointDigest: input.checkpointDigest,
    rootIdentity: physicalIdentity(fsImpl, input.rootPath),
    namespaceIdentity: physicalIdentity(fsImpl, privatePathSet.namespacePath),
    targets: receiptTargets,
    entries,
  });
}

function normalizeRelativePath(relativePath, { allowEmpty = false } = {}) {
  if (typeof relativePath !== 'string'
    || relativePath.includes('\\')
    || relativePath.startsWith('/')
    || relativePath.includes('\0')) {
    throw Object.assign(new Error('unsafe private namespace path'), {
      code: 'PROTOCOL_PATH_INVALID',
    });
  }
  if (relativePath === '' && allowEmpty) return '';
  const components = relativePath.split('/');
  if (!components.length || components.some((component) => (
    !component || component === '.' || component === '..'
  ))) {
    throw Object.assign(new Error('unsafe private namespace path'), {
      code: 'PROTOCOL_PATH_INVALID',
    });
  }
  return components.join('/');
}

function anchoredPath(namespacePath, relativePath, options) {
  const normalized = normalizeRelativePath(relativePath, options);
  return normalized
    ? path.join(namespacePath, ...normalized.split('/'))
    : namespacePath;
}

function assertSafeNamespaceAncestors(fsImpl, namespacePath, targetPath, { create = false } = {}) {
  const relative = path.relative(namespacePath, path.dirname(targetPath));
  let current = namespacePath;
  if (!exists(fsImpl, current)) {
    if (!create) return false;
    fsImpl.mkdirSync(current, { mode: 0o700 });
  }
  const rootStat = fsImpl.lstatSync(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw Object.assign(new Error('unsafe private namespace root'), {
      code: 'PRIVATE_DIRECTORY_UNSAFE',
    });
  }
  if (!relative || relative === '.') return true;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    if (!exists(fsImpl, current)) {
      if (!create) return false;
      fsImpl.mkdirSync(current, { mode: 0o700 });
      continue;
    }
    const stat = fsImpl.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw Object.assign(new Error('unsafe private namespace ancestor'), {
        code: 'PRIVATE_DIRECTORY_UNSAFE',
      });
    }
  }
  return true;
}

function createPrivateNamespace(
  fsImpl,
  namespacePath,
  { writable, onEvent = null, onCleanup = null, assertCleanup = null }
) {
  let closed = false;
  let serial = 0;

  function assertOpen() {
    if (closed) throw Object.assign(new Error('namespace closed'), {
      code: 'PROTOCOL_NAMESPACE_CLOSED',
    });
  }

  function assertWritable() {
    assertOpen();
    if (!writable) throw Object.assign(new Error('namespace is read only'), {
      code: 'PROTOCOL_STATE_INVALID',
    });
  }

  function readFile({ relativePath, maxBytes }) {
    assertOpen();
    if (onEvent) onEvent('namespace.read', { relativePath });
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw Object.assign(new Error('invalid read bound'), { code: 'PROTOCOL_LIMIT_EXCEEDED' });
    }
    const filePath = anchoredPath(namespacePath, relativePath);
    if (!assertSafeNamespaceAncestors(fsImpl, namespacePath, filePath)
      || !exists(fsImpl, filePath)) {
      return Object.freeze({ found: false, contentBase64: null, contentDigest: null });
    }
    const first = fsImpl.lstatSync(filePath);
    if (!first.isFile() || first.isSymbolicLink() || first.nlink !== 1
      || first.size > maxBytes) {
      throw Object.assign(new Error('unsafe private namespace file'), {
        code: first.size > maxBytes ? 'PROTOCOL_LIMIT_EXCEEDED' : 'PROTOCOL_DATA_INVALID',
      });
    }
    const bytes = fsImpl.readFileSync(filePath);
    if (bytes.length !== first.size) {
      throw Object.assign(new Error('private namespace file changed'), {
        code: 'PROTOCOL_DATA_INVALID',
      });
    }
    return Object.freeze({
      found: true,
      contentBase64: bytes.toString('base64'),
      contentDigest: digestBytes(bytes),
    });
  }

  function list({ relativePath, maxEntries }) {
    assertOpen();
    if (onEvent) onEvent('namespace.list', { relativePath });
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw Object.assign(new Error('invalid list bound'), { code: 'PROTOCOL_LIMIT_EXCEEDED' });
    }
    const directoryPath = anchoredPath(namespacePath, relativePath, { allowEmpty: true });
    if (!assertSafeNamespaceAncestors(fsImpl, namespacePath, directoryPath)
      || !exists(fsImpl, directoryPath)) {
      return Object.freeze({ entries: Object.freeze([]) });
    }
    const stat = fsImpl.lstatSync(directoryPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw Object.assign(new Error('unsafe private namespace directory'), {
        code: 'PROTOCOL_DATA_INVALID',
      });
    }
    const names = fsImpl.readdirSync(directoryPath).sort();
    if (names.length > maxEntries) {
      throw Object.assign(new Error('private namespace list bound exceeded'), {
        code: 'PROTOCOL_LIMIT_EXCEEDED',
      });
    }
    const prefix = normalizeRelativePath(relativePath, { allowEmpty: true });
    return Object.freeze({
      entries: Object.freeze(names.map((name) => (prefix ? `${prefix}/${name}` : name))),
    });
  }

  function writeFile({ relativePath, contentBase64, contentDigest, mode }) {
    assertWritable();
    if (onEvent) onEvent('namespace.write', { relativePath });
    if (mode !== 'replace_atomic'
      || typeof contentBase64 !== 'string'
      || typeof contentDigest !== 'string') {
      throw Object.assign(new Error('invalid namespace write'), {
        code: 'PROTOCOL_DATA_INVALID',
      });
    }
    const bytes = Buffer.from(contentBase64, 'base64');
    if (bytes.toString('base64') !== contentBase64 || digestBytes(bytes) !== contentDigest) {
      throw Object.assign(new Error('namespace write digest mismatch'), {
        code: 'PROTOCOL_DIGEST_MISMATCH',
      });
    }
    const filePath = anchoredPath(namespacePath, relativePath);
    assertSafeNamespaceAncestors(fsImpl, namespacePath, filePath, { create: true });
    if (exists(fsImpl, filePath)) {
      const stat = fsImpl.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
        throw Object.assign(new Error('unsafe namespace write target'), {
          code: 'PROTOCOL_DATA_INVALID',
        });
      }
    }
    const temporaryPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.tmp-test-${process.pid}-${serial += 1}`
    );
    fsImpl.writeFileSync(temporaryPath, bytes, { mode: 0o600, flag: 'wx' });
    fsImpl.renameSync(temporaryPath, filePath);
    return Object.freeze({ written: true, contentDigest });
  }

  function remove({ relativePath, recursive }) {
    assertWritable();
    const entryPath = anchoredPath(namespacePath, relativePath);
    if (!assertSafeNamespaceAncestors(fsImpl, namespacePath, entryPath)
      || !exists(fsImpl, entryPath)) {
      return Object.freeze({ removed: true });
    }
    const stat = fsImpl.lstatSync(entryPath);
    if (stat.isSymbolicLink()) {
      throw Object.assign(new Error('unsafe namespace removal target'), {
        code: 'PROTOCOL_DATA_INVALID',
      });
    }
    if (stat.isDirectory()) {
      if (recursive !== true) fsImpl.rmdirSync(entryPath);
      else fsImpl.rmSync(entryPath, { recursive: true, force: false });
    } else {
      fsImpl.unlinkSync(entryPath);
    }
    return Object.freeze({ removed: true });
  }

  const privateNamespace = Object.freeze({
    capabilityVersion: NAMESPACE_IO_INTEGRATION_VERSION,
    readFile,
    list,
    ...(writable ? {
      writeFile,
      remove,
      sync() { assertWritable(); return Object.freeze({ synced: true }); },
      cleanup() {
        assertWritable();
        if (assertCleanup) assertCleanup();
        if (onCleanup) onCleanup();
        closed = true;
        return Object.freeze({ cleaned: true });
      },
    } : {}),
  });
  namespaceClosers.set(privateNamespace, () => { closed = true; });
  return privateNamespace;
}

function createAnchoredMutationTestBackend({
  fsImpl = fs,
  backendId = 'anchored-mutation-test-backend',
  wrapSession = null,
  onEvent = null,
} = {}) {
  const probe = createAnchoredFilesystemMutationProbe({
    backendId,
    state: 'enforced',
    guarantees: [...ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES],
    reasonCode: 'ENFORCED',
  });

  function event(type, facts = {}) {
    if (typeof onEvent === 'function') onEvent(Object.freeze({ type, ...facts }));
  }

  function privatePaths(rootPath, transactionId) {
    const namespacePath = path.join(rootPath, '.faber');
    const transactionPath = path.join(namespacePath, 'transactions', transactionId);
    return {
      namespacePath,
      transactionPath,
      payloadPath: path.join(transactionPath, 'payload'),
      generationsPath: path.join(transactionPath, 'journal-generations'),
      headPath: path.join(namespacePath, 'transaction-heads', `${transactionId}.json`),
      anchorPath: path.join(namespacePath, 'transaction-heads', transactionId),
    };
  }

  function createSession(input, { existing }) {
    const transactionId = input.transactionId
      || path.basename(input.transactionPath || '');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(transactionId)) {
      throw Object.assign(new Error('invalid transaction id'), { code: 'PROTOCOL_DATA_INVALID' });
    }
    const privatePathSet = privatePaths(input.rootPath, transactionId);
    if (!existing) {
      if (exists(fsImpl, privatePathSet.transactionPath)
        || exists(fsImpl, privatePathSet.headPath)
        || exists(fsImpl, privatePathSet.anchorPath)) {
        throw Object.assign(new Error('transaction namespace already exists'), {
          code: 'CHECKPOINT_CREATE_FAILED',
        });
      }
      for (const directoryPath of [
        privatePathSet.namespacePath,
        path.join(privatePathSet.namespacePath, 'transactions'),
        path.join(privatePathSet.namespacePath, 'transaction-heads'),
        privatePathSet.transactionPath,
        privatePathSet.payloadPath,
        privatePathSet.generationsPath,
        privatePathSet.anchorPath,
      ]) {
        if (!exists(fsImpl, directoryPath)) fsImpl.mkdirSync(directoryPath, { mode: 0o700 });
        const stat = fsImpl.lstatSync(directoryPath);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw Object.assign(new Error('unsafe private directory'), {
            code: 'PRIVATE_DIRECTORY_UNSAFE',
          });
        }
      }
    } else {
      for (const directoryPath of [
        privatePathSet.transactionPath,
        privatePathSet.payloadPath,
        privatePathSet.generationsPath,
        privatePathSet.anchorPath,
      ]) {
        const stat = fsImpl.lstatSync(directoryPath);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw Object.assign(new Error('unsafe existing private directory'), {
            code: 'PRIVATE_DIRECTORY_UNSAFE',
          });
        }
      }
    }

    const targets = input.targets.map((target) => Object.freeze({ ...target }));
    const identityReceipt = createPhysicalIdentityReceipt(
      fsImpl,
      input,
      privatePathSet,
      targets
    );
    if (existing) {
      let expectedReceipt;
      try {
        expectedReceipt = assertAnchoredMutationIdentityReceipt(input.identityReceipt, {
          bindingDigest: input.bindingDigest,
          checkpointDigest: input.checkpointDigest,
          targets,
          checkpointEntries: input.checkpointEntries,
        });
      } catch {
        throw Object.assign(new Error('expected identity receipt is invalid'), {
          code: 'PROTOCOL_DATA_INVALID',
        });
      }
      if (expectedReceipt.receiptDigest !== identityReceipt.receiptDigest) {
        throw Object.assign(new Error('anchored identity continuity mismatch'), {
          code: 'ANCHORED_IDENTITY_MISMATCH',
        });
      }
    }
    const identities = targets.map((target) => {
      const sourcePath = path.join(input.rootPath, ...target.relativePath.split('/'));
      const payloadPath = path.join(privatePathSet.payloadPath, target.payloadName);
      const candidate = exists(fsImpl, sourcePath) ? sourcePath : payloadPath;
      const stat = fsImpl.lstatSync(candidate);
      return Object.freeze({ device: String(stat.dev), inode: String(stat.ino) });
    });
    let phase = existing ? 'unknown' : 'prepared';
    const privateNamespace = createPrivateNamespace(
      fsImpl,
      privatePathSet.namespacePath,
      {
        writable: true,
        onEvent: event,
        assertCleanup() {
          if (phase !== 'restored') {
            throw Object.assign(new Error('namespace cleanup requires restored phase'), {
              code: 'PROTOCOL_STATE_INVALID',
            });
          }
        },
        onCleanup() {
          if (exists(fsImpl, privatePathSet.transactionPath)) {
            fsImpl.rmSync(privatePathSet.transactionPath, { recursive: true, force: false });
          }
          if (exists(fsImpl, privatePathSet.headPath)) fsImpl.unlinkSync(privatePathSet.headPath);
          if (exists(fsImpl, privatePathSet.anchorPath)) {
            fsImpl.rmSync(privatePathSet.anchorPath, { recursive: true, force: false });
          }
          event('namespace.cleanup', { transactionId });
        },
      }
    );
    let closed = false;

    function progress() {
      if (closed) return Object.freeze({ moved: Object.freeze([]) });
      const moved = [];
      let reachedSource = false;
      for (const target of targets) {
        const sourcePath = path.join(input.rootPath, ...target.relativePath.split('/'));
        const payloadPath = path.join(privatePathSet.payloadPath, target.payloadName);
        const sourceExists = exists(fsImpl, sourcePath);
        const payloadExists = exists(fsImpl, payloadPath);
        if (sourceExists === payloadExists) {
          const error = new Error('ambiguous mutation progress');
          error.code = sourceExists ? 'ROLLBACK_COLLISION' : 'CHECKPOINT_MISSING';
          throw error;
        }
        if (payloadExists) {
          if (reachedSource) {
            const error = new Error('movement is not an ordered prefix');
            error.code = 'JOURNAL_PROGRESS_INVALID';
            throw error;
          }
          moved.push(target.payloadName);
        } else {
          reachedSource = true;
        }
      }
      const payloadNames = fsImpl.readdirSync(privatePathSet.payloadPath).sort();
      if (JSON.stringify(payloadNames) !== JSON.stringify(moved)) {
        const error = new Error('unexpected quarantine entries');
        error.code = 'CHECKPOINT_TAMPERED';
        throw error;
      }
      return Object.freeze({ moved: Object.freeze(moved) });
    }

    function verify() {
      if (closed) return Object.freeze({ verified: false });
      let verified = false;
      try {
        progress();
        const currentReceipt = createPhysicalIdentityReceipt(
          fsImpl,
          input,
          privatePathSet,
          targets
        );
        verified = currentReceipt.receiptDigest === identityReceipt.receiptDigest
          && targets.every((target, index) => {
            const sourcePath = path.join(input.rootPath, ...target.relativePath.split('/'));
            const payloadPath = path.join(privatePathSet.payloadPath, target.payloadName);
            const candidate = exists(fsImpl, sourcePath) ? sourcePath : payloadPath;
            const stat = fsImpl.lstatSync(candidate);
            return String(stat.dev) === identities[index].device
              && String(stat.ino) === identities[index].inode;
          });
      } catch {
        verified = false;
      }
      return Object.freeze({ verified });
    }

    function inspectProgress() {
      const result = progress();
      if (phase !== 'restored' && phase !== 'purged') {
        phase = result.moved.length === 0
          ? 'prepared'
          : result.moved.length === targets.length ? 'quarantined' : 'partial';
      }
      return result;
    }

    const session = Object.freeze({
      schemaVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
      helperId: 'anchored-mutation-test-helper',
      rootIdentityDigest: identityReceipt.rootIdentity.identityDigest,
      namespaceIdentityDigest: identityReceipt.namespaceIdentity.identityDigest,
      identityReceipt,
      privateNamespace,
      verify,
      inspectProgress,
      moveToQuarantine() {
        if (!['prepared', 'partial'].includes(phase)) {
          throw Object.assign(new Error('movement requires a prepared session'), {
            code: 'PROTOCOL_STATE_INVALID',
          });
        }
        if (!verify().verified) {
          throw Object.assign(new Error('anchored target changed'), {
            code: 'ANCHORED_TARGET_INVALIDATED',
          });
        }
        const moved = [];
        for (const target of targets) {
          fsImpl.renameSync(
            path.join(input.rootPath, ...target.relativePath.split('/')),
            path.join(privatePathSet.payloadPath, target.payloadName)
          );
          moved.push(target.payloadName);
        }
        phase = 'quarantined';
        event('move', { transactionId, moved: [...moved] });
        return Object.freeze({ moved: Object.freeze(moved) });
      },
      restoreFromQuarantine() {
        if (!['prepared', 'partial', 'quarantined'].includes(phase)) {
          throw Object.assign(new Error('restoration is invalid in the current phase'), {
            code: 'PROTOCOL_STATE_INVALID',
          });
        }
        const restored = [];
        for (let index = targets.length - 1; index >= 0; index -= 1) {
          const target = targets[index];
          const payloadPath = path.join(privatePathSet.payloadPath, target.payloadName);
          const sourcePath = path.join(input.rootPath, ...target.relativePath.split('/'));
          if (exists(fsImpl, payloadPath) && exists(fsImpl, sourcePath)) {
            throw Object.assign(new Error('rollback collision'), { code: 'ROLLBACK_COLLISION' });
          }
          if (exists(fsImpl, payloadPath)) {
            fsImpl.renameSync(payloadPath, sourcePath);
            restored.push(target.payloadName);
          }
        }
        phase = 'restored';
        event('restore', { transactionId, restored: [...restored] });
        return Object.freeze({ restored: Object.freeze(restored) });
      },
      purgeQuarantine() {
        if (phase !== 'quarantined') {
          throw Object.assign(new Error('purge requires a quarantined session'), {
            code: 'PROTOCOL_STATE_INVALID',
          });
        }
        if (exists(fsImpl, privatePathSet.transactionPath)) {
          fsImpl.rmSync(privatePathSet.transactionPath, { recursive: true, force: false });
        }
        if (exists(fsImpl, privatePathSet.headPath)) fsImpl.unlinkSync(privatePathSet.headPath);
        if (exists(fsImpl, privatePathSet.anchorPath)) {
          fsImpl.rmSync(privatePathSet.anchorPath, { recursive: true, force: false });
        }
        phase = 'purged';
        event('purge', { transactionId });
        return Object.freeze({ purged: true, namespaceCleaned: true });
      },
      close() {
        closed = true;
        try { namespaceClosers.get(privateNamespace)(); } catch {}
        return Object.freeze({ closed: true });
      },
    });
    event(existing ? 'session.openExisting' : 'session.prepare', { transactionId });
    return typeof wrapSession === 'function' ? wrapSession(session, input) : session;
  }

  return Object.freeze({
    namespaceIoVersion: NAMESPACE_IO_INTEGRATION_VERSION,
    probe() { return probe; },
    prepare(input) { return createSession(input, { existing: false }); },
    openRootNamespace({ rootPath }) {
      event('root.open', { rootPath });
      const namespacePath = path.join(rootPath, '.faber');
      const privateNamespace = createPrivateNamespace(fsImpl, namespacePath, {
        writable: false,
        onEvent: event,
      });
      let closed = false;
      let promoted = false;
      return Object.freeze({
        schemaVersion: ROOT_NAMESPACE_VERSION,
        helperId: 'anchored-mutation-test-helper',
        rootIdentityDigest: identityDigest(fsImpl, rootPath),
        namespaceIdentityDigest: exists(fsImpl, namespacePath)
          ? identityDigest(fsImpl, namespacePath)
          : digestBytes(Buffer.from(`missing:${path.resolve(rootPath)}`, 'utf8')),
        privateNamespace,
        openExistingSession(input) {
          if (closed || promoted) throw Object.assign(new Error('root namespace unavailable'), {
            code: 'PROTOCOL_NAMESPACE_CLOSED',
          });
          const session = createSession({ ...input, rootPath }, { existing: true });
          promoted = true;
          return session;
        },
        cleanupAuthenticatedOrphan({ transactionId }) {
          if (closed) throw Object.assign(new Error('root namespace closed'), {
            code: 'PROTOCOL_NAMESPACE_CLOSED',
          });
          const paths = privatePaths(rootPath, transactionId);
          if (exists(fsImpl, paths.headPath)) fsImpl.unlinkSync(paths.headPath);
          if (exists(fsImpl, paths.anchorPath)) {
            fsImpl.rmSync(paths.anchorPath, { recursive: true, force: false });
          }
          event('orphan.cleanup', { transactionId });
          return Object.freeze({ cleaned: true });
        },
        close() {
          if (promoted) throw Object.assign(new Error('root namespace promoted'), {
            code: 'PROTOCOL_ROOT_NAMESPACE_PROMOTED',
          });
          closed = true;
          namespaceClosers.get(privateNamespace)();
          return Object.freeze({ closed: true });
        },
      });
    },
  });
}

module.exports = {
  NAMESPACE_IO_INTEGRATION_VERSION,
  ROOT_NAMESPACE_VERSION,
  createAnchoredMutationTestBackend,
};

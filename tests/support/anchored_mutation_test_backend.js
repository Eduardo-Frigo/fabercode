'use strict';

const fs = require('fs');
const path = require('path');

const {
  ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES,
  ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
  createAnchoredFilesystemMutationProbe,
} = require('../../main/capabilities/anchored_filesystem_mutation_backend_contract');

function exists(entryPath) {
  try {
    fs.lstatSync(entryPath);
    return true;
  } catch {
    return false;
  }
}

function createAnchoredMutationTestBackend() {
  const probe = createAnchoredFilesystemMutationProbe({
    backendId: 'startup-recovery-test-backend',
    state: 'enforced',
    guarantees: [...ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES],
    reasonCode: 'ENFORCED',
  });

  return Object.freeze({
    probe() {
      return probe;
    },
    prepare(input) {
      const targets = input.targets.map((target) => Object.freeze({ ...target }));
      const identities = targets.map((target) => {
        const sourcePath = path.join(input.rootPath, ...target.relativePath.split('/'));
        const payloadPath = path.join(input.payloadPath, target.payloadName);
        const candidate = exists(sourcePath) ? sourcePath : payloadPath;
        const stat = fs.lstatSync(candidate);
        return Object.freeze({ device: String(stat.dev), inode: String(stat.ino) });
      });
      let closed = false;

      function verify() {
        if (closed) return Object.freeze({ verified: false });
        const verified = targets.every((target, index) => {
          const sourcePath = path.join(input.rootPath, ...target.relativePath.split('/'));
          const payloadPath = path.join(input.payloadPath, target.payloadName);
          const candidate = exists(sourcePath) ? sourcePath : payloadPath;
          if (!exists(candidate)) return false;
          const stat = fs.lstatSync(candidate);
          return String(stat.dev) === identities[index].device
            && String(stat.ino) === identities[index].inode;
        });
        return Object.freeze({ verified });
      }

      return Object.freeze({
        schemaVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
        verify,
        moveToQuarantine() {
          if (!verify().verified) throw new Error('anchored target changed');
          const moved = [];
          for (const target of targets) {
            fs.renameSync(
              path.join(input.rootPath, ...target.relativePath.split('/')),
              path.join(input.payloadPath, target.payloadName)
            );
            moved.push(target.payloadName);
          }
          return Object.freeze({ moved });
        },
        restoreFromQuarantine() {
          const restored = [];
          for (let index = targets.length - 1; index >= 0; index -= 1) {
            const target = targets[index];
            const payloadPath = path.join(input.payloadPath, target.payloadName);
            const sourcePath = path.join(input.rootPath, ...target.relativePath.split('/'));
            if (exists(payloadPath) && exists(sourcePath)) {
              throw new Error('rollback collision');
            }
            if (exists(payloadPath)) {
              fs.renameSync(payloadPath, sourcePath);
              restored.push(target.payloadName);
            }
          }
          return Object.freeze({ restored });
        },
        purgeQuarantine() {
          if (exists(input.transactionPath)) {
            fs.rmSync(input.transactionPath, { recursive: true, force: false });
          }
          if (exists(input.headPath)) fs.unlinkSync(input.headPath);
          if (exists(input.anchorPath)) {
            fs.rmSync(input.anchorPath, { recursive: true, force: false });
          }
          return Object.freeze({ purged: true });
        },
        close() {
          closed = true;
          return Object.freeze({ closed: true });
        },
      });
    },
  });
}

module.exports = { createAnchoredMutationTestBackend };

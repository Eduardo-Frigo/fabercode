'use strict';

const assert = require('assert');

const {
  createApplicationCreationLiveCorpusRepairService,
} = require('../main/services/application_creation_live_corpus_repair_service');

function run() {
  const service = createApplicationCreationLiveCorpusRepairService({ maxAttempts: 2 });
  const productFailure = {
    attempt: 0,
    generation: { ok: true },
    installResult: { ok: true },
    verification: { ready: false },
    executionLog: [{
      bin: 'npm',
      args: ['--ignore-scripts', 'test'],
      ok: false,
      message: "ERR_MODULE_NOT_FOUND in /private/var/folders/example/workspace/node_modules/next/server",
    }],
  };
  assert.strictEqual(service.shouldAttemptRepair(productFailure), true);

  const prompt = service.buildRepairPrompt({
    scenario: {
      id: 'next-react-backend',
      prompt: 'Crie um app Next funcional com build e testes.',
    },
    rootPaths: ['/private/var/folders/example/workspace'],
    verification: {
      results: [{
        id: 'node_test',
        status: 'failed',
        required: true,
        detail: 'O teste falhou.',
      }],
    },
    executionLog: productFailure.executionLog,
  });
  assert.match(prompt, /node_test/);
  assert.match(prompt, /ERR_MODULE_NOT_FOUND/);
  assert.match(prompt, /build e testes/);
  assert.doesNotMatch(prompt, /private\/var\/folders\/example\/workspace/);
  assert.match(prompt, /<workspace>/);
  assert.match(prompt, /não instale pacotes/i);

  assert.strictEqual(service.shouldAttemptRepair({
    ...productFailure,
    generation: {
      ok: false,
      status: 'failed',
      modifiedFiles: ['package.json', 'app/page.tsx'],
      message: 'A validação do produto ainda não passou.',
    },
  }), true);
  assert.strictEqual(service.shouldAttemptRepair({
    ...productFailure,
    generation: {
      ok: false,
      status: 'failed',
      modifiedFiles: [],
      message: 'Nenhum artefato foi produzido.',
    },
  }), false);

  const targetedPrompt = service.buildRepairPrompt({
    scenario: {
      id: 'requested-product-capabilities',
      prompt: 'Crie um app Next com auth e upload.',
    },
    verification: {
      results: [
        { id: 'acceptance_auth', status: 'failed', required: true },
        { id: 'acceptance_upload', status: 'failed', required: true },
        { id: 'node_build', status: 'failed', required: true },
        { id: 'node_test', status: 'failed', required: true },
      ],
    },
    executionLog: [{
      bin: 'npm',
      args: ['--ignore-scripts', 'run', 'build'],
      ok: false,
      message: 'ReferenceError: module is not defined in ES module scope while loading next.config.js. It looks like you are trying to use TypeScript but required packages are missing.',
    }],
  });
  assert.match(targetedPrompt, /next\.config\.mjs|export default/i);
  assert.match(targetedPrompt, /typescript|tsconfig/i);
  assert.match(targetedPrompt, /authenticate|verifypassword/i);
  assert.match(targetedPrompt, /request\.formdata|multipart/i);
  assert.match(targetedPrompt, /node:test|efeitos colaterais/i);

  assert.strictEqual(service.shouldAttemptRepair({
    ...productFailure,
    executionLog: [{ ok: false, message: 'unhandledRejection Error: kill EPERM' }],
  }), false);
  assert.strictEqual(service.shouldAttemptRepair({ ...productFailure, attempt: 2 }), false);
  assert.strictEqual(service.shouldAttemptRepair({
    ...productFailure,
    generation: { ok: false, modifiedFiles: [] },
  }), false);
  assert.strictEqual(service.shouldAttemptRepair({
    ...productFailure,
    installResult: { ok: false },
  }), false);

  console.log('application-creation-live-corpus-repair-service.test.js: ok');
}

run();

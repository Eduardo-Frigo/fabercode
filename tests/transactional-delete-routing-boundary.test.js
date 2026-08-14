'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { createAutomataTools } = require('../cortex/tools/automata_tools');

const executor = {
  execute() { return { ok: true }; },
  executeEditFileFuzzyAction() { return { ok: true }; },
  executeOperationBatchAction() { return { ok: true }; },
  executePatchAction() { return { ok: true }; },
  executeSearchTextAction() { return { ok: true }; },
};
const batchTool = createAutomataTools(executor)
  .find((tool) => tool.name === 'automata.execute_operation_batch');
assert(batchTool);
assert.deepStrictEqual(
  batchTool.inputSchema.properties.operations.items.properties.op.enum,
  ['mkdir', 'write_file', 'append_file']
);
assert.strictEqual(batchTool.description.includes('delete_file'), false);
assert.strictEqual(batchTool.description.includes('delete_dir'), false);

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const registryStart = mainSource.indexOf('function getToolRegistry()');
const registryEnd = mainSource.indexOf('\nfunction executePatchAction', registryStart);
assert(registryStart >= 0 && registryEnd > registryStart);
const registrySource = mainSource.slice(registryStart, registryEnd);
const boundaryIndex = registrySource.indexOf("operation.op === 'delete_file'");
const toolLookupIndex = registrySource.indexOf('const tool = toolRegistryInstance.get(name);');
const permissionIndex = registrySource.indexOf("tool.permission === 'write'");
assert(boundaryIndex >= 0);
assert(boundaryIndex < toolLookupIndex);
assert(boundaryIndex < permissionIndex);
assert(registrySource.includes("code: 'TRANSACTIONAL_DELETE_REQUIRED'"));

console.log('transactional delete routing boundary tests passed');

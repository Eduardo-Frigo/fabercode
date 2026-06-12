const assert = require('assert');

const {
  createCortexMemoryManagementService,
} = require('../main/services/cortex_memory_management_service');

function run() {
  const audit = [];
  let state = {
    conversationsByProject: {},
    messagesByConversation: {},
    auditTrail: [],
    cortexLearningByProject: {
      'project-1': {
        persona: [],
        executor: [],
        events: [
          {
            id: 'memory-1',
            memoryId: 'memory-1',
            type: 'cortex.user_input',
            topic: 'codigo',
            text: 'Usar arquitetura modular.',
            createdAt: '2026-05-26T10:00:00.000Z',
          },
        ],
      },
    },
  };
  const service = createCortexMemoryManagementService({
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    readOrchestrationState: () => state,
    writeOrchestrationState: (next) => {
      state = next;
    },
    now: () => '2026-05-27T12:00:00.000Z',
  });

  const listed = service.listCortexMemories({ projectId: 'project-1' });
  assert.strictEqual(listed.ok, true);
  assert.strictEqual(listed.memories[0].status, 'active');

  const edited = service.manageCortexMemory({
    action: 'edit',
    projectId: 'project-1',
    memoryId: 'memory-1',
    text: 'Usar arquitetura modular com provenance.',
  });
  assert.strictEqual(edited.ok, true);
  assert.match(edited.memory.text, /provenance/);

  const promoted = service.manageCortexMemory({
    action: 'promote',
    projectId: 'project-1',
    memoryId: 'memory-1',
  });
  assert.strictEqual(promoted.memory.status, 'promoted');
  assert.strictEqual(promoted.memory.promoted, true);

  const expired = service.manageCortexMemory({
    action: 'expire',
    projectId: 'project-1',
    memoryId: 'memory-1',
  });
  assert.strictEqual(expired.memory.status, 'expired');
  assert.strictEqual(service.listCortexMemories({ projectId: 'project-1', includeExpired: false }).memories.length, 0);

  const deleted = service.manageCortexMemory({
    action: 'delete',
    projectId: 'project-1',
    memoryId: 'memory-1',
  });
  assert.strictEqual(deleted.ok, true);
  assert.strictEqual(service.listCortexMemories({ projectId: 'project-1' }).memories.length, 0);
  assert.ok(audit.some((event) => event.type === 'cortex.memory_lifecycle'));

  console.log('cortex-memory-management-service.test.js: ok');
}

run();

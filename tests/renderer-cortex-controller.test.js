const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.value = '';
    this._textContent = '';
    this.classList = {
      add: () => {},
      remove: () => {},
      contains: () => false,
    };
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener() {}

  focus() {}

  get textContent() {
    return [
      this._textContent,
      ...this.children.map((child) => child && child.textContent ? child.textContent : ''),
    ].join('');
  }

  set textContent(value) {
    this._textContent = String(value || '');
    this.children = [];
  }

  set innerHTML(value) {
    this._textContent = String(value || '');
    this.children = [];
  }

  get innerHTML() {
    return this.textContent;
  }
}

function createFakeDocument(ids = []) {
  const elements = new Map(ids.map((id) => [id, new FakeElement('div', id)]));
  return {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement('div', id));
      return elements.get(id);
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
}

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'cortex_controller.js'), 'utf8');
const document = createFakeDocument([
  'cortex-context-diagnostics',
  'cortex-memory-audit-list',
  'cortex-runtime-status',
  'cortex-learning-content',
  'cortex-topic-list',
  'cortex-library-list',
  'cortex-rules-list',
  'cortex-attachment-list',
  'cortex-chat-log',
  'cortex-memory-search',
  'cortex-memory-status-filter',
]);
const sandbox = {
  document,
  setTimeout,
  window: {},
};
sandbox.window.window = sandbox.window;

vm.runInNewContext(source, sandbox, { filename: 'cortex_controller.js' });

const controller = sandbox.window.FaberCortex.createCortexController({
  api: {},
  t: (key) => key,
  getProjectId: () => 'project-1',
  getProjectInfo: () => ({ rootPath: '/tmp/project' }),
});

controller.renderMemoryDiagnostics({
  ok: true,
  entries: [
    {
      action: 'context_frame_decision',
      message: 'Context frame registrado.',
      contextFrame: {
        dominantSource: 'active_memory',
        allowedSources: ['current_message', 'active_memory'],
        blockedSources: ['conversation_brief'],
        activeMemory: {
          allowedForBriefing: true,
          citationsCount: 2,
        },
      },
    },
    {
      action: 'build_active_memory',
      message: 'Memória ativa construída.',
      provenance: {
        confidence: { average: 0.64 },
        used: [{ title: 'MemPalace projeto' }, { title: 'RAG arquitetura' }],
        blocked: [{ title: 'Memória antiga' }],
      },
    },
    {
      action: 'lifecycle_promote',
      ok: true,
      status: 'succeeded',
      createdAt: '2026-05-28T10:00:00.000Z',
      message: 'Memória promovida.',
      lifecycle: { action: 'promote' },
    },
  ],
}, {
  mode: 'integrated',
  warnings: [],
});

const text = document.getElementById('cortex-context-diagnostics').textContent;
assert.match(text, /Runtime/);
assert.match(text, /Fonte dominante: memória ativa/);
assert.match(text, /Provenance: 2 usada/);
assert.match(text, /Confiança média 64%/);
const auditText = document.getElementById('cortex-memory-audit-list').textContent;
assert.match(auditText, /Auditoria/);
assert.match(auditText, /lifecycle promote/);

controller.renderLearning({
  persona: [],
  executor: [],
  topics: [],
  events: [
    {
      id: 'memory-1',
      memoryId: 'memory-1',
      type: 'cortex.user_input',
      topic: 'codigo',
      text: 'Usar ranking vetorial para memória.',
      status: 'promoted',
      promoted: true,
    },
    {
      id: 'memory-2',
      memoryId: 'memory-2',
      type: 'cortex.user_input',
      topic: 'design',
      text: 'Usar composição editorial.',
      status: 'active',
    },
  ],
});

const libraryText = document.getElementById('cortex-library-list').textContent;
assert.match(libraryText, /ranking vetorial/);
assert.match(libraryText, /promovida/);
assert.match(libraryText, /✎/);
assert.match(libraryText, /↑/);
assert.doesNotMatch(
  document.getElementById('cortex-chat-log').textContent,
  /cortexIntro/,
  'Cortex modal should not add a default chat intro in the simplified UX'
);

document.getElementById('cortex-memory-status-filter').value = 'promoted';
controller.renderLearning({
  persona: [],
  executor: [],
  topics: [],
  events: [
    {
      id: 'memory-1',
      memoryId: 'memory-1',
      type: 'cortex.user_input',
      topic: 'codigo',
      text: 'Usar ranking vetorial para memória.',
      status: 'promoted',
      promoted: true,
    },
    {
      id: 'memory-2',
      memoryId: 'memory-2',
      type: 'cortex.user_input',
      topic: 'design',
      text: 'Usar composição editorial.',
      status: 'active',
    },
  ],
});
const filteredText = document.getElementById('cortex-library-list').textContent;
assert.match(filteredText, /ranking vetorial/);
assert.doesNotMatch(filteredText, /composição editorial/);

console.log('renderer-cortex-controller.test.js: ok');

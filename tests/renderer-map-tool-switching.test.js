const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
    toggle: (name, force) => {
      const next = force === undefined ? !values.has(name) : Boolean(force);
      if (next) values.add(name);
      else values.delete(name);
      return next;
    },
  };
}

function createElement(id = '') {
  return {
    id,
    dataset: {},
    style: {},
    children: [],
    classList: createClassList(),
    disabled: false,
    hidden: false,
    textContent: '',
    value: '',
    innerHTML: '',
    _listeners: {},
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    append(...nodes) {
      nodes.forEach((node) => this.appendChild(node));
    },
    remove() {
      this._removed = true;
      if (this.parentNode && Array.isArray(this.parentNode.children)) {
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      }
      this.parentNode = null;
    },
    focus() {
      this._focused = true;
    },
    setAttribute(name, value) {
      this[name] = String(value);
    },
    getAttribute(name) {
      return this[name];
    },
    addEventListener(type, handler) {
      (this._listeners[type] ||= []).push(handler);
    },
    dispatchEvent(event) {
      (this._listeners[event.type] || []).forEach((handler) => handler(event));
    },
    click() {
      return this.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
    },
    querySelector(selector) {
      if (selector === '#btn-map-tool-select') return null;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function createDocument(ids) {
  const elements = new Map();
  ids.forEach((id) => elements.set(id, createElement(id)));

  const container = elements.get('workspace-map-region');
  container.querySelector = (selector) => {
    if (!selector || selector[0] !== '#') return null;
    return elements.get(selector.slice(1)) || null;
  };

  const body = createElement('body');
  body.classList = createClassList(['mode-terminal']);

  const documentRef = {
    body,
    documentElement: { lang: 'pt-BR' },
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelector(selector) {
      if (selector === '.app-shell') return elements.get('app-shell') || null;
      if (selector === '.panel-right') return elements.get('panel-right') || null;
      if (selector === '.markdown-editor-toolbar') return elements.get('markdown-editor-toolbar') || null;
      return null;
    },
    createElement(tag) {
      return createElement(tag);
    },
    addEventListener() {},
    removeEventListener() {},
  };

  return { documentRef, elements };
}

function loadModule(sourcePath, sandbox, globalName) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  vm.runInNewContext(source, sandbox, { filename: path.basename(sourcePath) });
  return sandbox.window[globalName];
}

const ids = [
  'workspace-map-region',
  'btn-tab-chat',
  'btn-tab-map',
  'center-tabs',
  'workspace-map-inspector-panel',
  'inspector-node-title',
  'inspector-node-desc',
  'inspector-node-content',
  'inspector-asset-upload-field',
  'map-asset-file-input',
  'btn-map-inspector-close',
  'btn-map-delete-node',
  'workspace-map-chat-panel',
  'map-chat-log',
  'map-chat-textarea',
  'btn-map-chat-send',
  'right-panel-title',
  'btn-map-chat-new',
  'map-chat-list-view',
  'map-conversations-list',
  'map-chat-session-view',
  'btn-map-chat-back',
  'map-chat-session-title',
  'workspace-map-render-panel',
  'map-render-list-view',
  'btn-map-render-list-back',
  'map-render-conversations-list',
  'map-render-session-view',
  'btn-map-render-open',
  'btn-map-render-back',
  'btn-map-render-save',
  'map-render-status',
  'map-render-copy',
  'map-render-session-title',
  'map-render-session-status',
  'map-render-session-log',
  'map-render-plan-card',
  'map-render-session-checklist',
  'map-render-session-milestones',
  'map-render-attachment-list',
  'btn-map-render-attach',
  'map-render-textarea',
  'btn-map-render-send',
  'map-render-file-input',
  'btn-project-files',
  'btn-map-ai',
  'btn-project-git',
  'btn-project-terminal',
  'btn-project-milestones',
  'btn-cortex-mode',
  'workspace-collapse-right',
  'workspace-milestones-panel',
  'milestones-timeline-content',
  'project-milestones-count',
  'workspace-files-region',
  'workspace-right-zone',
  'workspace-center-zone',
  'workspace-center-tools-zone',
  'workspace-bottom-zone',
  'app-shell',
  'panel-right',
  'markdown-editor-toolbar',
  'btn-map-tool-select',
  'btn-map-tool-hand',
  'btn-map-tool-add-group',
  'btn-map-tool-add-card',
  'btn-map-tool-add-image',
  'btn-map-tool-add-decision',
  'btn-map-zoom-reset',
  'btn-map-clear',
];

const { documentRef, elements } = createDocument(ids);
const body = documentRef.body;
const terminalController = {
  closeCalls: 0,
  closePanel() {
    this.closeCalls += 1;
    body.classList.remove('mode-terminal');
  },
};

const api = {
  renderApplicationMap: async () => ({ ok: true }),
  readProjectFile: async () => ({ ok: false }),
  sendAssistantMessageCalls: 0,
  sendAssistantMessage: async () => {
    api.sendAssistantMessageCalls += 1;
    return { ok: true, response: 'ok' };
  },
  saveMilestones: async () => ({ ok: true }),
  renderMilestones: async () => ({ ok: true }),
  listMilestones: async () => ({ ok: true, milestones: [{ id: 'm1', number: 1, title: 'Milestone 1', summary: 'Resumo', status: 'active', tasks: [] }] }),
  getMilestoneGitStatus: async () => ({ ok: true, matchedModified: [], otherModified: [] }),
  listConversations: async () => ({ ok: true, conversationsByProject: {} }),
  addConversationCalls: 0,
  addConversationMessageCalls: 0,
  addConversationPayloads: [],
  addConversationMessagePayloads: [],
  addConversation: async (payload) => {
    api.addConversationCalls += 1;
    api.addConversationPayloads.push(payload);
    return { ok: true, conversation: { id: 'c1', title: payload.title, source: payload.meta && payload.meta.source } };
  },
  listConversationMessages: async () => ({ ok: true, messages: [] }),
  addConversationMessage: async (payload) => {
    api.addConversationMessageCalls += 1;
    api.addConversationMessagePayloads.push(payload);
    return { ok: true };
  },
  saveApplicationMap: async () => ({ ok: true }),
  getApplicationMap: async () => ({ ok: true, map: { nodes: [], edges: [] } }),
};

const canvasController = {
  setTool() {},
  addNodeAtCenter() {},
  resetZoom() {},
  clearMap() {},
  drawEdges() {},
  loadMapData() {},
  getMapData() {
    return { nodes: [], edges: [] };
  },
  updateSelectedNode() {},
  deleteSelectedNode() {},
  selectNode() {},
  getSelectedNode() {
    return null;
  },
};

elements.get('workspace-collapse-right').click = function () {
  body.classList.remove('workspace-right-collapsed');
};

const windowRef = {
  document: documentRef,
  localcodeApi: api,
  FaberApplicationMapCanvas: { createApplicationMapCanvas: () => canvasController },
  faberConfirm: async () => true,
  setTimeout,
  clearTimeout,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  },
};
windowRef.window = windowRef;

const sandbox = {
  window: windowRef,
  document: documentRef,
  console,
  setTimeout,
  clearTimeout,
  Promise,
  CustomEvent: windowRef.CustomEvent,
};

const tutorialCopy = loadModule(path.join(__dirname, '..', 'renderer', 'tutorial_copy.js'), sandbox, 'FaberTutorialCopy');
const applicationMap = loadModule(path.join(__dirname, '..', 'renderer', 'application_map.js'), sandbox, 'FaberApplicationMap');
const milestonesPanel = loadModule(path.join(__dirname, '..', 'renderer', 'milestones_panel.js'), sandbox, 'FaberMilestonesPanel');

assert.ok(tutorialCopy, 'Tutorial copy module should register');
assert.ok(applicationMap, 'Application map module should register');
assert.ok(milestonesPanel, 'Milestones panel module should register');

const controller = applicationMap.createApplicationMapController({
  api,
  getSelectedProjectId: () => 'project-1',
  getSelectedProjectInfo: () => ({ rootPath: '/tmp/project', totalFiles: 1 }),
  appendMessage() {},
  getTerminalController: () => terminalController,
});

const milestonesController = milestonesPanel.createMilestonesPanelController({
  api,
  getSelectedProjectId: () => 'project-1',
  getSelectedProjectInfo: () => ({ rootPath: '/tmp/project', totalFiles: 1 }),
  appendMessage() {},
  getTerminalController: () => terminalController,
});

controller.init();
milestonesController.init();

const btnMapAi = documentRef.getElementById('btn-map-ai');
const btnMilestones = documentRef.getElementById('btn-project-milestones');
const rightTitle = documentRef.getElementById('right-panel-title');
const renderPanel = documentRef.getElementById('workspace-map-render-panel');
const renderButton = documentRef.getElementById('btn-map-render-open');
const renderListView = documentRef.getElementById('map-render-list-view');
const renderConversationsList = documentRef.getElementById('map-render-conversations-list');
const renderSessionView = documentRef.getElementById('map-render-session-view');
const renderBackButton = documentRef.getElementById('btn-map-render-back');

assert.ok(btnMapAi, 'Map chat button must exist');
assert.ok(btnMilestones, 'Milestones button must exist');

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function findDescendant(root, predicate) {
  if (!root) return null;
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const found = findDescendant(child, predicate);
    if (found) return found;
  }
  return null;
}

(async () => {
  await btnMapAi.click();
  await flush();
  assert.strictEqual(body.classList.contains('mode-map-chat'), true, 'Map chat mode should activate');
  assert.strictEqual(body.classList.contains('mode-terminal'), false, 'Terminal mode should close when opening map chat');
  assert.strictEqual(rightTitle.textContent, 'Perguntar à IA', 'Right panel title should switch to map chat');
  assert.strictEqual(terminalController.closeCalls > 0, true, 'Terminal should be closed when opening map chat');
  assert.strictEqual(renderPanel.classList.contains('hidden'), false, 'Render panel should stay visible in map chat');
  assert.strictEqual(renderButton.textContent, 'Renderizar o Mapa', 'Render button should stay available below the conversation list');
  assert.strictEqual(renderListView.classList.contains('hidden'), false, 'Render list view should stay visible before starting render');
  assert.strictEqual(renderSessionView.classList.contains('hidden'), true, 'Render session view should stay hidden before starting render');
  assert.ok(renderConversationsList, 'Render conversation list should exist');

  await renderButton.click();
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 1800));
  assert.strictEqual(renderListView.classList.contains('hidden'), true, 'Render list should hide when session opens');
  assert.strictEqual(renderSessionView.classList.contains('hidden'), false, 'Render session should open after clicking render');
  assert.strictEqual(renderBackButton.disabled, false, 'Render back button should be available in session view');

  await renderBackButton.click();
  await flush();
  assert.strictEqual(renderListView.classList.contains('hidden'), false, 'Render list should return when back is pressed');
  assert.strictEqual(renderSessionView.classList.contains('hidden'), true, 'Render session should hide when returning');
  assert.strictEqual(api.addConversationCalls, 1, 'Render flow should create a dedicated render conversation');
  assert.strictEqual(api.addConversationPayloads[0].meta.source, 'map_render', 'Render conversations must use the isolated map_render source');
  assert.strictEqual(api.addConversationMessageCalls >= 1, true, 'Render flow should persist render messages for history');
  assert.strictEqual(
    api.addConversationMessagePayloads.every((payload) => payload.meta && payload.meta.source === 'map_render'),
    true,
    'Render messages must remain isolated from the main development chat'
  );

  body.classList.add('mode-terminal');
  await btnMilestones.click();
  await flush();
  assert.strictEqual(body.classList.contains('mode-milestones'), true, 'Milestones mode should activate');
  assert.strictEqual(body.classList.contains('mode-map-chat'), false, 'Map chat mode should close when opening milestones');
  assert.strictEqual(body.classList.contains('mode-terminal'), false, 'Terminal mode should close when opening milestones');
  assert.strictEqual(rightTitle.textContent, 'Milestones', 'Right panel title should switch to milestones');
  assert.strictEqual(terminalController.closeCalls > 1, true, 'Terminal should also be closed when opening milestones');

  const timeline = documentRef.getElementById('milestones-timeline-content');
  const collapsedItem = timeline.children.at(-1);
  const collapsedCard = collapsedItem.children[1];
  collapsedCard.dispatchEvent({
    type: 'click',
    target: { tagName: 'DIV', closest: () => null },
    preventDefault() {},
    stopPropagation() {},
  });
  const expandedItem = timeline.children.at(-1);
  const developmentChatButton = findDescendant(
    expandedItem,
    (element) => element.className === 'milestone-development-chat-btn'
  );
  assert.strictEqual(
    developmentChatButton,
    null,
    'Expanded milestones must not expose a tutorial-only development chat action'
  );

  const persistedConversationCount = api.addConversationCalls;
  const persistedMessageCount = api.addConversationMessageCalls;
  const providerCallsBeforeTutorial = api.sendAssistantMessageCalls;
  assert.strictEqual(controller.prepareTutorialMapConversation(), true, 'Tutorial map chat should open without backend setup');
  assert.strictEqual(documentRef.getElementById('map-chat-list-view').classList.contains('hidden'), true, 'Tutorial should hide conversation history');
  assert.strictEqual(documentRef.getElementById('map-chat-session-view').classList.contains('hidden'), false, 'Tutorial should display the simulated session');

  const simulated = await controller.simulateTutorialMapConversation('O briefing está completo?', 'Sim, o mapa está completo.');
  assert.strictEqual(simulated, true, 'Tutorial map conversation should complete');
  assert.strictEqual(documentRef.getElementById('map-chat-log').children.length, 2, 'Tutorial chat should render user and assistant messages');
  const tutorialAssistantMessage = documentRef.getElementById('map-chat-log').children[1];
  const tutorialGapAction = tutorialAssistantMessage.children.find((child) => child.id === 'btn-map-chat-add-gap');
  assert.ok(tutorialGapAction, 'Tutorial assistant reply should offer the contextual SEO map action');
  assert.strictEqual(tutorialGapAction.textContent, 'Adicionar documento de SEO ao mapa', 'Tutorial SEO action should explain the resulting map change');
  assert.strictEqual(api.addConversationCalls, persistedConversationCount + 1, 'Tutorial chat should persist one map conversation');
  assert.strictEqual(api.addConversationMessageCalls, persistedMessageCount + 2, 'Tutorial chat should persist both simulated messages');
  assert.strictEqual(api.addConversationPayloads.at(-1).meta.source, 'map_chat', 'Tutorial history must use the isolated map_chat source');
  assert.strictEqual(
    api.addConversationMessagePayloads.slice(-2).every((payload) => payload.meta && payload.meta.source === 'map_chat'),
    true,
    'Tutorial messages must remain isolated from the development chat'
  );
  assert.strictEqual(api.sendAssistantMessageCalls, providerCallsBeforeTutorial, 'Tutorial map chat must not call an AI provider');

  assert.strictEqual(controller.showTutorialMapCanvas(), true, 'Tutorial should return to the map after applying missing information');
  assert.strictEqual(body.classList.contains('mode-map-chat'), false, 'Returning to the tutorial map should close chat mode');
  assert.strictEqual(await controller.prepareTutorialMapHistory(), true, 'Tutorial should return to the persisted map history');
  assert.strictEqual(body.classList.contains('mode-map-chat'), true, 'Tutorial history should reopen map chat mode');
  assert.strictEqual(documentRef.getElementById('map-chat-list-view').classList.contains('hidden'), false, 'Tutorial should display conversation history before rendering');
  assert.strictEqual(api.addConversationMessageCalls, persistedMessageCount + 3, 'Tutorial history should persist the SEO correction result');

  const conversationCountBeforeAnalysis = api.addConversationCalls;
  const messageCountBeforeAnalysis = api.addConversationMessageCalls;
  assert.strictEqual(controller.prepareTutorialMapAnalysis(), true, 'Tutorial should open map analysis without starting a provider request');
  assert.strictEqual(body.classList.contains('mode-map-render'), true, 'Tutorial analysis should display the render panel');
  assert.strictEqual(documentRef.getElementById('map-render-list-view').classList.contains('hidden'), false, 'Tutorial analysis should stop at the render history screen');
  assert.strictEqual(api.addConversationCalls, conversationCountBeforeAnalysis, 'Opening tutorial analysis must not create a conversation');
  assert.strictEqual(api.addConversationMessageCalls, messageCountBeforeAnalysis, 'Opening tutorial analysis must not persist messages');

  assert.strictEqual(await controller.generateTutorialRenderDraft(), true, 'Tutorial should generate a local development plan');
  assert.strictEqual(api.sendAssistantMessageCalls, providerCallsBeforeTutorial, 'Tutorial rendering must not call an AI provider');
  assert.strictEqual(api.addConversationCalls, conversationCountBeforeAnalysis + 1, 'Tutorial rendering should persist its own history');
  assert.strictEqual(api.addConversationPayloads.at(-1).meta.source, 'map_render', 'Tutorial rendering must use the map_render source');
  assert.strictEqual(documentRef.getElementById('map-render-session-view').classList.contains('hidden'), false, 'Tutorial plan should open in the render session');
  assert.strictEqual(
    documentRef.getElementById('map-render-session-milestones').children.filter((child) => child.className === 'map-render-milestone-card').length >= 5,
    true,
    'Tutorial plan should render its five complete milestones'
  );
  assert.strictEqual(documentRef.getElementById('btn-map-render-save').classList.contains('hidden'), false, 'Ready tutorial plan should expose Save to Milestones');

  console.log('renderer-map-tool-switching.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

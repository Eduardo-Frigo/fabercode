const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app_conversations.js'), 'utf8');
const sandbox = { window: {}, console, Date };
sandbox.window.window = sandbox.window;
vm.runInNewContext(source, sandbox, { filename: 'app_conversations.js' });

const factory = sandbox.window.FaberAppConversations.createAppConversationController;
assert.strictEqual(typeof factory, 'function');

const events = [];
const state = {
  selectedProjectId: 'project-1',
  uiMode: 'default',
  activeConversationByProject: { 'project-1': 'conversation-1' },
  conversationMessagesById: {
    'conversation-1': [
      { role: 'user', text: 'Primeira mensagem' },
      { role: 'assistant', text: 'Mensagem mais recente' },
    ],
  },
  projectConversations: {
    'project-1': [{ id: 'conversation-1', title: 'Conversa' }],
  },
};

const controller = factory({
  api: {},
  chatController: {
    clearMessages: () => events.push('clear'),
    hasRecentAssistantMessage: () => false,
    scrollToBottom: () => events.push('scroll'),
  },
  hidePersonaThinkingIndicator: () => events.push('hide-thinking'),
  renderMessageBubble: (_role, text) => events.push(`message:${text}`),
  renderWelcomePanel: () => events.push('welcome'),
  state,
});

controller.renderChatForActiveConversation();
assert.deepStrictEqual(events.slice(-3), [
  'message:Mensagem mais recente',
  'welcome',
  'scroll',
]);

events.length = 0;
controller.appendMessage('assistant', 'Nova resposta', { persistToConversation: false });
assert.deepStrictEqual(events.slice(-3), [
  'message:Nova resposta',
  'welcome',
  'scroll',
]);

console.log('renderer-app-conversations.test.js: ok');

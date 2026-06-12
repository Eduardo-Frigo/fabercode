const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'welcome_quotes.js'), 'utf8');
const blockedTextPattern = new RegExp(['\\u0075nexamined', '\\u0065xaminad[ao]\\b'].join('|'), 'i');

function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function createClassList() {
  const classes = new Set();
  return {
    add: (...names) => names.forEach((name) => classes.add(name)),
    remove: (...names) => names.forEach((name) => classes.delete(name)),
    contains: (name) => classes.has(name),
  };
}

function createElement() {
  const attributes = new Map();
  return {
    textContent: '',
    dataset: {},
    classList: createClassList(),
    style: {
      values: {},
      setProperty(name, value) {
        this.values[name] = value;
      },
    },
    getAttribute: (name) => attributes.get(name) || '',
    setAttribute: (name, value) => attributes.set(name, String(value)),
  };
}

function loadWelcomeQuotes({ localStorage = {}, sessionStorage = {}, random = () => 0 } = {}) {
  const textEl = createElement();
  const authorEl = createElement();
  const documentRef = {
    documentElement: { lang: 'pt-BR' },
    getElementById: (id) => {
      if (id === 'welcome-quote-text') return textEl;
      if (id === 'welcome-quote-author') return authorEl;
      return null;
    },
  };
  const mathRef = Object.create(Math);
  mathRef.random = random;
  const sandbox = {
    console,
    document: documentRef,
    globalThis: {},
    Math: mathRef,
    WeakMap,
    window: {
      document: documentRef,
      localStorage: createStorage(localStorage),
      sessionStorage: createStorage(sessionStorage),
      matchMedia: () => ({ matches: false }),
    },
  };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(source, sandbox, { filename: 'welcome_quotes.js' });
  return {
    api: sandbox.window.FaberWelcomeQuotes,
    authorEl,
    textEl,
  };
}

{
  const { api } = loadWelcomeQuotes();
  assert.ok(api.quotes.length >= 30, 'welcome screen should have a broad quote pool');
  assert.strictEqual(
    api.quotes.some((quote) => blockedTextPattern.test([quote.pt, quote.en, quote.es].join(' '))),
    false,
    'blocked quote variants must not be available to the welcome screen'
  );
}

{
  const { api } = loadWelcomeQuotes({
    localStorage: { 'faber.welcomeQuote.lastAuthor': 'Sócrates' },
    random: () => 0,
  });
  const quote = api.getWelcomeQuote('pt-BR', { forceNew: true });
  assert.notStrictEqual(quote.author, 'Sócrates', 'new launches should avoid repeating the last author');
}

{
  const { api } = loadWelcomeQuotes({
    sessionStorage: { 'faber.welcomeQuote.currentIndex': '0' },
    random: () => 0,
  });
  api.setLastAuthor('Sócrates', { clearSession: true });
  const quote = api.getWelcomeQuote('pt-BR');
  assert.notStrictEqual(quote.author, 'Sócrates', 'runtime settings history should override volatile storage');
}

{
  const { api, authorEl, textEl } = loadWelcomeQuotes({ random: () => 0.6 });
  const quote = api.applyWelcomeQuote({ locale: 'en-US', animate: false, forceNew: true });
  assert.strictEqual(
    textEl.textContent.replace(/\s+/g, ' ').trim(),
    quote.text.replace(/\s+/g, ' ').trim(),
    'non-animated apply should render the full quote immediately'
  );
  assert.strictEqual(authorEl.textContent, `— ${quote.author}`, 'author should render with the requested dash prefix');
  assert.ok(authorEl.classList.contains('is-visible'), 'author should be visible after immediate rendering');
  assert.ok(Number(textEl.style.values['--welcome-quote-chars']) >= quote.text.length);
}

{
  const { api } = loadWelcomeQuotes();
  const longQuote = 'Sorte é o que acontece quando a preparação encontra a oportunidade.';
  assert.ok(
    api.formatQuoteTextForDisplay(longQuote, { maxLineLength: 48 }).includes('\n'),
    'long welcome quotes should break into two balanced display lines'
  );
}

console.log('renderer-welcome-quotes.test.js: ok');

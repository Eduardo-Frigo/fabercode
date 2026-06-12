(function () {
  const QUOTES = [
    {
      author: 'Sócrates',
      pt: 'Sábio é aquele que conhece os limites da própria ignorância.',
      en: 'Wise is the one who knows the limits of their own ignorance.',
      es: 'Sabio es aquel que conoce los límites de su propia ignorancia.',
    },
    {
      author: 'Platão',
      pt: 'Não espere por uma crise para descobrir o que é importante em sua vida.',
      en: 'Do not wait for a crisis to discover what is important in your life.',
      es: 'No esperes a una crisis para descubrir lo que es importante en tu vida.',
    },
    {
      author: 'Aristóteles',
      pt: 'O ignorante afirma, o sábio duvida, o sensato reflete.',
      en: 'The ignorant person asserts, the wise person doubts, the sensible person reflects.',
      es: 'El ignorante afirma, el sabio duda, el sensato reflexiona.',
    },
    {
      author: 'Aristóteles',
      pt: 'A excelência não é um ato, mas um hábito.',
      en: 'Excellence is not an act, but a habit.',
      es: 'La excelencia no es un acto, sino un hábito.',
    },
    {
      author: 'Sêneca',
      pt: 'Sorte é o que acontece quando a preparação encontra a oportunidade.',
      en: 'Luck is what happens when preparation meets opportunity.',
      es: 'La suerte es lo que sucede cuando la preparación encuentra la oportunidad.',
    },
    {
      author: 'Marco Aurélio',
      pt: 'A felicidade de sua vida depende da qualidade de seus pensamentos.',
      en: 'The happiness of your life depends on the quality of your thoughts.',
      es: 'La felicidad de su vida depende de la calidad de sus pensamientos.',
    },
    {
      author: 'Marco Aurélio',
      pt: 'Tudo o que ouvimos é uma opinião, não um fato. Tudo o que vemos é uma perspectiva, não a verdade.',
      en: 'Everything we hear is an opinion, not a fact. Everything we see is a perspective, not the truth.',
      es: 'Todo lo que escuchamos es una opinión, no un hecho. Todo lo que vemos es una perspectiva, no la verdad.',
    },
    {
      author: 'Epicteto',
      pt: 'Não são as coisas que nos perturbam, mas a nossa interpretação delas.',
      en: 'It is not things that disturb us, but our interpretation of them.',
      es: 'No son las cosas las que nos perturban, sino nuestra interpretación de ellas.',
    },
    {
      author: 'René Descartes',
      pt: 'Não há nada que dominemos inteiramente a não ser os nossos pensamentos.',
      en: 'There is nothing we fully master except our thoughts.',
      es: 'No hay nada que dominemos completamente excepto nuestros pensamientos.',
    },
    {
      author: 'Friedrich Nietzsche',
      pt: 'Torna-te quem tu és.',
      en: 'Become who you are.',
      es: 'Conviértete en quien eres.',
    },
    {
      author: 'Confúcio',
      pt: 'Eu não procuro saber as respostas, procuro compreender as perguntas.',
      en: 'I do not seek to know the answers, I seek to understand the questions.',
      es: 'No busco saber las respuestas, busco comprender las preguntas.',
    },
    {
      author: 'Lao Tsé',
      pt: 'A jornada de mil milhas começa com um único passo.',
      en: 'The journey of a thousand miles begins with a single step.',
      es: 'El viaje de mil millas comienza con un solo paso.',
    },
    {
      author: 'Lao Tsé',
      pt: 'O silêncio é uma fonte de grande força.',
      en: 'Silence is a source of great strength.',
      es: 'El silencio es una fuente de gran fuerza.',
    },
    {
      author: 'Buda',
      pt: 'A paz vem de dentro. Não a procure à sua volta.',
      en: 'Peace comes from within. Do not seek it around you.',
      es: 'La paz viene de dentro. No la busques alrededor.',
    },
    {
      author: 'Isaac Newton',
      pt: 'O que sabemos é uma gota; o que ignoramos é um oceano.',
      en: 'What we know is a drop; what we do not know is an ocean.',
      es: 'Lo que sabemos es una gota; lo que ignoramos es un océano.',
    },
    {
      author: 'Marie Curie',
      pt: 'Seja menos curioso sobre as pessoas e mais curioso sobre as ideias.',
      en: 'Be less curious about people and more curious about ideas.',
      es: 'Sé menos curioso sobre las personas y más curioso sobre las ideas.',
    },
    {
      author: 'Leonardo da Vinci',
      pt: 'A simplicidade é o último grau de sofisticação.',
      en: 'Simplicity is the ultimate degree of sophistication.',
      es: 'La simplicidad es el último grado de sofisticación.',
    },
    {
      author: 'Albert Camus',
      pt: 'No meio do inverno, aprendi que havia em mim um verão invencível.',
      en: 'In the middle of winter, I learned that there was in me an invincible summer.',
      es: 'En medio del invierno, aprendí que dentro de mí había un verano invencible.',
    },
    {
      author: 'Heráclito',
      pt: 'Tudo flui, nada permanece.',
      en: 'Everything flows, nothing remains.',
      es: 'Todo fluye, nada permanece.',
    },
    {
      author: 'Cícero',
      pt: 'Não basta conquistar a sabedoria, é preciso usá-la.',
      en: 'It is not enough to acquire wisdom; it is necessary to use it.',
      es: 'No basta conquistar la sabiduría, es necesario usarla.',
    },
    {
      author: 'Blaise Pascal',
      pt: 'O coração tem razões que a própria razão desconhece.',
      en: 'The heart has its reasons which reason itself does not know.',
      es: 'El corazón tiene razones que la propia razón desconoce.',
    },
    {
      author: 'John Locke',
      pt: 'Ler fornece ao espírito materiais para o conhecimento, mas só o pensar faz nosso o que lemos.',
      en: 'Reading provides the mind with materials for knowledge, but only thinking makes what we read our own.',
      es: 'Leer proporciona al espíritu materiales para el conocimiento, pero solo el pensar hace nuestro lo que leemos.',
    },
    {
      author: 'Carl G. Jung',
      pt: 'Até que você torne o inconsciente consciente, ele direcionará sua vida e você o chamará de destino.',
      en: 'Until you make the unconscious conscious, it will direct your life and you will call it fate.',
      es: 'Hasta que hagas consciente lo inconsciente, éste dirigirá tu vida y tú lo llamarás destino.',
    },
    {
      author: 'Michel de Montaigne',
      pt: 'A maior coisa do mundo é saber pertencer a si mesmo.',
      en: 'The greatest thing in the world is to know how to belong to oneself.',
      es: 'La mayor cosa del mundo es saber pertenecerse a uno mismo.',
    },
    {
      author: 'Baruch Spinoza',
      pt: 'Não rir, não lamentar, nem odiar, mas compreender.',
      en: 'Do not laugh, do not lament, nor hate, but understand.',
      es: 'No reír, no lamentar, ni odiar, sino comprender.',
    },
    {
      author: 'Immanuel Kant',
      pt: 'Ouse saber.',
      en: 'Dare to know.',
      es: 'Atrévete a saber.',
    },
    {
      author: 'Søren Kierkegaard',
      pt: 'A vida só pode ser compreendida olhando para trás, mas deve ser vivida olhando para frente.',
      en: 'Life can only be understood looking backward, but it must be lived looking forward.',
      es: 'La vida solo puede entenderse mirando hacia atrás, pero debe vivirse mirando hacia adelante.',
    },
    {
      author: 'Hannah Arendt',
      pt: 'A pluralidade é a condição da ação humana.',
      en: 'Plurality is the condition of human action.',
      es: 'La pluralidad es la condición de la acción humana.',
    },
    {
      author: 'Simone de Beauvoir',
      pt: 'Querer-se livre é também querer livres os outros.',
      en: 'To will oneself free is also to will others free.',
      es: 'Quererse libre es también querer libres a los demás.',
    },
    {
      author: 'Mary Wollstonecraft',
      pt: 'A virtude só floresce quando a razão pode respirar.',
      en: 'Virtue only flourishes when reason can breathe.',
      es: 'La virtud solo florece cuando la razón puede respirar.',
    },
    {
      author: 'Arthur Schopenhauer',
      pt: 'Cada pessoa toma os limites do próprio campo de visão pelos limites do mundo.',
      en: 'Each person takes the limits of their own field of vision for the limits of the world.',
      es: 'Cada persona toma los límites de su propio campo de visión por los límites del mundo.',
    },
    {
      author: 'David Hume',
      pt: 'A razão é guia quando aprende a dialogar com as paixões.',
      en: 'Reason is a guide when it learns to converse with the passions.',
      es: 'La razón es guía cuando aprende a dialogar con las pasiones.',
    },
    {
      author: 'Virginia Woolf',
      pt: 'Não se encontra a si mesmo quando se procura nos olhos dos outros.',
      en: 'One does not find oneself by searching in the eyes of others.',
      es: 'Uno no se encuentra buscándose en los ojos de los demás.',
    },
  ];

  const SESSION_KEY = 'faber.welcomeQuote.currentIndex';
  const LAST_KEY = 'faber.welcomeQuote.lastIndex';
  const LAST_AUTHOR_KEY = 'faber.welcomeQuote.lastAuthor';
  const typewriterState = new WeakMap();
  let persistedLastAuthor = '';

  function normalizeLocale(locale) {
    const value = String(locale || '').toLowerCase();
    if (value.startsWith('en')) return 'en';
    if (value.startsWith('es')) return 'es';
    return 'pt';
  }

  function readStoredIndex(storage, key) {
    try {
      const rawValue = storage && storage.getItem(key);
      if (rawValue === null || rawValue === undefined || rawValue === '') return null;
      const value = Number(rawValue);
      return Number.isInteger(value) && value >= 0 && value < QUOTES.length ? value : null;
    } catch (error) {
      return null;
    }
  }

  function writeStoredIndex(storage, key, index) {
    try {
      if (storage) storage.setItem(key, String(index));
    } catch (error) {
      // Storage can be unavailable in hardened preview contexts.
    }
  }

  function readStoredValue(storage, key) {
    try {
      return storage ? storage.getItem(key) : null;
    } catch (error) {
      return null;
    }
  }

  function writeStoredValue(storage, key, value) {
    try {
      if (storage) storage.setItem(key, String(value || ''));
    } catch (error) {
      // Storage can be unavailable in hardened preview contexts.
    }
  }

  function getStoredLastAuthor() {
    if (persistedLastAuthor) return persistedLastAuthor;
    const storedAuthor = readStoredValue(window.localStorage, LAST_AUTHOR_KEY);
    if (storedAuthor) return storedAuthor;
    const lastIndex = readStoredIndex(window.localStorage, LAST_KEY);
    return lastIndex !== null && QUOTES[lastIndex] ? QUOTES[lastIndex].author : '';
  }

  function setLastAuthor(author, options = {}) {
    persistedLastAuthor = String(author || '').trim();
    if (options.clearSession) {
      try {
        if (window.sessionStorage) window.sessionStorage.removeItem(SESSION_KEY);
      } catch {
        // Storage can be unavailable in hardened preview contexts.
      }
    }
  }

  function getCandidateIndexes(lastAuthor) {
    const allIndexes = QUOTES.map((_, index) => index);
    if (!lastAuthor) return allIndexes;
    const filtered = allIndexes.filter((index) => QUOTES[index].author !== lastAuthor);
    return filtered.length ? filtered : allIndexes;
  }

  function resolveTimer(name) {
    if (typeof window[name] === 'function') return window[name].bind(window);
    if (typeof globalThis !== 'undefined' && typeof globalThis[name] === 'function') {
      return globalThis[name].bind(globalThis);
    }
    return function () {};
  }

  function getTimerApi() {
    return {
      setInterval: resolveTimer('setInterval'),
      clearInterval: resolveTimer('clearInterval'),
      setTimeout: resolveTimer('setTimeout'),
      clearTimeout: resolveTimer('clearTimeout'),
    };
  }

  function pickQuoteIndex(options = {}) {
    if (!options.forceNew) {
      const sessionIndex = readStoredIndex(window.sessionStorage, SESSION_KEY);
      if (sessionIndex !== null) return sessionIndex;
    }
    const candidates = getCandidateIndexes(getStoredLastAuthor());
    const candidateIndex = Math.floor(Math.random() * candidates.length);
    const nextIndex = candidates[candidateIndex] || 0;
    writeStoredIndex(window.sessionStorage, SESSION_KEY, nextIndex);
    writeStoredIndex(window.localStorage, LAST_KEY, nextIndex);
    writeStoredValue(window.localStorage, LAST_AUTHOR_KEY, QUOTES[nextIndex].author);
    setLastAuthor(QUOTES[nextIndex].author);
    return nextIndex;
  }

  function getWelcomeQuote(locale, options = {}) {
    const language = normalizeLocale(locale);
    const quote = QUOTES[pickQuoteIndex(options)] || QUOTES[0];
    return {
      author: quote.author,
      text: quote[language] || quote.pt,
    };
  }

  function formatQuoteTextForDisplay(text, options = {}) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    const maxLineLength = Number.isFinite(options.maxLineLength) ? options.maxLineLength : 58;
    const minSideLength = Number.isFinite(options.minSideLength) ? options.minSideLength : 24;
    if (normalized.length <= maxLineLength) return normalized;

    const midpoint = Math.floor(normalized.length / 2);
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let index = 0; index < normalized.length; index += 1) {
      if (normalized[index] !== ' ') continue;
      if (index < minSideLength) continue;
      if (normalized.length - index - 1 < minSideLength) continue;
      const distance = Math.abs(index - midpoint);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    if (bestIndex < 0) return normalized;
    return `${normalized.slice(0, bestIndex)}\n${normalized.slice(bestIndex + 1)}`;
  }

  function clearTypewriter(textEl) {
    const previous = typewriterState.get(textEl);
    const timerApi = getTimerApi();
    if (previous && previous.delayTimer) timerApi.clearTimeout(previous.delayTimer);
    if (previous && previous.typingTimer) timerApi.clearInterval(previous.typingTimer);
    typewriterState.delete(textEl);
    textEl.classList.remove('is-typing');
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (error) {
      return false;
    }
  }

  function setQuoteDataset(textEl, text) {
    if (textEl.dataset) {
      textEl.dataset.welcomeQuoteText = text;
      return;
    }
    textEl.setAttribute('data-welcome-quote-text', text);
  }

  function getQuoteDataset(textEl) {
    if (textEl.dataset) return textEl.dataset.welcomeQuoteText || '';
    return textEl.getAttribute('data-welcome-quote-text') || '';
  }

  function revealQuoteImmediately(textEl, authorEl, text) {
    clearTypewriter(textEl);
    textEl.textContent = text;
    authorEl.classList.add('is-visible');
  }

  function animateQuoteText(textEl, authorEl, text, options = {}) {
    const timerApi = getTimerApi();
    const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 1080;
    const stepMs = Number.isFinite(options.stepMs) ? options.stepMs : 18;
    clearTypewriter(textEl);
    textEl.textContent = '';
    textEl.classList.add('is-typing');
    authorEl.classList.remove('is-visible');
    const delayTimer = timerApi.setTimeout(() => {
      let cursor = 0;
      const typingTimer = timerApi.setInterval(() => {
        cursor += 1;
        textEl.textContent = text.slice(0, cursor);
        if (cursor >= text.length) {
          timerApi.clearInterval(typingTimer);
          textEl.classList.remove('is-typing');
          authorEl.classList.add('is-visible');
          typewriterState.delete(textEl);
        }
      }, stepMs);
      typewriterState.set(textEl, { typingTimer });
    }, delayMs);
    typewriterState.set(textEl, { delayTimer });
  }

  function applyWelcomeQuote(options = {}) {
    const doc = options.document || document;
    const textEl = doc.getElementById('welcome-quote-text');
    const authorEl = doc.getElementById('welcome-quote-author');
    if (!textEl || !authorEl) return null;
    const quote = getWelcomeQuote(options.locale || doc.documentElement.lang || 'pt-BR', options);
    const displayText = formatQuoteTextForDisplay(quote.text);
    const previousText = getQuoteDataset(textEl);
    const sameQuoteStillTyping = previousText === quote.text && textEl.classList.contains('is-typing');
    textEl.style.setProperty('--welcome-quote-chars', String(Math.max(1, displayText.length)));
    setQuoteDataset(textEl, quote.text);
    authorEl.textContent = `— ${quote.author}`;
    if (sameQuoteStillTyping && options.forceReplay !== true) return quote;
    if (options.animate === false || prefersReducedMotion() || (previousText === quote.text && options.forceReplay !== true)) {
      revealQuoteImmediately(textEl, authorEl, displayText);
      return quote;
    }
    animateQuoteText(textEl, authorEl, displayText, options);
    return quote;
  }

  window.FaberWelcomeQuotes = {
    applyWelcomeQuote,
    animateQuoteText,
    formatQuoteTextForDisplay,
    getWelcomeQuote,
    normalizeLocale,
    quotes: QUOTES.slice(),
    setLastAuthor,
  };
})();

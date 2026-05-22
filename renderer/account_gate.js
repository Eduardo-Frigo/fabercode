(function () {
  function hasAccountApi(api) {
    return Boolean(api && typeof api.getAccountStatus === 'function');
  }

  function isSignedIn(status) {
    return Boolean(status && status.ok !== false && status.signedIn && status.user);
  }

  function hasPlatformMedia(status) {
    const media = status && status.config && status.config.media ? status.config.media : {};
    return Boolean(media.pexelsConfigured);
  }

  function getConfigMissingMessage(status) {
    const config = status && status.config ? status.config : {};
    const missing = Array.isArray(config.missing) ? config.missing : [];
    if (missing.length) return `Backend incompleto: ${missing.join(', ')}.`;
    if (config.media && !config.media.pexelsConfigured) {
      return 'Conta conectada, mas PEXELS_API_KEY ainda nao esta configurada para liberar imagens nas blueprints.';
    }
    return '';
  }

  function getPreferredDeviceLanguage(view) {
    const rawLanguage = String((view && view.navigator && view.navigator.language) || '').trim().toLowerCase();
    if (rawLanguage.startsWith('en')) return 'en-US';
    if (rawLanguage.startsWith('es')) return 'es-ES';
    return 'pt-BR';
  }

  function getPreferredDeviceTheme(view) {
    if (view && typeof view.matchMedia === 'function') {
      try {
        if (view.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
      } catch {}
    }
    return 'dark';
  }

  function createAccountGateController(options = {}) {
    const api = options.api || null;
    const doc = options.documentRef || document;
    const view = doc.defaultView || window;
    const requirePlatformMedia = options.requirePlatformMedia !== false;
    const onStatusChange = typeof options.onStatusChange === 'function' ? options.onStatusChange : () => {};
    const notify = typeof options.notify === 'function' ? options.notify : () => {};

    const elements = {
      gate: doc.getElementById('account-gate'),
      actions: doc.getElementById('account-gate-actions'),
      status: doc.getElementById('account-gate-status'),
      emailToggle: doc.getElementById('account-gate-email-toggle'),
      emailForm: doc.getElementById('account-gate-email-form'),
      emailInput: doc.getElementById('account-gate-email'),
      passwordInput: doc.getElementById('account-gate-password'),
      emailSubmit: doc.getElementById('account-gate-email-submit'),
      createToggle: doc.getElementById('account-gate-create-toggle'),
      signupFields: doc.getElementById('account-gate-signup-fields'),
      fullNameInput: doc.getElementById('account-gate-full-name'),
      themeSelect: doc.getElementById('account-gate-theme'),
      languageSelect: doc.getElementById('account-gate-language'),
      googleLogin: doc.getElementById('account-gate-google-login'),
      back: doc.getElementById('account-gate-back'),
      signOut: doc.getElementById('account-gate-sign-out'),
      refresh: doc.getElementById('account-gate-refresh'),
    };

    let currentStatus = null;
    let unlocked = false;
    let busy = false;
    let authMode = 'login';
    let authView = 'choices';
    let unsubscribeAccountEvent = null;

    function setInitialPreferences() {
      if (elements.languageSelect) {
        elements.languageSelect.value = getPreferredDeviceLanguage(view);
      }
      if (elements.themeSelect) {
        elements.themeSelect.value = getPreferredDeviceTheme(view);
      }
      if (elements.passwordInput) elements.passwordInput.setAttribute('autocomplete', 'current-password');
    }

    function setBusy(nextBusy) {
      busy = Boolean(nextBusy);
      [
        elements.emailToggle,
        elements.googleLogin,
        elements.signOut,
        elements.refresh,
        elements.emailInput,
        elements.passwordInput,
        elements.emailSubmit,
        elements.createToggle,
        elements.back,
        elements.fullNameInput,
        elements.themeSelect,
        elements.languageSelect,
      ].forEach((element) => {
        if (element) element.disabled = busy;
      });
    }

    function setStatusMessage(message) {
      if (elements.status) elements.status.textContent = message || '';
    }

    function setLocked(locked) {
      unlocked = !locked;
      if (doc.body) doc.body.classList.toggle('account-locked', locked);
      if (elements.gate) {
        elements.gate.classList.toggle('hidden', !locked);
        elements.gate.setAttribute('aria-hidden', locked ? 'false' : 'true');
      }
    }

    function canUseApp(status) {
      if (!isSignedIn(status)) return false;
      if (requirePlatformMedia && !hasPlatformMedia(status)) return false;
      return true;
    }

    function renderStatus(status = null, message = '') {
      const signedIn = isSignedIn(status);
      const platformMediaReady = hasPlatformMedia(status);
      const configMessage = getConfigMissingMessage(status);
      const appReady = canUseApp(status);

      if (message) {
        setStatusMessage(message);
      } else if (canUseApp(status)) {
        setStatusMessage('');
      } else if (signedIn && requirePlatformMedia && !platformMediaReady) {
        setStatusMessage(configMessage);
      } else if (configMessage) {
        setStatusMessage(configMessage);
      } else {
        setStatusMessage('');
      }

      if (signedIn) {
        if (elements.actions) elements.actions.classList.toggle('hidden', appReady);
        if (elements.emailForm) elements.emailForm.classList.add('hidden');
      } else if (authView === 'choices') {
        if (elements.actions) elements.actions.classList.remove('hidden');
        if (elements.emailForm) elements.emailForm.classList.add('hidden');
      } else {
        if (elements.actions) elements.actions.classList.add('hidden');
        if (elements.emailForm) elements.emailForm.classList.remove('hidden');
      }
      if (elements.signOut) elements.signOut.classList.toggle('hidden', !signedIn);
      if (elements.googleLogin) elements.googleLogin.classList.toggle('hidden', signedIn);
      if (elements.emailToggle) elements.emailToggle.classList.toggle('hidden', signedIn);
    }

    function showChoices() {
      authView = 'choices';
      authMode = 'login';
      if (elements.actions) elements.actions.classList.remove('hidden');
      if (elements.emailForm) elements.emailForm.classList.add('hidden');
      if (elements.signupFields) elements.signupFields.classList.add('hidden');
      if (elements.emailSubmit) elements.emailSubmit.textContent = 'Entrar';
      if (elements.createToggle) elements.createToggle.textContent = 'Não tem uma conta? Crie aqui.';
      if (elements.passwordInput) elements.passwordInput.setAttribute('autocomplete', 'current-password');
      setStatusMessage('');
    }

    function showEmailForm(nextMode = 'login') {
      authView = 'email';
      authMode = nextMode === 'signup' ? 'signup' : 'login';
      if (elements.actions) elements.actions.classList.add('hidden');
      if (elements.emailForm) elements.emailForm.classList.remove('hidden');
      if (elements.signupFields) elements.signupFields.classList.toggle('hidden', authMode !== 'signup');
      if (elements.emailSubmit) elements.emailSubmit.textContent = authMode === 'signup' ? 'Criar conta' : 'Entrar';
      if (elements.createToggle) {
        elements.createToggle.textContent = authMode === 'signup'
          ? 'Ja tem uma conta? Logar com e-mail.'
          : 'Nao tem uma conta? Crie aqui.';
      }
      if (elements.passwordInput) {
        elements.passwordInput.setAttribute('autocomplete', authMode === 'signup' ? 'new-password' : 'current-password');
      }
      if (elements.emailInput && typeof elements.emailInput.focus === 'function') elements.emailInput.focus();
    }

    function toggleCreateMode() {
      showEmailForm(authMode === 'signup' ? 'login' : 'signup');
      setStatusMessage('');
    }

    async function refresh(message = '') {
      if (!hasAccountApi(api)) {
        currentStatus = null;
        renderStatus(null, 'Backend de conta indisponivel. Reinicie o Faber Code e tente novamente.');
        setLocked(true);
        onStatusChange(currentStatus, false);
        return null;
      }

      setBusy(true);
      try {
        const status = await api.getAccountStatus();
        currentStatus = status || null;
        renderStatus(currentStatus, message);
        const nextUnlocked = canUseApp(currentStatus);
        setLocked(!nextUnlocked);
        onStatusChange(currentStatus, nextUnlocked);
        return currentStatus;
      } catch {
        currentStatus = null;
        renderStatus(null, 'Nao foi possivel validar sua sessao. Verifique o backend de conta e tente novamente.');
        setLocked(true);
        onStatusChange(currentStatus, false);
        return null;
      } finally {
        setBusy(false);
      }
    }

    async function startGoogleLogin() {
      if (!api || typeof api.startGoogleLogin !== 'function') {
        const message = 'Login Google indisponivel neste build.';
        renderStatus(currentStatus, message);
        notify(message);
        return null;
      }

      setBusy(true);
      try {
        const result = await api.startGoogleLogin({ openExternal: true });
        if (!result || !result.ok) {
          const message = (result && result.message) || 'Nao foi possivel iniciar o login Google.';
          renderStatus(currentStatus, message);
          notify(message);
          return result || null;
        }
        renderStatus(currentStatus, 'Conclua o login no navegador para continuar.');
        return result;
      } catch {
        const message = 'Falha ao abrir o login Google.';
        renderStatus(currentStatus, message);
        notify(message);
        return null;
      } finally {
        setBusy(false);
      }
    }

    async function submitEmailForm() {
      const email = elements.emailInput ? String(elements.emailInput.value || '').trim() : '';
      const password = elements.passwordInput ? String(elements.passwordInput.value || '') : '';
      if (!email || !password) {
        setStatusMessage('Preencha e-mail e senha.');
        return null;
      }

      const isSignup = authMode === 'signup';
      const methodName = isSignup ? 'signUpWithPassword' : 'signInWithPassword';
      if (!api || typeof api[methodName] !== 'function') {
        const message = 'Login com e-mail indisponivel neste build.';
        renderStatus(currentStatus, message);
        notify(message);
        return null;
      }

      const payload = { email, password };
      if (isSignup) {
        payload.name = elements.fullNameInput ? String(elements.fullNameInput.value || '').trim() : '';
        payload.themePreference = elements.themeSelect ? String(elements.themeSelect.value || '').trim() : getPreferredDeviceTheme(view);
        payload.languagePreference = elements.languageSelect ? String(elements.languageSelect.value || '').trim() : getPreferredDeviceLanguage(view);
      }

      setBusy(true);
      try {
        const result = await api[methodName](payload);
        if (!result || !result.ok) {
          const message = (result && result.message) || 'Nao foi possivel concluir o login.';
          renderStatus(currentStatus, message);
          notify(message);
          return result || null;
        }
        await refresh('');
        return result;
      } catch {
        const message = 'Falha ao concluir o login com e-mail.';
        renderStatus(currentStatus, message);
        notify(message);
        return null;
      } finally {
        setBusy(false);
      }
    }

    async function signOut() {
      if (!api || typeof api.signOutAccount !== 'function') {
        const message = 'Saida da conta indisponivel neste build.';
        renderStatus(currentStatus, message);
        notify(message);
        return null;
      }

      setBusy(true);
      try {
        const result = await api.signOutAccount();
        if (!result || !result.ok) {
          const message = (result && result.message) || 'Nao foi possivel sair da conta.';
          renderStatus(currentStatus, message);
          notify(message);
          return result || null;
        }
        await refresh('');
        return result;
      } catch {
        const message = 'Falha ao sair da conta.';
        renderStatus(currentStatus, message);
        notify(message);
        return null;
      } finally {
        setBusy(false);
      }
    }

    async function ensureUnlocked() {
      if (unlocked) return true;
      const status = await refresh();
      if (canUseApp(status)) return true;
      setLocked(true);
      return false;
    }

    function bindEvents() {
      setInitialPreferences();
      if (elements.emailToggle) {
        elements.emailToggle.addEventListener('click', () => {
          showEmailForm('login');
        });
      }
      if (elements.createToggle) {
        elements.createToggle.addEventListener('click', () => {
          toggleCreateMode();
        });
      }
      if (elements.back) {
        elements.back.addEventListener('click', () => {
          showChoices();
        });
      }
      if (elements.emailForm) {
        elements.emailForm.addEventListener('submit', async (event) => {
          if (event && typeof event.preventDefault === 'function') event.preventDefault();
          await submitEmailForm();
        });
      }
      if (elements.googleLogin) {
        elements.googleLogin.addEventListener('click', async () => {
          await startGoogleLogin();
        });
      }
      if (elements.refresh) {
        elements.refresh.addEventListener('click', async () => {
          await refresh('');
        });
      }
      if (elements.signOut) {
        elements.signOut.addEventListener('click', async () => {
          await signOut();
        });
      }
      if (api && typeof api.onAccountEvent === 'function') {
        unsubscribeAccountEvent = api.onAccountEvent(async () => {
          await refresh();
        });
      }
    }

    function dispose() {
      if (typeof unsubscribeAccountEvent === 'function') {
        unsubscribeAccountEvent();
        unsubscribeAccountEvent = null;
      }
    }

    return {
      bindEvents,
      canUseApp,
      dispose,
      ensureUnlocked,
      isUnlocked: () => unlocked,
      refresh,
      showChoices,
      showEmailForm,
      signOut,
      startGoogleLogin,
      submitEmailForm,
    };
  }

  window.FaberAccountGate = {
    createAccountGateController,
    getPreferredDeviceLanguage,
    hasPlatformMedia,
    isSignedIn,
  };
})();

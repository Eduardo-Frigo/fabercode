(function () {
  function createAiSettingsAccountPanel({ api = {}, elements = {}, translate = (key) => key, notify = () => {} } = {}) {
    function setAccountControlsSignedIn(signedIn) {
      if (elements.accountGoogleLogin) elements.accountGoogleLogin.classList.toggle('hidden', signedIn);
      if (elements.accountSignOut) elements.accountSignOut.classList.toggle('hidden', !signedIn);
      if (elements.accountEmail) elements.accountEmail.disabled = signedIn;
      if (elements.accountCode) elements.accountCode.disabled = signedIn;
      if (elements.accountEmailStart) elements.accountEmailStart.disabled = signedIn;
      if (elements.accountEmailComplete) elements.accountEmailComplete.disabled = signedIn;
    }

    function renderAccountStatus(status = null, message = '') {
      if (!elements.accountStatus) return;
      const signedIn = Boolean(status && status.signedIn && status.user);
      const config = status && status.config ? status.config : {};
      const missing = Array.isArray(config.missing) ? config.missing : [];
      const googleMissing = config.google && Array.isArray(config.google.missing) ? config.google.missing : [];
      const detailText = message ||
        (signedIn
          ? String(status.user.email || status.user.name || '')
          : missing.length
            ? translate('accountBackendMissing').replace('{items}', missing.join(', '))
            : googleMissing.length
              ? translate('googleUnavailable')
              : translate('accountNotConnected'));

      elements.accountStatus.innerHTML = '';
      const title = document.createElement('strong');
      title.textContent = signedIn ? translate('accountConnected') : translate('accountNotConnected');
      const detail = document.createElement('span');
      detail.textContent = detailText;
      elements.accountStatus.append(title, detail);
      setAccountControlsSignedIn(signedIn);
    }

    async function refreshAccountStatus(message = '') {
      if (!api || typeof api.getAccountStatus !== 'function') {
        renderAccountStatus(null, translate('accountBackendMissing').replace('{items}', 'account IPC'));
        return null;
      }
      try {
        const status = await api.getAccountStatus();
        renderAccountStatus(status, message);
        return status;
      } catch {
        renderAccountStatus(null, translate('accountBackendMissing').replace('{items}', 'account IPC'));
        return null;
      }
    }

    async function startGoogleLogin() {
      if (!api || typeof api.startGoogleLogin !== 'function') {
        notify(translate('accountBackendMissing').replace('{items}', 'Google IPC'));
        return;
      }
      const result = await api.startGoogleLogin({ openExternal: true });
      if (!result || !result.ok) {
        notify((result && result.message) || translate('googleUnavailable'));
        await refreshAccountStatus((result && result.message) || translate('googleUnavailable'));
        return;
      }
      await refreshAccountStatus(translate('googleBrowserOpened'));
    }

    async function startEmailLogin() {
      if (!api || typeof api.startEmailLogin !== 'function') return;
      const email = elements.accountEmail ? String(elements.accountEmail.value || '').trim() : '';
      const result = await api.startEmailLogin({ email });
      if (!result || !result.ok) {
        notify((result && result.message) || translate('accountNotConnected'));
        return;
      }
      const message = result.devCode
        ? translate('emailCodeSentDev').replace('{code}', result.devCode)
        : translate('emailCodeSent');
      if (elements.accountCode && result.devCode) elements.accountCode.value = result.devCode;
      await refreshAccountStatus(message);
    }

    async function completeEmailLogin() {
      if (!api || typeof api.completeEmailLogin !== 'function') return;
      const email = elements.accountEmail ? String(elements.accountEmail.value || '').trim() : '';
      const code = elements.accountCode ? String(elements.accountCode.value || '').trim() : '';
      const result = await api.completeEmailLogin({ email, code });
      if (!result || !result.ok) {
        notify((result && result.message) || translate('accountNotConnected'));
        return;
      }
      await refreshAccountStatus(translate('emailLoginComplete'));
    }

    async function signOutAccount() {
      if (!api || typeof api.signOutAccount !== 'function') return;
      const result = await api.signOutAccount();
      if (!result || !result.ok) {
        notify((result && result.message) || translate('accountNotConnected'));
        return;
      }
      await refreshAccountStatus(translate('accountSignedOut'));
    }

    return {
      completeEmailLogin,
      refreshAccountStatus,
      renderAccountStatus,
      signOutAccount,
      startEmailLogin,
      startGoogleLogin,
    };
  }

  window.FaberAiSettingsAccountPanel = {
    createAiSettingsAccountPanel,
  };
})();

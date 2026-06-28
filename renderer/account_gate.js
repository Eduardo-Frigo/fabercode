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

  function normalizeLanguagePreference(rawValue) {
    const value = String(rawValue || '').trim();
    const lower = value.toLowerCase();
    if (value === 'pt-BR' || lower.startsWith('pt')) return 'pt-BR';
    if (value === 'en-US' || lower.startsWith('en')) return 'en-US';
    if (value === 'es-ES' || lower.startsWith('es')) return 'es-ES';
    return '';
  }

  function getPreferredSignupLanguage({ documentRef = null, getInterfaceLanguage = null } = {}) {
    const interfaceLanguage = typeof getInterfaceLanguage === 'function'
      ? normalizeLanguagePreference(getInterfaceLanguage())
      : '';
    if (interfaceLanguage) return interfaceLanguage;

    const documentLanguage = documentRef && documentRef.documentElement
      ? normalizeLanguagePreference(documentRef.documentElement.lang)
      : '';
    return documentLanguage || 'pt-BR';
  }

  function getPreferredDeviceTheme(view) {
    if (view && typeof view.matchMedia === 'function') {
      try {
        if (view.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
      } catch {}
    }
    return 'dark';
  }

  function normalizeWorkspacePreference(rawValue) {
    const value = String(rawValue || '').trim().toLowerCase();
    return value === 'ide' || value === 'programador' || value === 'programmer' ? 'ide' : 'chat';
  }

  function formatGithubSetupMessage(result = {}) {
    const missing = Array.isArray(result.missing) ? result.missing.filter(Boolean) : [];
    const setup = result.setup || {};
    const callback = setup.redirectUri || result.redirectUri || 'http://127.0.0.1:37418/auth/github/callback';
    if (!missing.length && !setup.redirectUri) {
      return result.message || 'Nao foi possivel iniciar o login GitHub.';
    }

    const missingText = missing.length ? `Falta preencher ${missing.join(', ')} no .env.` : 'Revise a configuracao GitHub no .env.';
    return [
      `GitHub OAuth ainda nao esta configurado. ${missingText}`,
      'No GitHub: Settings > Developer settings > OAuth Apps > New OAuth App.',
      `Authorization callback URL: ${callback}`,
      'Depois salve o Client ID/Secret no .env e reinicie o Faber Code.',
    ].join('\n');
  }

  function createAccountGateController(options = {}) {
    const api = options.api || null;
    const doc = options.documentRef || document;
    const view = doc.defaultView || window;
    const requirePlatformMedia = options.requirePlatformMedia !== false;
    const onStatusChange = typeof options.onStatusChange === 'function' ? options.onStatusChange : () => {};
    const onWorkspacePreferenceSelected = typeof options.onWorkspacePreferenceSelected === 'function'
      ? options.onWorkspacePreferenceSelected
      : () => {};
    const onLanguagePreferenceSelected = typeof options.onLanguagePreferenceSelected === 'function'
      ? options.onLanguagePreferenceSelected
      : () => {};
    const onThemePreferenceSelected = typeof options.onThemePreferenceSelected === 'function'
      ? options.onThemePreferenceSelected
      : () => {};
    const notify = typeof options.notify === 'function' ? options.notify : () => {};
    const getInterfaceLanguage = typeof options.getInterfaceLanguage === 'function' ? options.getInterfaceLanguage : null;

    const elements = {
      gate: doc.getElementById('account-gate'),
      wizard: doc.getElementById('account-gate-wizard'),
      stepPills: Array.from(doc.querySelectorAll ? doc.querySelectorAll('[data-account-gate-step]') : []),
      backArrow: doc.getElementById('account-gate-back-arrow'),
      languageScreen: doc.getElementById('account-gate-language-screen'),
      languageNext: doc.getElementById('account-gate-language-next'),
      themeScreen: doc.getElementById('account-gate-theme-screen'),
      themeNext: doc.getElementById('account-gate-theme-next'),
      entryScreen: doc.getElementById('account-gate-entry-screen'),
      entryNext: doc.getElementById('account-gate-entry-next'),
      accessScreen: doc.getElementById('account-gate-access-screen'),
      accessLoginEmailBtn: doc.getElementById('account-gate-access-login-email'),
      accessSignupEmailBtn: doc.getElementById('account-gate-access-signup-email'),
      accessGoogleBtn: doc.getElementById('account-gate-access-google'),
      accessGithubBtn: doc.getElementById('account-gate-access-github'),
      signupChoiceScreen: doc.getElementById('account-gate-signup-choice-screen'),
      signupEmailBtn: doc.getElementById('account-gate-signup-email-btn'),
      signupGoogleBtn: doc.getElementById('account-gate-signup-google-btn'),
      signupGithubBtn: doc.getElementById('account-gate-signup-github-btn'),
      loginScreen: doc.getElementById('account-gate-login-screen'),
      actions: doc.getElementById('account-gate-actions'),
      status: doc.getElementById('account-gate-status'),
      onboardingLanguageSelect: doc.getElementById('account-gate-onboarding-language'),
      onboardingThemeSelect: doc.getElementById('account-gate-onboarding-theme'),
      newUser: doc.getElementById('account-gate-new-user'),
      existingUser: doc.getElementById('account-gate-existing-user'),
      emailToggle: doc.getElementById('account-gate-email-toggle'),
      emailForm: doc.getElementById('account-gate-email-form'),
      emailInput: doc.getElementById('account-gate-email'),
      passwordInput: doc.getElementById('account-gate-password'),
      emailSubmit: doc.getElementById('account-gate-email-submit'),
      createToggle: doc.getElementById('account-gate-create-toggle'),
      signupFields: doc.getElementById('account-gate-signup-fields'),
      fullNameInput: doc.getElementById('account-gate-full-name'),
      firstNameInput: doc.getElementById('account-gate-first-name'),
      lastNameInput: doc.getElementById('account-gate-last-name'),
      formEyebrow: doc.getElementById('account-gate-form-eyebrow'),
      formTitle: doc.getElementById('account-gate-form-title'),
      formCopy: doc.getElementById('account-gate-form-copy'),
      googleLogin: doc.getElementById('account-gate-google-login'),
      githubLogin: doc.getElementById('account-gate-github-login'),
      signOut: doc.getElementById('account-gate-sign-out'),
      refresh: doc.getElementById('account-gate-refresh'),
    };

    let currentStatus = null;
    let unlocked = false;
    let busy = false;
    let wantsTutorial = true;
    let authMode = 'login';
    let flowStep = 'language';
    let emailReturnStep = 'login';
    let unsubscribeAccountEvent = null;

    function setInitialPreferences() {
      const language = getPreferredSignupLanguage({ documentRef: doc, getInterfaceLanguage });
      const theme = getPreferredDeviceTheme(view);
      if (elements.onboardingLanguageSelect) {
        elements.onboardingLanguageSelect.value = language;
      }
      if (elements.onboardingThemeSelect) {
        elements.onboardingThemeSelect.value = theme;
      }
      if (elements.passwordInput) elements.passwordInput.setAttribute('autocomplete', 'current-password');
    }

    function setBusy(nextBusy) {
      busy = Boolean(nextBusy);
      [
        elements.languageNext,
        elements.themeBack,
        elements.themeNext,
        elements.entryBack,
        elements.loginBack,
        elements.emailBack,
        elements.onboardingLanguageSelect,
        elements.onboardingThemeSelect,
        elements.newUser,
        elements.existingUser,
        elements.emailToggle,
        elements.googleLogin,
        elements.githubLogin,
        elements.signOut,
        elements.refresh,
        elements.emailInput,
        elements.passwordInput,
        elements.emailSubmit,
        elements.createToggle,
        elements.fullNameInput,
        elements.workspaceSelect,
        elements.signupWorkspaceSelect,
      ].forEach((element) => {
        if (element) element.disabled = busy;
      });
    }

    function getWorkspacePreference() {
      if (!elements.workspaceSelect && !elements.signupWorkspaceSelect) return null;
      const rawValue = flowStep === 'email' && authMode === 'signup' && elements.signupWorkspaceSelect
        ? elements.signupWorkspaceSelect.value
        : elements.workspaceSelect
          ? elements.workspaceSelect.value
          : 'chat';
      return normalizeWorkspacePreference(rawValue);
    }

    function applyWorkspacePreference() {
      const mode = getWorkspacePreference();
      if (!mode) return null;
      if (elements.workspaceSelect) elements.workspaceSelect.value = mode;
      if (elements.signupWorkspaceSelect) elements.signupWorkspaceSelect.value = mode;
      onWorkspacePreferenceSelected(mode);
      return mode;
    }

    function setStatusMessage(message) {
      if (elements.status) elements.status.textContent = message || '';
    }

    function getSelectedLanguagePreference() {
      const fromOnboarding = elements.onboardingLanguageSelect
        ? normalizeLanguagePreference(elements.onboardingLanguageSelect.value)
        : '';
      return fromOnboarding || getPreferredSignupLanguage({ documentRef: doc, getInterfaceLanguage });
    }

    function getSelectedThemePreference() {
      const fromOnboarding = elements.onboardingThemeSelect
        ? String(elements.onboardingThemeSelect.value || '').trim()
        : '';
      return fromOnboarding === 'light' || fromOnboarding === 'dark'
        ? fromOnboarding
        : getPreferredDeviceTheme(view);
    }

    function applyOnboardingPreferences({ notifySelection = false } = {}) {
      const language = getSelectedLanguagePreference();
      const theme = getSelectedThemePreference();
      if (elements.onboardingLanguageSelect) elements.onboardingLanguageSelect.value = language;
      if (elements.onboardingThemeSelect) elements.onboardingThemeSelect.value = theme;
      if (notifySelection) {
        onLanguagePreferenceSelected(language);
        onThemePreferenceSelected(theme);
      }
      return { language, theme };
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
      } else if (appReady) {
        setStatusMessage('');
      } else if (signedIn && requirePlatformMedia && !platformMediaReady) {
        setStatusMessage(configMessage);
      } else if (configMessage) {
        setStatusMessage(configMessage);
      } else {
        setStatusMessage('');
      }

      if (signedIn) {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('fabercode:onboarding-completed', 'true');
        }
        if (elements.wizard) elements.wizard.classList.add('hidden');
      } else {
        if (elements.wizard) elements.wizard.classList.remove('hidden');
        renderFlowStep();
      }

      if (elements.signOut) elements.signOut.classList.toggle('hidden', !signedIn);
      if (elements.googleLogin) elements.googleLogin.classList.toggle('hidden', signedIn);
      if (elements.githubLogin) elements.githubLogin.classList.toggle('hidden', signedIn);
      if (elements.emailToggle) elements.emailToggle.classList.toggle('hidden', signedIn);
    }

    function getActiveWizardStep() {
      if (flowStep === 'theme') return 'theme';
      if (flowStep === 'entry' || flowStep === 'access' || flowStep === 'login' || flowStep === 'email') return 'entry';
      return 'language';
    }

    function updateWizardProgress(activeStep) {
      const activeIndex = ['language', 'theme', 'entry'].indexOf(activeStep);
      if (!elements.stepPills || !elements.stepPills.length) return;
      elements.stepPills.forEach((pill) => {
        if (!pill) return;
        const step = String(pill.getAttribute('data-account-gate-step') || '').trim();
        const stepIndex = ['language', 'theme', 'entry'].indexOf(step);
        pill.classList.toggle('is-active', step === activeStep);
        pill.classList.toggle('is-complete', stepIndex !== -1 && activeIndex !== -1 && stepIndex < activeIndex);
      });
    }

    function renderEmailFormState() {
      const signupMode = authMode === 'signup';
      if (elements.formEyebrow) {
        elements.formEyebrow.textContent = signupMode ? 'Novo usuário' : 'Acesso existente';
      }
      if (elements.formTitle) {
        elements.formTitle.textContent = signupMode ? 'Criar conta com e-mail' : 'Entrar com e-mail';
      }
      if (elements.formCopy) {
        elements.formCopy.textContent = signupMode
          ? 'Crie sua conta e siga com as preferências já escolhidas.'
          : 'Use sua conta existente para continuar.';
      }
      if (elements.signupFields) elements.signupFields.classList.toggle('hidden', !signupMode);
      if (elements.emailSubmit) elements.emailSubmit.textContent = signupMode ? 'Criar conta' : 'Entrar';
      if (elements.createToggle) {
        elements.createToggle.textContent = signupMode
          ? 'Já tem uma conta? Voltar para o login.'
          : 'Não tem uma conta? Crie aqui.';
      }
      if (elements.passwordInput) {
        elements.passwordInput.setAttribute('autocomplete', signupMode ? 'new-password' : 'current-password');
      }
    }

    const GATE_TRANSLATIONS = {
      'pt-BR': {
        eyebrowLang: 'Etapa 1 de 3',
        titleLang: 'Escolha o idioma',
        copyLang: 'A interface e as mensagens iniciais seguem essa escolha.',
        langPtTitle: 'Português (Brasil)',
        langPtDesc: 'Interface e mensagens em português',
        langEnTitle: 'English',
        langEnDesc: 'Interface and messages in English',
        langEsTitle: 'Español',
        langEsDesc: 'Interfaz e mensagens em espanhol',
        btnContinue: 'Continuar',

        eyebrowTheme: 'Etapa 2 de 3',
        titleTheme: 'Escolha o tema',
        copyTheme: 'Use escuro ou claro de acordo com o seu ambiente de trabalho.',
        themeDarkTitle: 'Escuro',
        themeDarkDesc: 'Tema escuro ideal para programar',
        themeLightTitle: 'Claro',
        themeLightDesc: 'Tema claro com foco em contraste',
        btnBack: 'Voltar',

        eyebrowEntry: 'Etapa 3 de 3',
        titleEntry: 'Como prefere iniciar?',
        copyEntry: 'Escolha se deseja começar com o tutorial guiado da ferramenta ou ir direto para o uso.',
        newUserTitle: 'Novo usuário',
        newUserDesc: 'Quero ver o tutorial guiado da ferramenta',
        existingUserTitle: 'Já sou um usuário',
        existingUserDesc: 'Quero ir direto para o uso da ferramenta',

        eyebrowAccess: 'Acesso',
        titleAccess: 'Escolha como acessar',
        copyAccess: 'Escolha seu método preferido para entrar ou criar sua conta.',
        accessLoginEmailTitle: 'Entrar com e-mail',
        accessLoginEmailDesc: 'Usar login tradicional com e-mail e senha',
        accessSignupEmailTitle: 'Criar conta com e-mail',
        accessSignupEmailDesc: 'Cadastro rápido usando e-mail e senha',
        accessGoogleTitle: 'Entrar com o Google',
        accessGoogleDesc: 'Acessar usando sua conta Google',
        accessGithubTitle: 'Entrar com GitHub',
        accessGithubDesc: 'Acessar usando seu perfil GitHub',

        eyebrowFormSignup: 'Novo usuário',
        titleFormSignup: 'Criar conta com e-mail',
        copyFormSignup: 'Crie sua conta e siga com as preferências já escolhidas.',
        btnSubmitSignup: 'Criar conta',
        toggleToLogin: 'Já tem uma conta? Voltar para o login.',

        eyebrowFormLogin: 'Acesso existente',
        titleFormLogin: 'Entrar com e-mail',
        copyFormLogin: 'Use sua conta existente para continuar.',
        btnSubmitLogin: 'Entrar',
        toggleToSignup: 'Não tem uma conta? Crie aqui.',

        labelEmail: 'E-mail',
        labelPassword: 'Senha',
        labelFirstName: 'Nome',
        labelLastName: 'Sobrenome',
        placeholderEmail: 'voce@email.com',
        placeholderPassword: 'Sua senha',
        placeholderFirstName: 'Seu nome',
        placeholderLastName: 'Seu sobrenome',
      },
      'en-US': {
        eyebrowLang: 'Step 1 of 3',
        titleLang: 'Choose language',
        copyLang: 'The interface and initial messages follow this choice.',
        langPtTitle: 'Português (Brasil)',
        langPtDesc: 'Interface and messages in Portuguese',
        langEnTitle: 'English',
        langEnDesc: 'Interface and messages in English',
        langEsTitle: 'Español',
        langEsDesc: 'Interface and messages in Spanish',
        btnContinue: 'Continue',

        eyebrowTheme: 'Step 2 of 3',
        titleTheme: 'Choose theme',
        copyTheme: 'Use dark or light according to your work environment.',
        themeDarkTitle: 'Dark',
        themeDarkDesc: 'Dark theme ideal for programming',
        themeLightTitle: 'Light',
        themeLightDesc: 'Light theme focused on contrast',
        btnBack: 'Back',

        eyebrowEntry: 'Step 3 of 3',
        titleEntry: 'How do you prefer to start?',
        copyEntry: 'Choose whether you want to start with the guided tutorial or go straight to using the tool.',
        newUserTitle: 'New user',
        newUserDesc: 'I want to see the guided tutorial of the tool',
        existingUserTitle: 'Already a user',
        existingUserDesc: 'I want to go straight to using the tool',

        eyebrowAccess: 'Access',
        titleAccess: 'Choose how to access',
        copyAccess: 'Choose your preferred method to sign in or create your account.',
        accessLoginEmailTitle: 'Sign in with email',
        accessLoginEmailDesc: 'Use traditional login with email and password',
        accessSignupEmailTitle: 'Create account with email',
        accessSignupEmailDesc: 'Quick registration using email and password',
        accessGoogleTitle: 'Sign in with Google',
        accessGoogleDesc: 'Access using your Google account',
        accessGithubTitle: 'Sign in with GitHub',
        accessGithubDesc: 'Access using your GitHub profile',

        eyebrowFormSignup: 'New User',
        titleFormSignup: 'Create account with email',
        copyFormSignup: 'Create your account and proceed with the chosen preferences.',
        btnSubmitSignup: 'Create account',
        toggleToLogin: 'Already have an account? Back to login.',

        eyebrowFormLogin: 'Existing Access',
        titleFormLogin: 'Sign in with email',
        copyFormLogin: 'Use your existing account to continue.',
        btnSubmitLogin: 'Sign in',
        toggleToSignup: "Don't have an account? Create here.",

        labelEmail: 'Email',
        labelPassword: 'Password',
        labelFirstName: 'First Name',
        labelLastName: 'Last Name',
        placeholderEmail: 'you@email.com',
        placeholderPassword: 'Your password',
        placeholderFirstName: 'Your first name',
        placeholderLastName: 'Your last name',
      },
      'es-ES': {
        eyebrowLang: 'Etapa 1 de 3',
        titleLang: 'Seleccione idioma',
        copyLang: 'La interfaz y los mensagens iniciales siguen esta elección.',
        langPtTitle: 'Português (Brasil)',
        langPtDesc: 'Interfaz y mensajes en portugués',
        langEnTitle: 'English',
        langEnDesc: 'Interfaz y mensajes en inglés',
        langEsTitle: 'Español',
        langEsDesc: 'Interfaz y mensajes en español',
        btnContinue: 'Continuar',

        eyebrowTheme: 'Etapa 2 de 3',
        titleTheme: 'Seleccione tema',
        copyTheme: 'Use oscuro o claro de acuerdo con su entorno de trabajo.',
        themeDarkTitle: 'Oscuro',
        themeDarkDesc: 'Tema oscuro ideal para programar',
        themeLightTitle: 'Claro',
        themeLightDesc: 'Tema claro centrado en el contraste',
        btnBack: 'Atrás',

        eyebrowEntry: 'Etapa 3 de 3',
        titleEntry: '¿Cómo prefiere iniciar?',
        copyEntry: 'Elija se desea comenzar con el tutorial guiado de la herramienta o ir directo al uso.',
        newUserTitle: 'Nuevo usuario',
        newUserDesc: 'Quiero ver el tutorial guiado de la herramienta',
        existingUserTitle: 'Ya soy un usuario',
        existingUserDesc: 'Quiero ir directo al uso de la herramienta',

        eyebrowAccess: 'Acceso',
        titleAccess: 'Elija cómo acceder',
        copyAccess: 'Elija su método preferido para iniciar sesión o crear su cuenta.',
        accessLoginEmailTitle: 'Iniciar sesión con correo',
        accessLoginEmailDesc: 'Usar inicio de sesión tradicional con correo y contraseña',
        accessSignupEmailTitle: 'Crear cuenta com correo',
        accessSignupEmailDesc: 'Registro rápido usando correo y contraseña',
        accessGoogleTitle: 'Iniciar sesión con Google',
        accessGoogleDesc: 'Acceder usando su cuenta de Google',
        accessGithubTitle: 'Iniciar sesión con GitHub',
        accessGithubDesc: 'Acceder usando su perfil de GitHub',

        eyebrowFormSignup: 'Nuevo usuario',
        titleFormSignup: 'Crear conta com e-mail',
        copyFormSignup: 'Cree su cuenta y continúe con las preferencias elegidas.',
        btnSubmitSignup: 'Crear cuenta',
        toggleToLogin: '¿Ya tiene una cuenta? Volver a iniciar sesión.',

        eyebrowFormLogin: 'Acceso existente',
        titleFormLogin: 'Iniciar sesión con correo',
        copyFormLogin: 'Use su cuenta existente para continuar.',
        btnSubmitLogin: 'Iniciar sesión',
        toggleToSignup: '¿No tiene una cuenta? Regístrese aquí.',

        labelEmail: 'Correo electrónico',
        labelPassword: 'Contraseña',
        labelFirstName: 'Nombre',
        labelLastName: 'Apellido',
        placeholderEmail: 'tu@email.com',
        placeholderPassword: 'Tu contraseña',
        placeholderFirstName: 'Tu nombre',
        placeholderLastName: 'Tu apellido',
      }
    };

    function translateGate(locale) {
      const strings = GATE_TRANSLATIONS[locale] || GATE_TRANSLATIONS['pt-BR'];

      // Eyebrows
      const eyebrowLang = doc.getElementById('account-gate-language-eyebrow');
      const eyebrowTheme = doc.getElementById('account-gate-theme-eyebrow');
      const eyebrowEntry = doc.getElementById('account-gate-entry-eyebrow');
      if (eyebrowLang) eyebrowLang.textContent = strings.eyebrowLang;
      if (eyebrowTheme) eyebrowTheme.textContent = strings.eyebrowTheme;
      if (eyebrowEntry) eyebrowEntry.textContent = strings.eyebrowEntry;

      // Language screen
      const titleLang = doc.getElementById('account-gate-language-title');
      const copyLang = doc.getElementById('account-gate-language-copy');
      const langPtStrong = doc.getElementById('account-gate-lang-pt-title');
      const langPtSpan = doc.getElementById('account-gate-lang-pt-desc');
      const langEnStrong = doc.getElementById('account-gate-lang-en-title');
      const langEnSpan = doc.getElementById('account-gate-lang-en-desc');
      const langEsStrong = doc.getElementById('account-gate-lang-es-title');
      const langEsSpan = doc.getElementById('account-gate-lang-es-desc');
      if (titleLang) titleLang.textContent = strings.titleLang;
      if (copyLang) copyLang.textContent = strings.copyLang;
      if (langPtStrong) langPtStrong.textContent = strings.langPtTitle;
      if (langPtSpan) langPtSpan.textContent = strings.langPtDesc;
      if (langEnStrong) langEnStrong.textContent = strings.langEnTitle;
      if (langEnSpan) langEnSpan.textContent = strings.langEnDesc;
      if (langEsStrong) langEsStrong.textContent = strings.langEsTitle;
      if (langEsSpan) langEsSpan.textContent = strings.langEsDesc;
      if (elements.languageNext) elements.languageNext.textContent = strings.btnContinue;

      // Theme screen
      const titleTheme = doc.getElementById('account-gate-theme-title');
      const copyTheme = doc.getElementById('account-gate-theme-copy');
      const themeDarkStrong = doc.getElementById('account-gate-theme-dark-title');
      const themeDarkSpan = doc.getElementById('account-gate-theme-dark-desc');
      const themeLightStrong = doc.getElementById('account-gate-theme-light-title');
      const themeLightSpan = doc.getElementById('account-gate-theme-light-desc');
      if (titleTheme) titleTheme.textContent = strings.titleTheme;
      if (copyTheme) copyTheme.textContent = strings.copyTheme;
      if (themeDarkStrong) themeDarkStrong.textContent = strings.themeDarkTitle;
      if (themeDarkSpan) themeDarkSpan.textContent = strings.themeDarkDesc;
      if (themeLightStrong) themeLightStrong.textContent = strings.themeLightTitle;
      if (themeLightSpan) themeLightSpan.textContent = strings.themeLightDesc;
      if (elements.themeNext) elements.themeNext.textContent = strings.btnContinue;

      // Entry screen
      const titleEntry = doc.getElementById('account-gate-entry-title');
      const copyEntry = doc.getElementById('account-gate-entry-copy');
      const newUserStrong = doc.getElementById('account-gate-new-user-title');
      const newUserSpan = doc.getElementById('account-gate-new-user-desc');
      const existingUserStrong = doc.getElementById('account-gate-existing-user-title');
      const existingUserSpan = doc.getElementById('account-gate-existing-user-desc');
      if (titleEntry) titleEntry.textContent = strings.titleEntry;
      if (copyEntry) copyEntry.textContent = strings.copyEntry;
      if (newUserStrong) newUserStrong.textContent = strings.newUserTitle;
      if (newUserSpan) newUserSpan.textContent = strings.newUserDesc;
      if (existingUserStrong) existingUserStrong.textContent = strings.existingUserTitle;
      if (existingUserSpan) existingUserSpan.textContent = strings.existingUserDesc;
      if (elements.entryNext) elements.entryNext.textContent = strings.btnContinue;

      // Access screen
      const eyebrowAccess = doc.getElementById('account-gate-access-eyebrow');
      const titleAccess = doc.getElementById('account-gate-access-title');
      const copyAccess = doc.getElementById('account-gate-access-copy');
      const loginEmailTitle = doc.getElementById('account-gate-access-login-email-title');
      const loginEmailDesc = doc.getElementById('account-gate-access-login-email-desc');
      const signupEmailTitle = doc.getElementById('account-gate-access-signup-email-title');
      const signupEmailDesc = doc.getElementById('account-gate-access-signup-email-desc');
      const googleTitle = doc.getElementById('account-gate-access-google-title');
      const googleDesc = doc.getElementById('account-gate-access-google-desc');
      const githubTitle = doc.getElementById('account-gate-access-github-title');
      const githubDesc = doc.getElementById('account-gate-access-github-desc');
      if (eyebrowAccess) eyebrowAccess.textContent = strings.eyebrowAccess;
      if (titleAccess) titleAccess.textContent = strings.titleAccess;
      if (copyAccess) copyAccess.textContent = strings.copyAccess;
      if (loginEmailTitle) loginEmailTitle.textContent = strings.accessLoginEmailTitle;
      if (loginEmailDesc) loginEmailDesc.textContent = strings.accessLoginEmailDesc;
      if (signupEmailTitle) signupEmailTitle.textContent = strings.accessSignupEmailTitle;
      if (signupEmailDesc) signupEmailDesc.textContent = strings.accessSignupEmailDesc;
      if (googleTitle) googleTitle.textContent = strings.accessGoogleTitle;
      if (googleDesc) googleDesc.textContent = strings.accessGoogleDesc;
      if (githubTitle) githubTitle.textContent = strings.accessGithubTitle;
      if (githubDesc) githubDesc.textContent = strings.accessGithubDesc;

      // Email Form
      const labelEmail = doc.getElementById('account-gate-label-email');
      const labelPassword = doc.getElementById('account-gate-label-password');
      const labelFirstName = doc.getElementById('account-gate-label-first-name');
      const labelLastName = doc.getElementById('account-gate-label-last-name');
      if (labelEmail) labelEmail.textContent = strings.labelEmail;
      if (labelPassword) labelPassword.textContent = strings.labelPassword;
      if (labelFirstName) labelFirstName.textContent = strings.labelFirstName;
      if (labelLastName) labelLastName.textContent = strings.labelLastName;
      if (elements.emailInput) elements.emailInput.placeholder = strings.placeholderEmail;
      if (elements.passwordInput) elements.passwordInput.placeholder = strings.placeholderPassword;
      if (elements.firstNameInput) elements.firstNameInput.placeholder = strings.placeholderFirstName;
      if (elements.lastNameInput) elements.lastNameInput.placeholder = strings.placeholderLastName;

      if (authMode === 'signup') {
        if (elements.formEyebrow) elements.formEyebrow.textContent = strings.eyebrowFormSignup;
        if (elements.formTitle) elements.formTitle.textContent = strings.titleFormSignup;
        if (elements.formCopy) elements.formCopy.textContent = strings.copyFormSignup;
        if (elements.emailSubmit) elements.emailSubmit.textContent = strings.btnSubmitSignup;
        if (elements.createToggle) elements.createToggle.textContent = strings.toggleToLogin;
      } else {
        if (elements.formEyebrow) elements.formEyebrow.textContent = strings.eyebrowFormLogin;
        if (elements.formTitle) elements.formTitle.textContent = strings.titleFormLogin;
        if (elements.formCopy) elements.formCopy.textContent = strings.copyFormLogin;
        if (elements.emailSubmit) elements.emailSubmit.textContent = strings.btnSubmitLogin;
        if (elements.createToggle) elements.createToggle.textContent = strings.toggleToSignup;
      }
    }

    function renderFlowStep() {
      const signedIn = isSignedIn(currentStatus);
      const showWizard = !signedIn;
      if (elements.wizard) elements.wizard.classList.toggle('hidden', !showWizard);
      if (!showWizard) return;

      if (elements.languageScreen) elements.languageScreen.classList.toggle('hidden', flowStep !== 'language');
      if (elements.themeScreen) elements.themeScreen.classList.toggle('hidden', flowStep !== 'theme');
      if (elements.entryScreen) elements.entryScreen.classList.toggle('hidden', flowStep !== 'entry');
      if (elements.accessScreen) elements.accessScreen.classList.toggle('hidden', flowStep !== 'access');
      if (elements.signupChoiceScreen) elements.signupChoiceScreen.classList.toggle('hidden', flowStep !== 'signup_choice' && flowStep !== 'access');
      if (elements.loginScreen) elements.loginScreen.classList.toggle('hidden', flowStep !== 'login' && flowStep !== 'access');
      if (elements.emailForm) elements.emailForm.classList.toggle('hidden', flowStep !== 'email');

      if (elements.backArrow) {
        elements.backArrow.classList.toggle('hidden', flowStep === 'language');
      }

      updateWizardProgress(getActiveWizardStep());
      if (flowStep === 'email') renderEmailFormState();

      const langCode = elements.onboardingLanguageSelect ? elements.onboardingLanguageSelect.value : 'pt-BR';
      translateGate(langCode);

      // Highlight selected language card
      if (elements.onboardingLanguageSelect) {
        const currentLang = elements.onboardingLanguageSelect.value;
        const langPt = doc.getElementById('account-gate-lang-pt');
        const langEn = doc.getElementById('account-gate-lang-en');
        const langEs = doc.getElementById('account-gate-lang-es');
        if (langPt) langPt.classList.toggle('is-selected', currentLang === 'pt-BR');
        if (langEn) langEn.classList.toggle('is-selected', currentLang === 'en-US');
        if (langEs) langEs.classList.toggle('is-selected', currentLang === 'es-ES');
      }
      // Highlight selected theme card
      if (elements.onboardingThemeSelect) {
        const currentTheme = elements.onboardingThemeSelect.value;
        const themeDark = doc.getElementById('account-gate-theme-dark-btn');
        const themeLight = doc.getElementById('account-gate-theme-light-btn');
        if (themeDark) themeDark.classList.toggle('is-selected', currentTheme === 'dark');
        if (themeLight) themeLight.classList.toggle('is-selected', currentTheme === 'light');
      }
      // Highlight selected user tutorial profile card
      const newUserCard = doc.getElementById('account-gate-new-user');
      const existingUserCard = doc.getElementById('account-gate-existing-user');
      if (newUserCard) newUserCard.classList.toggle('is-selected', wantsTutorial === true);
      if (existingUserCard) existingUserCard.classList.toggle('is-selected', wantsTutorial === false);
    }

    function showLanguageScreen() {
      flowStep = 'language';
      authMode = 'login';
      renderFlowStep();
    }

    function showThemeScreen() {
      flowStep = 'theme';
      authMode = 'login';
      renderFlowStep();
    }

    function showEntryScreen() {
      flowStep = 'entry';
      authMode = 'login';
      renderFlowStep();
    }

    function showAccessScreen() {
      flowStep = 'access';
      authMode = 'login';
      renderFlowStep();
    }

    function showSignupChoiceScreen() {
      showAccessScreen();
    }

    function showLoginScreen() {
      showAccessScreen();
    }

    function showEmailForm(nextMode = 'login', returnStep = null) {
      flowStep = 'email';
      authMode = nextMode === 'signup' ? 'signup' : 'login';
      if (returnStep) emailReturnStep = returnStep;
      renderFlowStep();
      if (elements.emailInput && typeof elements.emailInput.focus === 'function') elements.emailInput.focus();
    }

    function showIntro() {
      showLanguageScreen();
    }

    function showChoices() {
      showEntryScreen();
    }

    function toggleCreateMode() {
      showEmailForm(authMode === 'signup' ? 'login' : 'signup', emailReturnStep);
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
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('fabercode:wants-tutorial', String(wantsTutorial));
      }
      if (!api || typeof api.startGoogleLogin !== 'function') {
        const message = 'Login Google indisponivel neste build.';
        renderStatus(currentStatus, message);
        notify(message);
        return null;
      }

      setBusy(true);
      try {
        applyWorkspacePreference();
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

    async function startGithubLogin() {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('fabercode:wants-tutorial', String(wantsTutorial));
      }
      if (!api || typeof api.startGithubAccountLogin !== 'function') {
        const message = 'Login GitHub indisponivel neste build.';
        renderStatus(currentStatus, message);
        notify(message);
        return null;
      }

      setBusy(true);
      try {
        applyWorkspacePreference();
        const result = await api.startGithubAccountLogin({ openExternal: true });
        if (!result || !result.ok) {
          const message = formatGithubSetupMessage(result || {});
          renderStatus(currentStatus, message);
          notify(message);
          return result || null;
        }
        renderStatus(currentStatus, 'Conclua o login no GitHub para continuar.');
        return result;
      } catch {
        const message = 'Falha ao abrir o login GitHub.';
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
        const preferences = applyOnboardingPreferences();
        const firstName = elements.firstNameInput ? String(elements.firstNameInput.value || '').trim() : '';
        const lastName = elements.lastNameInput ? String(elements.lastNameInput.value || '').trim() : '';
        payload.name = `${firstName} ${lastName}`.trim() || (elements.fullNameInput ? String(elements.fullNameInput.value || '').trim() : '');
        payload.themePreference = preferences.theme;
        payload.languagePreference = preferences.language;
        applyWorkspacePreference();
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
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('fabercode:wants-tutorial', String(wantsTutorial));
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
      
      const onboardingCompleted = typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('fabercode:onboarding-completed') === 'true';
      if (onboardingCompleted) {
        showAccessScreen();
      } else {
        showLanguageScreen();
      }

      // Card-selection handlers (no auto-advance, highlight card click instead)
      const langPt = doc.getElementById('account-gate-lang-pt');
      const langEn = doc.getElementById('account-gate-lang-en');
      const langEs = doc.getElementById('account-gate-lang-es');
      const themeDark = doc.getElementById('account-gate-theme-dark-btn');
      const themeLight = doc.getElementById('account-gate-theme-light-btn');

      if (langPt) {
        langPt.addEventListener('click', () => {
          if (elements.onboardingLanguageSelect) {
            elements.onboardingLanguageSelect.value = 'pt-BR';
            elements.onboardingLanguageSelect.dispatchEvent(new Event('change'));
          }
          renderFlowStep();
        });
      }
      if (langEn) {
        langEn.addEventListener('click', () => {
          if (elements.onboardingLanguageSelect) {
            elements.onboardingLanguageSelect.value = 'en-US';
            elements.onboardingLanguageSelect.dispatchEvent(new Event('change'));
          }
          renderFlowStep();
        });
      }
      if (langEs) {
        langEs.addEventListener('click', () => {
          if (elements.onboardingLanguageSelect) {
            elements.onboardingLanguageSelect.value = 'es-ES';
            elements.onboardingLanguageSelect.dispatchEvent(new Event('change'));
          }
          renderFlowStep();
        });
      }

      if (themeDark) {
        themeDark.addEventListener('click', () => {
          if (elements.onboardingThemeSelect) {
            elements.onboardingThemeSelect.value = 'dark';
            elements.onboardingThemeSelect.dispatchEvent(new Event('change'));
          }
          renderFlowStep();
        });
      }
      if (themeLight) {
        themeLight.addEventListener('click', () => {
          if (elements.onboardingThemeSelect) {
            elements.onboardingThemeSelect.value = 'light';
            elements.onboardingThemeSelect.dispatchEvent(new Event('change'));
          }
          renderFlowStep();
        });
      }

      if (elements.onboardingLanguageSelect) {
        elements.onboardingLanguageSelect.addEventListener('change', () => {
          applyOnboardingPreferences({ notifySelection: true });
        });
      }
      if (elements.onboardingThemeSelect) {
        elements.onboardingThemeSelect.addEventListener('change', () => {
          applyOnboardingPreferences({ notifySelection: true });
        });
      }

      // Next buttons
      if (elements.languageNext) {
        elements.languageNext.addEventListener('click', () => {
          showThemeScreen();
        });
      }
      if (elements.themeNext) {
        elements.themeNext.addEventListener('click', () => {
          showEntryScreen();
        });
      }

      // Top-left dynamic back arrow routing
      if (elements.backArrow) {
        elements.backArrow.addEventListener('click', () => {
          if (flowStep === 'theme') {
            showLanguageScreen();
          } else if (flowStep === 'entry') {
            showThemeScreen();
          } else if (flowStep === 'access') {
            showEntryScreen();
          } else if (flowStep === 'email') {
            showAccessScreen();
          }
        });
      }

      // Entry screen choice actions (Tutorial selector)
      if (elements.newUser) {
        elements.newUser.addEventListener('click', () => {
          wantsTutorial = true;
          renderFlowStep();
        });
      }
      if (elements.existingUser) {
        elements.existingUser.addEventListener('click', () => {
          wantsTutorial = false;
          renderFlowStep();
        });
      }
      if (elements.entryNext) {
        elements.entryNext.addEventListener('click', () => {
          showAccessScreen();
        });
      }

      // Step 4 unified access screen handlers
      if (elements.accessLoginEmailBtn) {
        elements.accessLoginEmailBtn.addEventListener('click', () => {
          showEmailForm('login', 'access');
        });
      }
      if (elements.accessSignupEmailBtn) {
        elements.accessSignupEmailBtn.addEventListener('click', () => {
          showEmailForm('signup', 'access');
        });
      }
      if (elements.accessGoogleBtn) {
        elements.accessGoogleBtn.addEventListener('click', async () => {
          await startGoogleLogin();
        });
      }
      if (elements.accessGithubBtn) {
        elements.accessGithubBtn.addEventListener('click', async () => {
          await startGithubLogin();
        });
      }

      if (elements.createToggle) {
        elements.createToggle.addEventListener('click', () => {
          toggleCreateMode();
        });
      }
      if (elements.emailForm) {
        elements.emailForm.addEventListener('submit', async (event) => {
          if (event && typeof event.preventDefault === 'function') event.preventDefault();
          await submitEmailForm();
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
        showEntryScreen,
        showChoices,
        showIntro,
        showEmailForm,
        showLanguageScreen,
        showLoginScreen,
        showThemeScreen,
        signOut,
        startGithubLogin,
        startGoogleLogin,
        submitEmailForm,
    };
  }

  window.FaberAccountGate = {
    createAccountGateController,
    formatGithubSetupMessage,
    getPreferredDeviceLanguage,
    getPreferredSignupLanguage,
    hasPlatformMedia,
    isSignedIn,
    normalizeLanguagePreference,
    normalizeWorkspacePreference,
  };
})();

function registerAccountHandlers(dependencies = {}) {
  const {
    accountService,
    appendAuditEvent = () => {},
    emitAccountEvent = () => {},
    registerIpcHandler,
    shell = null,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Account IPC dependency missing: ${name}`);
  }

  requireDependency('accountService', accountService);
  requireDependency('registerIpcHandler', registerIpcHandler);

  registerIpcHandler('account:status', async () => {
    return accountService.getStatus();
  });

  registerIpcHandler('account:google:start', async (_, payload = {}) => {
    const request = accountService.createGoogleLoginRequest(payload || {});
    if (!request.ok) return request;
    if (payload && payload.openExternal && shell && typeof shell.openExternal === 'function') {
      await shell.openExternal(request.url);
    }
    appendAuditEvent('account.google_login_started', {
      redirectUri: request.redirectUri,
      openExternal: Boolean(payload && payload.openExternal),
    });
    return request;
  });

  registerIpcHandler('account:google:complete', async (_, payload = {}) => {
    const result = await accountService.exchangeGoogleCode(payload || {});
    appendAuditEvent(result.ok ? 'account.google_login_completed' : 'account.google_login_failed', {
      ok: Boolean(result.ok),
      message: result.ok ? null : result.message || null,
    });
    if (result.ok) emitAccountEvent({ type: 'signed-in', provider: 'google' });
    return result;
  });

  registerIpcHandler('account:email:start', async (_, payload = {}) => {
    const result = accountService.startEmailLogin(payload || {});
    appendAuditEvent(result.ok ? 'account.email_login_started' : 'account.email_login_failed', {
      ok: Boolean(result.ok),
      email: result.email || null,
      message: result.ok ? null : result.message || null,
    });
    return result;
  });

  registerIpcHandler('account:email:complete', async (_, payload = {}) => {
    const result = await accountService.completeEmailLogin(payload || {});
    appendAuditEvent(result.ok ? 'account.email_login_completed' : 'account.email_login_failed', {
      ok: Boolean(result.ok),
      message: result.ok ? null : result.message || null,
    });
    if (result.ok) emitAccountEvent({ type: 'signed-in', provider: 'email' });
    return result;
  });

  registerIpcHandler('account:password:sign-in', async (_, payload = {}) => {
    const result = await accountService.signInWithPassword(payload || {});
    appendAuditEvent(result.ok ? 'account.password_sign_in_completed' : 'account.password_sign_in_failed', {
      ok: Boolean(result.ok),
      email: payload && payload.email ? String(payload.email).trim().toLowerCase() : null,
      message: result.ok ? null : result.message || null,
    });
    if (result.ok) emitAccountEvent({ type: 'signed-in', provider: 'password' });
    return result;
  });

  registerIpcHandler('account:password:sign-up', async (_, payload = {}) => {
    const result = await accountService.signUpWithPassword(payload || {});
    appendAuditEvent(result.ok ? 'account.password_sign_up_completed' : 'account.password_sign_up_failed', {
      ok: Boolean(result.ok),
      email: payload && payload.email ? String(payload.email).trim().toLowerCase() : null,
      message: result.ok ? null : result.message || null,
    });
    if (result.ok) emitAccountEvent({ type: 'signed-in', provider: 'password' });
    return result;
  });

  registerIpcHandler('account:sign-out', async () => {
    const result = await accountService.signOut();
    appendAuditEvent('account.signed_out', { ok: Boolean(result.ok) });
    if (result.ok) emitAccountEvent({ type: 'signed-out' });
    return result;
  });
}

module.exports = {
  registerAccountHandlers,
};

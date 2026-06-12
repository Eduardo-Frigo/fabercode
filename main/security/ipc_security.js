function createIpcSecurity(dependencies = {}) {
  const {
    getMainWindow = () => null,
  } = dependencies;

  function validateSender(event) {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, message: 'Janela principal indisponível para validar IPC.' };
    }

    if (!event || event.sender !== mainWindow.webContents) {
      return { ok: false, message: 'Canal IPC rejeitado: origem não autorizada.' };
    }

    return { ok: true };
  }

  function wrapHandler(handler) {
    return async (event, ...args) => {
      const senderValidation = validateSender(event);
      if (!senderValidation.ok) return senderValidation;
      return handler(event, ...args);
    };
  }

  return {
    validateSender,
    wrapHandler,
  };
}

module.exports = {
  createIpcSecurity,
};

function createSecretStore(dependencies = {}) {
  const {
    safeStorage,
  } = dependencies;

  function canEncrypt() {
    return Boolean(
      safeStorage &&
        typeof safeStorage.isEncryptionAvailable === 'function' &&
        safeStorage.isEncryptionAvailable() &&
        typeof safeStorage.encryptString === 'function' &&
        typeof safeStorage.decryptString === 'function'
    );
  }

  function encodeBase64(value) {
    return Buffer.from(String(value || ''), 'utf8').toString('base64');
  }

  function decodeBase64(value) {
    return Buffer.from(String(value || ''), 'base64').toString('utf8');
  }

  function protectSecret(value) {
    const text = String(value || '').trim();
    if (!text) return '';

    if (canEncrypt()) {
      const encrypted = safeStorage.encryptString(text);
      return `enc:v1:${encrypted.toString('base64')}`;
    }

    return `plain:v1:${encodeBase64(text)}`;
  }

  function unprotectSecret(value) {
    const text = String(value || '').trim();
    if (!text) return '';

    if (text.startsWith('enc:v1:')) {
      if (!canEncrypt()) return '';
      try {
        const encrypted = Buffer.from(text.slice('enc:v1:'.length), 'base64');
        return safeStorage.decryptString(encrypted).trim();
      } catch {
        return '';
      }
    }

    if (text.startsWith('plain:v1:')) {
      try {
        return decodeBase64(text.slice('plain:v1:'.length)).trim();
      } catch {
        return '';
      }
    }

    return text;
  }

  return {
    canEncrypt,
    protectSecret,
    unprotectSecret,
  };
}

module.exports = {
  createSecretStore,
};

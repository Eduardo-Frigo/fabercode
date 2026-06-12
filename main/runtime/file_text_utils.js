function createFileTextUtils(dependencies = {}) {
  const {
    crypto,
  } = dependencies;

  function clipText(input, max = 4000) {
    const normalized = String(input || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max - 3).trim()}...`;
  }

  function clipTextPreserveLines(input, max = 2600) {
    const normalized = String(input || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u0000/g, '')
      .replace(/[\u2012\u2013\u2014\u2015]/g, '-')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, Math.max(0, max - 14)).trim()}\n\n[...truncado]`;
  }

  function hashText(text) {
    if (!crypto || typeof crypto.createHash !== 'function') {
      throw new Error('file_text_utils requires crypto.createHash');
    }
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  }

  function isTextLikeExtension(ext) {
    return [
      '.txt',
      '.md',
      '.markdown',
      '.js',
      '.ts',
      '.tsx',
      '.jsx',
      '.json',
      '.py',
      '.php',
      '.java',
      '.yml',
      '.yaml',
      '.xml',
      '.html',
      '.css',
      '.scss',
      '.log',
    ].includes(ext);
  }

  return {
    clipText,
    clipTextPreserveLines,
    hashText,
    isTextLikeExtension,
  };
}

module.exports = {
  createFileTextUtils,
};

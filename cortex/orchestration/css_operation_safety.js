function toPosixCssPath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function isCssOperationPath(value = '') {
  return /\.css$/i.test(toPosixCssPath(value));
}

function normalizeCssImportOrder(content = '') {
  const source = String(content || '');
  if (!/@import\b/i.test(source)) return source;

  const normalizedSource = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedSource.split('\n');
  const charsets = [];
  const imports = [];
  const body = [];
  const seenCharsets = new Set();
  const seenImports = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^@charset\b/i.test(trimmed)) {
      const key = trimmed.replace(/\s+/g, ' ');
      if (!seenCharsets.has(key)) {
        seenCharsets.add(key);
        charsets.push(line);
      }
      continue;
    }
    if (/^@import\b/i.test(trimmed)) {
      const key = trimmed.replace(/\s+/g, ' ');
      if (!seenImports.has(key)) {
        seenImports.add(key);
        imports.push(line);
      }
      continue;
    }
    body.push(line);
  }

  while (body.length && body[0].trim() === '') body.shift();
  while (body.length && body[body.length - 1].trim() === '') body.pop();

  const resultLines = [...charsets, ...imports];
  if (resultLines.length && body.length) resultLines.push('');
  resultLines.push(...body);

  return `${resultLines.join('\n')}\n`;
}

function findCssImportOrderViolation(content = '') {
  const lines = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let sawRuleBeforeImport = false;
  let insideBlockComment = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let trimmed = line.trim();
    if (!trimmed) continue;

    if (insideBlockComment) {
      if (trimmed.includes('*/')) insideBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) insideBlockComment = true;
      continue;
    }

    if (/^@import\b/i.test(trimmed)) {
      if (sawRuleBeforeImport) {
        return {
          line: index + 1,
          statement: trimmed.slice(0, 160),
        };
      }
      continue;
    }

    if (/^@charset\b/i.test(trimmed) || /^@layer\b/i.test(trimmed)) {
      continue;
    }

    sawRuleBeforeImport = true;
  }

  return null;
}

module.exports = {
  findCssImportOrderViolation,
  isCssOperationPath,
  normalizeCssImportOrder,
};

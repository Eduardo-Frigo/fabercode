function buildAppendDiffPreview(targetFile, previousContent, appendedBlock) {
  const previousLinesCount = previousContent.length ? previousContent.split('\n').length : 0;
  const addedLines = appendedBlock.split('\n');
  const header = [
    `--- a/${targetFile}`,
    `+++ b/${targetFile}`,
    `@@ -${previousLinesCount},0 +${previousLinesCount + 1},${addedLines.length} @@`,
  ];
  const body = addedLines.map((line) => `+${line}`);
  return [...header, ...body].join('\n');
}

function buildWriteFileDiffPreview(targetFile, previousContent, nextContent) {
  const previousLines = previousContent.length ? previousContent.split('\n') : [];
  const nextLines = nextContent.split('\n');
  const header = [
    `--- a/${targetFile}`,
    `+++ b/${targetFile}`,
    `@@ -1,${previousLines.length} +1,${nextLines.length} @@`,
  ];
  const body = [
    ...previousLines.map((line) => `-${line}`),
    ...nextLines.map((line) => `+${line}`),
  ];
  return [...header, ...body].join('\n');
}

function buildOperationBatchDiffPreview(operations = []) {
  const chunks = [];
  for (const operation of operations) {
    if (operation.op === 'mkdir') {
      chunks.push(`+++ dir/${operation.path}`);
      continue;
    }

    if (operation.op === 'append_file') {
      const lines = String(operation.content || '').split('\n');
      const header = [`--- a/${operation.path}`, `+++ b/${operation.path}`, '@@ append @@'];
      const body = lines.map((line) => `+${line}`).slice(0, 120);
      chunks.push([...header, ...body].join('\n'));
      continue;
    }

    if (operation.op === 'write_file') {
      const lines = String(operation.content || '').split('\n').slice(0, 120);
      const header = [`--- a/${operation.path}`, `+++ b/${operation.path}`, `@@ -0,0 +1,${lines.length} @@`];
      const body = lines.map((line) => `+${line}`);
      chunks.push([...header, ...body].join('\n'));
    }
  }
  return chunks.join('\n');
}

module.exports = {
  buildAppendDiffPreview,
  buildOperationBatchDiffPreview,
  buildWriteFileDiffPreview,
};

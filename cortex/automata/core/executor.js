const DEFAULT_EXCLUDED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.cache']);
const {
  isCssOperationPath,
  normalizeCssImportOrder,
} = require('../../orchestration/css_operation_safety');

const SAFE_SECRET_TEMPLATE_FILES = new Set(['.env.example', '.env.sample', '.env.template']);
const SENSITIVE_FILE_NAMES = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
  'id_rsa',
  'id_ed25519',
  'id_dsa',
  'id_ecdsa',
  'secrets.json',
]);

function normalizeSecurityPath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
}

function isSensitiveAutomataPath(value = '') {
  const normalized = normalizeSecurityPath(value).toLowerCase();
  if (!normalized || SAFE_SECRET_TEMPLATE_FILES.has(normalized)) return false;
  if (normalized === '.env' || /^\.env\./.test(normalized)) return true;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '.git' || part === '.ssh' || part === 'private_context')) return true;
  const fileName = parts[parts.length - 1] || normalized;
  if (SENSITIVE_FILE_NAMES.has(fileName)) return true;
  if (/\.(pem|key|p12|pfx)$/i.test(fileName)) return true;
  return false;
}

function createAutomataExecutor(dependencies = {}) {
  const {
    computeLineChangeStats,
    excludedDirs = DEFAULT_EXCLUDED_DIRS,
    fs,
    hashText,
    ingestRuntimeDiffStats = () => {},
    isTextLikeExtension,
    mergeDiffStatsEntry,
    normalizeRelativePathForDiff,
    normalizeRequestedRelativePath,
    path,
    validateExecutionCommand,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Automata executor dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('fs', fs);
    requireDependency('path', path);
    requireDependency('computeLineChangeStats', computeLineChangeStats);
    requireDependency('hashText', hashText);
    requireDependency('isTextLikeExtension', isTextLikeExtension);
    requireDependency('mergeDiffStatsEntry', mergeDiffStatsEntry);
    requireDependency('normalizeRelativePathForDiff', normalizeRelativePathForDiff);
    requireDependency('normalizeRequestedRelativePath', normalizeRequestedRelativePath);
    requireDependency('validateExecutionCommand', validateExecutionCommand);
  }

  function resolvePatchAbsoluteTarget(action) {
    const directTarget = String((action && action.absoluteTarget) || '').trim();
    if (directTarget) return directTarget;

    const rootPath = String((action && action.rootPath) || '').trim();
    const targetFile = normalizeRequestedRelativePath(action && action.targetFile);
    if (!rootPath || !targetFile) return '';
    return path.join(rootPath, targetFile);
  }

  function blockSensitiveAutomataPath(rawPath) {
    const normalized = normalizeSecurityPath(rawPath);
    if (!isSensitiveAutomataPath(normalized)) return null;
    return {
      ok: false,
      message: `Operação bloqueada em caminho sensível: ${normalized}`,
    };
  }

  function isInsideRoot(rootPath, candidatePath) {
    const root = path.resolve(String(rootPath || ''));
    const candidate = path.resolve(String(candidatePath || ''));
    return candidate === root || candidate.startsWith(root + path.sep);
  }

  function getRealPathIfExists(candidatePath) {
    try {
      return fs.realpathSync(candidatePath);
    } catch {
      return '';
    }
  }

  function findNearestExistingParent(candidatePath, rootPath) {
    let current = path.resolve(path.dirname(candidatePath));
    const root = path.resolve(rootPath);

    while (current && isInsideRoot(root, current)) {
      if (fs.existsSync(current)) return current;
      const next = path.dirname(current);
      if (next === current) break;
      current = next;
    }

    return fs.existsSync(root) ? root : '';
  }

  function resolvePhysicalPathForWrite(rootPath, candidatePath) {
    const rootRealPath = getRealPathIfExists(rootPath);
    if (!rootRealPath) {
      return { ok: false, message: 'A pasta do projeto não está acessível fisicamente.' };
    }

    const absolutePath = path.resolve(candidatePath);
    const physicalPath = fs.existsSync(absolutePath)
      ? getRealPathIfExists(absolutePath)
      : getRealPathIfExists(findNearestExistingParent(absolutePath, rootPath));

    if (!physicalPath || !isInsideRoot(rootRealPath, physicalPath)) {
      return { ok: false, message: 'Operação bloqueada: caminho físico fora da raiz do projeto.' };
    }

    return { ok: true, physicalPath, rootRealPath };
  }

  function getPathKind(candidatePath) {
    if (!fs.existsSync(candidatePath)) return 'missing';
    try {
      const stat = fs.statSync(candidatePath);
      if (stat.isDirectory()) return 'directory';
      if (stat.isFile()) return 'file';
      return 'other';
    } catch {
      return 'other';
    }
  }

  function collectDirectoryChain(rootPath, targetDirectory) {
    const root = path.resolve(String(rootPath || ''));
    const target = path.resolve(String(targetDirectory || ''));
    if (target === root) return [];
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return [];

    const directories = [];
    let current = root;
    for (const part of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      directories.push(current);
    }
    return directories;
  }

  function rememberDirectorySnapshot(directorySnapshots, directoryPath) {
    if (directorySnapshots.has(directoryPath)) return;
    directorySnapshots.set(directoryPath, {
      absolutePath: directoryPath,
      existed: fs.existsSync(directoryPath),
    });
  }

  function prepareOperationBatchTransaction(rootPath, normalizedOperations) {
    if (getPathKind(rootPath) !== 'directory') {
      return { ok: false, message: 'A pasta do projeto não está acessível para executar o lote.' };
    }

    const directorySnapshots = new Map();
    const fileSnapshots = new Map();
    const preparedOperations = [];

    for (const operation of normalizedOperations) {
      const normalizedPath = operation.normalizedPath;
      const sensitivePath = blockSensitiveAutomataPath(normalizedPath);
      if (sensitivePath) return sensitivePath;
      const absolutePath = path.join(rootPath, normalizedPath);
      if (!isInsideRoot(rootPath, absolutePath)) {
        return { ok: false, message: `Operação bloqueada fora da raiz do projeto: ${normalizedPath}` };
      }
      const physicalCheck = resolvePhysicalPathForWrite(rootPath, absolutePath);
      if (!physicalCheck.ok) {
        return { ok: false, message: `${physicalCheck.message} (${normalizedPath})` };
      }

      if (operation.op === 'mkdir') {
        const pathKind = getPathKind(absolutePath);
        if (pathKind === 'file' || pathKind === 'other') {
          return { ok: false, message: `Não foi possível criar pasta sobre arquivo existente: ${normalizedPath}` };
        }

        for (const directoryPath of collectDirectoryChain(rootPath, absolutePath)) {
          const directoryKind = getPathKind(directoryPath);
          if (directoryKind === 'file' || directoryKind === 'other') {
            const rel = path.relative(rootPath, directoryPath) || normalizedPath;
            return { ok: false, message: `Caminho de pasta bloqueado por arquivo existente: ${rel}` };
          }
          rememberDirectorySnapshot(directorySnapshots, directoryPath);
        }
        preparedOperations.push({ ...operation, absolutePath });
        continue;
      }

      if (operation.op === 'delete_file') {
        const targetKind = getPathKind(absolutePath);
        if (targetKind === 'directory' || targetKind === 'other') {
          return { ok: false, message: `Não foi possível deletar pasta usando delete_file: ${normalizedPath}` };
        }
        if (!fileSnapshots.has(absolutePath)) {
          let snapshotContent = '';
          if (targetKind === 'file') {
            try {
              snapshotContent = fs.readFileSync(absolutePath, 'utf8');
            } catch {
              return { ok: false, message: `Não foi possível preparar rollback para arquivo: ${normalizedPath}` };
            }
          }
          fileSnapshots.set(absolutePath, {
            absolutePath,
            existed: targetKind === 'file',
            content: snapshotContent,
          });
        }
        preparedOperations.push({ ...operation, absolutePath });
        continue;
      }

      if (operation.op === 'delete_dir') {
        const targetKind = getPathKind(absolutePath);
        if (targetKind === 'file' || targetKind === 'other') {
          return { ok: false, message: `Não foi possível deletar arquivo usando delete_dir: ${normalizedPath}` };
        }
        if (targetKind === 'directory') {
          rememberDirectorySnapshot(directorySnapshots, absolutePath);
          const backupFilesRecursively = (dirPath) => {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
              const fullPath = path.join(dirPath, item);
              const stat = fs.statSync(fullPath);
              if (stat.isFile()) {
                if (!fileSnapshots.has(fullPath)) {
                  fileSnapshots.set(fullPath, {
                    absolutePath: fullPath,
                    existed: true,
                    content: fs.readFileSync(fullPath, 'utf8'),
                  });
                }
              } else if (stat.isDirectory()) {
                rememberDirectorySnapshot(directorySnapshots, fullPath);
                backupFilesRecursively(fullPath);
              }
            }
          };
          backupFilesRecursively(absolutePath);
        }
        preparedOperations.push({ ...operation, absolutePath });
        continue;
      }

      const targetKind = getPathKind(absolutePath);
      if (targetKind === 'directory' || targetKind === 'other') {
        return { ok: false, message: `Não foi possível escrever sobre caminho não textual: ${normalizedPath}` };
      }

      const directoryPath = path.dirname(absolutePath);
      for (const candidateDirectory of collectDirectoryChain(rootPath, directoryPath)) {
        const directoryKind = getPathKind(candidateDirectory);
        if (directoryKind === 'file' || directoryKind === 'other') {
          const rel = path.relative(rootPath, candidateDirectory) || normalizedPath;
          return { ok: false, message: `Caminho de arquivo bloqueado por arquivo existente: ${rel}` };
        }
        rememberDirectorySnapshot(directorySnapshots, candidateDirectory);
      }

      if (!fileSnapshots.has(absolutePath)) {
        let snapshotContent = '';
        if (targetKind === 'file') {
          try {
            snapshotContent = fs.readFileSync(absolutePath, 'utf8');
          } catch {
            return { ok: false, message: `Não foi possível preparar rollback para arquivo: ${normalizedPath}` };
          }
        }
        fileSnapshots.set(absolutePath, {
          absolutePath,
          existed: targetKind === 'file',
          content: snapshotContent,
        });
      }
      preparedOperations.push({ ...operation, absolutePath });
    }

    return {
      ok: true,
      directorySnapshots: [...directorySnapshots.values()],
      fileSnapshots: [...fileSnapshots.values()],
      operations: preparedOperations,
    };
  }

  function rollbackOperationBatchTransaction(transaction) {
    const errors = [];
    const fileSnapshots = Array.isArray(transaction && transaction.fileSnapshots)
      ? transaction.fileSnapshots.slice().reverse()
      : [];
    for (const snapshot of fileSnapshots) {
      try {
        if (snapshot.existed) {
          const dir = path.dirname(snapshot.absolutePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(snapshot.absolutePath, snapshot.content, 'utf8');
        } else if (fs.existsSync(snapshot.absolutePath)) {
          fs.unlinkSync(snapshot.absolutePath);
        }
      } catch (error) {
        errors.push(`${snapshot.absolutePath}: ${error.message}`);
      }
    }

    const directorySnapshots = Array.isArray(transaction && transaction.directorySnapshots)
      ? transaction.directorySnapshots
          .filter((snapshot) => snapshot && !snapshot.existed)
          .slice()
          .sort((left, right) => right.absolutePath.length - left.absolutePath.length)
      : [];
    for (const snapshot of directorySnapshots) {
      try {
        if (fs.existsSync(snapshot.absolutePath)) {
          fs.rmdirSync(snapshot.absolutePath);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          errors.push(`${snapshot.absolutePath}: ${error.message}`);
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors,
    };
  }

  function executePatchAction(action) {
    assertReady();
    if (!action || action.type !== 'apply_file_patch') {
      return { ok: false, message: 'Ação inválida.' };
    }

    if (String(action.targetFile || '').toUpperCase() === 'LOCALFIX_NOTES.MD') {
      return {
        ok: false,
        message:
          'Bloqueei um patch genérico de notas técnicas para evitar falso positivo de execução. Informe o arquivo alvo exato ou peça uma alteração concreta no projeto.',
      };
    }

    const absoluteTarget = resolvePatchAbsoluteTarget(action);
    if (!absoluteTarget) {
      return { ok: false, message: 'Ação inválida: arquivo alvo absoluto ausente.' };
    }
    if (action.rootPath && !isInsideRoot(action.rootPath, absoluteTarget)) {
      return { ok: false, message: 'Ação bloqueada: arquivo alvo fora da raiz do projeto.' };
    }
    if (action.rootPath) {
      const relativeTarget = path.relative(path.resolve(action.rootPath), path.resolve(absoluteTarget));
      const sensitivePath = blockSensitiveAutomataPath(action.targetFile || relativeTarget);
      if (sensitivePath) return sensitivePath;
    }
    if (action.rootPath) {
      const physicalCheck = resolvePhysicalPathForWrite(action.rootPath, absoluteTarget);
      if (!physicalCheck.ok) {
        return { ok: false, message: physicalCheck.message };
      }
    }

    const dir = path.dirname(absoluteTarget);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const currentContent = fs.existsSync(absoluteTarget) ? fs.readFileSync(absoluteTarget, 'utf8') : '';
    const currentHash = hashText(currentContent);

    if (currentHash !== action.previousContentHash) {
      return {
        ok: false,
        message:
          'O arquivo mudou desde a prévia do patch. Gere um novo plano para evitar sobrescrever alterações recentes.',
      };
    }

    let nextContent = String(action.nextContent || '');
    if (isCssOperationPath(action.targetFile || absoluteTarget)) {
      nextContent = normalizeCssImportOrder(nextContent);
    }
    if (fs.existsSync(absoluteTarget) && currentContent === nextContent) {
      return {
        ok: true,
        modifiedFiles: [],
        diffStats: {},
        message: `Nenhuma alteração de conteúdo em ${action.targetFile}.`,
        humanSummary: action.humanSummary || null,
      };
    }
    fs.writeFileSync(absoluteTarget, nextContent, 'utf8');

    const targetFile = normalizeRelativePathForDiff(action.targetFile || '');
    const diffStats = {};
    if (targetFile) {
      mergeDiffStatsEntry(diffStats, targetFile, computeLineChangeStats(currentContent, nextContent));
    }

    if (action.rootPath && Object.keys(diffStats).length) {
      ingestRuntimeDiffStats(action.rootPath, diffStats);
    }

    return {
      ok: true,
      modifiedFiles: targetFile ? [targetFile] : [],
      diffStats,
      message: `Arquivo atualizado com sucesso: ${action.targetFile}`,
      humanSummary: action.humanSummary || null,
    };
  }

  function executeOperationBatchAction(action) {
    assertReady();
    const rootPath = action.rootPath;
    if (!rootPath || !fs.existsSync(rootPath)) {
      return { ok: false, message: 'A pasta do projeto não está acessível para executar o lote.' };
    }
    if (!Array.isArray(action.operations) || !action.operations.length) {
      return { ok: false, message: 'Lote vazio de operações.' };
    }

    const normalizedOperations = [];
    for (const operation of action.operations) {
      if (!operation || typeof operation !== 'object') {
        return { ok: false, message: 'Operação inválida no lote.' };
      }
      if (!['mkdir', 'write_file', 'append_file', 'delete_file', 'delete_dir'].includes(operation.op)) {
        return { ok: false, message: `Operação de lote não suportada: ${operation.op}` };
      }
      const normalizedPath = normalizeRequestedRelativePath(operation.path);
      if (!normalizedPath) {
        return { ok: false, message: `Caminho inválido no lote: ${operation.path || '<vazio>'}` };
      }
      if ((operation.op === 'write_file' || operation.op === 'append_file') && typeof operation.content !== 'string') {
        return { ok: false, message: `Operação ${operation.op} sem conteúdo textual.` };
      }
      normalizedOperations.push({ ...operation, normalizedPath });
    }

    const transaction = prepareOperationBatchTransaction(rootPath, normalizedOperations);
    if (!transaction.ok) {
      return { ok: false, message: transaction.message };
    }

    const modifiedFiles = [];
    const diffStats = {};
    try {
      for (const operation of transaction.operations) {
        const normalizedPath = operation.normalizedPath;
        const absolutePath = operation.absolutePath;

        if (operation.op === 'mkdir') {
          fs.mkdirSync(absolutePath, { recursive: true });
          continue;
        }

        if (operation.op === 'delete_file') {
          if (fs.existsSync(absolutePath)) {
            fs.rmSync(absolutePath, { force: true });
            const rel = normalizeRelativePathForDiff(normalizedPath);
            modifiedFiles.push(rel);
            mergeDiffStatsEntry(diffStats, rel, { added: 0, deleted: 1 });
          }
          continue;
        }

        if (operation.op === 'delete_dir') {
          if (fs.existsSync(absolutePath)) {
            fs.rmSync(absolutePath, { recursive: true, force: true });
            const rel = normalizeRelativePathForDiff(normalizedPath);
            modifiedFiles.push(rel);
            mergeDiffStatsEntry(diffStats, rel, { added: 0, deleted: 1 });
          }
          continue;
        }

        if (operation.op === 'write_file') {
          const dir = path.dirname(absolutePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const existed = fs.existsSync(absolutePath);
          const previous = existed ? fs.readFileSync(absolutePath, 'utf8') : '';
          let nextContent = String(operation.content || '');
          if (isCssOperationPath(normalizedPath)) {
            nextContent = normalizeCssImportOrder(nextContent);
          }
          if (existed && previous === nextContent) continue;
          fs.writeFileSync(absolutePath, nextContent, 'utf8');
          const rel = normalizeRelativePathForDiff(normalizedPath);
          modifiedFiles.push(rel);
          mergeDiffStatsEntry(diffStats, rel, computeLineChangeStats(previous, nextContent));
          continue;
        }

        if (operation.op === 'append_file') {
          const dir = path.dirname(absolutePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const previous = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
          let nextContent = `${previous}${String(operation.content || '')}`;
          if (isCssOperationPath(normalizedPath)) {
            nextContent = normalizeCssImportOrder(nextContent);
          }
          if (previous === nextContent) continue;
          fs.writeFileSync(absolutePath, nextContent, 'utf8');
          const rel = normalizeRelativePathForDiff(normalizedPath);
          modifiedFiles.push(rel);
          mergeDiffStatsEntry(diffStats, rel, computeLineChangeStats(previous, nextContent));
          continue;
        }
      }
    } catch (error) {
      const rollback = rollbackOperationBatchTransaction(transaction);
      return {
        ok: false,
        modifiedFiles: [],
        diffStats: {},
        rolledBack: rollback.ok,
        rollbackErrors: rollback.errors,
        message: rollback.ok
          ? `Falha ao executar lote; rollback aplicado. Motivo: ${error.message}`
          : `Falha ao executar lote; rollback incompleto. Motivo: ${error.message}`,
      };
    }

    const uniqueFiles = [...new Set(modifiedFiles)];
    if (Object.keys(diffStats).length) {
      ingestRuntimeDiffStats(rootPath, diffStats);
    }
    return {
      ok: true,
      transactional: true,
      modifiedFiles: uniqueFiles,
      diffStats,
      message: uniqueFiles.length
        ? `Lote executado com sucesso. Arquivos atualizados: ${uniqueFiles.join(', ')}`
        : 'Lote executado com sucesso.',
      humanSummary: action && action.humanSummary ? action.humanSummary : null,
    };
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function executeEditFileFuzzyAction(action) {
    assertReady();
    const rootPath = action.rootPath;
    const targetFile = normalizeRequestedRelativePath(action.targetFile);
    
    if (!rootPath || !targetFile) {
      return { ok: false, message: 'Arquivo alvo ausente para edição.' };
    }
    
    const absoluteTarget = path.join(rootPath, targetFile);
    if (!isInsideRoot(rootPath, absoluteTarget)) {
      return { ok: false, message: 'Operação bloqueada fora da raiz do projeto.' };
    }
    
    const physicalCheck = resolvePhysicalPathForWrite(rootPath, absoluteTarget);
    if (!physicalCheck.ok) {
      return { ok: false, message: physicalCheck.message };
    }
    
    const sensitivePath = blockSensitiveAutomataPath(targetFile);
    if (sensitivePath) return sensitivePath;

    if (!fs.existsSync(absoluteTarget)) {
      return { ok: false, message: `O arquivo não existe para ser editado: ${targetFile}` };
    }

    const currentContent = fs.readFileSync(absoluteTarget, 'utf8');
    const targetContent = String(action.targetContent || '');
    const replacementContent = String(action.replacementContent || '');

    if (!targetContent) {
      return { ok: false, message: 'Conteúdo alvo para substituição não pode ser vazio.' };
    }

    let nextContent = null;

    // Estratégia 1: Match exato
    if (currentContent.includes(targetContent)) {
      const count = currentContent.split(targetContent).length - 1;
      if (count > 1) {
        return { ok: false, message: `A string alvo aparece ${count} vezes no arquivo. Forneça um bloco de código mais específico para evitar substituição no lugar errado.` };
      }
      nextContent = currentContent.replace(targetContent, replacementContent);
    } else {
      // Estratégia 2: Match fuzzy ignorando espaços/indentação
      const normalizedCurrent = currentContent.replace(/\r\n/g, '\n');
      const regexParts = targetContent.trim().split(/\s+/).map(escapeRegExp);
      const fuzzyRegex = new RegExp(regexParts.join('\\s+'));
      
      const match = normalizedCurrent.match(fuzzyRegex);
      if (match) {
        const count = normalizedCurrent.match(new RegExp(fuzzyRegex.source, 'g')).length;
        if (count > 1) {
          return { ok: false, message: `A string alvo (ignorando espaços) aparece ${count} vezes no arquivo. Forneça um bloco de código mais específico.` };
        }
        nextContent = normalizedCurrent.replace(fuzzyRegex, replacementContent);
      }
    }

    if (nextContent === null) {
      return { 
        ok: false, 
        message: 'Não foi possível encontrar o bloco de código exato para substituir. Verifique se o conteúdo alvo existe no arquivo (copie exatamente do arquivo original) e tente novamente.' 
      };
    }

    if (isCssOperationPath(targetFile)) {
      nextContent = normalizeCssImportOrder(nextContent);
    }

    if (currentContent === nextContent) {
      return {
        ok: true,
        modifiedFiles: [],
        diffStats: {},
        message: `Nenhuma alteração de conteúdo em ${targetFile}.`,
      };
    }

    fs.writeFileSync(absoluteTarget, nextContent, 'utf8');

    const diffStats = {};
    mergeDiffStatsEntry(diffStats, targetFile, computeLineChangeStats(currentContent, nextContent));

    if (Object.keys(diffStats).length) {
      ingestRuntimeDiffStats(rootPath, diffStats);
    }

    return {
      ok: true,
      modifiedFiles: [targetFile],
      diffStats,
      message: `Arquivo editado com sucesso: ${targetFile}`,
    };
  }

  function executeSearchTextAction(action) {
    assertReady();
    const rootPath = action.rootPath;
    const query = String(action.targetText || '').trim();
    if (!rootPath || !query) {
      return { ok: false, message: 'Busca inválida: texto ou pasta ausente.' };
    }
    if (!fs.existsSync(rootPath)) {
      return { ok: false, message: 'A pasta do projeto não está acessível.' };
    }

    const maxResults = Math.max(1, Math.min(50, Number(action.maxResults) || 20));
    const results = [];
    const queryLower = query.toLowerCase();

    function walk(dir) {
      if (results.length >= maxResults) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(rootPath, fullPath);

        if (entry.isDirectory()) {
          if (excludedDirs.has(entry.name)) continue;
          walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;

        const ext = path.extname(entry.name).toLowerCase();
        if (!isTextLikeExtension(ext)) continue;

        let content = '';
        try {
          content = fs.readFileSync(fullPath, 'utf8');
        } catch {
          continue;
        }

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          if (line.toLowerCase().includes(queryLower)) {
            results.push({
              file: relativePath,
              line: i + 1,
              snippet: line.trim().slice(0, 220),
            });
            if (results.length >= maxResults) return;
          }
        }
      }
    }

    walk(rootPath);

    if (!results.length) {
      return {
        ok: true,
        modifiedFiles: [],
        message: `Não encontrei esse texto no projeto: "${query}".`,
        searchResults: [],
      };
    }

    const top = results.slice(0, 8);
    const resultText = top.map((r) => `- ${r.file}:${r.line} — ${r.snippet}`).join('\n');
    return {
      ok: true,
      modifiedFiles: [],
      message: `Encontrei ${results.length} ocorrência(s) do texto solicitado.\n${resultText}`,
      searchResults: results,
    };
  }

  function execute(action) {
    assertReady();
    if (!action) {
      return { ok: false, message: 'Ação ausente.' };
    }

    if (action.cortexRuntimeVersion && action.cortexValidated !== true) {
      return {
        ok: false,
        message: 'O Cortex bloqueou a execução porque os artefatos não passaram pela validação do WorkGraph.',
      };
    }

    const executionCommand = action.executionCommand || null;
    if (executionCommand) {
      const commandForValidation = {
        ...executionCommand,
        root_path: executionCommand.root_path || action.rootPath,
      };
      const validation = validateExecutionCommand(commandForValidation);
      if (!validation.ok) {
        return { ok: false, message: validation.message };
      }

      const mappedAction = {
        ...action,
        type: commandForValidation.task_type,
        targetFile: commandForValidation.target_file,
        previousContentHash: commandForValidation.previous_content_hash,
        nextContent: commandForValidation.next_content,
        rootPath: commandForValidation.root_path,
        targetText: commandForValidation.target_text,
        maxResults: commandForValidation.max_results,
        operations: commandForValidation.operations,
      };
      if (mappedAction.type === 'execute_operation_batch') {
        return executeOperationBatchAction(mappedAction);
      }
      if (mappedAction.type === 'search_text_in_files') {
        return executeSearchTextAction(mappedAction);
      }
      return executePatchAction(mappedAction);
    }

    if (action.type === 'operation_batch') {
      return executeOperationBatchAction(action);
    }

    if (action.type === 'search_text_in_files') {
      return executeSearchTextAction(action);
    }

    if (action.type === 'edit_file_fuzzy') {
      return executeEditFileFuzzyAction(action);
    }

    return executePatchAction(action);
  }

  return {
    execute,
    executeOperationBatchAction,
    executePatchAction,
    executeSearchTextAction,
    executeEditFileFuzzyAction,
  };
}

module.exports = {
  createAutomataExecutor,
};

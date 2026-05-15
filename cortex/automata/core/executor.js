const DEFAULT_EXCLUDED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.cache']);

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

  function isInsideRoot(rootPath, candidatePath) {
    const root = path.resolve(String(rootPath || ''));
    const candidate = path.resolve(String(candidatePath || ''));
    return candidate === root || candidate.startsWith(root + path.sep);
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
      const absolutePath = path.join(rootPath, normalizedPath);
      if (!isInsideRoot(rootPath, absolutePath)) {
        return { ok: false, message: `Operação bloqueada fora da raiz do projeto: ${normalizedPath}` };
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

    const nextContent = String(action.nextContent || '');
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
      if (!['mkdir', 'write_file', 'append_file'].includes(operation.op)) {
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

        if (operation.op === 'write_file') {
          const dir = path.dirname(absolutePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const previous = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
          const nextContent = String(operation.content || '');
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
          const nextContent = `${previous}${String(operation.content || '')}`;
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

    return executePatchAction(action);
  }

  return {
    execute,
    executeOperationBatchAction,
    executePatchAction,
    executeSearchTextAction,
  };
}

module.exports = {
  createAutomataExecutor,
};

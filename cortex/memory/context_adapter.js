function normalizeWingSlug(rawName) {
  const base = String(rawName || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_.]/g, '');
  return base || 'default_wing';
}

function createMemoryContextAdapter(dependencies = {}) {
  const {
    CORTEX_RAG_ENABLED = true,
    CORTEX_RAG_PROVIDER = 'r2r',
    MEMPALACE_COMMAND_TIMEOUT_MS = 12000,
    MEMPALACE_PYTHON_BIN = 'python3',
    MEMPALACE_REPO_CANDIDATES = [],
    R2R_API_KEY = '',
    R2R_BASE_URL = '',
    R2R_CORTEX_DELETE_ENDPOINT = '',
    R2R_CORTEX_INGEST_ENDPOINT = '',
    R2R_CORTEX_REINDEX_ENDPOINT = '',
    R2R_SEARCH_LIMIT = 6,
    R2R_STATUS_TIMEOUT_MS = 3500,
    R2R_TIMEOUT_MS = 12000,
    abortController = globalThis.AbortController,
    clearTimeoutFn = clearTimeout,
    clipText = (value, max = 4000) => String(value || '').slice(0, max),
    crypto,
    env = {},
    extractIntentTerms = () => [],
    fetchFn = globalThis.fetch,
    fs,
    getRuntimeProfileSettings = () => ({ memoryContextChars: 1200 }),
    getUserDataPath,
    path,
    runCommand,
    setTimeoutFn = setTimeout,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Memory context dependency missing: ${name}`);
  }

  function assertMempalaceReady() {
    requireDependency('fs', fs);
    requireDependency('getUserDataPath', getUserDataPath);
    requireDependency('path', path);
    requireDependency('runCommand', runCommand);
  }

  function assertRagReady() {
    requireDependency('abortController', abortController);
    requireDependency('crypto', crypto);
    requireDependency('fetchFn', fetchFn);
  }

  function resolveMempalaceRepoPath() {
    assertMempalaceReady();
    for (const candidate of MEMPALACE_REPO_CANDIDATES) {
      const marker = path.join(candidate, 'mempalace', 'cli.py');
      if (fs.existsSync(marker)) {
        return candidate;
      }
    }
    return null;
  }

  function resolveMempalacePalacePath() {
    assertMempalaceReady();
    if (env.MEMPALACE_PALACE_PATH) {
      return path.resolve(env.MEMPALACE_PALACE_PATH);
    }
    return path.join(getUserDataPath(), 'mempalace', 'palace');
  }

  function resolveMempalaceHomePath() {
    assertMempalaceReady();
    if (env.MEMPALACE_HOME) {
      return path.resolve(env.MEMPALACE_HOME);
    }
    const homePath = path.join(getUserDataPath(), 'mempalace-home');
    if (!fs.existsSync(homePath)) {
      fs.mkdirSync(homePath, { recursive: true });
    }
    return homePath;
  }

  function resolveWingFromProject(projectInfo) {
    if (!projectInfo || !projectInfo.rootPath) return null;
    requireDependency('path', path);
    return normalizeWingSlug(path.basename(projectInfo.rootPath));
  }

  function detectMempalaceMissingDependency(stderrText = '') {
    const match = String(stderrText).match(/ModuleNotFoundError: No module named '([^']+)'/);
    return match ? match[1] : null;
  }

  async function runMempalaceCli(args, options = {}) {
    const repoPath = resolveMempalaceRepoPath();
    const palacePath = resolveMempalacePalacePath();
    const mempalaceHomePath = resolveMempalaceHomePath();

    if (!repoPath) {
      return {
        ok: false,
        reason: 'repo_not_found',
        message:
          'Pasta mempalace-develop não encontrada. Defina MEMPALACE_REPO_PATH ou mantenha a pasta ao lado do localcode-studio.',
      };
    }

    const command = await runCommand(MEMPALACE_PYTHON_BIN, ['-m', 'mempalace', ...args], {
      cwd: repoPath,
      timeoutMs: options.timeoutMs || MEMPALACE_COMMAND_TIMEOUT_MS,
      env: {
        MEMPALACE_PALACE_PATH: palacePath,
        HOME: mempalaceHomePath,
        USERPROFILE: mempalaceHomePath,
      },
    });

    const missingDependency = detectMempalaceMissingDependency(command.stderr);
    if (!command.ok && missingDependency) {
      return {
        ok: false,
        reason: 'dependency_missing',
        dependency: missingDependency,
        stdout: command.stdout,
        stderr: command.stderr,
        palacePath,
        repoPath,
        message: `Dependência Python ausente para MemPalace: ${missingDependency}.`,
      };
    }

    return {
      ...command,
      repoPath,
      palacePath,
      mempalaceHomePath,
    };
  }

  async function runMempalacePythonJson(script, payload = {}, options = {}) {
    const repoPath = resolveMempalaceRepoPath();
    const palacePath = resolveMempalacePalacePath();
    const mempalaceHomePath = resolveMempalaceHomePath();

    if (!repoPath) {
      return {
        ok: false,
        reason: 'repo_not_found',
        message:
          'Pasta mempalace-develop não encontrada. Defina MEMPALACE_REPO_PATH ou mantenha a pasta ao lado do localcode-studio.',
      };
    }

    const command = await runCommand(MEMPALACE_PYTHON_BIN, ['-c', script, JSON.stringify(payload)], {
      cwd: repoPath,
      timeoutMs: options.timeoutMs || MEMPALACE_COMMAND_TIMEOUT_MS,
      env: {
        MEMPALACE_PALACE_PATH: palacePath,
        HOME: mempalaceHomePath,
        USERPROFILE: mempalaceHomePath,
      },
    });

    const missingDependency = detectMempalaceMissingDependency(command.stderr);
    if (!command.ok && missingDependency) {
      return {
        ok: false,
        reason: 'dependency_missing',
        dependency: missingDependency,
        message: `Dependência Python ausente para MemPalace: ${missingDependency}.`,
        stderr: command.stderr,
      };
    }

    if (!command.ok) {
      return {
        ok: false,
        reason: command.timedOut ? 'timeout' : 'python_error',
        message: command.stderr || 'Falha ao executar API Python do MemPalace.',
        stderr: command.stderr,
        stdout: command.stdout,
      };
    }

    try {
      return {
        ok: true,
        data: JSON.parse(command.stdout || '{}'),
        stderr: command.stderr,
        palacePath,
        repoPath,
      };
    } catch (error) {
      return {
        ok: false,
        reason: 'json_parse_error',
        message: error.message,
        stdout: command.stdout,
        stderr: command.stderr,
      };
    }
  }

  async function getMempalaceRuntimeStatus(projectInfo = null) {
    const repoPath = resolveMempalaceRepoPath();
    if (!repoPath) {
      return {
        ok: true,
        available: false,
        reason: 'repo_not_found',
        message:
          'MemPalace não localizado no workspace. Coloque "mempalace-develop" ao lado do projeto ou configure MEMPALACE_REPO_PATH.',
      };
    }

    const versionCheck = await runMempalaceCli(['--version'], { timeoutMs: 7000 });
    if (!versionCheck.ok) {
      return {
        ok: true,
        available: false,
        reason: versionCheck.reason || 'runtime_error',
        dependency: versionCheck.dependency || null,
        message:
          versionCheck.reason === 'dependency_missing'
            ? `MemPalace detectado, mas falta a dependência Python "${versionCheck.dependency}".`
            : 'MemPalace detectado, mas o runtime local não está pronto.',
        details: versionCheck.stderr || versionCheck.message || null,
      };
    }

    const wing = resolveWingFromProject(projectInfo);

    return {
      ok: true,
      available: true,
      ready: true,
      version: versionCheck.stdout.trim(),
      palacePath: versionCheck.palacePath,
      repoPath,
      wing,
    };
  }

  async function ensureMempalaceProjectIndexed(projectInfo) {
    if (!projectInfo || !projectInfo.rootPath) {
      return { ok: false, message: 'Projeto inválido para indexação no MemPalace.' };
    }

    const wing = resolveWingFromProject(projectInfo);
    const initResult = await runMempalaceCli([
      'init',
      projectInfo.rootPath,
      '--yes',
      '--no-llm',
    ]);

    if (!initResult.ok) {
      return {
        ok: false,
        step: 'init',
        message: initResult.message || initResult.stderr || 'Falha no mempalace init.',
      };
    }

    const mineResult = await runMempalaceCli([
      'mine',
      projectInfo.rootPath,
      '--mode',
      'projects',
      '--wing',
      wing,
      '--agent',
      'faber_executor',
    ]);

    if (!mineResult.ok) {
      return {
        ok: false,
        step: 'mine',
        message: mineResult.message || mineResult.stderr || 'Falha no mempalace mine.',
      };
    }

    return {
      ok: true,
      wing,
      initLog: initResult.stdout.trim(),
      mineLog: mineResult.stdout.trim(),
    };
  }

  async function searchMempalaceContext(query, projectInfo, nResults = 4) {
    const wing = resolveWingFromProject(projectInfo);
    if (!query || !query.trim()) {
      return { ok: false, message: 'Query vazia para busca de memória.' };
    }

    const args = ['search', query, '--results', String(Math.max(1, Math.min(nResults, 8)))];
    if (wing) {
      args.push('--wing', wing);
    }

    const result = await runMempalaceCli(args);
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason || 'search_error',
        message: result.message || result.stderr || 'Falha na busca de memória.',
      };
    }

    return {
      ok: true,
      wing,
      text: result.stdout.trim(),
      query,
      retrievalReason: 'mempalace_cli_search_query',
      refs: [
        {
          source: 'mempalace.cli.search',
          sourceType: 'mempalace',
          sourceId: wing || 'default_wing',
          title: wing ? `MemPalace ${wing}` : 'MemPalace',
          reason: 'mempalace_cli_search_query',
          preview: clipText(result.stdout.trim(), 220),
        },
      ],
    };
  }

  async function buildMempalacePlannerContext(projectInfo, userMessage) {
    const runtimeSettings = getRuntimeProfileSettings();
    const runtime = await getMempalaceRuntimeStatus(projectInfo);
    if (!runtime.available || !runtime.ready) {
      return {
        ok: false,
        available: false,
        reason: runtime.reason || 'runtime_unavailable',
        hint: runtime.message,
      };
    }

    const searchResult = await searchMempalaceContext(userMessage, projectInfo, 4);
    if (!searchResult.ok) {
      return {
        ok: false,
        available: true,
        reason: searchResult.reason || 'search_failed',
        hint: searchResult.message,
      };
    }

    const clipped = searchResult.text.slice(0, runtimeSettings.memoryContextChars).trim();
    if (!clipped) {
      return {
        ok: false,
        available: true,
        reason: 'empty_search',
        hint: 'MemPalace sem resultados para esta consulta.',
      };
    }

    return {
      ok: true,
      available: true,
      wing: searchResult.wing,
      query: searchResult.query || userMessage,
      retrievalReason: searchResult.retrievalReason || 'mempalace_cli_search_query',
      refs: searchResult.refs || [],
      contextText: clipped,
    };
  }

  function buildR2rQuery(projectInfo, userMessage, attachments = []) {
    const lines = [];
    const prompt = String(userMessage || '').trim();
    if (prompt) lines.push(`Pedido do usuário: ${prompt}`);
    if (projectInfo && projectInfo.rootPath) lines.push(`Projeto: ${path.basename(projectInfo.rootPath)}`);
    if (projectInfo && Array.isArray(projectInfo.stacks) && projectInfo.stacks.length) {
      lines.push(`Stack: ${projectInfo.stacks.join(', ')}`);
    }
    if (Array.isArray(attachments) && attachments.length) {
      const compact = attachments
        .slice(0, 6)
        .map((entry) => `${entry && entry.name ? entry.name : 'anexo'} (${entry && entry.type ? entry.type : 'desconhecido'})`);
      lines.push(`Anexos: ${compact.join(', ')}`);
    }
    return clipText(lines.join('\n'), 1600);
  }

  async function requestR2rJson(endpointPath, options = {}) {
    if (!R2R_BASE_URL) {
      return { ok: false, reason: 'r2r_base_url_missing', status: 0 };
    }
    assertRagReady();

    const method = String(options.method || 'POST').toUpperCase();
    const payload = options.payload || null;
    const timeoutMs = options.timeoutMs || R2R_TIMEOUT_MS;
    const endpoint = `${R2R_BASE_URL}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;
    const controller = new abortController();
    const timeout = setTimeoutFn(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 12000));
    const headers = { 'Content-Type': 'application/json' };
    if (R2R_API_KEY) headers.Authorization = `Bearer ${R2R_API_KEY}`;

    try {
      const request = {
        method,
        headers,
        signal: controller.signal,
      };
      if (method !== 'GET' && method !== 'HEAD') {
        request.body = JSON.stringify(payload || {});
      }

      const response = await fetchFn(endpoint, request);
      const text = await response.text().catch(() => '');
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          reason: `r2r_http_${response.status}`,
          message: typeof text === 'string' ? clipText(text.replace(/\s+/g, ' '), 260) : '',
        };
      }
      return { ok: true, status: response.status, data, endpoint };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        reason: error && error.name === 'AbortError' ? 'r2r_timeout' : 'r2r_request_error',
        message: String(error && error.message ? error.message : error || ''),
      };
    } finally {
      clearTimeoutFn(timeout);
    }
  }

  async function postR2rJson(endpointPath, payload, timeoutMs = R2R_TIMEOUT_MS) {
    return requestR2rJson(endpointPath, {
      method: 'POST',
      payload,
      timeoutMs,
    });
  }

  function collectR2rSearchItems(payload) {
    requireDependency('crypto', crypto);

    const root = payload && typeof payload === 'object' ? payload : {};
    const buckets = [];

    const ingest = (value) => {
      if (Array.isArray(value)) buckets.push(...value);
    };

    ingest(root.results);
    ingest(root.search_results);
    ingest(root.data);
    if (root.results && typeof root.results === 'object') {
      ingest(root.results.results);
      ingest(root.results.search_results);
      ingest(root.results.vector_search_results);
      ingest(root.results.hybrid_search_results);
      ingest(root.results.chunk_search_results);
      ingest(root.results.items);
    }
    if (root.data && typeof root.data === 'object') {
      ingest(root.data.results);
      ingest(root.data.search_results);
      ingest(root.data.items);
    }

    const normalized = [];
    for (const item of buckets) {
      if (!item || typeof item !== 'object') continue;
      const metadata =
        (item.metadata && typeof item.metadata === 'object' ? item.metadata : null) ||
        (item.chunk && item.chunk.metadata && typeof item.chunk.metadata === 'object' ? item.chunk.metadata : null) ||
        (item.document && item.document.metadata && typeof item.document.metadata === 'object' ? item.document.metadata : null) ||
        {};
      const textCandidates = [
        item.text,
        item.content,
        item.snippet,
        item.summary,
        item.chunk && item.chunk.text,
        item.document && item.document.text,
        item.document && item.document.content,
      ];
      const text = textCandidates.find((entry) => typeof entry === 'string' && entry.trim()) || '';
      if (!text) continue;
      const titleCandidates = [
        metadata.title,
        metadata.name,
        metadata.file,
        metadata.path,
        item.title,
        item.source,
      ];
      const title = titleCandidates.find((entry) => typeof entry === 'string' && entry.trim()) || 'referência';
      const scoreCandidate = [item.score, item.similarity, item.relevance].find((entry) => Number.isFinite(Number(entry)));
      const score = Number.isFinite(Number(scoreCandidate)) ? Number(scoreCandidate) : null;
      const pathCandidates = [
        metadata.path,
        metadata.filePath,
        metadata.file_path,
        metadata.sourcePath,
        metadata.source_path,
        metadata.source,
        item.path,
        item.source,
      ];
      const sourcePath = pathCandidates.find((entry) => typeof entry === 'string' && entry.trim()) || '';
      const documentIdCandidates = [
        item.document_id,
        item.documentId,
        item.id,
        metadata.documentId,
        metadata.document_id,
        item.document && item.document.id,
      ];
      const documentId = documentIdCandidates.find((entry) => typeof entry === 'string' && entry.trim()) || '';
      normalized.push({
        title: String(title).trim(),
        text: String(text).trim(),
        score,
        path: String(sourcePath || '').trim(),
        documentId: String(documentId || '').trim(),
        metadata,
      });
    }

    const unique = [];
    const seen = new Set();
    for (const item of normalized) {
      const fingerprint = crypto
        .createHash('sha1')
        .update(`${item.title}::${item.text.slice(0, 300)}`)
        .digest('hex')
        .slice(0, 12);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      unique.push(item);
    }
    return unique;
  }

  function formatR2rContext(items = [], maxChars = 1800) {
    if (!Array.isArray(items) || !items.length) return '';
    const lines = [];
    for (const item of items) {
      const scorePart = Number.isFinite(item.score) ? ` (score ${item.score.toFixed(3)})` : '';
      const sourcePart = item.path ? ` [${item.path}]` : '';
      lines.push(`- ${item.title}${sourcePart}${scorePart}: ${clipText(item.text, 360)}`);
    }
    return clipText(lines.join('\n'), maxChars);
  }

  async function buildRagPlannerContext(projectInfo, userMessage, attachments = [], runtimeSettings = null) {
    if (!CORTEX_RAG_ENABLED) {
      return { ok: false, available: false, reason: 'rag_disabled', provider: CORTEX_RAG_PROVIDER };
    }
    if (CORTEX_RAG_PROVIDER !== 'r2r') {
      return { ok: false, available: false, reason: 'rag_provider_unsupported', provider: CORTEX_RAG_PROVIDER };
    }
    if (!R2R_BASE_URL) {
      return { ok: false, available: false, reason: 'r2r_base_url_missing', provider: 'r2r' };
    }

    const query = buildR2rQuery(projectInfo, userMessage, attachments);
    if (!query) {
      return { ok: false, available: true, reason: 'rag_empty_query', provider: 'r2r' };
    }

    const limit = Math.max(1, Math.min(20, Number.isFinite(Number(R2R_SEARCH_LIMIT)) ? Number(R2R_SEARCH_LIMIT) : 6));
    const payload = {
      query,
      limit,
      search_mode: 'hybrid',
    };

    const endpoints = ['/v3/retrieval/search', '/retrieval/search'];
    let lastError = null;
    let success = null;

    for (const endpoint of endpoints) {
      const result = await postR2rJson(endpoint, payload, R2R_TIMEOUT_MS);
      if (result.ok) {
        success = result;
        break;
      }
      lastError = result;
      if (Number(result.status) !== 404) break;
    }

    if (!success) {
      return {
        ok: false,
        available: true,
        reason: lastError && lastError.reason ? lastError.reason : 'r2r_search_failed',
        hint: lastError && lastError.message ? lastError.message : null,
        provider: 'r2r',
      };
    }

    const items = collectR2rSearchItems(success.data || {});
    if (!items.length) {
      return {
        ok: false,
        available: true,
        reason: 'r2r_no_results',
        provider: 'r2r',
      };
    }

    const maxChars =
      runtimeSettings && Number.isFinite(Number(runtimeSettings.memoryContextChars))
        ? Math.max(600, Math.min(2600, Number(runtimeSettings.memoryContextChars)))
        : 1800;

    return {
      ok: true,
      available: true,
      provider: 'r2r',
      endpoint: success.endpoint,
      query,
      refsCount: items.length,
      retrievalReason: 'r2r_hybrid_search_query',
      contextText: formatR2rContext(items.slice(0, limit), maxChars),
      refs: items.slice(0, limit).map((item) => ({
        source: 'rag.r2r',
        sourceType: 'rag',
        sourceId: item.documentId || item.path || item.title,
        title: item.title,
        score: item.score,
        path: item.path || '',
        documentId: item.documentId || '',
        reason: 'r2r_hybrid_search_query',
        preview: clipText(item.text, 220),
      })),
    };
  }

  async function getRagRuntimeStatus() {
    const baseStatus = {
      ok: true,
      provider: CORTEX_RAG_PROVIDER,
      enabled: Boolean(CORTEX_RAG_ENABLED),
      configured: Boolean(R2R_BASE_URL),
      baseUrl: CORTEX_RAG_PROVIDER === 'r2r' ? R2R_BASE_URL || null : null,
      ingestConfigured: Boolean(String(R2R_CORTEX_INGEST_ENDPOINT || '').trim()),
      searchLimit: Math.max(1, Math.min(20, Number.isFinite(Number(R2R_SEARCH_LIMIT)) ? Number(R2R_SEARCH_LIMIT) : 6)),
      timeoutMs: Math.max(1000, Number.isFinite(Number(R2R_TIMEOUT_MS)) ? Number(R2R_TIMEOUT_MS) : 12000),
      statusTimeoutMs: Math.max(1000, Number.isFinite(Number(R2R_STATUS_TIMEOUT_MS)) ? Number(R2R_STATUS_TIMEOUT_MS) : 3500),
      available: false,
      ready: false,
      searchable: false,
    };

    if (!CORTEX_RAG_ENABLED) {
      return { ...baseStatus, reason: 'rag_disabled' };
    }
    if (CORTEX_RAG_PROVIDER !== 'r2r') {
      return { ...baseStatus, reason: 'rag_provider_unsupported' };
    }
    if (!R2R_BASE_URL) {
      return { ...baseStatus, reason: 'r2r_base_url_missing' };
    }

    const probePayload = {
      query: 'faber cortex runtime health check',
      limit: 1,
      search_mode: 'hybrid',
    };
    const endpoints = ['/v3/retrieval/search', '/retrieval/search'];
    let lastError = null;

    for (const endpoint of endpoints) {
      const result = await postR2rJson(endpoint, probePayload, baseStatus.statusTimeoutMs);
      if (result.ok) {
        return {
          ...baseStatus,
          available: true,
          ready: true,
          searchable: true,
          endpoint: result.endpoint,
          reason: baseStatus.ingestConfigured ? 'ready' : 'search_ready_ingest_missing',
          hint: baseStatus.ingestConfigured
            ? null
            : 'Busca RAG disponível; configure R2R_CORTEX_INGEST_ENDPOINT para indexar a memória do Cortex.',
        };
      }
      lastError = result;
      if (Number(result.status) !== 404) break;
    }

    return {
      ...baseStatus,
      available: true,
      reason: lastError && lastError.reason ? lastError.reason : 'r2r_status_failed',
      hint: lastError && lastError.message ? lastError.message : null,
    };
  }

  async function indexCortexMemoryInRag(projectInfo, memoryEntry = {}) {
    if (!CORTEX_RAG_ENABLED) {
      return { ok: false, available: false, reason: 'rag_disabled', provider: CORTEX_RAG_PROVIDER };
    }
    if (CORTEX_RAG_PROVIDER !== 'r2r') {
      return { ok: false, available: false, reason: 'rag_provider_unsupported', provider: CORTEX_RAG_PROVIDER };
    }
    if (!R2R_BASE_URL) {
      return { ok: false, available: false, reason: 'r2r_base_url_missing', provider: 'r2r' };
    }

    const endpoint = String(R2R_CORTEX_INGEST_ENDPOINT || '').trim();
    if (!endpoint) {
      return {
        ok: false,
        available: true,
        reason: 'r2r_ingest_endpoint_missing',
        provider: 'r2r',
        hint: 'Configure R2R_CORTEX_INGEST_ENDPOINT para indexar a biblioteca do Cortex no RAG.',
      };
    }

    const text = String(memoryEntry.content || memoryEntry.userMessage || '').trim();
    if (!text) {
      return { ok: false, available: true, reason: 'empty_cortex_memory', provider: 'r2r' };
    }

    assertRagReady();
    const payload = {
      id: memoryEntry.id || crypto.randomUUID(),
      text: clipText(text, 12000),
      metadata: {
        source: 'faber_cortex',
        type: memoryEntry.type || 'cortex_memory',
        topic: memoryEntry.topic || 'geral',
        projectId: memoryEntry.projectId || null,
        userId: memoryEntry.userId || null,
        conversationId: memoryEntry.conversationId || null,
        jobId: memoryEntry.jobId || null,
        projectName: memoryEntry.projectName || (projectInfo && projectInfo.rootPath ? path.basename(projectInfo.rootPath) : null),
        rootPath: memoryEntry.rootPath || (projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null),
        expiresAt: memoryEntry.expiresAt || (memoryEntry.validity && memoryEntry.validity.expiresAt) || null,
        validity: memoryEntry.validity || null,
        status: memoryEntry.status || 'active',
        promoted: Boolean(memoryEntry.promoted),
        scope: memoryEntry.scope || 'project',
        lifecycleAction: memoryEntry.lifecycleAction || null,
        updatedAt: memoryEntry.updatedAt || null,
        documents: Array.isArray(memoryEntry.documents)
          ? memoryEntry.documents.map((doc) => ({ name: doc.name || 'documento', path: doc.path || '' }))
          : [],
        createdAt: memoryEntry.createdAt || new Date().toISOString(),
      },
    };

    const result = await postR2rJson(endpoint, payload, R2R_TIMEOUT_MS);
    if (!result.ok) {
      return {
        ok: false,
        available: true,
        reason: result.reason || 'r2r_ingest_failed',
        provider: 'r2r',
        hint: result.message || null,
        endpoint: result.endpoint || endpoint,
      };
    }

    const data = result.data && typeof result.data === 'object' ? result.data : {};
    return {
      ok: true,
      available: true,
      provider: 'r2r',
      endpoint: result.endpoint,
      documentId: data.id || data.document_id || data.documentId || payload.id,
    };
  }

  async function reindexRagProject(projectInfo, input = {}) {
    if (!CORTEX_RAG_ENABLED) {
      return { ok: false, available: false, reason: 'rag_disabled', provider: CORTEX_RAG_PROVIDER };
    }
    if (CORTEX_RAG_PROVIDER !== 'r2r') {
      return { ok: false, available: false, reason: 'rag_provider_unsupported', provider: CORTEX_RAG_PROVIDER };
    }
    if (!R2R_BASE_URL) {
      return { ok: false, available: false, reason: 'r2r_base_url_missing', provider: 'r2r' };
    }
    const endpoint = String(R2R_CORTEX_REINDEX_ENDPOINT || '').trim();
    if (!endpoint) {
      return {
        ok: false,
        available: true,
        reason: 'r2r_reindex_endpoint_missing',
        provider: 'r2r',
        hint: 'Configure R2R_CORTEX_REINDEX_ENDPOINT para solicitar reindexação do índice RAG.',
      };
    }

    assertRagReady();
    const payload = {
      projectId: input.projectId || null,
      rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
      action: 'reindex',
      requestedAt: new Date().toISOString(),
    };
    const result = await postR2rJson(endpoint, payload, R2R_TIMEOUT_MS);
    if (!result.ok) {
      return {
        ok: false,
        available: true,
        reason: result.reason || 'r2r_reindex_failed',
        provider: 'r2r',
        hint: result.message || null,
        endpoint: result.endpoint || endpoint,
      };
    }
    const data = result.data && typeof result.data === 'object' ? result.data : {};
    return {
      ok: true,
      available: true,
      provider: 'r2r',
      endpoint: result.endpoint,
      jobId: data.jobId || data.job_id || data.id || null,
    };
  }

  async function forgetRagMemory(input = {}) {
    if (!CORTEX_RAG_ENABLED) {
      return { ok: false, available: false, reason: 'rag_disabled', provider: CORTEX_RAG_PROVIDER };
    }
    if (CORTEX_RAG_PROVIDER !== 'r2r') {
      return { ok: false, available: false, reason: 'rag_provider_unsupported', provider: CORTEX_RAG_PROVIDER };
    }
    if (!R2R_BASE_URL) {
      return { ok: false, available: false, reason: 'r2r_base_url_missing', provider: 'r2r' };
    }
    const endpoint = String(R2R_CORTEX_DELETE_ENDPOINT || '').trim();
    if (!endpoint) {
      return {
        ok: false,
        available: true,
        reason: 'r2r_delete_endpoint_missing',
        provider: 'r2r',
        hint: 'Configure R2R_CORTEX_DELETE_ENDPOINT para apagar memórias indexadas no RAG.',
      };
    }
    const memoryId = String(input.memoryId || input.documentId || '').trim();
    if (!memoryId) {
      return { ok: false, available: true, reason: 'missing_memory_id', provider: 'r2r' };
    }

    assertRagReady();
    const projectInfo = input.projectInfo && typeof input.projectInfo === 'object' ? input.projectInfo : null;
    const payload = {
      id: memoryId,
      document_id: input.documentId || memoryId,
      action: input.action || 'forget',
      reason: input.reason || 'user_requested_memory_forget',
      metadata: {
        projectId: input.projectId || null,
        rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
        topic: input.topic || null,
      },
    };
    const result = await postR2rJson(endpoint, payload, R2R_TIMEOUT_MS);
    if (!result.ok) {
      return {
        ok: false,
        available: true,
        reason: result.reason || 'r2r_delete_failed',
        provider: 'r2r',
        hint: result.message || null,
        endpoint: result.endpoint || endpoint,
      };
    }
    const data = result.data && typeof result.data === 'object' ? result.data : {};
    return {
      ok: true,
      available: true,
      provider: 'r2r',
      endpoint: result.endpoint,
      documentId: data.id || data.document_id || data.documentId || memoryId,
    };
  }

  function extractMempalaceEntityHints(projectInfo, userMessage) {
    const entities = new Set();
    if (projectInfo && projectInfo.rootPath) entities.add(path.basename(projectInfo.rootPath));
    if (projectInfo && Array.isArray(projectInfo.stacks)) {
      projectInfo.stacks.forEach((stack) => entities.add(String(stack || '').trim()));
    }
    extractIntentTerms(userMessage)
      .filter((term) => term.length >= 4)
      .slice(0, 8)
      .forEach((term) => entities.add(term));
    return Array.from(entities).filter(Boolean).slice(0, 10);
  }

  async function buildMempalaceCortexCore(projectInfo, userMessage, runtimeSettings) {
    const runtime = await getMempalaceRuntimeStatus(projectInfo);
    if (!runtime.available || !runtime.ready) {
      return {
        ok: false,
        available: false,
        reason: runtime.reason || 'runtime_unavailable',
        hint: runtime.message,
      };
    }

    const payload = {
      palacePath: runtime.palacePath,
      wing: runtime.wing,
      query: String(userMessage || '').slice(0, 500),
      entities: extractMempalaceEntityHints(projectInfo, userMessage),
      maxChars: Math.max(900, Number(runtimeSettings.memoryContextChars || 1200)),
    };

    const script = `
import json, os, sys
payload = json.loads(sys.argv[1])
out = {"ok": True, "wing": payload.get("wing"), "layers": {}, "kg": {}, "graph": {}}
palace_path = payload.get("palacePath")
wing = payload.get("wing")
entities = payload.get("entities") or []
max_chars = int(payload.get("maxChars") or 1200)
try:
    from mempalace.layers import MemoryStack
    stack = MemoryStack(palace_path=palace_path)
    wake = stack.wake_up(wing=wing)
    out["layers"]["wake_up"] = wake[:max_chars]
except Exception as exc:
    out["layers"]["error"] = str(exc)
try:
    from mempalace.knowledge_graph import KnowledgeGraph
    kg = KnowledgeGraph(db_path=os.path.join(palace_path, "knowledge_graph.sqlite3"))
    out["kg"]["stats"] = kg.stats()
    facts = []
    for entity in entities[:6]:
        rows = kg.query_entity(entity, direction="both")
        if rows:
            facts.append({"entity": entity, "facts": rows[:8]})
    out["kg"]["facts"] = facts
except Exception as exc:
    out["kg"]["error"] = str(exc)
try:
    from mempalace.palace_graph import find_tunnels, graph_stats
    out["graph"]["stats"] = graph_stats()
    out["graph"]["tunnels"] = find_tunnels(wing_a=wing)[:8] if wing else find_tunnels()[:8]
except Exception as exc:
    out["graph"]["error"] = str(exc)
print(json.dumps(out, ensure_ascii=False))
`;

    const result = await runMempalacePythonJson(script, payload, { timeoutMs: 12000 });
    if (!result.ok) {
      return {
        ok: false,
        available: true,
        reason: result.reason || 'mempalace_core_error',
        hint: result.message,
      };
    }

    const data = result.data || {};
    return {
      ok: true,
      available: true,
      wing: data.wing || runtime.wing,
      layers: data.layers || {},
      kg: data.kg || {},
      graph: data.graph || {},
    };
  }

  function formatMempalaceCoreForPrompt(core, maxChars = 1600) {
    if (!core || !core.ok) return 'MemPalace core: indisponível.';
    const lines = [];
    if (core.layers && core.layers.wake_up) {
      lines.push(`Wake-up/L1:\n${clipText(core.layers.wake_up, Math.floor(maxChars * 0.45))}`);
    }
    const kgFacts = core.kg && Array.isArray(core.kg.facts) ? core.kg.facts : [];
    if (kgFacts.length) {
      lines.push(`Knowledge graph:\n${clipText(JSON.stringify(kgFacts), Math.floor(maxChars * 0.25))}`);
    }
    const tunnels = core.graph && Array.isArray(core.graph.tunnels) ? core.graph.tunnels : [];
    if (tunnels.length) {
      lines.push(`Túneis/graph:\n${clipText(JSON.stringify(tunnels), Math.floor(maxChars * 0.2))}`);
    }
    const stats = core.graph && core.graph.stats ? core.graph.stats : null;
    if (stats) {
      lines.push(`Graph stats: ${clipText(JSON.stringify(stats), Math.floor(maxChars * 0.1))}`);
    }
    return clipText(lines.filter(Boolean).join('\n'), maxChars);
  }

  async function persistCortexCheckpointToMempalace(projectInfo, workGraph, stage) {
    if (!projectInfo || !workGraph || !workGraph.id) return { ok: false, reason: 'missing_workgraph' };
    const runtime = await getMempalaceRuntimeStatus(projectInfo);
    if (!runtime.available || !runtime.ready) {
      return { ok: false, reason: runtime.reason || 'runtime_unavailable' };
    }
    const content = [
      `CORTEX_WORKGRAPH:${workGraph.id}`,
      `stage:${stage}`,
      `status:${workGraph.status}`,
      `goal:${workGraph.goal}`,
      `brief:${workGraph.brief || ''}`,
      `passes:${(workGraph.passes || []).map((pass) => `${pass.id}:${pass.role}:${pass.passKind}:${pass.status}`).join(', ')}`,
      `artifacts:${JSON.stringify(workGraph.artifacts || [])}`,
      `validation:${JSON.stringify(workGraph.validationResults || [])}`,
    ].join('\n');

    const payload = {
      wing: runtime.wing || resolveWingFromProject(projectInfo),
      room: 'cortex_runtime',
      content,
      sourceFile: `cortex-${workGraph.id}-${stage}.txt`,
      projectName: path.basename(projectInfo.rootPath),
      workGraphId: workGraph.id,
      stage,
    };
    const script = `
import json, sys
payload = json.loads(sys.argv[1])
out = {"ok": True}
try:
    from mempalace.mcp_server import tool_add_drawer, tool_kg_add
    drawer = tool_add_drawer(
        payload["wing"],
        payload["room"],
        payload["content"],
        source_file=payload.get("sourceFile"),
        added_by="faber_cortex"
    )
    out["drawer"] = drawer
    if drawer.get("success"):
        source = drawer.get("drawer_id")
        out["kg_project"] = tool_kg_add(payload["projectName"], "has_cortex_workgraph", payload["workGraphId"], source_closet=source)
        out["kg_stage"] = tool_kg_add(payload["workGraphId"], "last_stage", payload["stage"], source_closet=source)
except Exception as exc:
    out = {"ok": False, "error": str(exc)}
print(json.dumps(out, ensure_ascii=False))
`;
    const result = await runMempalacePythonJson(script, payload, { timeoutMs: 12000 });
    return result.ok ? result.data : result;
  }

  async function persistCortexMemoryToMempalace(projectInfo, memoryEntry = {}) {
    if (!projectInfo || !memoryEntry || !memoryEntry.id) return { ok: false, reason: 'missing_cortex_memory' };
    const runtime = await getMempalaceRuntimeStatus(projectInfo);
    if (!runtime.available || !runtime.ready) {
      return { ok: false, available: false, reason: runtime.reason || 'runtime_unavailable', hint: runtime.message };
    }

    const projectName = memoryEntry.projectName || path.basename(projectInfo.rootPath || 'projeto');
    const content = [
      `CORTEX_MEMORY:${memoryEntry.id}`,
      `topic:${memoryEntry.topic || 'geral'}`,
      `project:${projectName}`,
      `createdAt:${memoryEntry.createdAt || new Date().toISOString()}`,
      '',
      memoryEntry.content || memoryEntry.userMessage || '',
    ].join('\n');

    const payload = {
      wing: runtime.wing || resolveWingFromProject(projectInfo),
      room: `cortex_memory/${memoryEntry.topic || 'geral'}`,
      content: clipText(content, 12000),
      sourceFile: `${memoryEntry.id}.txt`,
      projectName,
      memoryId: memoryEntry.id,
      topic: memoryEntry.topic || 'geral',
      documents: Array.isArray(memoryEntry.documents) ? memoryEntry.documents : [],
    };

    const script = `
import json, sys
payload = json.loads(sys.argv[1])
out = {"ok": True}
try:
    from mempalace.mcp_server import tool_add_drawer, tool_kg_add
    drawer = tool_add_drawer(
        payload["wing"],
        payload["room"],
        payload["content"],
        source_file=payload.get("sourceFile"),
        added_by="faber_cortex"
    )
    out["drawer"] = drawer
    if drawer.get("success"):
        source = drawer.get("drawer_id")
        out["kg_project"] = tool_kg_add(payload["projectName"], "has_cortex_memory", payload["memoryId"], source_closet=source)
        out["kg_topic"] = tool_kg_add(payload["memoryId"], "topic", payload["topic"], source_closet=source)
        out["kg_documents"] = []
        for document in payload.get("documents") or []:
            name = document.get("name") or "documento"
            out["kg_documents"].append(tool_kg_add(payload["memoryId"], "references_document", name, source_closet=source))
except Exception as exc:
    out = {"ok": False, "error": str(exc)}
print(json.dumps(out, ensure_ascii=False))
`;
    const result = await runMempalacePythonJson(script, payload, { timeoutMs: 12000 });
    if (!result.ok) return result;
    const data = result.data || {};
    if (data.ok === false) {
      return { ok: false, available: true, reason: 'mempalace_memory_error', message: data.error || 'Falha ao salvar memória Cortex.' };
    }
    return {
      ok: true,
      available: true,
      wing: payload.wing,
      drawerId: data.drawer && data.drawer.drawer_id ? data.drawer.drawer_id : null,
      drawer: data.drawer || null,
      kg: {
        project: data.kg_project || null,
        topic: data.kg_topic || null,
        documents: data.kg_documents || [],
      },
    };
  }

  async function forgetMempalaceMemory(input = {}) {
    const projectInfo = input.projectInfo && typeof input.projectInfo === 'object' ? input.projectInfo : null;
    const memoryId = String(input.memoryId || '').trim();
    if (!projectInfo || !memoryId) return { ok: false, reason: 'missing_mempalace_memory_forget_input' };
    const runtime = await getMempalaceRuntimeStatus(projectInfo);
    if (!runtime.available || !runtime.ready) {
      return { ok: false, available: false, reason: runtime.reason || 'runtime_unavailable', hint: runtime.message };
    }
    const projectName = path.basename(projectInfo.rootPath || 'projeto');
    const payload = {
      wing: runtime.wing || resolveWingFromProject(projectInfo),
      room: 'cortex_memory/tombstones',
      content: [
        `CORTEX_MEMORY_FORGET:${memoryId}`,
        `action:${input.action || 'forget'}`,
        `reason:${input.reason || 'user_requested_memory_forget'}`,
        `project:${projectName}`,
        `createdAt:${new Date().toISOString()}`,
      ].join('\n'),
      sourceFile: `${memoryId}.forget.txt`,
      projectName,
      memoryId,
    };
    const script = `
import json, sys
payload = json.loads(sys.argv[1])
out = {"ok": True}
try:
    from mempalace.mcp_server import tool_add_drawer, tool_kg_add
    drawer = tool_add_drawer(
        payload["wing"],
        payload["room"],
        payload["content"],
        source_file=payload.get("sourceFile"),
        added_by="faber_cortex"
    )
    out["drawer"] = drawer
    if drawer.get("success"):
        source = drawer.get("drawer_id")
        out["kg_forget"] = tool_kg_add(payload["memoryId"], "status", "forgotten", source_closet=source)
        out["kg_project"] = tool_kg_add(payload["projectName"], "forgot_cortex_memory", payload["memoryId"], source_closet=source)
except Exception as exc:
    out = {"ok": False, "error": str(exc)}
print(json.dumps(out, ensure_ascii=False))
`;
    const result = await runMempalacePythonJson(script, payload, { timeoutMs: 12000 });
    if (!result.ok) return result;
    const data = result.data || {};
    if (data.ok === false) {
      return { ok: false, available: true, reason: 'mempalace_forget_error', message: data.error || 'Falha ao registrar esquecimento no MemPalace.' };
    }
    return {
      ok: true,
      available: true,
      wing: payload.wing,
      drawerId: data.drawer && data.drawer.drawer_id ? data.drawer.drawer_id : null,
      drawer: data.drawer || null,
      kg: {
        forget: data.kg_forget || null,
        project: data.kg_project || null,
      },
    };
  }

  return {
    buildMempalaceCortexCore,
    buildMempalacePlannerContext,
    buildR2rQuery,
    buildRagPlannerContext,
    collectR2rSearchItems,
    ensureMempalaceProjectIndexed,
    forgetMempalaceMemory,
    forgetRagMemory,
    formatMempalaceCoreForPrompt,
    formatR2rContext,
    getMempalaceRuntimeStatus,
    getRagRuntimeStatus,
    indexCortexMemoryInRag,
    normalizeWingSlug,
    persistCortexMemoryToMempalace,
    persistCortexCheckpointToMempalace,
    postR2rJson,
    reindexRagProject,
    resolveWingFromProject,
    searchMempalaceContext,
  };
}

module.exports = {
  createMemoryContextAdapter,
  normalizeWingSlug,
};

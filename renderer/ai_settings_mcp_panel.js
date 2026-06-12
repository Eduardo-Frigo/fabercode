(function () {
  function normalizeListText(value) {
    return String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function listToText(value) {
    return Array.isArray(value) ? value.join(', ') : '';
  }

  function normalizeRecordText(value) {
    return String(value || '')
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .reduce((acc, entry) => {
        const separatorIndex = entry.indexOf('=');
        if (separatorIndex <= 0) return acc;
        const key = entry.slice(0, separatorIndex).trim();
        if (!key) return acc;
        acc[key] = entry.slice(separatorIndex + 1).trim();
        return acc;
      }, {});
  }

  function recordToText(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    return Object.keys(value)
      .map((key) => `${key}=${value[key]}`)
      .join('\n');
  }

  function createAiSettingsMcpPanel(options = {}) {
    const api = options.api || {};
    const elements = options.elements || {};
    const notify = typeof options.notify === 'function' ? options.notify : () => {};
    let servers = [];
    let presets = [];

    function setStatus(message, ok) {
      if (!elements.mcpStatus) return;
      elements.mcpStatus.innerHTML = '';
      const title = document.createElement('strong');
      title.textContent = ok === false ? 'MCP externo precisa de atenção' : 'MCP externo';
      const detail = document.createElement('span');
      detail.textContent = String(message || '');
      elements.mcpStatus.append(title, detail);
    }

    function clearEditor() {
      if (elements.mcpId) elements.mcpId.value = '';
      if (elements.mcpName) elements.mcpName.value = '';
      if (elements.mcpTransport) elements.mcpTransport.value = 'stdio';
      if (elements.mcpCommand) elements.mcpCommand.value = '';
      if (elements.mcpEndpoint) elements.mcpEndpoint.value = '';
      if (elements.mcpTimeout) elements.mcpTimeout.value = '8000';
      if (elements.mcpAllowed) elements.mcpAllowed.value = '';
      if (elements.mcpBlocked) elements.mcpBlocked.value = 'filesystem.write';
      if (elements.mcpPermissions) elements.mcpPermissions.value = 'read, write';
      if (elements.mcpBlockedRisks) elements.mcpBlockedRisks.value = 'critical';
      if (elements.mcpMaxRisk) elements.mcpMaxRisk.value = 'high';
      if (elements.mcpAllowedDirectories) elements.mcpAllowedDirectories.value = '';
      if (elements.mcpBlockedDirectories) elements.mcpBlockedDirectories.value = '.git, node_modules';
      if (elements.mcpAllowedNetworkHosts) elements.mcpAllowedNetworkHosts.value = 'localhost, 127.0.0.1, ::1';
      if (elements.mcpBlockedNetworkHosts) elements.mcpBlockedNetworkHosts.value = '';
      if (elements.mcpEnv) elements.mcpEnv.value = '';
      if (elements.mcpHeaders) elements.mcpHeaders.value = '';
      if (elements.mcpEnabled) elements.mcpEnabled.checked = true;
      if (elements.mcpApproved) elements.mcpApproved.checked = false;
      if (elements.mcpHighRiskAllow) elements.mcpHighRiskAllow.checked = false;
      if (elements.mcpInjectSession) elements.mcpInjectSession.checked = false;
      if (elements.mcpAllowExternalNetwork) elements.mcpAllowExternalNetwork.checked = false;
      syncTransportFields();
    }

    function fillEditor(server) {
      if (!server) {
        clearEditor();
        return;
      }
      if (elements.mcpId) elements.mcpId.value = server.id || '';
      if (elements.mcpName) elements.mcpName.value = server.name || '';
      if (elements.mcpTransport) elements.mcpTransport.value = server.transport || 'stdio';
      if (elements.mcpCommand) elements.mcpCommand.value = server.command || '';
      if (elements.mcpEndpoint) elements.mcpEndpoint.value = server.endpoint || '';
      if (elements.mcpTimeout) elements.mcpTimeout.value = String(server.requestTimeoutMs || 8000);
      if (elements.mcpAllowed) elements.mcpAllowed.value = listToText(server.allowedTools);
      if (elements.mcpBlocked) elements.mcpBlocked.value = listToText(server.blockedTools);
      const riskPolicy = server.riskPolicy || {};
      if (elements.mcpPermissions) elements.mcpPermissions.value = listToText(riskPolicy.allowedPermissions || ['read', 'write']);
      if (elements.mcpBlockedRisks) elements.mcpBlockedRisks.value = listToText(riskPolicy.blockedRiskLevels || ['critical']);
      if (elements.mcpMaxRisk) elements.mcpMaxRisk.value = riskPolicy.maxRiskLevel || 'high';
      const scopePolicy = server.scopePolicy || {};
      if (elements.mcpAllowedDirectories) elements.mcpAllowedDirectories.value = listToText(scopePolicy.allowedDirectories);
      if (elements.mcpBlockedDirectories) elements.mcpBlockedDirectories.value = listToText(scopePolicy.blockedDirectories || ['.git', 'node_modules']);
      if (elements.mcpAllowedNetworkHosts) elements.mcpAllowedNetworkHosts.value = listToText(scopePolicy.allowedNetworkHosts || ['localhost', '127.0.0.1', '::1']);
      if (elements.mcpBlockedNetworkHosts) elements.mcpBlockedNetworkHosts.value = listToText(scopePolicy.blockedNetworkHosts);
      if (elements.mcpEnv) elements.mcpEnv.value = recordToText(server.env);
      if (elements.mcpHeaders) elements.mcpHeaders.value = recordToText(server.headers);
      if (elements.mcpEnabled) elements.mcpEnabled.checked = server.enabled !== false;
      if (elements.mcpApproved) elements.mcpApproved.checked = server.trust === 'approved';
      if (elements.mcpHighRiskAllow) elements.mcpHighRiskAllow.checked = riskPolicy.requireExplicitAllowForHighRisk === true;
      if (elements.mcpInjectSession) elements.mcpInjectSession.checked = server.injectProjectSessionArgument === true;
      if (elements.mcpAllowExternalNetwork) elements.mcpAllowExternalNetwork.checked = scopePolicy.allowExternalNetwork === true;
      syncTransportFields();
    }

    function renderPresets() {
      if (!elements.mcpPresetSelect) return;
      elements.mcpPresetSelect.innerHTML = '';
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = presets.length ? 'Escolha um preset...' : 'Nenhum preset disponível';
      elements.mcpPresetSelect.appendChild(empty);
      presets.forEach((preset) => {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = `${preset.name}${preset.requiresSecrets ? ' · requer segredo' : ''}`;
        option.title = preset.description || '';
        elements.mcpPresetSelect.appendChild(option);
      });
    }

    async function refreshPresets() {
      if (!api.listExternalMcpPresets) {
        presets = [];
        renderPresets();
        return null;
      }
      const result = await api.listExternalMcpPresets();
      presets = result && Array.isArray(result.presets) ? result.presets : [];
      renderPresets();
      return result;
    }

    async function applySelectedPreset() {
      if (!elements.mcpPresetSelect || !api.applyExternalMcpPreset) return;
      const presetId = String(elements.mcpPresetSelect.value || '').trim();
      if (!presetId) {
        notify('Escolha um preset MCP para preencher o cadastro.');
        return;
      }
      const result = await api.applyExternalMcpPreset({ presetId });
      if (!result || !result.ok || !result.server) {
        notify(result && result.message ? result.message : 'Não consegui carregar este preset MCP.');
        return;
      }
      fillEditor(result.server);
      setStatus(`Preset carregado: ${result.server.name || presetId}. Revise e aprove antes de salvar.`, true);
    }

    function buildPayloadFromEditor() {
      const transport = elements.mcpTransport ? elements.mcpTransport.value : 'stdio';
      const commandText = elements.mcpCommand ? String(elements.mcpCommand.value || '').trim() : '';
      const commandParts = commandText.split(/\s+/).filter(Boolean);
      const id = elements.mcpId ? String(elements.mcpId.value || '').trim() : '';
      return {
        id,
        name: elements.mcpName ? String(elements.mcpName.value || '').trim() : '',
        transport,
        command: transport === 'stdio' ? commandParts[0] || '' : '',
        args: transport === 'stdio' ? commandParts.slice(1) : [],
        endpoint: transport === 'stdio' ? '' : (elements.mcpEndpoint ? String(elements.mcpEndpoint.value || '').trim() : ''),
        requestTimeoutMs: elements.mcpTimeout ? Number(elements.mcpTimeout.value || 8000) : 8000,
        env: transport === 'stdio' ? normalizeRecordText(elements.mcpEnv ? elements.mcpEnv.value : '') : {},
        headers: transport === 'stdio' ? {} : normalizeRecordText(elements.mcpHeaders ? elements.mcpHeaders.value : ''),
        enabled: elements.mcpEnabled ? elements.mcpEnabled.checked : true,
        trust: elements.mcpApproved && elements.mcpApproved.checked ? 'approved' : 'untrusted',
        permission: 'write',
        allowedTools: normalizeListText(elements.mcpAllowed ? elements.mcpAllowed.value : ''),
        blockedTools: normalizeListText(elements.mcpBlocked ? elements.mcpBlocked.value : ''),
        riskPolicy: {
          maxRiskLevel: elements.mcpMaxRisk ? elements.mcpMaxRisk.value : 'high',
          allowedPermissions: normalizeListText(elements.mcpPermissions ? elements.mcpPermissions.value : 'read, write'),
          blockedRiskLevels: normalizeListText(elements.mcpBlockedRisks ? elements.mcpBlockedRisks.value : 'critical'),
          requireExplicitAllowForHighRisk: elements.mcpHighRiskAllow ? elements.mcpHighRiskAllow.checked : false,
        },
        scopePolicy: {
          enforceProjectRoot: true,
          allowedDirectories: normalizeListText(elements.mcpAllowedDirectories ? elements.mcpAllowedDirectories.value : ''),
          blockedDirectories: normalizeListText(elements.mcpBlockedDirectories ? elements.mcpBlockedDirectories.value : '.git, node_modules'),
          allowExternalNetwork: elements.mcpAllowExternalNetwork ? elements.mcpAllowExternalNetwork.checked : false,
          allowedNetworkHosts: normalizeListText(elements.mcpAllowedNetworkHosts ? elements.mcpAllowedNetworkHosts.value : 'localhost, 127.0.0.1, ::1'),
          blockedNetworkHosts: normalizeListText(elements.mcpBlockedNetworkHosts ? elements.mcpBlockedNetworkHosts.value : ''),
        },
        injectProjectSessionArgument: elements.mcpInjectSession ? elements.mcpInjectSession.checked : false,
      };
    }

    function renderTools(container, tools) {
      const toolList = document.createElement('div');
      toolList.className = 'ai-settings-mcp-tools';
      if (!Array.isArray(tools) || !tools.length) {
        toolList.textContent = 'Nenhuma tool descoberta nesta rodada.';
        container.appendChild(toolList);
        return;
      }
      tools.forEach((tool) => {
        const chip = document.createElement('span');
        chip.className = `ai-settings-api-badge${tool.allowed ? ' is-active' : ' is-warning'}`;
        const risk = tool.riskLevel ? ` ${tool.riskLevel}` : '';
        const permission = tool.permission ? `/${tool.permission}` : '';
        const blocked = tool.allowed ? '' : ` bloqueada${tool.blockedReason ? `: ${tool.blockedReason}` : ''}`;
        chip.textContent = `${tool.name}${risk}${permission}${blocked}`;
        toolList.appendChild(chip);
      });
      container.appendChild(toolList);
    }

    function renderDiscoveryCache(container, cache) {
      if (!cache || !Array.isArray(cache.tools) || !cache.tools.length) return;
      const cacheHeader = document.createElement('div');
      cacheHeader.className = 'ai-settings-mcp-cache-title';
      cacheHeader.textContent = `Cache visual: ${cache.toolCount || cache.tools.length} tools`;
      const cacheTools = document.createElement('div');
      cacheTools.className = 'ai-settings-mcp-tools ai-settings-mcp-cache';
      cache.tools.slice(0, 12).forEach((tool) => {
        const chip = document.createElement('span');
        chip.className = `ai-settings-api-badge${tool.allowed ? ' is-active' : ' is-warning'}`;
        const risk = tool.riskLevel ? ` ${tool.riskLevel}` : '';
        const permission = tool.permission ? `/${tool.permission}` : '';
        chip.textContent = `${tool.name}${risk}${permission}`;
        cacheTools.appendChild(chip);
      });
      if (cache.tools.length > 12) {
        const more = document.createElement('span');
        more.className = 'ai-settings-api-badge';
        more.textContent = `+${cache.tools.length - 12}`;
        cacheTools.appendChild(more);
      }
      container.append(cacheHeader, cacheTools);
    }

    function renderServers() {
      if (!elements.mcpList) return;
      elements.mcpList.innerHTML = '';
      if (!servers.length) {
        const empty = document.createElement('p');
        empty.className = 'ai-settings-api-empty';
        empty.textContent = 'Nenhum servidor MCP externo configurado.';
        elements.mcpList.appendChild(empty);
        setStatus('Nenhum servidor configurado ainda.', false);
        return;
      }
      setStatus(`${servers.length} servidor(es) configurado(s).`, true);
      servers.forEach((server) => {
        const item = document.createElement('div');
        item.className = 'ai-settings-api-item ai-settings-mcp-item';
        if (server.trust !== 'approved' || !server.ready) item.classList.add('is-incomplete');

        const meta = document.createElement('div');
        meta.className = 'ai-settings-api-meta';
        const titleRow = document.createElement('div');
        titleRow.className = 'ai-settings-api-title-row';
        const title = document.createElement('strong');
        title.textContent = server.name || server.id;
        titleRow.appendChild(title);
        const transport = document.createElement('span');
        transport.className = 'ai-settings-api-badge';
        transport.textContent = server.transport || 'stdio';
        titleRow.appendChild(transport);
        const status = document.createElement('span');
        status.className = `ai-settings-api-badge${server.trust === 'approved' && server.ready ? ' is-active' : ' is-warning'}`;
        status.textContent = server.trust === 'approved' && server.ready ? 'pronto' : 'pendente';
        titleRow.appendChild(status);
        const detail = document.createElement('div');
        detail.className = 'ai-settings-api-detail';
        detail.textContent = server.transport === 'stdio' ? server.command || 'Comando ausente' : server.endpoint || 'Endpoint ausente';
        const facts = document.createElement('div');
        facts.className = 'ai-settings-api-facts';
        const riskPolicy = server.riskPolicy || {};
        facts.textContent = [
          `Permitidas: ${listToText(server.allowedTools) || 'todas'}`,
          `Bloqueadas: ${listToText(server.blockedTools) || 'nenhuma'}`,
          `Risco max: ${riskPolicy.maxRiskLevel || 'high'}`,
          `Permissoes: ${listToText(riskPolicy.allowedPermissions || ['read', 'write'])}`,
          `Dirs: ${listToText(server.scopePolicy && server.scopePolicy.allowedDirectories) || 'raiz do projeto'}`,
          `Rede: ${server.scopePolicy && server.scopePolicy.allowExternalNetwork ? 'externa permitida' : 'hosts permitidos'}`,
          server.hasEnv ? 'env configurado' : '',
          server.hasHeaders ? 'headers configurados' : '',
        ].filter(Boolean).join(' | ');
        meta.append(titleRow, detail, facts);
        renderDiscoveryCache(meta, server.discoveryCache);

        const actions = document.createElement('div');
        actions.className = 'ai-settings-api-actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'btn btn-muted';
        edit.textContent = 'Editar';
        edit.addEventListener('click', () => fillEditor(server));
        const discover = document.createElement('button');
        discover.type = 'button';
        discover.className = 'btn btn-success';
        discover.textContent = 'Descobrir';
        discover.addEventListener('click', async () => {
          if (!api.discoverExternalMcpTools) return;
          discover.disabled = true;
          const result = await api.discoverExternalMcpTools({ serverId: server.id, refresh: true });
          discover.disabled = false;
          if (!result || !result.ok) {
            setStatus(result && result.message ? result.message : 'Falha ao descobrir tools.', false);
            return;
          }
          const tools = result.data && result.data.tools ? result.data.tools : [];
          server.discoveryCache = {
            toolCount: tools.length,
            cachedAt: result.data && result.data.discoveredAt ? result.data.discoveredAt : '',
            discoveredAt: result.data && result.data.discoveredAt ? result.data.discoveredAt : '',
            tools,
          };
          renderServers();
          setStatus(`Tools descobertas em ${server.name || server.id}.`, true);
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-danger';
        remove.textContent = 'Remover';
        remove.addEventListener('click', async () => {
          if (!api.removeExternalMcpServer) return;
          const result = await api.removeExternalMcpServer({ serverId: server.id });
          if (!result || !result.ok) {
            notify(result && result.message ? result.message : 'Não consegui remover o servidor MCP.');
            return;
          }
          servers = result.servers || [];
          renderServers();
        });
        actions.append(edit, discover, remove);
        item.append(meta, actions);
        elements.mcpList.appendChild(item);
      });
    }

    async function refresh() {
      await refreshPresets();
      if (!api.listExternalMcpServers) {
        setStatus('IPC de MCP externo indisponível nesta build.', false);
        return;
      }
      const result = await api.listExternalMcpServers();
      if (!result || !result.ok) {
        setStatus(result && result.message ? result.message : 'Não consegui carregar MCP externo.', false);
        return;
      }
      servers = result.servers || [];
      renderServers();
    }

    async function saveFromEditor() {
      if (!api.saveExternalMcpServer) return;
      const payload = buildPayloadFromEditor();
      if (!payload.name) {
        notify('Informe um nome para o servidor MCP.');
        return;
      }
      if (payload.transport === 'stdio' && !payload.command) {
        notify('Informe o comando stdio.');
        return;
      }
      if (payload.transport !== 'stdio' && !payload.endpoint) {
        notify('Informe o endpoint HTTP/SSE.');
        return;
      }
      if (payload.requestTimeoutMs < 500 || payload.requestTimeoutMs > 120000 || !Number.isFinite(payload.requestTimeoutMs)) {
        notify('Informe timeout entre 500 e 120000 ms.');
        return;
      }
      const result = await api.saveExternalMcpServer({ server: payload });
      if (!result || !result.ok) {
        notify(result && result.message ? result.message : 'Não consegui salvar o servidor MCP.');
        return;
      }
      servers = result.servers || [];
      clearEditor();
      renderServers();
      setStatus('Servidor MCP salvo.', true);
    }

    function syncTransportFields() {
      const transport = elements.mcpTransport ? elements.mcpTransport.value : 'stdio';
      if (elements.mcpCommand) elements.mcpCommand.disabled = transport !== 'stdio';
      if (elements.mcpEndpoint) elements.mcpEndpoint.disabled = transport === 'stdio';
      if (elements.mcpEnv) elements.mcpEnv.disabled = transport !== 'stdio';
      if (elements.mcpHeaders) elements.mcpHeaders.disabled = transport === 'stdio';
    }

    function bindEvents() {
      if (elements.mcpNew) elements.mcpNew.addEventListener('click', clearEditor);
      if (elements.mcpSave) elements.mcpSave.addEventListener('click', saveFromEditor);
      if (elements.mcpPresetApply) elements.mcpPresetApply.addEventListener('click', applySelectedPreset);
      if (elements.mcpTransport) {
        elements.mcpTransport.addEventListener('change', syncTransportFields);
      }
      syncTransportFields();
    }

    return {
      bindEvents,
      clearEditor,
      refreshPresets,
      refresh,
      renderServers,
    };
  }

  window.FaberAiSettingsMcpPanel = {
    createAiSettingsMcpPanel,
  };
})();

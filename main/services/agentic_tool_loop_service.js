function defaultClipText(value = '', maxChars = 12000) {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function actionRequiresFileChanges(action = {}) {
  const route = action.routeDecision || {};
  const productRoute = route.productRoute || {};
  const text = `${action.userMessage || ''} ${route.executionMessage || ''}`.toLowerCase();
  return (
    productRoute.capability === 'create_project' ||
    productRoute.executionIntent === 'init_project' ||
    productRoute.capability === 'edit_project' ||
    productRoute.executionIntent === 'edit_project' ||
    /\b(criar|crie|gerar|gere|implementar|implemente|arquivos|projeto|app|site|escrever|alterar|altere|modificar|modifique|adicionar|adicione)\b/.test(text)
  );
}

function createAgenticToolLoopService(dependencies = {}) {
  const {
    appendAuditEvent = () => {},
    appendJobEvent = () => {},
    clipText = defaultClipText,
    executeCapability = null,
    executeTool = null,
    getEffectiveGeminiModel = () => '',
    getEffectiveOpenAiModel = () => '',
    getSelectedAiProvider = () => '',
    requestModelTurn = null,
    setJobCheckpoint = () => {},
    shouldUseModel = () => false,
    timeoutMs = 90000,
    maxSteps = 10,
  } = dependencies;

  function supportsAgenticExecution() {
    const provider = String(getSelectedAiProvider() || '').trim().toLowerCase();
    if (provider === 'openai') {
      const model = String(getEffectiveOpenAiModel() || '').trim();
      return Boolean(model);
    }
    if (provider === 'gemini') {
      return true;
    }
    return false;
  }

  function buildProjectSession(projectInfo = {}) {
    return {
      projectId: projectInfo && projectInfo.id ? projectInfo.id : '',
      rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '',
      realRootPath:
        projectInfo && (projectInfo.realRootPath || projectInfo.rootPath)
          ? projectInfo.realRootPath || projectInfo.rootPath
          : '',
    };
  }

  function summarizeAttachments(attachments = []) {
    if (!Array.isArray(attachments) || !attachments.length) return '';
    return attachments
      .map((item) => `${item && item.name ? item.name : 'anexo'} (${item && item.type ? item.type : 'desconhecido'})`)
      .join(', ');
  }

  function buildSystemPrompt(projectInfo = {}) {
    const rootPath = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    return [
      'Você é o runtime agentic do Faber Code. Seu trabalho é agir como um engenheiro de software sênior direto no projeto.',
      'IMPORTANTE: Você está na fase de EXECUÇÃO. Não responda apenas com texto (ex: "Vou começar"). Você deve chamar ferramentas imediatamente.',
      '## Diretrizes de Edição (CRÍTICO)',
      '1. PREFIRA EDITAR A REESCREVER: Nunca use write_file para modificar um arquivo existente inteiro. Sempre use `edit_file_fuzzy`.',
      '2. COMO USAR edit_file_fuzzy: Copie um bloco único e exato do arquivo (targetContent) e forneça a nova versão (replacementContent). O sistema ignora espaços e indentações para te ajudar a encontrar o bloco.',
      '3. NUNCA DEIXE CÓDIGO QUEBRADO: Se você criar ou modificar arquivos de código (TS, JS, etc), use `run_command` para rodar linters (`npm run lint`), checagem de tipos (`npx tsc --noEmit`) ou testes ANTES de concluir a tarefa.',
      '4. AUTO-CORREÇÃO: Se um comando de terminal falhar com erros de sintaxe ou lint, analise a saída de erro e chame a ferramenta de edição para corrigir o arquivo.',
      '5. COMANDOS NÃO-INTERATIVOS: Qualquer comando no `run_command` deve ter flags como -y ou --yes. Não use comandos que exigem input do usuário.',
      '6. MAPA DA APLICAÇÃO E MILESTONES: O projeto utiliza um Mapa da Aplicação (JSON em `.faber/application-map.json`, Markdowns em `docs/application-map/`) e Milestones (JSON em `.faber/milestones.json`, Markdowns em `docs/milestones/`). Ao criar, modificar ou remover componentes/arquivos ou concluir etapas, certifique-se de manter esses arquivos de documentação e planejamento sincronizados e atualizados.',
      '## Conclusão',
      'Sempre chame a ferramenta `finish_task` para indicar que você terminou, não importa se foi um sucesso ou se você encontrou um bloqueio instransponível.',
      `Projeto ativo: ${rootPath || 'indisponível'}.`,
    ].join('\n');
  }

  function buildBoundTools(projectInfo = {}) {
    const projectSession = buildProjectSession(projectInfo);
    const rootPath = projectSession.rootPath;
    const capability = (capabilityId, action, payload = {}) =>
      executeCapability({
        capability: capabilityId,
        action,
        payload,
        projectSession,
      });
    const runTool = (name, input = {}) => executeTool(name, input);

    return [
      {
        name: 'project_tree',
        description: 'Lista a árvore resumida do projeto ativo, incluindo stacks detectadas e arquivos principais.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        execute: async () => capability('filesystem', 'project_tree', {}),
      },
      {
        name: 'read_file',
        description: 'Lê um arquivo dentro do projeto ativo.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['path'],
          properties: {
            path: { type: 'string' },
            maxChars: { type: 'integer', minimum: 200, maximum: 20000 },
          },
        },
        execute: async (input = {}) =>
          capability('filesystem', 'read_file', {
            path: input.path,
            maxChars: input.maxChars,
          }),
      },
      {
        name: 'search_text',
        description: 'Busca texto nos arquivos do projeto sem alterar conteúdo.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['targetText'],
          properties: {
            targetText: { type: 'string' },
          },
        },
        execute: async (input = {}) =>
          runTool('automata.search_text_in_files', {
            rootPath,
            targetText: input.targetText,
          }),
      },
      {
        name: 'write_file',
        description: 'Cria ou sobrescreve um arquivo dentro do projeto ativo.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'content'],
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
        },
        execute: async (input = {}) =>
          runTool('automata.execute_operation_batch', {
            rootPath,
            operations: [
              {
                op: 'write_file',
                path: input.path,
                content: String(input.content || ''),
              },
            ],
          }),
      },
      {
        name: 'write_files_batch',
        description: 'Cria ou sobrescreve vários arquivos em um lote único dentro do projeto ativo.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['operations'],
          properties: {
            operations: {
              type: 'array',
              minItems: 1,
              maxItems: 24,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['path', 'content'],
                properties: {
                  path: { type: 'string' },
                  content: { type: 'string' },
                },
              },
            },
          },
        },
        execute: async (input = {}) =>
          runTool('automata.execute_operation_batch', {
            rootPath,
            operations: (Array.isArray(input.operations) ? input.operations : []).map((entry) => ({
              op: 'write_file',
              path: entry.path,
              content: String(entry.content || ''),
            })),
          }),
      },
      {
        name: 'edit_file_fuzzy',
        description: 'Edita um arquivo existente substituindo um bloco de texto por outro de forma tolerante a falhas.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'targetContent', 'replacementContent'],
          properties: {
            path: { type: 'string' },
            targetContent: { type: 'string' },
            replacementContent: { type: 'string' },
          },
        },
        execute: async (input = {}) =>
          runTool('automata.edit_file_fuzzy', {
            rootPath,
            targetFile: input.path,
            targetContent: String(input.targetContent || ''),
            replacementContent: String(input.replacementContent || ''),
          }),
      },
      {
        name: 'finish_task',
        description: 'Encerra a execução do agente. Chame esta ferramenta quando terminar tudo ou não puder prosseguir.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'summary'],
          properties: {
            status: { type: 'string', enum: ['success', 'failure'] },
            summary: { type: 'string', description: 'Resumo do que foi feito e do que ficou pendente.' },
          },
        },
        execute: async (input = {}) => {
          return { ok: true, status: input.status, message: 'Tarefa encerrada: ' + input.summary, _isFinishTask: true };
        },
      },
      {
        name: 'run_command',
        description: 'Roda um comando de terminal preso à raiz do projeto e retorna saída auditável. NÃO USE cd, passe caminhos relativos ao invés disso.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['command'],
          properties: {
            command: { type: 'string' },
            sessionId: { type: 'string' },
          },
        },
        execute: async (input = {}) =>
          capability('terminal', 'run_command', {
            command: input.command,
            sessionId: input.sessionId,
          }),
      },
      {
        name: 'terminal_status',
        description: 'Consulta sessões e saída atual do terminal do projeto.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        execute: async () => {
          const res = await capability('terminal', 'status', {});
          if (res && res.data && Array.isArray(res.data.sessions)) {
            const isRunning = res.data.sessions.some(s => s.running);
            if (isRunning) {
              await new Promise(r => setTimeout(r, 4000));
            }
          }
          return res;
        },
      },
      {
        name: 'preview_capture',
        description: 'Inicia preview e captura evidência visual real do projeto.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            stopAfterCapture: { type: 'boolean' },
          },
        },
        execute: async (input = {}) =>
          capability('browser_preview', 'capture', {
            stopAfterCapture: input.stopAfterCapture !== false,
          }),
      },
      {
        name: 'git_status',
        description: 'Lê o status Git atual do projeto.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        execute: async () => capability('git', 'status', {}),
      },
      {
        name: 'structured_edit_plan',
        description: 'Pede ao Faber um patch estruturado determinístico para uma alteração pontual.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['prompt'],
          properties: {
            prompt: { type: 'string' },
          },
        },
        execute: async (input = {}) =>
          capability('structured_edit', 'plan', {
            prompt: input.prompt,
          }),
      },
      {
        name: 'structured_edit_apply',
        description: 'Aplica um patch estruturado determinístico quando o pedido encaixa em micro-edits seguros.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['prompt'],
          properties: {
            prompt: { type: 'string' },
          },
        },
        execute: async (input = {}) =>
          capability('structured_edit', 'apply', {
            prompt: input.prompt,
          }),
      },
    ];
  }

  function sanitizeSchemaForStrict(schema) {
    if (!schema || typeof schema !== 'object') {
      return { type: 'object', properties: {}, required: [], additionalProperties: false };
    }
    const result = { ...schema };
    if (result.type === 'object') {
      result.additionalProperties = false;
      if (!result.properties) {
        result.properties = {};
      }
      const propKeys = Object.keys(result.properties);
      const newProperties = {};
      for (const key of propKeys) {
        newProperties[key] = sanitizeSchemaForStrict(result.properties[key]);
      }
      result.properties = newProperties;
      result.required = propKeys;
    } else if (result.type === 'array' && result.items) {
      result.items = sanitizeSchemaForStrict(result.items);
    }
    return result;
  }

  function buildToolDefinitions(tools = []) {
    const provider = String(getSelectedAiProvider() || '').trim().toLowerCase();
    const isStrictSupported = provider === 'openai';

    return tools.map((tool) => {
      const baseParams = tool.inputSchema || { type: 'object', additionalProperties: false, properties: {} };
      const parameters = isStrictSupported ? sanitizeSchemaForStrict(baseParams) : baseParams;

      const definition = {
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters,
      };
      if (isStrictSupported) {
        definition.strict = true;
      }
      return definition;
    });
  }

  function makeToolIndex(tools = []) {
    const map = new Map();
    for (const tool of tools) {
      map.set(tool.name, tool);
    }
    return map;
  }

  function collectModifiedFilesFromResult(toolName, input, result) {
    const files = new Set();
    if ((toolName === 'write_file' || toolName === 'automata.apply_file_patch') && input) {
      const p = input.path || input.targetFile;
      if (p) files.add(String(p));
    }
    if (toolName === 'write_files_batch' || toolName === 'automata.execute_operation_batch') {
      for (const entry of Array.isArray(input && input.operations) ? input.operations : []) {
        if (entry && entry.path) files.add(String(entry.path));
      }
    }
    const candidates = [];
    if (result && Array.isArray(result.modifiedFiles)) candidates.push(...result.modifiedFiles);
    if (result && result.data && Array.isArray(result.data.applied)) candidates.push(...result.data.applied);
    if (result && result.result && Array.isArray(result.result.applied)) candidates.push(...result.result.applied);
    for (const value of candidates) {
      if (value) files.add(String(value));
    }
    return [...files];
  }

  function summarizeToolResultForModel(result) {
    const summary = {
      ok: Boolean(result && result.ok),
      status: result && result.status ? result.status : '',
      message: result && result.message ? result.message : '',
      errors: result && Array.isArray(result.errors) ? result.errors.slice(0, 8) : [],
      warnings: result && Array.isArray(result.warnings) ? result.warnings.slice(0, 8) : [],
      artifacts: result && Array.isArray(result.artifacts) ? result.artifacts.slice(0, 8) : [],
      logs: result && Array.isArray(result.logs) ? result.logs.slice(0, 4) : [],
      data: result && result.data ? result.data : null,
    };
    
    // Safely truncate large string data before stringify
    if (summary.data && typeof summary.data.content === 'string' && summary.data.content.length > 13000) {
      summary.data.content = summary.data.content.slice(0, 13000) + '... [TRUNCATED]';
    }
    if (summary.logs && summary.logs[0] && typeof summary.logs[0] === 'string' && summary.logs[0].length > 13000) {
      summary.logs[0] = summary.logs[0].slice(0, 13000) + '... [TRUNCATED]';
    }
    
    const raw = JSON.stringify(summary, null, 2);
    return raw.length > 14000 ? raw.slice(0, 13997) + '...' : raw;
  }

  function buildConversationMessages(conversationMessages = [], userMessage = '', attachments = []) {
    const messages = [];
    for (const message of Array.isArray(conversationMessages) ? conversationMessages.slice(-8) : []) {
      const role = message && message.role === 'assistant' ? 'assistant' : 'user';
      const content = String(
        message && (message.text || message.content || message.message)
          ? message.text || message.content || message.message
          : ''
      ).trim();
      if (!content) continue;
      messages.push({ role, content });
    }
    const contentArr = [];
    if (userMessage) {
      contentArr.push({ type: 'text', text: String(userMessage).trim() });
    }
    
    if (Array.isArray(attachments)) {
      const fs = require('fs');
      for (const att of attachments) {
        if (att && att.path && (att.type.startsWith('image/') || att.path.match(/\.(png|jpe?g|gif|webp)$/i))) {
          try {
            if (fs.existsSync(att.path)) {
              const base64 = fs.readFileSync(att.path, 'base64');
              let mime = att.type || 'image/jpeg';
              if (att.path.endsWith('.png')) mime = 'image/png';
              else if (att.path.endsWith('.webp')) mime = 'image/webp';
              else if (att.path.endsWith('.gif')) mime = 'image/gif';
              contentArr.push({
                type: 'image_url',
                image_url: { url: `data:${mime};base64,${base64}` }
              });
            }
          } catch (e) {}
        }
      }
    }
    
    if (contentArr.length > 0) {
      messages.push({ role: 'user', content: contentArr });
    } else {
      const attachmentSummary = summarizeAttachments(attachments);
      const fallbackMessage = attachmentSummary
        ? `${String(userMessage || '').trim()}\n\nAnexos: ${attachmentSummary}`
        : String(userMessage || '').trim();
      if (fallbackMessage) messages.push({ role: 'user', content: fallbackMessage });
    }
    
    return messages;
  }

  function buildExecutionPlan(payload = {}) {
    if (!supportsAgenticExecution()) return null;
    const projectInfo = payload.projectInfo || null;
    if (!projectInfo || !projectInfo.rootPath) return null;

    return {
      ok: true,
      response: 'Entendi. Vou trabalhar nisso agora e te volto com resultado real.',
      action: {
        type: 'agentic_tool_loop',
        userMessage: payload.userMessage || '',
        attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
        conversationMessages: Array.isArray(payload.conversationMessages) ? payload.conversationMessages : [],
        contextHint: payload.contextHint || null,
        routeDecision: payload.routeDecision || null,
        rootPath: projectInfo.rootPath,
      },
      meta: {
        planner: 'agentic_tool_loop',
        reason: 'agentic_tool_loop_ready',
        autoExecute: true,
        provider: getSelectedAiProvider(),
      },
    };
  }

  async function executeAction(action = {}, projectInfo = {}, options = {}) {
    if (!supportsAgenticExecution()) {
      return {
        ok: false,
        message: 'O loop agentic direto só está disponível com os provedores suportados (OpenAI, Gemini).',
      };
    }
    if (typeof requestModelTurn !== 'function') {
      return { ok: false, message: 'Cliente do modelo agentic indisponível.' };
    }
    if (typeof executeCapability !== 'function' || typeof executeTool !== 'function') {
      return { ok: false, message: 'Ferramentas locais indisponíveis para o loop agentic.' };
    }

    const jobId = options && options.jobId ? String(options.jobId) : String(action && action.jobId ? action.jobId : '');
    const tools = buildBoundTools(projectInfo);
    const toolDefinitions = buildToolDefinitions(tools);
    const toolIndex = makeToolIndex(tools);
    const conversationMessages = buildConversationMessages(
      action.conversationMessages || [],
      action.userMessage || '',
      action.attachments || []
    );
    const systemPrompt = buildSystemPrompt(projectInfo);
    const allTextParts = [];
    const modifiedFiles = new Set();
    const toolRuns = [];
    let previousResponseId = '';
    let pendingToolResults = [];
    let isFinished = false;
  let lastFinishResult = null;
    let finishReason = '';
    
    // Doom Loop Detector State
    const recentFailedToolCalls = [];
    let consecutiveEmptyTurns = 0;

    if (jobId) {
      const activeProvider = String(getSelectedAiProvider() || '').trim().toLowerCase();
      setJobCheckpoint(jobId, 'agentic_loop', {
        started: true,
        provider: activeProvider,
        model: activeProvider === 'gemini' ? getEffectiveGeminiModel() : getEffectiveOpenAiModel(),
      });
    }

    for (let step = 0; step < maxSteps; step += 1) {
      if (jobId) {
        appendJobEvent(jobId, 'job.agentic_turn_started', {
          step: step + 1,
          previousResponseId: previousResponseId || null,
        });
      }

      const turn = await requestModelTurn({
        previousResponseId,
        systemPrompt,
        conversationMessages,
        toolResults: pendingToolResults,
        tools: toolDefinitions,
        timeoutMs,
      });

      previousResponseId = turn && turn.responseId ? String(turn.responseId) : previousResponseId;
      if (turn && turn.text) {
        allTextParts.push(String(turn.text).trim());
      }

      if (jobId) {
        setJobCheckpoint(jobId, 'agentic_last_turn', {
          step: step + 1,
          responseId: previousResponseId || null,
          toolCalls: Array.isArray(turn && turn.toolCalls) ? turn.toolCalls.length : 0,
          textPreview: turn && turn.text ? clipText(turn.text, 400) : '',
        });
      }

      const toolCalls = Array.isArray(turn && turn.toolCalls) ? turn.toolCalls : [];
      if (!toolCalls.length && !isFinished) {
        consecutiveEmptyTurns += 1;
        const finalMessage = allTextParts.filter(Boolean).join('\n\n').trim();

        if (modifiedFiles.size > 0 && finalMessage) {
          return {
            ok: true,
            agentic: true,
            message: finalMessage,
            modifiedFiles: [...modifiedFiles],
            toolRuns,
          };
        }
        
        if (consecutiveEmptyTurns < 4 && maxSteps > 1) {
          if (turn && turn.text) {
            conversationMessages.push({ role: 'assistant', content: turn.text });
          }
          conversationMessages.push({
            role: 'user',
            content: 'Lembrete: Você não chamou nenhuma ferramenta. Você DEVE usar tools para interagir com o projeto e concluir a tarefa. Não pare até terminar usando finish_task.',
          });
          previousResponseId = '';
          pendingToolResults = [];
          continue;
        }

        if (actionRequiresFileChanges(action) && modifiedFiles.size === 0) {
          return {
            ok: false,
            status: 'blocked',
            errors: ['agentic_no_file_changes'],
            message: 'Sem alterações de arquivos requeridas.',
            modifiedFiles: [],
            toolRuns,
          };
        }
        return {
          ok: true,
          agentic: true,
          message: finalMessage || 'Concluído.',
          modifiedFiles: [...modifiedFiles],
          toolRuns,
        };
      }

      consecutiveEmptyTurns = 0;
      pendingToolResults = [];
      for (const call of toolCalls) {
        const tool = toolIndex.get(String(call && call.name ? call.name : ''));
        if (!tool) {
          const output = JSON.stringify({ ok: false, message: `Tool desconhecida: ${call && call.name ? call.name : ''}` });
          pendingToolResults.push({
            callId: call && call.callId ? call.callId : call && call.id ? call.id : '',
            output,
          });
          continue;
        }

        // Doom Loop Check
        const currentCallKey = `${tool.name}:${JSON.stringify(call.input || {})}`;
        const identicalFails = recentFailedToolCalls.filter(k => k === currentCallKey).length;
        if (identicalFails >= 2) {
          pendingToolResults.push({
            callId: call && call.callId ? call.callId : call && call.id ? call.id : '',
            output: JSON.stringify({ ok: false, message: 'SISTEMA: Você repetiu esta exata chamada falha múltiplas vezes. Você está preso em um DOOM LOOP. Por favor, tente uma abordagem completamente diferente ou encerre usando finish_task.' }),
          });
          continue;
        }

        if (jobId) {
          appendJobEvent(jobId, 'job.agentic_tool_called', {
            step: step + 1,
            toolName: tool.name,
          });
        }

        let result = null;
        try {
          result = await tool.execute(call.input || {});
          if (result && result._isFinishTask) {
            isFinished = true;
            finishReason = result.message;
            lastFinishResult = result;
            // Preserve status from finish_task for later checks
            result.finishTaskStatus = result.status;
          }
        } catch (error) {
          result = {
            ok: false,
            status: 'failed',
            message: error && error.message ? error.message : String(error || ''),
            errors: ['agentic_tool_execution_failed'],
          };
        }

        if (!result.ok) {
          recentFailedToolCalls.push(currentCallKey);
          if (recentFailedToolCalls.length > 10) recentFailedToolCalls.shift();
        }

        collectModifiedFilesFromResult(tool.name, call.input || {}, result).forEach((file) => modifiedFiles.add(file));

        toolRuns.push({
          step: step + 1,
          toolName: tool.name,
          ok: Boolean(result && result.ok),
          message: result && result.message ? result.message : '',
        });

        if (jobId) {
          appendJobEvent(jobId, 'job.agentic_tool_result', {
            step: step + 1,
            toolName: tool.name,
            ok: Boolean(result && result.ok),
            message: result && result.message ? clipText(result.message, 320) : '',
          });
        }

        pendingToolResults.push({
          callId: call && call.callId ? call.callId : call && call.id ? call.id : '',
          output: summarizeToolResultForModel(result),
        });
      }

      if (isFinished) {
        if (actionRequiresFileChanges(action) && modifiedFiles.size === 0 && lastFinishResult && lastFinishResult.status === 'success') {
          return {
            ok: false,
            status: 'blocked',
            errors: ['agentic_no_file_changes'],
            message: 'Sem alterações de arquivos requeridas ao finalizar.',
            modifiedFiles: [],
            toolRuns,
          };
        }
        return {
          ok: true,
          agentic: true,
          message: finishReason,
          modifiedFiles: [...modifiedFiles],
          toolRuns,
        };
      }
    }

    appendAuditEvent('assistant.agentic_loop_step_limit', {
      rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
      maxSteps,
    });

    return {
      ok: false,
      status: 'step_limit',
      errors: ['agentic_step_limit_exceeded'],
      message: `O loop agentic atingiu o limite de ${maxSteps} passos antes de concluir.`,
      modifiedFiles: [...modifiedFiles],
      toolRuns,
    };
  }

  return {
    buildExecutionPlan,
    executeAction,
    supportsAgenticExecution,
  };
}

module.exports = {
  createAgenticToolLoopService,
};

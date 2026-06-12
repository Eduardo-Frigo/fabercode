function defaultClipText(value = '', maxChars = 12000) {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function createAgenticToolLoopService(dependencies = {}) {
  const {
    appendAuditEvent = () => {},
    appendJobEvent = () => {},
    clipText = defaultClipText,
    executeCapability = null,
    executeTool = null,
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
    const model = String(getEffectiveOpenAiModel() || '').trim();
    return provider === 'openai' && Boolean(model) && shouldUseModel(model);
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
      'Você é o runtime agentic do Faber Code.',
      'Seu trabalho é agir como um agente de desenvolvimento real dentro do projeto local.',
      'Não pare em plano, blueprint ou promessa quando o pedido exigir trabalho técnico.',
      'Use as tools para inspecionar arquivos, editar, rodar comandos, validar preview e concluir a tarefa.',
      'Não peça confirmação extra depois que o pedido já estiver claro.',
      'Prefira ler o projeto antes de escrever, mas não prolongue análise sem necessidade.',
      'Quando modificar algo, valide com terminal, preview ou leitura final dos arquivos sempre que fizer sentido.',
      'Explique no final, em português natural, o que foi feito de verdade e o que ainda ficou pendente.',
      `Projeto ativo: ${rootPath || 'indisponível'}.`,
    ].join(' ');
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
        name: 'run_command',
        description: 'Roda um comando de terminal preso à raiz do projeto e retorna saída auditável.',
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
        execute: async () => capability('terminal', 'status', {}),
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

  function buildToolDefinitions(tools = []) {
    return tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || { type: 'object', additionalProperties: false, properties: {} },
      strict: true,
    }));
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
    if (toolName === 'write_file' && input && input.path) files.add(String(input.path));
    if (toolName === 'write_files_batch') {
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
    return clipText(JSON.stringify(summary), 14000);
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
    const attachmentSummary = summarizeAttachments(attachments);
    const currentMessage = attachmentSummary
      ? `${String(userMessage || '').trim()}\n\nAnexos: ${attachmentSummary}`
      : String(userMessage || '').trim();
    if (currentMessage) messages.push({ role: 'user', content: currentMessage });
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
        provider: 'openai',
      },
    };
  }

  async function executeAction(action = {}, projectInfo = {}, options = {}) {
    if (!supportsAgenticExecution()) {
      return {
        ok: false,
        message: 'O loop agentic direto só está disponível com provider OpenAI em modelo compatível com tools.',
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

    if (jobId) {
      setJobCheckpoint(jobId, 'agentic_loop', {
        started: true,
        provider: 'openai',
        model: getEffectiveOpenAiModel(),
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
      if (!toolCalls.length) {
        const finalMessage = allTextParts.filter(Boolean).join('\n\n').trim();
        return {
          ok: true,
          agentic: true,
          message: finalMessage || 'Concluído.',
          modifiedFiles: [...modifiedFiles],
          toolRuns,
        };
      }

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

        if (jobId) {
          appendJobEvent(jobId, 'job.agentic_tool_called', {
            step: step + 1,
            toolName: tool.name,
          });
        }

        let result = null;
        try {
          result = await tool.execute(call.input || {});
        } catch (error) {
          result = {
            ok: false,
            status: 'failed',
            message: error && error.message ? error.message : String(error || ''),
            errors: ['agentic_tool_execution_failed'],
          };
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
    }

    appendAuditEvent('assistant.agentic_loop_step_limit', {
      rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
      maxSteps,
    });

    return {
      ok: false,
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

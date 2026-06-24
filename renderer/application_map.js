(function () {
  function createApplicationMapController(options = {}) {
    const api = options.api || {};
    const getSelectedProjectId = typeof options.getSelectedProjectId === 'function' ? options.getSelectedProjectId : () => '';
    const getSelectedProjectInfo = typeof options.getSelectedProjectInfo === 'function' ? options.getSelectedProjectInfo : () => null;
    const appendMessage = typeof options.appendMessage === 'function' ? options.appendMessage : () => {};
    const getTerminalController = typeof options.getTerminalController === 'function' ? options.getTerminalController : () => null;

    const container = document.getElementById('workspace-map-region');
    const tabChat = document.getElementById('btn-tab-chat');
    const tabMap = document.getElementById('btn-tab-map');
    const centerTabs = document.getElementById('center-tabs');

    const inspector = document.getElementById('workspace-map-inspector-panel');
    const inspectorTitle = document.getElementById('inspector-node-title');
    const inspectorDesc = document.getElementById('inspector-node-desc');
    const inspectorContent = document.getElementById('inspector-node-content');
    const inspectorAssetField = document.getElementById('inspector-asset-upload-field');
    const inspectorAssetInput = document.getElementById('map-asset-file-input');
    const inspectorClose = document.getElementById('btn-map-inspector-close');
    const inspectorDelete = document.getElementById('btn-map-delete-node');

    let canvasController = null;
    let autosaveTimeout = null;
    let contentEditor = null;

    function insertMarkdown(format) {
      if (!contentEditor) return;
      const doc = contentEditor.getDoc();
      const cursor = doc.getCursor();
      const selection = doc.getSelection();

      let replacement = '';
      let cursorOffset = 0;

      switch (format) {
        case 'h1':
          replacement = `# ${selection || 'Título 1'}`;
          break;
        case 'h2':
          replacement = `## ${selection || 'Título 2'}`;
          break;
        case 'bold':
          replacement = `**${selection || 'texto'}**`;
          cursorOffset = selection ? 0 : -2;
          break;
        case 'italic':
          replacement = `*${selection || 'texto'}*`;
          cursorOffset = selection ? 0 : -1;
          break;
        case 'list':
          replacement = `- ${selection || 'item'}`;
          break;
        case 'code':
          replacement = `\`\`\`\n${selection || 'código'}\n\`\`\``;
          break;
        case 'link':
          replacement = `[${selection || 'link'}](url)`;
          cursorOffset = selection ? 0 : -5;
          break;
      }

      doc.replaceSelection(replacement);
      contentEditor.focus();
      
      if (cursorOffset !== 0) {
        const newCursor = doc.getCursor();
        doc.setCursor({ line: newCursor.line, ch: newCursor.ch + cursorOffset });
      }
    }

    function init() {
      // Set up tabs switching
      if (tabChat && tabMap) {
        tabChat.addEventListener('click', () => {
          switchTab('chat');
        });
        tabMap.addEventListener('click', () => {
          switchTab('map');
        });
      }

      if (inspectorContent && typeof window.CodeMirror !== 'undefined') {
        contentEditor = window.CodeMirror.fromTextArea(inspectorContent, {
          mode: 'markdown',
          theme: 'material-darker',
          lineWrapping: true,
          viewportMargin: Infinity
        });
        contentEditor.on('change', () => {
          inspectorContent.value = contentEditor.getValue();
          updateSelectedNodeData();
        });
      }

      // Initialize canvas
      canvasController = window.FaberApplicationMapCanvas.createApplicationMapCanvas(container, {
        api,
        getProjectId: getSelectedProjectId,
        getSelectedProjectInfo,
        onNodeSelected: (node, openEdit) => {
          if (node) {
            if (openEdit) {
              openInspector(node);
            }
          } else {
            closeInspector();
          }
        },
        onMapChanged: () => {
          triggerAutosave();
        },
        onToolChanged: (tool) => {
          persistTools.forEach((otherId) => {
            const b = container.querySelector(`#${otherId}`);
            if (b) {
              const expectedId = tool === 'select' ? 'btn-map-tool-select' : 'btn-map-tool-hand';
              b.classList.toggle('active', otherId === expectedId);
            }
          });
        }
      });

      // Bind toolbar actions
      const persistTools = ['btn-map-tool-select', 'btn-map-tool-hand'];
      const creationTools = [
        { id: 'btn-map-tool-add-group', type: 'group' },
        { id: 'btn-map-tool-add-card', type: 'text' },
        { id: 'btn-map-tool-add-image', type: 'image' },
        { id: 'btn-map-tool-add-decision', type: 'decision' }
      ];

      persistTools.forEach((id) => {
        const btn = container.querySelector(`#${id}`);
        if (btn) {
          btn.addEventListener('click', () => {
            persistTools.forEach((otherId) => {
              const b = container.querySelector(`#${otherId}`);
              if (b) b.classList.toggle('active', otherId === id);
            });
            const tool = id === 'btn-map-tool-select' ? 'select' : 'hand';
            canvasController.setTool(tool);
          });
        }
      });

      creationTools.forEach((toolDef) => {
        const btn = container.querySelector(`#${toolDef.id}`);
        if (btn) {
          btn.addEventListener('click', () => {
            // Immediate creation at center
            canvasController.addNodeAtCenter(toolDef.type);
            // Re-active select tool
            persistTools.forEach((otherId) => {
              const b = container.querySelector(`#${otherId}`);
              if (b) b.classList.toggle('active', otherId === 'btn-map-tool-select');
            });
            canvasController.setTool('select');
          });
        }
      });

      if (canvasController) {
        canvasController.setTool('select');
      }

      // Zoom Controls
      const btnReset = container.querySelector('#btn-map-zoom-reset');
      if (btnReset) {
        btnReset.addEventListener('click', () => {
          canvasController.resetZoom();
        });
      }

      // Clear
      const btnClear = container.querySelector('#btn-map-clear');
      if (btnClear) {
        btnClear.addEventListener('click', async () => {
          await canvasController.clearMap();
        });
      }

      // Ask IA
      const mapChatPanel = document.getElementById('workspace-map-chat-panel');
      const mapChatLog = document.getElementById('map-chat-log');
      const mapChatTextarea = document.getElementById('map-chat-textarea');
      const btnMapChatSend = document.getElementById('btn-map-chat-send');
      const rightPanelTitle = document.getElementById('right-panel-title');
      const btnMapChatNew = document.getElementById('btn-map-chat-new');
      const btnMapRenderLauncher = document.getElementById('btn-map-render-launcher');

      const mapChatListView = document.getElementById('map-chat-list-view');
      const mapConversationsList = document.getElementById('map-conversations-list');
      const mapChatSessionView = document.getElementById('map-chat-session-view');
      const btnMapChatBack = document.getElementById('btn-map-chat-back');
      const mapChatSessionTitle = document.getElementById('map-chat-session-title');
      const renderPanel = document.getElementById('workspace-map-render-panel');
      const renderListView = document.getElementById('map-render-list-view');
      const renderSessionView = document.getElementById('map-render-session-view');
      const renderListBack = document.getElementById('btn-map-render-list-back');
      const renderPanelOpen = document.getElementById('btn-map-render-open');
      const renderSessionBack = document.getElementById('btn-map-render-back');
      const renderPanelSave = document.getElementById('btn-map-render-save');
      const renderPanelStatus = document.getElementById('map-render-status');
      const renderPanelCopy = document.getElementById('map-render-copy');
      const renderConversationsList = document.getElementById('map-render-conversations-list');
      const renderSessionTitle = document.getElementById('map-render-session-title');
      const renderSessionStatus = document.getElementById('map-render-session-status');
      const renderSessionLog = document.getElementById('map-render-session-log');
      const renderSessionPlanCard = document.getElementById('map-render-plan-card');
      const renderSessionChecklist = document.getElementById('map-render-session-checklist');
      const renderSessionMilestones = document.getElementById('map-render-session-milestones');
      const renderAttachmentList = document.getElementById('map-render-attachment-list');
      const renderSessionTextarea = document.getElementById('map-render-textarea');
      const renderAttachButton = document.getElementById('btn-map-render-attach');
      const renderSessionSend = document.getElementById('btn-map-render-send');
      const renderFileInput = document.getElementById('map-render-file-input');

      let mapChatMessages = [];
      let activeConversationId = null;
      let renderDraft = null;
      let renderMessages = [];
      let renderConversations = [];
      let activeRenderConversationId = null;
      let renderAttachments = [];
      let renderWorkflowBusy = false;
      let renderPlanUpdating = false;
      let renderPanelView = 'list';

      setRenderPanelView('list');
      renderRenderPanel();

      function appendMapChatMessage(role, text) {
        if (!mapChatLog) return;
        const bubble = document.createElement('div');
        bubble.className = `msg ${role}`;
        bubble.textContent = text;
        mapChatLog.appendChild(bubble);
        mapChatLog.scrollTop = mapChatLog.scrollHeight;
      }

      function showMapChatThinking() {
        if (!mapChatLog) return null;
        const thinking = document.createElement('div');
        thinking.className = 'msg assistant thinking';
        thinking.id = 'map-chat-thinking';
        thinking.innerHTML = '<span>Pensando...</span>';
        mapChatLog.appendChild(thinking);
        mapChatLog.scrollTop = mapChatLog.scrollHeight;
        return thinking;
      }

      function hideMapChatThinking() {
        const thinking = document.getElementById('map-chat-thinking');
        if (thinking) thinking.remove();
      }

      function escapeHtml(text) {
        return String(text || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function normalizeRenderText(value) {
        return String(value || '').toLowerCase();
      }

      function getRenderMapMarkdown(mapData = {}) {
        let markdown = '# MAPA DA APLICAÇÃO PARA RENDERIZAÇÃO\n\n';
        const rootNodes = Array.isArray(mapData.nodes) ? mapData.nodes.filter((node) => node && !node.parentId) : [];
        const childNodes = Array.isArray(mapData.nodes) ? mapData.nodes.filter((node) => node && node.parentId) : [];
        const groups = rootNodes.filter((node) => node.type === 'group' || node.type === 'folder');

        if (groups.length) {
          markdown += '## GRUPOS / MÓDULOS\n';
          groups.forEach((group) => {
            markdown += `### ${group.title || 'Grupo sem título'}\n`;
            if (group.description) markdown += `${group.description}\n`;
            const children = childNodes.filter((child) => child.parentId === group.id);
            if (children.length) {
              markdown += '\n';
              children.forEach((child) => {
                markdown += `- [${child.type || 'node'}] ${child.title || 'Sem título'}`;
                if (child.description) markdown += ` — ${child.description}`;
                if (child.content) markdown += ` (Conteúdo: ${child.content})`;
                markdown += '\n';
              });
            }
            markdown += '\n';
          });
        }

        const standalone = rootNodes.filter((node) => node.type !== 'group' && node.type !== 'folder');
        if (standalone.length) {
          markdown += '## ITENS AVULSOS\n';
          standalone.forEach((node) => {
            markdown += `- [${node.type || 'node'}] ${node.title || 'Sem título'}`;
            if (node.description) markdown += ` — ${node.description}`;
            if (node.content) markdown += ` (Conteúdo: ${node.content})`;
            markdown += '\n';
          });
        }

        if (Array.isArray(mapData.edges) && mapData.edges.length) {
          markdown += '\n## CONEXÕES\n';
          mapData.edges.forEach((edge) => {
            const source = Array.isArray(mapData.nodes) ? mapData.nodes.find((node) => node.id === edge.sourceNodeId) : null;
            const target = Array.isArray(mapData.nodes) ? mapData.nodes.find((node) => node.id === edge.targetNodeId) : null;
            if (source && target) {
              markdown += `- ${source.title || source.id} -> ${target.title || target.id}`;
              if (edge.type) markdown += ` (${edge.type})`;
              markdown += '\n';
            }
          });
        }

        return markdown.trim();
      }

      async function collectRenderDocumentation(rootPath, mapData = {}) {
        const rootNodes = Array.isArray(mapData.nodes) ? mapData.nodes.filter((node) => node && !node.parentId) : [];
        const groups = rootNodes.filter((node) => node.type === 'group' || node.type === 'folder');
        const docPaths = [
          'docs/application-map/README.md',
          'docs/application-map/decisions.md',
          'docs/application-map/open-questions.md',
        ];

        groups.forEach((group) => {
          const fileBasename = String(group.title || 'grupo')
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '-') + '.md';
          docPaths.push(`docs/application-map/${fileBasename}`);
        });

        const uniquePaths = [...new Set(docPaths)];
        const documents = [];
        let combinedText = '';

        for (const relativePath of uniquePaths) {
          try {
            const result = await api.readProjectFile({ projectInfo: { rootPath }, relativePath });
            if (result && result.ok && result.content) {
              documents.push({ path: relativePath, content: result.content });
              combinedText += `\n\n### ${relativePath}\n${result.content}`;
            }
          } catch (error) {
            console.warn('[collectRenderDocumentation] Failed to read ' + relativePath, error);
          }
        }

        return { documents, combinedText: combinedText.trim() };
      }

      function evaluateRenderReadiness(mapData = {}, combinedText = '') {
        const rootNodes = Array.isArray(mapData.nodes) ? mapData.nodes.filter((node) => node && !node.parentId) : [];
        const groups = rootNodes.filter((node) => node.type === 'group' || node.type === 'folder');
        const text = normalizeRenderText(combinedText);
        const nodeText = normalizeRenderText(
          Array.isArray(mapData.nodes)
            ? mapData.nodes
                .map((node) => [node.title, node.description, node.content].filter(Boolean).join(' '))
                .join(' \n ')
            : ''
        );
        const fullText = `${text}\n${nodeText}`;

        const checks = [
          {
            id: 'docs',
            label: 'Markdowns do mapa',
            ok: groups.length > 0 || /docs\/application-map/.test(fullText),
            hint: 'O mapa precisa ter markdowns estruturados para guiar a renderização.',
          },
          {
            id: 'tradeoffs',
            label: 'Tradeoffs do projeto',
            ok: /tradeoff|trade-offs|frontend|back-end|backend|stack/.test(fullText),
            hint: 'Documente decisões e compensações de frontend, backend e stack.',
          },
          {
            id: 'security',
            label: 'Plano de segurança',
            ok: /seguran|security|rate limit|rate limiting|mfa|csp|hsts|auth|oauth|jwt/.test(fullText),
            hint: 'A base do projeto precisa registrar proteção, autenticação e hardening.',
          },
          {
            id: 'branding',
            label: 'Marca e design system',
            ok: /brand|marca|logo|logotipo|cores|color|design system|tipografia|tipographic|ui kit/.test(fullText),
            hint: 'O render precisa saber a linguagem visual e os assets da marca.',
          },
        ];

        const missing = checks.filter((item) => !item.ok);
        return {
          checks,
          missing,
          ready: missing.length === 0,
        };
      }

      function buildRenderMilestones(mapData = {}, readiness = {}, combinedText = '', documents = []) {
        const nodes = Array.isArray(mapData.nodes) ? mapData.nodes.filter(Boolean) : [];
        const milestones = [];
        let index = 1;

        const normalize = (value) => String(value || '').toLowerCase();
        const unique = (items) => Array.from(new Set((items || []).filter(Boolean)));
        const collectNodeTitles = (keywords, limit = 6) => unique(
          nodes
            .filter((node) => {
              const haystack = normalize([node.title, node.description, node.content, node.type].join(' '));
              return keywords.some((keyword) => haystack.includes(keyword));
            })
            .map((node) => node.title || node.description || node.type || 'Item sem título')
        ).slice(0, limit);

        const documentList = Array.isArray(documents) ? documents.filter((doc) => doc && doc.path) : [];
        const pickReferences = (keywords = [], fallbackPaths = []) => {
          const matches = documentList
            .filter((doc) => {
              const haystack = normalize(`${doc.path}\n${doc.content || ''}`);
              return keywords.some((keyword) => haystack.includes(keyword));
            })
            .map((doc) => doc.path);
          const paths = unique([...matches, ...fallbackPaths]).slice(0, 4);
          return paths.map((path) => ({ path }));
        };

        const makeTasks = (fallbackTasks) => fallbackTasks.map((title, taskIndex) => ({
            id: `render-task-${index}-${taskIndex + 1}`,
            title,
            status: 'pending',
          }));

        const addMilestone = (title, summary, tasks = [], extra = {}) => {
          const milestone = {
            id: `render-milestone-${index}`,
            number: index,
            title,
            summary,
            status: 'planned',
            tasks: tasks.length
              ? tasks
              : [
                  {
                    id: `render-task-${index}-1`,
                    title: 'Validar o escopo e os markdowns do mapa',
                    status: 'pending',
                  },
                ],
            acceptanceCriteria: extra.acceptanceCriteria || '',
            validationCommands: extra.validationCommands || '',
            commits: [],
            notes: extra.notes || '',
            references: Array.isArray(extra.references) ? extra.references : [],
            changeMarker: extra.changeMarker || null,
          };
          milestones.push(milestone);
          index += 1;
          return milestone;
        };

        const addTasksToMilestone = (milestone, taskTitles = [], markerLabel = '') => {
          if (!milestone || !Array.isArray(taskTitles) || !taskTitles.length) return;
          const currentTasks = Array.isArray(milestone.tasks) ? milestone.tasks : [];
          const additions = taskTitles.map((title, taskIndex) => ({
            id: `${milestone.id}-refined-${currentTasks.length + taskIndex + 1}`,
            title,
            status: 'pending',
            isRefinement: true,
          }));
          milestone.tasks = [...currentTasks, ...additions];
          milestone.changeMarker = {
            type: 'task',
            count: additions.length,
            label: markerLabel || `+${additions.length}`,
          };
        };

        if (readiness.missing && readiness.missing.length) {
          addMilestone(
            'Fechar lacunas da documentação',
            'Completar os markdowns e as decisões que ainda impedem a execução segura do projeto.',
            readiness.missing.map((item, idx) => ({
              id: `render-task-${index}-${idx + 1}`,
              title: item.hint || item.label || 'Lacuna não descrita',
              status: 'pending',
            })),
            {
              notes: 'Etapa derivada diretamente da validação de completude do mapa.',
              references: pickReferences(
                ['open question', 'open-question', 'decis', 'tradeoff', 'seguran', 'security', 'design', 'marca'],
                documentList.map((doc) => doc.path)
              ),
            }
          );
        }

        const foundationNodes = collectNodeTitles(['backend', 'database', 'banco', 'stack', 'setup', 'env', 'seguran']);
        addMilestone(
          'Preparar fundação técnica do projeto',
          'Converter as decisões do mapa em base técnica executável antes de implementar telas e regras finais.',
          makeTasks(
            [
              'Validar a stack definida no mapa e registrar a decisão final de frontend, backend e banco.',
              'Organizar estrutura de pastas, scripts de desenvolvimento, build, lint e testes.',
              'Criar arquivos de ambiente de exemplo sem segredos reais e documentar como configurar o projeto.',
              'Transformar os itens técnicos do mapa em contratos iniciais para as próximas etapas.',
            ]
          ),
          {
            notes: foundationNodes.length
              ? `Itens do mapa considerados: ${foundationNodes.join(', ')}.`
              : 'Primeiro bloco do passo a passo: base técnica antes de implementar funcionalidades.',
            references: pickReferences(['readme', 'backend', 'banco', 'database', 'stack', 'decis', 'seguran', 'security']),
          }
        );

        const designNodes = collectNodeTitles(['design', 'layout', 'frontend', 'brand', 'marca', 'logo', 'tipografia']);
        addMilestone(
          'Estruturar interface, marca e design system',
          'Transformar a linguagem visual documentada no mapa em tokens, componentes e navegação reutilizável.',
          makeTasks(
            [
              'Consolidar cores, tipografia, espaçamentos, estados de interação e assets de marca.',
              'Criar shell visual da aplicação com layout base e componentes compartilhados.',
              'Mapear telas, navegação e hierarquia visual antes de implementar o fluxo principal.',
              'Registrar lacunas de design que ainda precisem de imagens, logotipo ou documentação adicional.',
            ]
          ),
          {
            notes: designNodes.length
              ? `Itens do mapa considerados: ${designNodes.join(', ')}.`
              : 'Esta etapa consolida o visual antes da implementação de telas finais.',
            references: pickReferences(['design', 'frontend', 'layout', 'marca', 'brand', 'logo', 'cor', 'cores', 'tipografia']),
          }
        );

        const productNodes = collectNodeTitles(['funções', 'funcao', 'feature', 'frontend', 'login', 'dashboard', 'fluxo', 'tarefa']);
        const productMilestone = addMilestone(
          'Implementar fluxo principal da aplicação',
          'Construir o caminho ponta a ponta que permite ao usuário usar o produto conforme o mapa definiu.',
          makeTasks(
            [
              'Implementar telas e rotas principais descritas no mapa da aplicação.',
              'Criar formulários, estados de carregamento, validações de interface e feedbacks de erro/sucesso.',
              'Conectar cada ação do usuário ao contrato de dados esperado, mesmo que inicialmente com mocks.',
              'Validar o fluxo completo pelo ponto de vista do usuário antes de avançar para hardening.',
            ]
          ),
          {
            notes: productNodes.length
              ? `Itens do mapa considerados: ${productNodes.join(', ')}.`
              : 'A partir daqui o plano passa a representar execução real do produto.',
            references: pickReferences(['frontend', 'funções', 'funcoes', 'feature', 'login', 'dashboard', 'fluxo', 'tarefa']),
          }
        );

        const backendNodes = collectNodeTitles(['backend', 'api', 'database', 'banco', 'auth', 'jwt', 'sequelize', 'dados']);
        const backendMilestone = addMilestone(
          'Construir backend, dados e integrações',
          'Implementar persistência, API, autenticação e regras de negócio alinhadas com o fluxo principal.',
          makeTasks(
            [
              'Modelar entidades, relações, migrations e seeds necessários para o domínio desenhado.',
              'Criar contratos REST/API e padronizar payloads, erros e status codes.',
              'Implementar autenticação, autorização e regras de negócio do backend.',
              'Integrar frontend, backend e banco em cenários reais do produto.',
            ]
          ),
          {
            notes: backendNodes.length
              ? `Itens do mapa considerados: ${backendNodes.join(', ')}.`
              : (combinedText ? 'A etapa usa o contexto consolidado dos markdowns e decisões do mapa.' : ''),
            references: pickReferences(['backend', 'api', 'database', 'banco', 'dados', 'sequelize', 'auth', 'jwt']),
          }
        );

        const securityNodes = collectNodeTitles(['seguran', 'security', 'teste', 'test', 'deploy', 'log', 'observ']);
        const asksForPentest = /pentest|pen test|penetration test|teste de intrus|intrus[aã]o|vulnerability|vulnerabil|owasp/.test(normalize(combinedText));
        const asksForErrorLogging = /log de erro|logs de erro|error log|erro em produ|observabil|monitoramento|alerta|telemetria|sentry/.test(normalize(combinedText));
        const asksForRealUserValidation = /usu[aá]rios reais|usuario real|user test|teste com usu[aá]rio|valida[cç][aã]o com usu[aá]rios|pesquisa com usu[aá]rios|beta test|teste beta/.test(normalize(combinedText));
        if (asksForPentest) {
          addMilestone(
            'Executar pentest e correção de vulnerabilidades',
            'Validar a aplicação com testes ofensivos controlados e transformar achados em correções antes da entrega.',
            makeTasks(
              [
                'Definir escopo do pentest, ambientes permitidos e critérios de parada.',
                'Executar checklist OWASP para autenticação, autorização, sessão, inputs e exposição de dados.',
                'Registrar vulnerabilidades com severidade, evidência, impacto e recomendação.',
                'Corrigir achados críticos/altos e repetir os testes de validação antes de liberar a entrega.',
              ]
            ),
            {
              validationCommands: 'npm test\nnpm run build',
              notes: 'Etapa adicionada a partir do refinamento solicitado no chat de render.',
              references: pickReferences(['seguran', 'security', 'auth', 'jwt', 'owasp', 'pentest', 'teste']),
              changeMarker: { type: 'milestone', count: 1, label: '+ etapa' },
            }
          );
        }

        if (asksForErrorLogging) {
          addTasksToMilestone(
            backendMilestone,
            [
              'Definir padrão de logs para erros de frontend, backend, autenticação e integrações.',
              'Registrar contexto mínimo de falhas sem expor dados sensíveis ou segredos.',
              'Criar fluxo de captura, consulta e triagem de erros recorrentes.',
            ],
            '+3'
          );
        }

        if (asksForRealUserValidation) {
          addMilestone(
            'Validar fluxo com usuários reais',
            'Testar as etapas principais com pessoas reais antes de encerrar o plano de execução.',
            makeTasks(
              [
                'Definir cenários de uso e critérios de sucesso para a validação com usuários.',
                'Preparar ambiente, dados de teste e roteiro de observação para cada etapa crítica.',
                'Coletar dúvidas, bloqueios, erros e pontos de fricção durante a execução real.',
                'Transformar os achados em ajustes priorizados no plano antes da entrega final.',
              ]
            ),
            {
              notes: 'Etapa adicionada a partir do refinamento solicitado no chat de render.',
              references: pickReferences(['readme', 'frontend', 'design', 'funções', 'funcoes', 'teste', 'valida']),
              changeMarker: { type: 'milestone', count: 1, label: '+ etapa' },
            }
          );
        }

        const deliveryMilestone = addMilestone(
          'Aplicar segurança, testes e entrega',
          'Fechar o projeto com proteção, validação funcional, revisão técnica e preparação de entrega.',
          makeTasks(
            [
              'Aplicar checklist de segurança definido no mapa: autenticação, autorização, headers, secrets e rate limiting.',
              'Criar testes unitários, integração e fluxo ponta a ponta para as jornadas principais.',
              'Revisar logs, tratamento de erros, observabilidade e comportamento em produção.',
              'Preparar validação final, documentação de execução e critérios de aceite da entrega.',
            ]
          ),
          {
            validationCommands: 'npm test\nnpm run build',
            notes: securityNodes.length
              ? `Itens do mapa considerados: ${securityNodes.join(', ')}.`
              : 'Último passo da sequência, com validação antes de concluir a entrega.',
            references: pickReferences(['seguran', 'security', 'teste', 'test', 'deploy', 'log', 'observability', 'hsts', 'csp']),
          }
        );

        if (asksForErrorLogging) {
          addTasksToMilestone(
            deliveryMilestone,
            [
              'Adicionar alertas ou checklist de revisão para erros críticos antes da entrega.',
              'Validar se os logs apoiam análise de incidentes sem expor dados sensíveis.',
            ],
            '+2'
          );
        }

        if (asksForRealUserValidation && productMilestone && !productMilestone.changeMarker) {
          addTasksToMilestone(
            productMilestone,
            [
              'Preparar o fluxo principal para teste guiado com usuários reais antes do fechamento.',
            ],
            '+1'
          );
        }

        return milestones;
      }

      function normalizeRenderKey(value) {
        return String(value || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
      }

      function renumberRenderMilestones(milestones = []) {
        return milestones.map((milestone, milestoneIndex) => {
          const number = milestoneIndex + 1;
          return {
            ...milestone,
            id: milestone.id || `render-milestone-${number}`,
            number,
            tasks: Array.isArray(milestone.tasks)
              ? milestone.tasks.map((task, taskIndex) => ({
                  ...task,
                  id: task.id || `render-task-${number}-${taskIndex + 1}`,
                }))
              : [],
          };
        });
      }

      function mergeRenderTasks(previousTasks = [], nextTasks = []) {
        const seen = new Set();
        const merged = [];
        [...previousTasks, ...nextTasks].forEach((task) => {
          if (!task) return;
          const key = normalizeRenderKey(task.title || task.id);
          if (!key || seen.has(key)) return;
          seen.add(key);
          merged.push({ ...task });
        });
        return merged;
      }

      function buildRequestedReleaseMilestone(requestText = '', nextNumber = 1, pickReferences = () => []) {
        const normalized = normalizeRenderKey(requestText);
        const asksExplicitNewStep = /\b(adicionar|adicione|incluir|inclua|criar|crie|colocar|coloque)\b/.test(normalized) && /\b(etapa|passo|ponto|milestone|8|oitavo)\b/.test(normalized);
        const asksRelease = /liberacao|lancamento|release|publicacao|go live|deploy final|entrega final|lancar|publicar/.test(normalized);
        if (!asksExplicitNewStep || !asksRelease) return null;

        return {
          id: `render-milestone-manual-release-${Date.now()}`,
          number: nextNumber,
          title: 'Preparar liberação e lançamento do projeto',
          summary: 'Organizar a etapa final de release para publicar, comunicar e acompanhar a aplicação após a validação.',
          status: 'planned',
          tasks: [
            {
              id: `render-task-release-${nextNumber}-1`,
              title: 'Consolidar checklist de release com build, testes, variáveis de ambiente e documentação de execução.',
              status: 'pending',
              isRefinement: true,
            },
            {
              id: `render-task-release-${nextNumber}-2`,
              title: 'Definir plano de lançamento, responsáveis, janela de publicação e estratégia de rollback.',
              status: 'pending',
              isRefinement: true,
            },
            {
              id: `render-task-release-${nextNumber}-3`,
              title: 'Acompanhar primeiros usuários reais, logs de erro e métricas críticas após a liberação.',
              status: 'pending',
              isRefinement: true,
            },
          ],
          acceptanceCriteria: '',
          validationCommands: 'npm test\nnpm run build',
          commits: [],
          notes: 'Etapa adicionada a partir do refinamento solicitado no chat de render.',
          references: pickReferences(['readme', 'deploy', 'release', 'teste', 'seguran', 'security', 'log']),
          changeMarker: { type: 'milestone', count: 1, label: '+1' },
        };
      }

      function mergeRenderMilestonePlan(previousMilestones = [], nextMilestones = [], requestText = '', referencePicker = () => []) {
        const merged = [];
        const byTitle = new Map();

        const addOrMerge = (milestone) => {
          if (!milestone) return;
          const key = normalizeRenderKey(milestone.title || milestone.id);
          if (!key) return;
          const existing = byTitle.get(key);
          if (!existing) {
            const copy = {
              ...milestone,
              tasks: Array.isArray(milestone.tasks) ? milestone.tasks.map((task) => ({ ...task })) : [],
              references: Array.isArray(milestone.references) ? milestone.references.map((reference) => ({ ...reference })) : [],
            };
            byTitle.set(key, copy);
            merged.push(copy);
            return;
          }

          existing.summary = milestone.summary || existing.summary;
          existing.status = milestone.status || existing.status;
          existing.acceptanceCriteria = milestone.acceptanceCriteria || existing.acceptanceCriteria || '';
          existing.validationCommands = milestone.validationCommands || existing.validationCommands || '';
          existing.notes = milestone.notes || existing.notes || '';
          existing.tasks = mergeRenderTasks(existing.tasks, milestone.tasks);
          existing.references = Array.isArray(milestone.references) && milestone.references.length
            ? milestone.references
            : existing.references;
          existing.changeMarker = milestone.changeMarker || existing.changeMarker || null;
        };

        previousMilestones.forEach(addOrMerge);
        nextMilestones.forEach(addOrMerge);

        const requestedRelease = buildRequestedReleaseMilestone(requestText, merged.length + 1, referencePicker);
        if (requestedRelease && !merged.some((milestone) => /libera|lan[cç]amento|release/i.test(milestone.title || ''))) {
          merged.push(requestedRelease);
        }

        return renumberRenderMilestones(merged);
      }

      function formatRenderConversationDate(value) {
        const date = value ? new Date(value) : new Date();
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      }

      function getRenderConversationById(conversationId) {
        return Array.isArray(renderConversations)
          ? renderConversations.find((conversation) => conversation && conversation.id === conversationId) || null
          : null;
      }

      function getActiveRenderConversation() {
        return activeRenderConversationId ? getRenderConversationById(activeRenderConversationId) : null;
      }

      function toRenderMessage(message = {}) {
        return {
          role: message.role === 'user' ? 'user' : 'assistant',
          content: message.content || message.text || '',
          attachments: Array.isArray(message.attachments)
            ? message.attachments.map((attachment) => ({ ...attachment }))
            : [],
        };
      }

      function normalizeRenderConversation(conversation = {}) {
        return {
          id: conversation.id,
          title: conversation.title || 'Render do Mapa',
          createdAt: conversation.createdAt || new Date().toISOString(),
          updatedAt: conversation.updatedAt || conversation.createdAt || new Date().toISOString(),
          source: 'map_render',
          messages: Array.isArray(conversation.messages)
            ? conversation.messages.map(toRenderMessage)
            : [],
          draft: conversation.draft ? { ...conversation.draft } : null,
          lastAttachments: Array.isArray(conversation.lastAttachments)
            ? conversation.lastAttachments.map((attachment) => ({ ...attachment }))
            : [],
        };
      }

      function syncRenderConversationState() {
        const activeConversation = getActiveRenderConversation();
        if (!activeConversation) return;

        activeConversation.messages = Array.isArray(renderMessages)
          ? renderMessages.map((message) => ({ ...message }))
          : [];
        activeConversation.draft = renderDraft ? { ...renderDraft } : null;
        activeConversation.updatedAt = new Date().toISOString();
        if (renderAttachments && renderAttachments.length) {
          activeConversation.lastAttachments = renderAttachments.map((attachment) => ({ ...attachment }));
        } else {
          activeConversation.lastAttachments = [];
        }
      }

      async function createRenderConversation(title = '') {
        const now = new Date();
        const defaultTitle = `Render do Mapa (${now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`;
        let conversation = {
          id: `render-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: String(title || defaultTitle).trim().slice(0, 80) || defaultTitle,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          source: 'map_render',
          messages: [],
          draft: null,
          lastAttachments: [],
        };

        const projectId = getSelectedProjectId();
        if (projectId && api && typeof api.addConversation === 'function') {
          try {
            const result = await api.addConversation({
              projectId,
              title: conversation.title,
              meta: { source: 'map_render' },
            });
            if (result && result.ok && result.conversation) {
              conversation = normalizeRenderConversation(result.conversation);
            }
          } catch (error) {
            console.error('[createRenderConversation] failed to persist render conversation:', error);
          }
        }

        renderConversations = [conversation, ...renderConversations.filter((item) => item && item.id !== conversation.id)];
        activeRenderConversationId = conversation.id;
        return conversation;
      }

      async function persistRenderConversationMessage(role, text) {
        const projectId = getSelectedProjectId();
        const conversationId = activeRenderConversationId;
        const normalizedText = String(text || '').trim();
        if (!projectId || !conversationId || !normalizedText || !api || typeof api.addConversationMessage !== 'function') {
          return null;
        }

        try {
          return await api.addConversationMessage({
            projectId,
            conversationId,
            role,
            text: normalizedText,
            meta: { mode: 'map_render', source: 'map_render' },
          });
        } catch (error) {
          console.error('[persistRenderConversationMessage] failed:', error);
          return null;
        }
      }

      async function loadRenderConversationMessages(conversationId) {
        if (!conversationId || !api || typeof api.listConversationMessages !== 'function') return [];

        try {
          const result = await api.listConversationMessages({ conversationId, limit: 120 });
          if (result && result.ok && Array.isArray(result.messages)) {
            return result.messages.map(toRenderMessage).filter((message) => message.content);
          }
        } catch (error) {
          console.error('[loadRenderConversationMessages] failed:', error);
        }
        return [];
      }

      async function loadRenderConversationsFromStore(projectId = getSelectedProjectId()) {
        if (!projectId || !api || typeof api.listConversations !== 'function') return;

        try {
          const result = await api.listConversations();
          if (!result || !result.ok) return;

          const conversations = result.conversationsByProject && result.conversationsByProject[projectId]
            ? result.conversationsByProject[projectId]
            : [];
          renderConversations = conversations
            .filter((conversation) => conversation && conversation.source === 'map_render')
            .map(normalizeRenderConversation);

          if (activeRenderConversationId && !getRenderConversationById(activeRenderConversationId)) {
            activeRenderConversationId = null;
          }
          renderRenderConversationsList();
        } catch (error) {
          console.error('[loadRenderConversationsFromStore] failed:', error);
        }
      }

      function setActiveRenderConversation(conversationId) {
        activeRenderConversationId = conversationId || null;
        const activeConversation = getActiveRenderConversation();
        if (activeConversation) {
          renderMessages = Array.isArray(activeConversation.messages) ? activeConversation.messages.map((message) => ({ ...message })) : [];
          renderDraft = activeConversation.draft ? { ...activeConversation.draft } : null;
          renderAttachments = [];
        } else {
          renderMessages = [];
          renderDraft = null;
          renderAttachments = [];
        }
      }

      function renderRenderConversationsList() {
        if (!renderConversationsList) return;
        renderConversationsList.innerHTML = '';

        const conversations = Array.isArray(renderConversations) ? renderConversations : [];
        if (!conversations.length) {
          return;
        }

        conversations.forEach((conversation) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = `map-render-conversation-row${conversation.id === activeRenderConversationId ? ' active' : ''}`;

          const main = document.createElement('div');
          main.className = 'map-render-conversation-row__main';

          const title = document.createElement('strong');
          title.className = 'map-render-conversation-row__title';
          title.textContent = conversation.title || 'Render do Mapa';

          const subtitle = document.createElement('span');
          subtitle.className = 'map-render-conversation-row__subtitle';
          const draft = conversation.draft || {};
          if (draft.ready) {
            subtitle.textContent = `Pronta para milestones • ${formatRenderConversationDate(conversation.updatedAt || conversation.createdAt)}`;
          } else if (Array.isArray(draft.missing) && draft.missing.length) {
            subtitle.textContent = `Faltam lacunas • ${formatRenderConversationDate(conversation.updatedAt || conversation.createdAt)}`;
          } else if (Array.isArray(conversation.messages) && conversation.messages.length) {
            subtitle.textContent = `Chat em andamento • ${formatRenderConversationDate(conversation.updatedAt || conversation.createdAt)}`;
          } else if (conversation.source === 'map_render') {
            subtitle.textContent = `Renderização salva • ${formatRenderConversationDate(conversation.updatedAt || conversation.createdAt)}`;
          } else {
            subtitle.textContent = `Nova renderização • ${formatRenderConversationDate(conversation.createdAt)}`;
          }

          main.append(title, subtitle);

          const arrow = document.createElement('span');
          arrow.className = 'map-render-conversation-row__arrow';
          arrow.textContent = '→';

          row.append(main, arrow);
          row.addEventListener('click', async () => {
            await openRenderConversation(conversation.id);
          });
          renderConversationsList.appendChild(row);
        });
      }

      function renderRenderAttachmentList() {
        if (!renderAttachmentList) return;
        renderAttachmentList.innerHTML = '';
        const attachments = Array.isArray(renderAttachments) ? renderAttachments : [];
        renderAttachmentList.classList.toggle('hidden', !attachments.length);
        if (!attachments.length) return;

        attachments.forEach((file, index) => {
          const chip = document.createElement('div');
          chip.className = 'attachment-chip attachment-chip--render';

          if (file && file.path && (String(file.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.path))) {
            const img = document.createElement('img');
            img.className = 'attachment-thumb';
            img.src = `file://${file.path}`;
            chip.appendChild(img);
          }

          const name = document.createElement('span');
          name.className = 'attachment-name';
          name.textContent = file.name || `Anexo ${index + 1}`;

          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'attachment-remove';
          remove.title = 'Remover anexo';
          remove.textContent = 'x';
          remove.addEventListener('click', () => {
            renderAttachments = renderAttachments.filter((_, attachmentIndex) => attachmentIndex !== index);
            renderRenderAttachmentList();
            syncRenderConversationState();
          });

          chip.append(name, remove);
          renderAttachmentList.appendChild(chip);
        });
      }

      async function openRenderConversation(conversationId) {
        const conversation = getRenderConversationById(conversationId);
        if (!conversation) return;

        activeRenderConversationId = conversation.id;
        if (!Array.isArray(conversation.messages) || !conversation.messages.length) {
          conversation.messages = await loadRenderConversationMessages(conversation.id);
        }
        renderMessages = Array.isArray(conversation.messages)
          ? conversation.messages.map((message) => ({ ...message }))
          : [];
        renderDraft = conversation.draft ? { ...conversation.draft } : null;
        renderAttachments = [];
        setRenderPanelView('session');

        const projectInfo = getSelectedProjectInfo();
        const rootPath = projectInfo?.rootPath || '';
        if (rootPath) {
          const mapData = canvasController ? canvasController.getMapData() : { nodes: [], edges: [] };
          const documentation = await collectRenderDocumentation(rootPath, mapData);
          const lastAssistant = [...renderMessages].reverse().find((message) => message && message.role === 'assistant');
          if (!renderDraft) {
            rebuildRenderDraft(mapData, documentation, lastAssistant ? lastAssistant.content : '');
          } else {
            const rebuilt = rebuildRenderDraft(mapData, documentation, lastAssistant ? lastAssistant.content : '');
            renderDraft = {
              ...renderDraft,
              ...rebuilt,
              milestones: Array.isArray(renderDraft.milestones) && renderDraft.milestones.length
                ? renderDraft.milestones
                : rebuilt.milestones,
            };
            syncRenderConversationState();
          }
        }

        renderRenderPanel();
      }

      function setRenderPanelView(nextView) {
        renderPanelView = nextView === 'session' ? 'session' : 'list';
        renderRenderPanel();
      }

      function renderRenderMessage(role, text, attachments = []) {
        if (!renderSessionLog) return;
        const bubble = document.createElement('div');
        bubble.className = `msg ${role}`;
        bubble.textContent = text;
        if (Array.isArray(attachments) && attachments.length) {
          const attachmentRow = document.createElement('div');
          attachmentRow.className = 'msg-attachments msg-attachments--render';
          attachments.forEach((attachment) => {
            if (attachment && attachment.path && (String(attachment.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(attachment.path))) {
              const img = document.createElement('img');
              img.src = `file://${attachment.path}`;
              attachmentRow.appendChild(img);
            } else {
              const pill = document.createElement('span');
              pill.className = 'attachment-chip attachment-chip--render';
              pill.textContent = attachment && attachment.name ? attachment.name : 'Anexo';
              attachmentRow.appendChild(pill);
            }
          });
          bubble.appendChild(attachmentRow);
        }
        renderSessionLog.appendChild(bubble);
        renderSessionLog.scrollTop = renderSessionLog.scrollHeight;
      }

      function showRenderThinking() {
        if (!renderSessionLog) return null;
        const thinking = document.createElement('div');
        thinking.className = 'msg assistant thinking';
        thinking.id = 'render-thinking';
        thinking.innerHTML = '<span>Analisando ajuste no plano...</span>';
        renderSessionLog.appendChild(thinking);
        renderSessionLog.scrollTop = renderSessionLog.scrollHeight;
        return thinking;
      }

      function hideRenderThinking() {
        const thinking = document.getElementById('render-thinking');
        if (thinking) thinking.remove();
      }

      function setRenderPlanUpdating(isUpdating) {
        renderPlanUpdating = Boolean(isUpdating);
        if (renderSessionPlanCard) {
          renderSessionPlanCard.classList.toggle('is-updating', renderPlanUpdating);
          renderSessionPlanCard.setAttribute('aria-busy', renderPlanUpdating ? 'true' : 'false');
        }
      }

      function showRenderStatusTicker() {
        if (!renderSessionLog) return null;
        const ticker = document.createElement('div');
        ticker.className = 'map-chat-status-ticker map-render-status-ticker';
        ticker.id = 'render-status-ticker';
        ticker.innerHTML = `
          <div class="ticker-step" id="render-step-export-md"><span class="status-dot"></span> <span>Exportando markdowns...</span></div>
          <div class="ticker-step" id="render-step-send-images"><span class="status-dot"></span> <span>Enviando imagens...</span></div>
          <div class="ticker-step" id="render-step-analyze-info"><span class="status-dot"></span> <span>Analisando informações...</span></div>
          <div class="ticker-step" id="render-step-contextualized"><span class="status-dot"></span> <span>Chat contextualizado!</span></div>
        `;
        renderSessionLog.appendChild(ticker);
        renderSessionLog.scrollTop = renderSessionLog.scrollHeight;
        return {
          ticker,
          exportStep: document.getElementById('render-step-export-md'),
          sendStep: document.getElementById('render-step-send-images'),
          analyzeStep: document.getElementById('render-step-analyze-info'),
          contextualizedStep: document.getElementById('render-step-contextualized'),
        };
      }

      function renderPlanPreview() {
        if (renderSessionChecklist) {
          renderSessionChecklist.innerHTML = '';
          renderSessionChecklist.classList.add('hidden');
        }

        if (renderSessionMilestones) {
          renderSessionMilestones.innerHTML = '';
          const milestones = renderDraft && Array.isArray(renderDraft.milestones) ? renderDraft.milestones : [];
          if (!milestones.length) {
            const empty = document.createElement('div');
            empty.className = 'map-render-empty-plan';
            empty.textContent = 'O plano ainda não foi consolidado em milestones.';
            renderSessionMilestones.appendChild(empty);
            return;
          }

          milestones.forEach((milestone) => {
            const card = document.createElement('article');
            card.className = 'map-render-milestone-card';
            if (milestone.changeMarker) {
              card.classList.add('has-refinement');
            }

            const header = document.createElement('header');
            header.className = 'map-render-milestone-card__header';
            const title = document.createElement('strong');
            title.textContent = `${String(milestone.number || '')}. ${milestone.title || 'Milestone'}`;
            header.appendChild(title);

            if (milestone.changeMarker) {
              const marker = document.createElement('span');
              marker.className = `map-render-change-marker map-render-change-marker--${milestone.changeMarker.type || 'task'}`;
              marker.textContent = milestone.changeMarker.label || `+${milestone.changeMarker.count || 1}`;
              marker.title = milestone.changeMarker.type === 'milestone'
                ? 'Nova etapa inserida pelo refinamento'
                : 'Novas tarefas inseridas nesta etapa pelo refinamento';
              header.appendChild(marker);
            }

            const summary = document.createElement('p');
            summary.textContent = milestone.summary || '';

            const tasks = document.createElement('ul');
            tasks.className = 'map-render-milestone-card__tasks';
            (Array.isArray(milestone.tasks) ? milestone.tasks : []).forEach((task) => {
              const item = document.createElement('li');
              if (task && task.isRefinement) {
                item.className = 'is-refinement';
              }
              item.textContent = task.title || 'Tarefa sem título';
              tasks.appendChild(item);
            });

            card.appendChild(header);
            card.appendChild(summary);
            card.appendChild(tasks);

            const references = Array.isArray(milestone.references) ? milestone.references : [];
            if (references.length) {
              const refs = document.createElement('div');
              refs.className = 'map-render-milestone-card__refs';
              const refTitle = document.createElement('span');
              refTitle.textContent = 'Markdowns de referência';
              const refList = document.createElement('ul');
              references.forEach((reference) => {
                const refItem = document.createElement('li');
                refItem.textContent = reference && reference.path ? reference.path : String(reference || '');
                refList.appendChild(refItem);
              });
              refs.append(refTitle, refList);
              card.appendChild(refs);
            }
            renderSessionMilestones.appendChild(card);
          });
        }
      }

      function renderRenderPanel() {
        if (!renderPanel) return;

        const isSessionView = renderPanelView === 'session';
        if (renderListView) {
          renderListView.classList.toggle('hidden', isSessionView);
        }
        if (renderSessionView) {
          renderSessionView.classList.toggle('hidden', !isSessionView);
        }
        if (renderPanelCopy) {
          renderPanelCopy.classList.toggle('hidden', isSessionView);
        }
        if (renderPanelOpen) {
          renderPanelOpen.textContent = 'Renderizar o Mapa';
          renderPanelOpen.disabled = renderWorkflowBusy;
        }
        if (renderListBack) {
          renderListBack.disabled = renderWorkflowBusy;
        }
        if (renderSessionBack) {
          renderSessionBack.disabled = renderWorkflowBusy;
        }
        if (renderAttachButton) {
          renderAttachButton.disabled = renderWorkflowBusy;
        }
        if (renderPanelSave) {
          renderPanelSave.classList.toggle(
            'hidden',
            !isSessionView || !renderDraft || !renderDraft.ready || !renderDraft.milestones || !renderDraft.milestones.length
          );
          renderPanelSave.disabled = renderWorkflowBusy;
        }

        if (!isSessionView) {
          if (renderPanelStatus) {
            const activeConversation = getActiveRenderConversation();
            if (activeConversation && activeConversation.draft) {
              renderPanelStatus.textContent = activeConversation.draft.ready
                ? 'Última renderização pronta. Selecione uma conversa para revisar ou reanalise o mapa.'
                : 'Última renderização com lacunas. Selecione uma conversa para ajustar o plano.';
            } else if (Array.isArray(renderConversations) && renderConversations.length) {
              renderPanelStatus.textContent = 'Selecione uma renderização anterior para revisar o diagnóstico ou crie uma nova análise.';
            } else {
              renderPanelStatus.textContent = 'Pronto para iniciar a análise.';
            }
          }
          renderRenderConversationsList();
          return;
        }

        if (renderSessionTitle) {
          const activeConversation = getActiveRenderConversation();
          renderSessionTitle.textContent = activeConversation && activeConversation.title
            ? activeConversation.title
            : (renderDraft && renderDraft.ready
              ? 'Renderização e validação do plano'
              : 'Renderização do Mapa');
        }

        if (renderSessionStatus) {
          renderSessionStatus.textContent = renderDraft
            ? (renderDraft.ready
              ? 'Análise concluída. Você já pode revisar, corrigir pelo chat e salvar em milestones.'
              : 'Ainda existem lacunas importantes. Use o chat abaixo para completar o contexto.')
            : 'Pronto para iniciar a análise.';
        }

        if (renderSessionPlanCard) {
          renderSessionPlanCard.classList.toggle('hidden', !renderDraft);
          renderSessionPlanCard.classList.toggle('is-updating', renderPlanUpdating);
          renderSessionPlanCard.setAttribute('aria-busy', renderPlanUpdating ? 'true' : 'false');
        }

        if (renderSessionLog) {
          const hasMessages = Array.isArray(renderMessages) && renderMessages.length > 0;
          renderSessionLog.innerHTML = '';

          if (!hasMessages && !renderDraft) {
            const placeholder = document.createElement('div');
            placeholder.className = 'map-render-session-placeholder';
            placeholder.innerHTML = `
              <strong>Análise do render</strong>
              <p>Aqui aparecerão as etapas de exportação, leitura dos markdowns, validação do contexto e o chat para ajustar o plano.</p>
            `;
            renderSessionLog.appendChild(placeholder);
          }

          if (!hasMessages && renderDraft && renderDraft.assistantSummary) {
            renderMessages = [{ role: 'assistant', content: renderDraft.assistantSummary }];
            syncRenderConversationState();
          }

          (renderMessages || []).forEach((message) => {
            renderRenderMessage(message.role, message.content, message.attachments || []);
          });
        }

        renderPlanPreview();
        renderRenderAttachmentList();
      }

      function setMapSidePanelMode(mode) {
        const modeClasses = ['mode-map-chat', 'mode-map-render', 'mode-git', 'mode-terminal', 'mode-milestones', 'mode-cortex'];
        modeClasses.forEach((cls) => document.body.classList.remove(cls));
        if (mode) {
          document.body.classList.add(mode);
        }

        const rightPanelTitle = document.getElementById('right-panel-title');
        if (rightPanelTitle) {
          if (mode === 'mode-map-chat') {
            rightPanelTitle.textContent = 'Perguntar à IA';
          } else if (mode === 'mode-map-render') {
            rightPanelTitle.textContent = 'Renderização do Mapa';
          } else if (mode === 'mode-git') {
            rightPanelTitle.textContent = 'Git';
          } else if (mode === 'mode-terminal') {
            rightPanelTitle.textContent = 'Terminal';
          } else if (mode === 'mode-milestones') {
            rightPanelTitle.textContent = 'Milestones';
          } else if (mode === 'mode-cortex') {
            rightPanelTitle.textContent = 'Regras e contexto';
          } else {
            rightPanelTitle.textContent = 'Arquivos';
          }
        }

        const btnAi = document.getElementById('btn-map-ai');
        if (btnAi) {
          btnAi.classList.toggle('active', mode === 'mode-map-chat');
        }

        const filesBtn = document.getElementById('btn-project-files');
        if (filesBtn) {
          filesBtn.classList.toggle('active', mode === null);
        }
      }

      function buildRenderPrompt(mapData, documentation, userRequest = '', conversationMessages = []) {
        const renderMarkdown = getRenderMapMarkdown(mapData);
        const recentConversation = Array.isArray(conversationMessages) && conversationMessages.length
          ? conversationMessages.slice(-8).map((message) => `- ${message.role}: ${message.text || message.content || ''}`).join('\n')
          : '(sem histórico adicional)';

        return [
          'Você é o Assistente de Renderização do Mapa da Aplicação no Faber Code.',
          'Sua missão é analisar o mapa exportado e os markdowns do projeto para transformar a idealização em um plano de desenvolvimento executável.',
          'Não substitua os markdowns e não entregue apenas um resumo. Organize as informações em sequência de implementação, cite os markdowns relevantes por caminho e explique quais decisões sustentam cada etapa.',
          'O resultado deve ajudar o painel de milestones e o chat de desenvolvimento: cada etapa precisa ter tarefas acionáveis, critérios claros e referências aos documentos do mapa que devem ser consultados.',
          'Se houver lacunas, diga quais informações bloqueiam ou enfraquecem o plano e como o usuário pode completá-las neste chat de render.',
          'Responda em linguagem clara e objetiva. Se o usuário estiver corrigindo algo, destaque exatamente o que mudou no plano.',
          '',
          'QUADRO DO MAPA EM MARKDOWN:',
          '```markdown',
          renderMarkdown,
          '```',
          '',
          'MARKDOWNS ENCONTRADOS:',
          documentation.combinedText || '(nenhum markdown foi encontrado ainda)',
          '',
          'HISTÓRICO CURTO DO CHAT DE RENDER:',
          recentConversation,
          '',
          'PEDIDO ATUAL DO USUÁRIO:',
          userRequest || '(início da renderização)',
        ].join('\n');
      }

      function rebuildRenderDraft(mapData, documentation, assistantSummary, options = {}) {
        const combinedText = `${documentation.combinedText}\n${assistantSummary}`;
        const readiness = evaluateRenderReadiness(mapData, combinedText);
        const generatedMilestones = buildRenderMilestones(
          mapData,
          readiness,
          combinedText,
          documentation.documents
        );
        const pickReferences = (keywords = []) => {
          const normalizedKeywords = keywords.map(normalizeRenderKey).filter(Boolean);
          const documents = Array.isArray(documentation.documents) ? documentation.documents : [];
          return documents
            .filter((document) => {
              const searchable = normalizeRenderKey(`${document.path || ''}\n${document.content || ''}`);
              return normalizedKeywords.some((keyword) => searchable.includes(keyword));
            })
            .map((document) => ({ path: document.path }))
            .slice(0, 4);
        };
        const previousMilestones = Array.isArray(options.previousMilestones)
          ? options.previousMilestones
          : [];
        const requestText = options.requestText || '';
        const milestones = previousMilestones.length || requestText
          ? mergeRenderMilestonePlan(previousMilestones, generatedMilestones, requestText, pickReferences)
          : generatedMilestones;
        renderDraft = {
          assistantSummary: assistantSummary || 'A IA não retornou uma resposta, então o diagnóstico abaixo foi montado com heurísticas locais e documentação existente.',
          checks: readiness.checks,
          missing: readiness.missing,
          ready: readiness.ready,
          milestones,
          documents: documentation.documents,
          renderMarkdown: getRenderMapMarkdown(mapData),
        };
        syncRenderConversationState();
        renderRenderConversationsList();
        return renderDraft;
      }

      async function generateRenderDraft(userRequest = 'Executar a análise inicial do mapa.') {
        const projectInfo = getSelectedProjectInfo();
        const rootPath = projectInfo?.rootPath || '';
        if (!rootPath || renderWorkflowBusy) return;

        renderWorkflowBusy = true;
        await createRenderConversation();
        renderMessages = [];
        renderDraft = null;
        renderAttachments = [];
        setRenderPanelView('session');
        renderRenderPanel();

        if (renderSessionStatus) renderSessionStatus.textContent = 'Exportando o mapa e coletando documentação...';
        if (renderSessionLog) renderSessionLog.innerHTML = '';
        if (renderSessionChecklist) renderSessionChecklist.innerHTML = '';
        if (renderSessionMilestones) renderSessionMilestones.innerHTML = '';
        if (renderPanelStatus) {
          renderPanelStatus.textContent = 'Exportando o mapa e coletando documentação...';
        }

        const renderTicker = showRenderStatusTicker();

        try {
          const mapData = canvasController ? canvasController.getMapData() : { nodes: [], edges: [] };

          try {
            await api.renderApplicationMap({ rootPath });
            if (renderTicker && renderTicker.exportStep) {
              renderTicker.exportStep.classList.remove('active');
              renderTicker.exportStep.classList.add('completed');
            }
            await new Promise((resolve) => setTimeout(resolve, 180));
          } catch (error) {
            console.error('[generateRenderDraft] renderApplicationMap failed:', error);
          }

          if (renderSessionStatus) renderSessionStatus.textContent = 'Lendo markdowns do mapa e pedindo análise da IA...';
          if (renderPanelStatus) renderPanelStatus.textContent = 'Lendo markdowns do mapa e pedindo análise da IA...';
          if (renderTicker && renderTicker.sendStep) {
            renderTicker.sendStep.classList.add('active');
          }

          const documentation = await collectRenderDocumentation(rootPath, mapData);
          if (renderTicker && renderTicker.sendStep) {
            renderTicker.sendStep.classList.remove('active');
            renderTicker.sendStep.classList.add('completed');
          }
          await new Promise((resolve) => setTimeout(resolve, 180));
          if (renderTicker && renderTicker.analyzeStep) {
            renderTicker.analyzeStep.classList.add('active');
          }
          const renderPrompt = buildRenderPrompt(mapData, documentation, userRequest, renderMessages);

          let assistantSummary = '';
          try {
            const response = await api.sendAssistantMessage({
              projectInfo,
              userMessage: renderPrompt,
              contextHint: 'Você deve atuar de forma consultiva, diagnosticando lacunas do mapa para apoiar o planejamento e a futura geração de milestones.',
              conversationMessages: Array.isArray(renderMessages)
                ? renderMessages.map((message) => ({ role: message.role, text: message.content }))
                : [],
              attachments: [],
              isMapChat: true,
            });
            if (response && response.ok && response.response) {
              assistantSummary = response.response;
            }
          } catch (error) {
            console.error('[generateRenderDraft] sendAssistantMessage failed:', error);
          }
          if (renderTicker && renderTicker.analyzeStep) {
            renderTicker.analyzeStep.classList.remove('active');
            renderTicker.analyzeStep.classList.add('completed');
          }

          rebuildRenderDraft(mapData, documentation, assistantSummary);
          await new Promise((resolve) => setTimeout(resolve, 220));
          if (renderTicker && renderTicker.contextualizedStep) {
            renderTicker.contextualizedStep.classList.add('active');
          }

          const missingLabels = Array.isArray(renderDraft.missing)
            ? renderDraft.missing.map((item) => item.label || item.hint).filter(Boolean)
            : [];
          const introMessage = renderDraft.ready
            ? [
                'A análise inicial terminou e o plano já está coerente para virar milestones.',
                'Você pode revisar o resumo abaixo, pedir ajustes pelo chat e depois salvar o plano.'
              ].join(' ')
            : [
                'Ainda encontrei lacunas importantes antes de fechar as milestones.',
                missingLabels.length ? `Itens pendentes: ${missingLabels.join(', ')}.` : 'Ainda vale revisar os markdowns do projeto.',
                'Se quiser, eu posso te ajudar aqui no chat de render a completar o que está faltando.'
              ].join(' ');

          const generatedMessages = [
            { role: 'assistant', content: assistantSummary || 'A IA não retornou uma resposta, então montei um diagnóstico inicial com base nos markdowns encontrados.' },
            { role: 'assistant', content: introMessage },
          ];
          const nextMessages = Array.isArray(renderMessages) ? renderMessages.slice() : [];
          nextMessages.push(...generatedMessages);
          renderMessages = nextMessages;
          syncRenderConversationState();
          for (const message of generatedMessages) {
            await persistRenderConversationMessage(message.role, message.content);
          }

          if (renderSessionStatus) {
            renderSessionStatus.textContent = renderDraft.ready
              ? 'Análise pronta. O plano está pronto para revisão e refinamento no chat.'
              : 'Há lacunas importantes. O chat de render está aberto para completar as informações.';
          }
          if (renderPanelStatus) {
            renderPanelStatus.textContent = renderDraft.ready
              ? 'Análise pronta. O plano está pronto para revisão e refinamento no chat.'
              : 'Há lacunas importantes. O chat de render está aberto para completar as informações.';
          }
          if (renderTicker && renderTicker.contextualizedStep) {
            renderTicker.contextualizedStep.classList.remove('active');
            renderTicker.contextualizedStep.classList.add('completed');
          }

          setRenderPanelView('session');
          renderRenderPanel();
          if (renderSessionTextarea) {
            renderSessionTextarea.focus();
          }
        } catch (error) {
          console.error('[generateRenderDraft] failed:', error);
          renderDraft = {
            assistantSummary: 'Não foi possível concluir a análise de render neste momento.',
            checks: [],
            missing: [],
            ready: false,
            milestones: [],
            documents: [],
            renderMarkdown: '',
          };
          renderMessages = [
            { role: 'assistant', content: 'Não foi possível concluir a análise de render neste momento.' },
          ];
          syncRenderConversationState();
          await persistRenderConversationMessage('assistant', 'Não foi possível concluir a análise de render neste momento.');
          if (renderSessionStatus) {
            renderSessionStatus.textContent = `Falha ao analisar o mapa: ${error.message || String(error)}`;
          }
          if (renderPanelStatus) {
            renderPanelStatus.textContent = `Falha ao analisar o mapa: ${error.message || String(error)}`;
          }
          setRenderPanelView('session');
          renderRenderPanel();
        } finally {
          renderWorkflowBusy = false;
          hideRenderThinking();
          renderRenderPanel();
        }
      }

      async function sendRenderChatMessage(userText) {
        const messageText = String(userText || '').trim();
        if (!messageText || renderWorkflowBusy) return;

        const projectInfo = getSelectedProjectInfo();
        const rootPath = projectInfo?.rootPath || '';
        if (!rootPath) return;

        renderWorkflowBusy = true;

        if (!getActiveRenderConversation()) {
          await createRenderConversation();
        }

        const mapData = canvasController ? canvasController.getMapData() : { nodes: [], edges: [] };
        const history = Array.isArray(renderMessages) ? renderMessages.slice() : [];
        const outgoingAttachments = Array.isArray(renderAttachments)
          ? renderAttachments.map((attachment) => ({
              path: attachment.path,
              type: attachment.type,
              name: attachment.name,
            }))
          : [];
        renderMessages.push({ role: 'user', content: messageText, attachments: outgoingAttachments });
        renderRenderMessage('user', messageText, outgoingAttachments);
        const thinking = showRenderThinking();
        setRenderPlanUpdating(true);
        if (renderSessionStatus) renderSessionStatus.textContent = 'Analisando o pedido e refinando o plano...';
        if (renderPanelStatus) renderPanelStatus.textContent = 'Analisando o pedido e refinando o plano...';
        if (renderSessionSend) renderSessionSend.disabled = true;
        if (renderSessionTextarea) renderSessionTextarea.disabled = true;
        if (renderAttachButton) renderAttachButton.disabled = true;
        await persistRenderConversationMessage('user', messageText);
        renderAttachments = [];
        renderRenderAttachmentList();
        syncRenderConversationState();

        const previousMilestones = renderDraft && Array.isArray(renderDraft.milestones)
          ? renderDraft.milestones.map((milestone) => ({
              ...milestone,
              tasks: Array.isArray(milestone.tasks) ? milestone.tasks.map((task) => ({ ...task })) : [],
              references: Array.isArray(milestone.references) ? milestone.references.map((reference) => ({ ...reference })) : [],
            }))
          : [];
        let documentation = null;
        try {
          documentation = await collectRenderDocumentation(rootPath, mapData);
          const response = await api.sendAssistantMessage({
            projectInfo,
            userMessage: buildRenderPrompt(mapData, documentation, messageText, history),
            contextHint: 'Você deve refinar o plano de renderização com foco em clareza, cobertura das lacunas e qualidade das milestones.',
            conversationMessages: history.map((message) => ({ role: message.role, text: message.content })),
            attachments: outgoingAttachments,
            isMapChat: true,
          });

          if (thinking) thinking.remove();

          const assistantText = response && response.ok && response.response
            ? response.response
            : 'Não consegui refinar o plano neste momento.';
          renderMessages.push({ role: 'assistant', content: assistantText });
          renderRenderMessage('assistant', assistantText);
          await persistRenderConversationMessage('assistant', assistantText);

          const renderTranscript = renderMessages
            .map((message) => `${message.role}: ${message.content || ''}`)
            .join('\n\n');
          rebuildRenderDraft(mapData, documentation, `${renderTranscript}\n\nPedido atual do usuário: ${messageText}`, {
            previousMilestones,
            requestText: messageText,
          });
          syncRenderConversationState();

          if (renderSessionStatus) {
            renderSessionStatus.textContent = renderDraft.ready
              ? 'Plano refinado. Você pode salvar em milestones quando estiver satisfeito.'
              : 'Plano refinado, mas ainda existem lacunas para fechar.';
          }
          if (renderPanelStatus) {
            renderPanelStatus.textContent = renderDraft.ready
              ? 'Plano refinado. Você pode salvar em milestones quando estiver satisfeito.'
              : 'Plano refinado, mas ainda existem lacunas para fechar.';
          }
          renderRenderPanel();
        } catch (error) {
          if (thinking) thinking.remove();
          const fallbackText = documentation
            ? 'Não consegui obter uma resposta completa da IA agora, mas atualizei o rascunho local do plano com base no seu pedido.'
            : `Erro ao comunicar com a IA: ${error.message || String(error)}`;
          renderMessages.push({ role: 'assistant', content: fallbackText });
          renderRenderMessage('assistant', fallbackText);
          await persistRenderConversationMessage('assistant', fallbackText);
          if (documentation) {
            const renderTranscript = renderMessages
              .map((message) => `${message.role}: ${message.content || ''}`)
              .join('\n\n');
            rebuildRenderDraft(mapData, documentation, `${renderTranscript}\n\nPedido atual do usuário: ${messageText}`, {
              previousMilestones,
              requestText: messageText,
            });
            syncRenderConversationState();
          }
          if (renderSessionStatus) renderSessionStatus.textContent = fallbackText;
          if (renderPanelStatus) renderPanelStatus.textContent = fallbackText;
        } finally {
          hideRenderThinking();
          setRenderPlanUpdating(false);
          renderWorkflowBusy = false;
          if (renderSessionSend) renderSessionSend.disabled = false;
          if (renderSessionTextarea) renderSessionTextarea.disabled = false;
          if (renderAttachButton) renderAttachButton.disabled = false;
          renderRenderPanel();
        }
      }

      async function saveRenderMilestones() {
        const projectInfo = getSelectedProjectInfo();
        const rootPath = projectInfo?.rootPath || '';
        if (!rootPath || !renderDraft || !renderDraft.ready || !Array.isArray(renderDraft.milestones) || !renderDraft.milestones.length) {
          alert('Ainda faltam informações para consolidar as milestones.');
          return;
        }

        const confirmed = window.faberConfirm
          ? await window.faberConfirm('Confirma a criação deste plano de milestones no projeto?')
          : true;
        if (!confirmed) return;

        if (renderSessionStatus) renderSessionStatus.textContent = 'Salvando milestones no projeto...';
        if (renderPanelStatus) renderPanelStatus.textContent = 'Salvando milestones no projeto...';

        try {
          const milestonesForSave = renderDraft.milestones.map((milestone) => {
            const { changeMarker, ...cleanMilestone } = milestone || {};
            return {
              ...cleanMilestone,
              tasks: Array.isArray(cleanMilestone.tasks)
                ? cleanMilestone.tasks.map((task) => {
                    const { isRefinement, ...cleanTask } = task || {};
                    return cleanTask;
                  })
                : [],
            };
          });
          const saveResult = await api.saveMilestones({ rootPath, milestones: milestonesForSave });
          if (!saveResult || !saveResult.ok) {
            throw new Error(saveResult && saveResult.message ? saveResult.message : 'Falha ao salvar milestones.');
          }
          await api.renderMilestones({ rootPath });
          window.dispatchEvent(new CustomEvent('faber:milestones-updated', { detail: { rootPath } }));
          if (renderSessionStatus) renderSessionStatus.textContent = 'Milestones salvas e documentação atualizada.';
          if (renderPanelStatus) renderPanelStatus.textContent = 'Milestones salvas e documentação atualizada.';
          syncRenderConversationState();
        } catch (error) {
          console.error('[saveRenderMilestones] failed:', error);
          if (renderSessionStatus) renderSessionStatus.textContent = `Falha ao salvar milestones: ${error.message || String(error)}`;
          if (renderPanelStatus) renderPanelStatus.textContent = `Falha ao salvar milestones: ${error.message || String(error)}`;
          alert(`Falha ao salvar milestones: ${error.message || String(error)}`);
        }
      }

      async function loadMapConversations() {
        const projectId = getSelectedProjectId();
        if (!projectId) return;

        activeConversationId = null;
        mapChatMessages = [];
        setRenderPanelView('list');
        if (mapChatLog) mapChatLog.innerHTML = '';
        if (mapConversationsList) mapConversationsList.innerHTML = '';

        // Show list, hide session view
        if (mapChatListView) mapChatListView.classList.remove('hidden');
        if (mapChatSessionView) mapChatSessionView.classList.add('hidden');

        try {
          const result = await api.listConversations();
          if (result && result.ok) {
            const conversations = result.conversationsByProject && result.conversationsByProject[projectId]
              ? result.conversationsByProject[projectId]
              : [];
            const mapConversations = conversations.filter(c => c && c.source === 'map_chat');
            
            if (mapConversations.length > 0) {
              mapConversations.forEach(c => {
                const row = document.createElement('div');
                row.className = 'map-conversation-row';
                row.dataset.id = c.id;
                
                const titleSpan = document.createElement('span');
                titleSpan.className = 'map-conversation-title';
                titleSpan.textContent = c.title || 'Análise';
                row.appendChild(titleSpan);

                // Rename button
                const renameBtn = document.createElement('button');
                renameBtn.className = 'map-conversation-rename-btn';
                renameBtn.title = 'Renomear conversa';
                renameBtn.innerHTML = `
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                  </svg>
                `;
                row.appendChild(renameBtn);

                renameBtn.addEventListener('click', async (event) => {
                  event.stopPropagation();
                  const dialogController = window.FaberInlineInputDialog
                    ? window.FaberInlineInputDialog.createInlineInputDialogController()
                    : null;
                  
                  if (dialogController) {
                    const newTitle = await dialogController.requestText({
                      title: 'Renomear Conversa',
                      initialValue: c.title || 'Análise',
                      placeholder: 'Novo nome da conversa'
                    });
                    
                    if (newTitle !== null && newTitle.trim() !== '') {
                      const renameResult = await api.renameConversation({
                        projectId,
                        conversationId: c.id,
                        title: newTitle.trim()
                      });
                      if (renameResult && renameResult.ok) {
                        await loadMapConversations();
                      } else {
                        alert('Falha ao renomear conversa: ' + (renameResult.message || 'Erro desconhecido.'));
                      }
                    }
                  } else {
                    const newTitle = prompt('Renomear Conversa:', c.title || 'Análise');
                    if (newTitle !== null && newTitle.trim() !== '') {
                      const renameResult = await api.renameConversation({
                        projectId,
                        conversationId: c.id,
                        title: newTitle.trim()
                      });
                      if (renameResult && renameResult.ok) {
                        await loadMapConversations();
                      }
                    }
                  }
                });

                // Delete button
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'map-conversation-delete-btn';
                deleteBtn.title = 'Excluir conversa';
                deleteBtn.innerHTML = `
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                `;
                row.appendChild(deleteBtn);

                deleteBtn.addEventListener('click', async (event) => {
                  event.stopPropagation();
                  const confirmed = await window.faberConfirm("Deseja realmente excluir esta conversa?");
                  if (confirmed) {
                    const deleteResult = await api.deleteConversation({
                      projectId,
                      conversationId: c.id
                    });
                    if (deleteResult && deleteResult.ok) {
                      await loadMapConversations();
                    } else {
                      alert('Falha ao excluir conversa: ' + (deleteResult.message || 'Erro desconhecido.'));
                    }
                  }
                });

                const arrow = document.createElement('span');
                arrow.className = 'map-conversation-arrow';
                arrow.innerHTML = '➔';
                arrow.style.opacity = '0.5';
                row.appendChild(arrow);

                row.addEventListener('click', async () => {
                  activeConversationId = c.id;
                  if (mapChatSessionTitle) mapChatSessionTitle.textContent = c.title || 'Análise';
                  
                  // Switch to session view
                  if (mapChatListView) mapChatListView.classList.add('hidden');
                  if (mapChatSessionView) mapChatSessionView.classList.remove('hidden');
                  
                  await loadMapConversationMessages(c.id);
                });
                
                mapConversationsList.appendChild(row);
              });
            } else {
              const emptyMsg = document.createElement('p');
              emptyMsg.className = 'right-tool-empty';
              emptyMsg.style.textAlign = 'center';
              emptyMsg.style.padding = '20px 10px';
              emptyMsg.textContent = 'Nenhuma análise anterior encontrada. Clique em "Nova" para iniciar.';
              mapConversationsList.appendChild(emptyMsg);
            }

          }
          await loadRenderConversationsFromStore(projectId);
        } catch (err) {
          console.error('[loadMapConversations] Error:', err);
        }
      }

      async function loadMapConversationMessages(conversationId) {
        if (!conversationId) return;
        if (mapChatLog) mapChatLog.innerHTML = '';
        mapChatMessages = [];

        try {
          const result = await api.listConversationMessages({ conversationId, limit: 100 });
          if (result && result.ok && Array.isArray(result.messages)) {
            result.messages.forEach(m => {
              appendMapChatMessage(m.role, m.text);
              mapChatMessages.push({ role: m.role, content: m.text });
            });

            if (result.messages.length === 0) {
              await triggerMapAnalysis();
            }
          }
        } catch (err) {
          console.error('[loadMapConversationMessages] Error:', err);
        }
      }

      async function createNewMapConversation() {
        const projectId = getSelectedProjectId();
        if (!projectId) return;

        const now = new Date();
        const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const title = `Análise do Mapa (${dateStr} ${timeStr})`;

        try {
          const result = await api.addConversation({
            projectId,
            title,
            meta: { source: 'map_chat' }
          });
          if (result && result.ok && result.conversation) {
            const newConv = result.conversation;
            activeConversationId = newConv.id;

            if (mapChatSessionTitle) mapChatSessionTitle.textContent = newConv.title;

            // Switch to session view immediately
            if (mapChatListView) mapChatListView.classList.add('hidden');
            if (mapChatSessionView) mapChatSessionView.classList.remove('hidden');

            if (mapChatLog) mapChatLog.innerHTML = '';
            mapChatMessages = [];

            await triggerMapAnalysis();
          }
        } catch (err) {
          console.error('[createNewMapConversation] Error:', err);
        }
      }

      async function triggerMapAnalysis() {
        const projectId = getSelectedProjectId();
        const projectInfo = getSelectedProjectInfo();
        const rootPath = projectInfo?.rootPath || '';
        if (!projectId || !rootPath) return;

        // Append status ticker to chat log
        const ticker = document.createElement('div');
        ticker.className = 'map-chat-status-ticker';
        ticker.id = 'map-chat-status-ticker';
        ticker.innerHTML = `
          <div class="ticker-step" id="step-export-md"><span class="status-dot"></span> <span>Exportando markdowns...</span></div>
          <div class="ticker-step" id="step-send-images"><span class="status-dot"></span> <span>Enviando imagens...</span></div>
          <div class="ticker-step" id="step-analyze-info"><span class="status-dot"></span> <span>Analisando informações...</span></div>
          <div class="ticker-step" id="step-contextualized"><span class="status-dot"></span> <span>Chat contextualizado!</span></div>
        `;
        if (mapChatLog) {
          mapChatLog.appendChild(ticker);
          mapChatLog.scrollTop = mapChatLog.scrollHeight;
        }

        const stepExportMd = document.getElementById('step-export-md');
        const stepSendImages = document.getElementById('step-send-images');
        const stepAnalyzeInfo = document.getElementById('step-analyze-info');
        const stepContextualized = document.getElementById('step-contextualized');

        const mapData = canvasController ? canvasController.getMapData() : { nodes: [], edges: [] };
        const imageDescriptions = {}; // Map node.id -> description text

        // --- PASSO 1: Exportando markdowns ---
        if (stepExportMd) stepExportMd.classList.add('active');
        try {
          await api.renderApplicationMap({ rootPath });
          if (stepExportMd) {
            stepExportMd.classList.remove('active');
            stepExportMd.classList.add('completed');
          }
        } catch (err) {
          console.error('[triggerMapAnalysis] Export markdown error:', err);
          if (stepExportMd) stepExportMd.classList.remove('active');
        }

        // --- PASSO 2: Enviando imagens ---
        if (stepSendImages) stepSendImages.classList.add('active');
        const imageNodes = mapData.nodes.filter(n => n && (n.type === 'image' || n.assetId));
        if (imageNodes.length > 0) {
          const spanText = stepSendImages.querySelector('span:not(.status-dot)');
          for (let i = 0; i < imageNodes.length; i++) {
            const node = imageNodes[i];
            const assetId = node.assetId || node.content;
            if (!assetId) continue;

            if (spanText) {
              spanText.textContent = `Enviando imagens (${i + 1}/${imageNodes.length})...`;
            }

            const imgPath = window.electron ? window.electron.pathJoin(rootPath, assetId) : `${rootPath}/${assetId}`;
            const imgAttachments = [{
              path: imgPath,
              type: assetId.endsWith('.png') ? 'image/png' : assetId.endsWith('.jpg') ? 'image/jpeg' : 'image/jpeg',
              name: assetId
            }];

            try {
              const response = await api.sendAssistantMessage({
                projectInfo,
                userMessage: `Por favor, analise a seguinte imagem do mapa da aplicação (nome: ${assetId}) e forneça uma descrição detalhada de seu conteúdo técnico, elementos de UI/UX, fluxos ou informações de design apresentadas.`,
                contextHint: 'Você é um assistente técnico analista de UI/UX. Descreva com precisão tudo o que está visível na imagem e sua relação com o desenvolvimento de software.',
                conversationMessages: [],
                attachments: imgAttachments,
                isMapChat: true
              });
              if (response && response.ok && response.response) {
                imageDescriptions[node.id] = response.response;
              } else {
                imageDescriptions[node.id] = '(IA não conseguiu analisar a imagem)';
              }
            } catch (err) {
              console.error('[triggerMapAnalysis] Image analysis error for ' + assetId, err);
              imageDescriptions[node.id] = `(Erro de OCR/Visão: ${err.message || String(err)})`;
            }
          }
        }
        if (stepSendImages) {
          stepSendImages.classList.remove('active');
          stepSendImages.classList.add('completed');
          const spanText = stepSendImages.querySelector('span:not(.status-dot)');
          if (spanText) spanText.textContent = 'Imagens enviadas';
        }

        // --- PASSO 3: Analisando informações ---
        if (stepAnalyzeInfo) stepAnalyzeInfo.classList.add('active');

        // Compile group-centric prompt content
        let promptText = 'Por favor, analise as informações consolidadas do mapa da minha aplicação.\n\n';
        promptText += 'O mapa da aplicação foi exportado para a pasta `docs/application-map/` no meu workspace.\n';
        promptText += 'Aqui estão as informações detalhadas estruturadas por grupo:\n\n';

        const rootNodes = mapData.nodes.filter(n => !n.parentId);
        const childNodes = mapData.nodes.filter(n => n.parentId);
        const groups = rootNodes.filter(n => n.type === 'group' || n.type === 'folder');

        for (const g of groups) {
          const fileBasename = g.title.toLowerCase().replace(/[^a-z0-9_-]/g, '-') + '.md';
          const relativePath = 'docs/application-map/' + fileBasename;
          let markdownContent = '';

          try {
            const readResult = await api.readProjectFile({ projectInfo, relativePath });
            if (readResult && readResult.ok) {
              markdownContent = readResult.content;
            }
          } catch (err) {
            console.warn('[triggerMapAnalysis] Failed to read group markdown: ' + relativePath, err);
          }

          promptText += `### GRUPO: ${g.title}\n`;
          if (markdownContent) {
            promptText += `${markdownContent}\n\n`;
          } else {
            promptText += `*(Grupo sem documentação markdown)*\n\n`;
          }

          // Add descriptions of images belonging to this group
          const groupImages = childNodes.filter(c => c.parentId === g.id && (c.type === 'image' || c.assetId));
          if (groupImages.length > 0) {
            promptText += `#### Imagens deste Grupo:\n`;
            groupImages.forEach(img => {
              const desc = imageDescriptions[img.id] || '(Nenhuma descrição disponível)';
              promptText += `- **Imagem [${img.title}]:** ${desc}\n`;
            });
            promptText += '\n';
          }
          promptText += '---\n\n';
        }

        // Orphan/Standalone Nodes
        const standalones = rootNodes.filter(n => n.type !== 'group' && n.type !== 'folder');
        const orphanImages = standalones.filter(n => n.type === 'image' || n.assetId);
        const orphanTexts = standalones.filter(n => n.type !== 'image' && !n.assetId);

        if (orphanTexts.length > 0 || orphanImages.length > 0) {
          promptText += `### ITENS AVULSOS (SEM GRUPO)\n`;
          orphanTexts.forEach(n => {
            promptText += `- **[${n.type.toUpperCase()}]** ${n.title}`;
            if (n.description) promptText += ` — ${n.description}`;
            if (n.content) promptText += ` (Conteúdo: \`${n.content}\`)`;
            promptText += '\n';
          });
          if (orphanImages.length > 0) {
            promptText += `\n#### Imagens Avulsas:\n`;
            orphanImages.forEach(img => {
              const desc = imageDescriptions[img.id] || '(Nenhuma descrição disponível)';
              promptText += `- **Imagem [${img.title}]:** ${desc}\n`;
            });
          }
          promptText += '\n---\n\n';
        }

        // Read auxiliary files (README.md, decisions.md, open-questions.md)
        const auxFiles = [
          { name: 'README.md', path: 'docs/application-map/README.md' },
          { name: 'Decisões', path: 'docs/application-map/decisions.md' },
          { name: 'Dúvidas e Perguntas', path: 'docs/application-map/open-questions.md' }
        ];
        promptText += '### OUTROS ARQUIVOS DE CONTEXTO DO MAPA:\n\n';
        for (const file of auxFiles) {
          try {
            const readResult = await api.readProjectFile({ projectInfo, relativePath: file.path });
            if (readResult && readResult.ok) {
              promptText += `#### ${file.name} (${file.path}):\n${readResult.content}\n\n`;
            }
          } catch (err) {
            console.warn('[triggerMapAnalysis] Failed to read auxiliary file: ' + file.path, err);
          }
        }

        promptText += '\nCom base em todos os markdowns estruturados por grupo e nas descrições de imagens fornecidas acima:\n';
        promptText += '1. Faça um resumo curto provando que você compreendeu as informações do mapa (UI/UX, design system, Front End, Backend, etc.).\n';
        promptText += '2. Comente o que você vê que eu planejo criar.\n';
        promptText += '3. Diga quais pontos do planejamento você acha que estão faltando para eu finalizar a modelagem do meu projeto.\n';

        const systemGuidance = 
          `Você é o Assistente de Modelagem do Mapa da Aplicação no Faber Code.\n` +
          `O usuário está editando o mapa e solicitou ajuda.\n\n` +
          `DIRETRIZES IMPORTANTES PARA SUAS RESPOSTAS:\n` +
          `1. Você NÃO deve tentar criar a aplicação, sugerir geração de código ou planejar tarefas de desenvolvimento de backend/frontend.\n` +
          `2. Seu foco exclusivo é ajudar o usuário a compreender e planejar que tipo de aplicação quer criar, auxiliando a documentar e definir os markdowns (textos, notas e referências visuais) necessários para desenhar e fechar a modelagem do projeto no Mapa da Aplicação.\n` +
          `3. Você pode ler arquivos do projeto para contextualizar a sua resposta, porém não execute tarefas ou scripts de alteração de código fonte.\n` +
          `4. Responda em linguagem natural, amigável, clara e objetiva.\n` +
          `5. No início da sua resposta, prove ao usuário que compreendeu o planejamento iniciando com uma frase explicativa como "Entendido, então você deseja criar uma aplicação com o..." seguida por um resumo curto.\n` +
          `6. NUNCA diga frases como "Entendi. Vou trabalhar nisso agora e te volto com resultado real" e NUNCA aja como se fosse criar a aplicação.`;

        try {
          const response = await api.sendAssistantMessage({
            projectInfo,
            userMessage: promptText,
            contextHint: systemGuidance,
            conversationMessages: [],
            attachments: [], // Attachments are already processed and described in the prompt text
            isMapChat: true
          });

          if (stepAnalyzeInfo) {
            stepAnalyzeInfo.classList.remove('active');
            stepAnalyzeInfo.classList.add('completed');
          }

          if (stepContextualized) {
            stepContextualized.classList.add('active');
            stepContextualized.classList.add('completed');
          }

          // Delay slightly so the user sees the completed state
          await new Promise(r => setTimeout(r, 600));
          if (ticker) ticker.remove();

          if (response && response.ok && response.response) {
            appendMapChatMessage('assistant', response.response);
            mapChatMessages.push({ role: 'assistant', content: response.response });

            if (activeConversationId) {
              await api.addConversationMessage({
                projectId,
                conversationId: activeConversationId,
                role: 'assistant',
                text: response.response
              });
            }
          } else {
            appendMapChatMessage('assistant', 'Desculpe, não consegui obter uma resposta da IA neste momento.');
          }
        } catch (err) {
          if (ticker) ticker.remove();
          appendMapChatMessage('assistant', `Erro ao comunicar com a IA: ${err.message || String(err)}`);
        }
      }

      async function sendMapChatMessage(userText) {
        if (!userText.trim()) return;

        appendMapChatMessage('user', userText);
        mapChatMessages.push({ role: 'user', content: userText });

        const projectId = getSelectedProjectId();
        if (activeConversationId) {
          try {
            await api.addConversationMessage({
              projectId,
              conversationId: activeConversationId,
              role: 'user',
              text: userText
            });
          } catch (err) {
            console.error('[sendMapChatMessage] Save user error:', err);
          }
        }

        const thinking = showMapChatThinking();

        const mapData = canvasController ? canvasController.getMapData() : { nodes: [], edges: [] };
        
        let mapMarkdown = "# MAPA DA APLICAÇÃO ATUAL (BOARD)\n\n";
        
        const rootNodes = mapData.nodes.filter(n => !n.parentId);
        const childNodes = mapData.nodes.filter(n => n.parentId);
        
        const groups = rootNodes.filter(n => n.type === 'group');
        if (groups.length > 0) {
          mapMarkdown += "## GRUPOS / MÓDULOS\n";
          groups.forEach(g => {
            mapMarkdown += `### 📁 Grupo: ${g.title}\n`;
            if (g.description) mapMarkdown += `*Descrição:* ${g.description}\n`;
            
            const children = childNodes.filter(c => c.parentId === g.id);
            if (children.length > 0) {
              mapMarkdown += "\n*Itens pertencentes a este grupo:*\n";
              children.forEach(c => {
                mapMarkdown += `- **[${c.type.toUpperCase()}]** ${c.title}`;
                if (c.description) mapMarkdown += ` — ${c.description}`;
                if (c.content) mapMarkdown += ` (Conteúdo: \`${c.content}\`)`;
                mapMarkdown += "\n";
              });
            } else {
              mapMarkdown += "\n*(Este grupo está vazio)*\n";
            }
            mapMarkdown += "\n";
          });
        }
        
        const standalones = rootNodes.filter(n => n.type !== 'group');
        if (standalones.length > 0) {
          mapMarkdown += "## ITENS SOLTOS NO CANVAS\n";
          standalones.forEach(n => {
            mapMarkdown += `- **[${n.type.toUpperCase()}]** ${n.title}`;
            if (n.description) mapMarkdown += ` — ${n.description}`;
            if (n.content) mapMarkdown += ` (Conteúdo: \`${n.content}\`)`;
            mapMarkdown += "\n";
          });
          mapMarkdown += "\n";
        }
        
        if (mapData.edges.length > 0) {
          mapMarkdown += "## CONEXÕES E DEPENDÊNCIAS\n";
          mapData.edges.forEach(e => {
            const src = mapData.nodes.find(n => n.id === e.sourceNodeId);
            const tgt = mapData.nodes.find(n => n.id === e.targetNodeId);
            if (src && tgt) {
              mapMarkdown += `- **${src.title}** (${src.type}) ➔ **${tgt.title}** (${tgt.type})\n`;
            }
          });
          mapMarkdown += "\n";
        }

        const systemGuidance = 
          `Você é o Assistente de Modelagem do Mapa da Aplicação no Faber Code.\n` +
          `O usuário está editando o mapa e solicitou ajuda.\n\n` +
          `Aqui está o estado atual do board mapeado pelo usuário em formato Markdown:\n` +
          `\`\`\`markdown\n` +
          `${mapMarkdown}\n` +
          `\`\`\`\n\n` +
          `DIRETRIZES IMPORTANTES PARA SUAS RESPOSTAS:\n` +
          `1. Você NÃO deve tentar criar a aplicação, sugerir geração de código ou planejar tarefas de desenvolvimento de backend/frontend.\n` +
          `2. Seu foco exclusivo é ajudar o usuário a compreender e planejar que tipo de aplicação quer criar, auxiliando a documentar e definir os markdowns (textos, notas e referências visuais) necessários para desenhar e fechar a modelagem do projeto no Mapa da Aplicação.\n` +
          `3. Você pode ler arquivos do projeto para contextualizar a sua resposta, porém não execute tarefas ou scripts de alteração de código fonte.\n` +
          `4. Responda em linguagem natural, amigável, clara e objetiva.\n` +
          `5. No início da sua resposta, prove ao usuário que compreendeu o planejamento iniciando com uma frase explicativa como "Entendido, então você deseja criar uma aplicação com o..." seguida por um resumo curto.\n` +
          `6. NUNCA diga frases como "Entendi. Vou trabalhar nisso agora e te volto com resultado real" e NUNCA aja como se fosse criar a aplicação.`;

        const mapAttachments = [];
        const projectInfo = getSelectedProjectInfo();
        const rootPath = projectInfo?.rootPath || '';
        if (rootPath) {
          const uniqueAssetIds = [...new Set(mapData.nodes.filter(n => n.assetId).map(n => n.assetId))];
          uniqueAssetIds.forEach(assetId => {
            mapAttachments.push({
              path: window.electron ? window.electron.pathJoin(rootPath, assetId) : `${rootPath}/${assetId}`,
              type: assetId.endsWith('.png') ? 'image/png' : assetId.endsWith('.jpg') ? 'image/jpeg' : 'image/jpeg',
              name: assetId
            });
          });
        }

        try {
          const response = await api.sendAssistantMessage({
            projectInfo: projectInfo,
            userMessage: userText,
            contextHint: systemGuidance,
            conversationMessages: mapChatMessages.map(m => ({ role: m.role, text: m.content })),
            attachments: mapAttachments,
            isMapChat: true
          });

          hideMapChatThinking();

          if (response && response.ok && response.response) {
            appendMapChatMessage('assistant', response.response);
            mapChatMessages.push({ role: 'assistant', content: response.response });

            if (activeConversationId) {
              try {
                await api.addConversationMessage({
                  projectId,
                  conversationId: activeConversationId,
                  role: 'assistant',
                  text: response.response
                });
              } catch (err) {
                console.error('[sendMapChatMessage] Save assistant error:', err);
              }
            }
          } else {
            appendMapChatMessage('assistant', 'Desculpe, não consegui obter uma resposta da IA neste momento.');
          }
        } catch (err) {
          hideMapChatThinking();
          appendMapChatMessage('assistant', `Erro ao comunicar com a IA: ${err.message || String(err)}`);
        }
      }

      if (btnMapChatSend && mapChatTextarea) {
        btnMapChatSend.addEventListener('click', () => {
          const text = mapChatTextarea.value;
          mapChatTextarea.value = '';
          sendMapChatMessage(text);
        });

        mapChatTextarea.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            btnMapChatSend.click();
          }
        });
      }

      if (btnMapChatBack) {
        btnMapChatBack.addEventListener('click', async () => {
          activeConversationId = null;
          await loadMapConversations();
        });
      }

      if (btnMapChatNew) {
        btnMapChatNew.addEventListener('click', async () => {
          btnMapChatNew.disabled = true;
          await createNewMapConversation();
          btnMapChatNew.disabled = false;
        });
      }

      if (btnMapRenderLauncher) {
        btnMapRenderLauncher.addEventListener('click', async () => {
          if (inspector && inspector.classList.contains('open')) {
            closeInspector();
          }
          setMapSidePanelMode('mode-map-render');
          await loadRenderConversationsFromStore();
          setRenderPanelView('list');
          renderRenderPanel();
        });
      }

      if (renderPanelOpen) {
        renderPanelOpen.addEventListener('click', async () => {
          if (renderWorkflowBusy) return;
          if (inspector && inspector.classList.contains('open')) {
            closeInspector();
          }
          setMapSidePanelMode('mode-map-render');
          await generateRenderDraft();
        });
      }

      if (renderListBack) {
        renderListBack.addEventListener('click', async () => {
          if (renderWorkflowBusy) return;
          setMapSidePanelMode('mode-map-chat');
          setRenderPanelView('list');
          renderRenderPanel();
          await loadMapConversations();
        });
      }

      if (renderSessionBack) {
        renderSessionBack.addEventListener('click', async () => {
          if (renderWorkflowBusy) return;
          await loadRenderConversationsFromStore();
          setRenderPanelView('list');
          renderRenderPanel();
        });
      }

      if (renderAttachButton && renderFileInput) {
        renderAttachButton.addEventListener('click', () => {
          renderFileInput.click();
        });
        renderFileInput.addEventListener('change', (event) => {
          const incoming = Array.from((event && event.target && event.target.files) || []);
          if (!incoming.length) return;
          const allowed = incoming.filter((file) => {
            const lowerName = String(file.name || '').toLowerCase();
            return (
              file.type.startsWith('image/') ||
              lowerName.endsWith('.pdf') ||
              lowerName.endsWith('.txt') ||
              lowerName.endsWith('.md') ||
              lowerName.endsWith('.markdown')
            );
          });
          if (!allowed.length) {
            event.target.value = '';
            return;
          }
          renderAttachments = [...renderAttachments, ...allowed.map((file) => ({
            path: file.path,
            type: file.type,
            name: file.name,
          }))];
          renderRenderAttachmentList();
          syncRenderConversationState();
          event.target.value = '';
        });
      }

      if (renderSessionSend && renderSessionTextarea) {
        renderSessionSend.addEventListener('click', () => {
          const text = renderSessionTextarea.value;
          renderSessionTextarea.value = '';
          sendRenderChatMessage(text);
        });

        renderSessionTextarea.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            renderSessionSend.click();
          }
        });
      }

      if (renderPanelSave) {
        renderPanelSave.addEventListener('click', async () => {
          await saveRenderMilestones();
        });
      }

      const btnAi = document.getElementById('btn-map-ai');
      if (btnAi) {
        btnAi.addEventListener('click', async () => {
          document.body.classList.remove('mode-map-render');
          document.body.classList.remove('mode-milestones');
          document.body.classList.remove('mode-cortex');
          document.body.classList.remove('mode-git');
          document.body.classList.remove('mode-terminal');
          const cortexBtn = document.getElementById('btn-cortex-mode');
          if (cortexBtn) cortexBtn.classList.remove('active');
          const milestonesBtn = document.getElementById('btn-project-milestones');
          if (milestonesBtn) milestonesBtn.classList.remove('active');
          const gitBtn = document.getElementById('btn-project-git');
          if (gitBtn) gitBtn.classList.remove('active');
          const terminalBtn = document.getElementById('btn-project-terminal');
          if (terminalBtn) terminalBtn.classList.remove('active');

          const terminalController = getTerminalController();
          if (terminalController) {
            terminalController.closePanel();
          }

          const active = !document.body.classList.contains('mode-map-chat');
          setMapSidePanelMode(active ? 'mode-map-chat' : null);
          btnAi.classList.toggle('active', active);

          const filesBtn = document.getElementById('btn-project-files');
          if (filesBtn) {
            filesBtn.classList.toggle('active', !active);
          }

          if (active) {
            if (document.body.classList.contains('workspace-right-collapsed')) {
              const rightToggle = document.getElementById('workspace-collapse-right');
              if (rightToggle) rightToggle.click();
            }

            await loadMapConversations();
          }
        });
      }

      // Inspector events
      if (inspectorClose) inspectorClose.addEventListener('click', closeInspector);
      if (inspectorDelete) inspectorDelete.addEventListener('click', () => {
        canvasController.deleteSelectedNode();
      });

      const updateSelectedNodeData = () => {
        const node = canvasController.getSelectedNode();
        if (!node) return;

        canvasController.updateSelectedNode({
          title: inspectorTitle.value,
          description: inspectorDesc.value,
          content: inspectorContent.value
        });
      };

      [inspectorTitle, inspectorDesc].forEach((field) => {
        if (field) {
          field.addEventListener('input', updateSelectedNodeData);
        }
      });
      if (inspectorContent && !contentEditor) {
        inspectorContent.addEventListener('input', updateSelectedNodeData);
      }

      // Asset Upload handler
      if (inspectorAssetInput) {
        inspectorAssetInput.addEventListener('change', async () => {
          const file = inspectorAssetInput.files[0];
          const rootPath = getSelectedProjectInfo()?.rootPath;
          if (!file || !rootPath) return;

          const reader = new FileReader();
          reader.onload = async (e) => {
            const base64Data = e.target.result;
            const result = await api.importApplicationMapAsset({
              rootPath,
              base64Data,
              fileName: file.name,
              kind: 'references'
            });

            if (result.ok && result.asset) {
              canvasController.updateSelectedNode({
                assetId: result.asset.projectRelativePath,
                content: result.asset.projectRelativePath
              });
              // Reload inspector field content
              if (inspectorContent) {
                inspectorContent.value = result.asset.projectRelativePath;
                if (contentEditor) contentEditor.setValue(result.asset.projectRelativePath);
              }
            } else {
              alert('Falha ao importar imagem: ' + (result.message || 'Erro desconhecido.'));
            }
          };
          reader.readAsDataURL(file);
        });
      }

      // Close inspector if other sidebar tools are clicked
      const otherSidebarButtons = [
        'btn-project-files',
        'btn-map-ai',
        'btn-project-git',
        'btn-project-terminal',
        'btn-project-milestones',
        'btn-cortex-mode'
      ];
      otherSidebarButtons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
          btn.addEventListener('click', () => {
            if (inspector && inspector.classList.contains('open')) {
              inspector.classList.add('hidden');
              inspector.classList.remove('open');
              document.body.classList.remove('mode-map-inspector');
              previousPanelInfo = null;
              if (canvasController && typeof canvasController.selectNode === 'function') {
                if (canvasController.getSelectedNode()) {
                  canvasController.selectNode(null);
                }
              }
            }
          });
        }
      });

      // Markdown toolbar events
      const toolbar = document.querySelector('.markdown-editor-toolbar');
      if (toolbar) {
        toolbar.querySelectorAll('button').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            const format = btn.dataset.format;
            insertMarkdown(format);
          });
        });
      }
    }

    function switchTab(mode) {
      const chatRegion = document.getElementById('workspace-chat-region');
      const mapRegion = document.getElementById('workspace-map-region');
      const welcomePanel = document.getElementById('welcome-panel');

      if (mode === 'chat') {
        setMapSidePanelMode(null);
        if (tabChat) tabChat.classList.add('active');
        if (tabMap) tabMap.classList.remove('active');
        if (chatRegion) chatRegion.classList.remove('hidden');
        if (mapRegion) mapRegion.classList.add('hidden');
        if (welcomePanel) {
          // Trigger normal welcome panel visibility rules
          welcomePanel.classList.toggle('hidden', chatRegion.querySelector('#chat-log').children.length > 0);
        }
      } else {
        if (tabChat) tabChat.classList.remove('active');
        if (tabMap) tabMap.classList.add('active');
        if (chatRegion) chatRegion.classList.add('hidden');
        if (mapRegion) mapRegion.classList.remove('hidden');
        if (welcomePanel) welcomePanel.classList.add('hidden');
        if (canvasController) {
          canvasController.setTool('select');
        }

        // Draw connections after tab is shown and dimensions are computed
        setTimeout(() => {
          if (canvasController) canvasController.drawEdges();
        }, 100);
      }
    }

    let previousPanelInfo = null;

    function getCurrentlyActiveRightSidebarPanel() {
      if (document.body.classList.contains('mode-map-render')) {
        return { panel: document.getElementById('workspace-map-render-panel'), title: 'Renderização do Mapa', buttonId: 'btn-map-render-open' };
      }
      if (document.body.classList.contains('mode-cortex')) {
        return { panel: document.getElementById('cortex-learning-box'), title: 'Regras e contexto', buttonId: 'btn-cortex-mode' };
      }
      if (document.body.classList.contains('mode-git')) {
        return { panel: document.getElementById('workspace-git-panel'), title: 'Git', buttonId: 'btn-project-git' };
      }
      if (document.body.classList.contains('mode-terminal')) {
        return { panel: document.getElementById('project-terminal-panel'), title: 'Terminal', buttonId: 'btn-project-terminal' };
      }
      if (document.body.classList.contains('mode-milestones')) {
        return { panel: document.getElementById('workspace-milestones-panel'), title: 'Milestones', buttonId: 'btn-project-milestones' };
      }
      if (document.body.classList.contains('mode-map-chat')) {
        return { panel: document.getElementById('workspace-map-chat-panel'), title: 'Perguntar à IA', buttonId: 'btn-map-ai' };
      }
      // Default to files
      return { panel: document.getElementById('workspace-files-region'), title: 'Arquivos', buttonId: 'btn-project-files' };
    }

    function openInspector(node) {
      if (!inspector) return;

      // If inspector is not already open, remember current panel
      if (!inspector.classList.contains('open')) {
        previousPanelInfo = getCurrentlyActiveRightSidebarPanel();
      }

      inspectorTitle.value = node.title || '';
      inspectorDesc.value = node.description || '';
      inspectorContent.value = node.content || '';
      if (contentEditor) {
        contentEditor.setValue(node.content || '');
        setTimeout(() => contentEditor.refresh(), 10);
      }

      // Only show upload button for image or group node types
      if (inspectorAssetField) {
        inspectorAssetField.style.display = (node.type === 'image' || node.type === 'group') ? 'block' : 'none';
      }

      // Hide other panels in right zone
      const rightZone = document.getElementById('workspace-right-zone');
      if (rightZone) {
        rightZone.querySelectorAll('.workspace-tool-region').forEach(el => {
          if (el.id !== 'workspace-actions-region') {
            el.classList.add('hidden');
          }
        });
      }

      // Show inspector panel
      inspector.classList.remove('hidden');
      inspector.classList.add('open');

      // Clear other tool body classes to avoid display conflicts
      const modeClasses = ['mode-map-chat', 'mode-map-render', 'mode-git', 'mode-terminal', 'mode-milestones', 'mode-cortex'];
      modeClasses.forEach(cls => {
        document.body.classList.remove(cls);
      });
      document.body.classList.add('mode-map-inspector');

      // Update header title of right panel
      const rightPanelTitle = document.getElementById('right-panel-title');
      if (rightPanelTitle) {
        rightPanelTitle.textContent = 'Detalhes do Item';
      }

      // Ensure right panel is expanded
      if (document.body.classList.contains('workspace-right-collapsed')) {
        const rightToggle = document.getElementById('workspace-collapse-right');
        if (rightToggle) rightToggle.click();
      }
    }

    function closeInspector() {
      if (!inspector) return;

      const wasOpen = inspector.classList.contains('open');
      if (!wasOpen) return;

      inspector.classList.remove('open');
      inspector.classList.add('hidden');
      document.body.classList.remove('mode-map-inspector');

      // Restore previously active panel body class
      if (previousPanelInfo && previousPanelInfo.buttonId) {
        if (previousPanelInfo.buttonId === 'btn-map-ai') {
          document.body.classList.add('mode-map-chat');
        } else if (previousPanelInfo.buttonId === 'btn-map-render-open') {
          document.body.classList.add('mode-map-render');
        } else if (previousPanelInfo.buttonId === 'btn-project-git') {
          document.body.classList.add('mode-git');
        } else if (previousPanelInfo.buttonId === 'btn-project-terminal') {
          document.body.classList.add('mode-terminal');
        } else if (previousPanelInfo.buttonId === 'btn-project-milestones') {
          document.body.classList.add('mode-milestones');
        } else if (previousPanelInfo.buttonId === 'btn-cortex-mode') {
          document.body.classList.add('mode-cortex');
        }
      }

      // Restore previously active panel
      if (previousPanelInfo) {
        const rightZone = document.getElementById('workspace-right-zone');
        if (rightZone) {
          rightZone.querySelectorAll('.workspace-tool-region').forEach(el => {
            if (el.id !== 'workspace-actions-region') {
              el.classList.add('hidden');
            }
          });
        }
        previousPanelInfo.panel.classList.remove('hidden');
        previousPanelInfo.panel.classList.remove('workspace-runtime-hidden');

        const rightPanelTitle = document.getElementById('right-panel-title');
        if (rightPanelTitle) {
          rightPanelTitle.textContent = previousPanelInfo.title;
        }
      } else {
        const filesRegion = document.getElementById('workspace-files-region');
        if (filesRegion) {
          filesRegion.classList.remove('hidden');
          filesRegion.classList.remove('workspace-runtime-hidden');
        }
        setMapSidePanelMode(null);
      }

      previousPanelInfo = null;

      if (canvasController && typeof canvasController.selectNode === 'function') {
        if (canvasController.getSelectedNode()) {
          canvasController.selectNode(null);
        }
      }
    }

    async function loadProjectMap(projectId, options = {}) {
      const rootPath = getSelectedProjectInfo()?.rootPath;
      if (!rootPath) return;

      const result = await api.getApplicationMap({ rootPath });
      if (result && result.ok && result.map) {
        canvasController.loadMapData(result.map);
      }
      
      await loadMapConversations();

      // Auto-toggle tab: Show Map for new projects with 0 files
      const hasFiles = Number(getSelectedProjectInfo()?.totalFiles || 0) > 0;
      if (centerTabs) centerTabs.classList.remove('hidden');
      const targetTab = options.initialTab || (hasFiles ? 'chat' : 'map');
      switchTab(targetTab);
    }

    function triggerAutosave() {
      if (autosaveTimeout) clearTimeout(autosaveTimeout);
      autosaveTimeout = setTimeout(async () => {
        const projectId = getSelectedProjectId();
        const rootPath = getSelectedProjectInfo()?.rootPath;
        if (!projectId || !rootPath) return;
        
        const mapData = canvasController.getMapData();
        await api.saveApplicationMap({ rootPath, map: mapData });
      }, 1000);
    }

    function resetForNoProject() {
      if (centerTabs) centerTabs.classList.add('hidden');
      closeInspector();
      switchTab('chat');
    }

    return {
      init,
      loadProjectMap,
      resetForNoProject,
      switchTab
    };
  }

  window.FaberApplicationMap = {
    createApplicationMapController
  };
})();

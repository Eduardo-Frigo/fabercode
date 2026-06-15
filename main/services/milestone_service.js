const defaultFs = require('fs');
const defaultPath = require('path');

const DEFAULT_MILESTONES = [
  {
    id: 'milestone-1',
    number: 1,
    title: 'Foundation',
    summary: 'Definição da stack inicial, estrutura de pastas e dependências básicas.',
    status: 'ready',
    tasks: [
      { id: 'task-1-1', title: 'Configurar repositório Git e estrutura de diretórios', status: 'pending' },
      { id: 'task-1-2', title: 'Definir e instalar dependências principais do projeto', status: 'pending' },
      { id: 'task-1-3', title: 'Criar configuração de build e script de desenvolvimento', status: 'pending' }
    ],
    acceptanceCriteria: 'Projeto inicia localmente sem erros e possui repositório git inicializado.',
    validationCommands: 'npm run build\nnpm test',
    commits: [],
    notes: ''
  },
  {
    id: 'milestone-2',
    number: 2,
    title: 'Frontend Shell',
    summary: 'Layout base, roteamento inicial e design system.',
    status: 'planned',
    tasks: [
      { id: 'task-2-1', title: 'Implementar folha de estilos global e tokens de design', status: 'pending' },
      { id: 'task-2-2', title: 'Criar componentes de layout comuns (Header, Sidebar, Footer)', status: 'pending' },
      { id: 'task-2-3', title: 'Configurar roteador e criar páginas estáticas iniciais', status: 'pending' }
    ],
    acceptanceCriteria: 'Interface carrega os estilos globais e permite navegação entre páginas básicas.',
    validationCommands: 'npm run lint',
    commits: [],
    notes: ''
  },
  {
    id: 'milestone-3',
    number: 3,
    title: 'Backend Core',
    summary: 'Configuração do servidor, conexões e lógica de negócios inicial.',
    status: 'planned',
    tasks: [
      { id: 'task-3-1', title: 'Estruturar servidor backend e roteador de API', status: 'pending' },
      { id: 'task-3-2', title: 'Configurar acesso a banco de dados ou persistência local', status: 'pending' },
      { id: 'task-3-3', title: 'Criar endpoints de saúde (health check) e esquemas de dados', status: 'pending' }
    ],
    acceptanceCriteria: 'Endpoints da API respondem localmente e conexões de persistência estão ativas.',
    validationCommands: 'npm test',
    commits: [],
    notes: ''
  },
  {
    id: 'milestone-4',
    number: 4,
    title: 'API Integration',
    summary: 'Conexão do frontend com o backend e sincronização de dados.',
    status: 'planned',
    tasks: [
      { id: 'task-4-1', title: 'Implementar chamadas de API no frontend usando fetch/axios', status: 'pending' },
      { id: 'task-4-2', title: 'Adicionar gerenciador de estado ou contextos de dados', status: 'pending' },
      { id: 'task-4-3', title: 'Exibir dados dinâmicos do backend na UI com loaders e tratamento de erros', status: 'pending' }
    ],
    acceptanceCriteria: 'A UI renderiza dados dinâmicos buscados do backend e as alterações salvam corretamente.',
    validationCommands: '',
    commits: [],
    notes: ''
  },
  {
    id: 'milestone-5',
    number: 5,
    title: 'Validation and Deploy',
    summary: 'Ajustes finos, auditorias, testes e publicação do projeto.',
    status: 'planned',
    tasks: [
      { id: 'task-5-1', title: 'Executar testes de ponta a ponta e correção de bugs finais', status: 'pending' },
      { id: 'task-5-2', title: 'Rodar auditorias de segurança e linter em toda a base', status: 'pending' },
      { id: 'task-5-3', title: 'Preparar build de produção e scripts de deploy', status: 'pending' }
    ],
    acceptanceCriteria: 'Todos os testes passam em produção e a build final é gerada com sucesso.',
    validationCommands: 'npm run build\nnpm run audit',
    commits: [],
    notes: ''
  }
];

function createMilestoneService(dependencies = {}) {
  const fs = dependencies.fs || defaultFs;
  const path = dependencies.path || defaultPath;

  function ensureFaberDir(rootPath) {
    const faberDir = path.join(rootPath, '.faber');
    if (!fs.existsSync(faberDir)) {
      fs.mkdirSync(faberDir, { recursive: true });
    }
    return faberDir;
  }

  function getMilestonesPath(rootPath) {
    return path.join(ensureFaberDir(rootPath), 'milestones.json');
  }

  function listMilestones(rootPath) {
    const filePath = getMilestonesPath(rootPath);
    if (!fs.existsSync(filePath)) {
      // Create defaults
      saveMilestones(rootPath, DEFAULT_MILESTONES);
      return DEFAULT_MILESTONES;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse milestones JSON', e);
      return DEFAULT_MILESTONES;
    }
  }

  function saveMilestones(rootPath, milestones) {
    const filePath = getMilestonesPath(rootPath);
    fs.writeFileSync(filePath, JSON.stringify(milestones, null, 2), 'utf8');
    return { ok: true, milestones };
  }

  function updateMilestoneStatus(rootPath, milestoneId, status) {
    const milestones = listMilestones(rootPath);
    const m = milestones.find((x) => x.id === milestoneId);
    if (!m) return { ok: false, message: 'Milestone not found' };
    
    m.status = status;
    m.updatedAt = new Date().toISOString();
    if (status === 'active' && !m.startedAt) {
      m.startedAt = new Date().toISOString();
    }
    if (status === 'done' && !m.completedAt) {
      m.completedAt = new Date().toISOString();
    }
    saveMilestones(rootPath, milestones);
    return { ok: true, milestone: m };
  }

  function updateMilestoneTask(rootPath, milestoneId, taskId, taskUpdate) {
    const milestones = listMilestones(rootPath);
    const m = milestones.find((x) => x.id === milestoneId);
    if (!m) return { ok: false, message: 'Milestone not found' };
    
    const t = m.tasks.find((x) => x.id === taskId);
    if (!t) return { ok: false, message: 'Task not found' };
    
    Object.assign(t, taskUpdate);
    m.updatedAt = new Date().toISOString();
    saveMilestones(rootPath, milestones);
    return { ok: true, task: t };
  }

  function linkMilestoneCommit(rootPath, milestoneId, commit) {
    const milestones = listMilestones(rootPath);
    const m = milestones.find((x) => x.id === milestoneId);
    if (!m) return { ok: false, message: 'Milestone not found' };
    
    if (!m.commits) m.commits = [];
    m.commits.push(commit);
    m.updatedAt = new Date().toISOString();
    saveMilestones(rootPath, milestones);
    return { ok: true, milestone: m };
  }

  function renderMilestones(rootPath) {
    try {
      const milestones = listMilestones(rootPath);
      const docsDir = path.join(rootPath, 'docs', 'milestones');
      if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true });
      }

      // Generate README.md
      let readme = '# Plano de Desenvolvimento - Milestones\n\nTimeline do projeto organizada em etapas estruturadas:\n\n';
      milestones.forEach((m) => {
        const fileBasename = `milestone-${String(m.number).padStart(2, '0')}-${m.title.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}.md`;
        let statusEmoji = '⚪';
        if (m.status === 'active') statusEmoji = '🔵';
        if (m.status === 'done') statusEmoji = '🟢';
        if (m.status === 'blocked') statusEmoji = '🔴';
        readme += `### ${statusEmoji} Milestone ${m.number}: [${m.title}](./${fileBasename})\n`;
        readme += `Status: \`${m.status}\`\n\n${m.summary}\n\n`;
      });
      fs.writeFileSync(path.join(docsDir, 'README.md'), readme, 'utf8');

      // Generate separate files
      milestones.forEach((m) => {
        const fileBasename = `milestone-${String(m.number).padStart(2, '0')}-${m.title.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}.md`;
        let content = `# Milestone ${m.number} - ${m.title}\n\n`;
        content += `Status: **${m.status}**\n\n`;
        content += `## Objetivo\n\n${m.summary || ''}\n\n`;
        
        content += `## Tarefas\n\n`;
        if (m.tasks && m.tasks.length) {
          m.tasks.forEach((t) => {
            const checked = t.status === 'done' ? '[x]' : '[ ]';
            content += `- ${checked} **${t.title}**\n`;
            if (t.description) content += `  _${t.description}_\n`;
          });
        } else {
          content += `- Não há tarefas cadastradas.\n`;
        }
        content += `\n`;

        content += `## Critérios de Aceite\n\n${m.acceptanceCriteria || ''}\n\n`;
        
        if (m.validationCommands) {
          content += `## Validação\n\n\`\`\`bash\n${m.validationCommands}\n\`\`\`\n\n`;
        }

        content += `## Commits Relacionados\n\n`;
        if (m.commits && m.commits.length) {
          m.commits.forEach((c) => {
            content += `- \`${c.hash.substring(0, 7)}\` - ${c.message} (${c.createdAt})\n`;
          });
        } else {
          content += `Nenhum commit associado a esta milestone ainda.\n`;
        }

        fs.writeFileSync(path.join(docsDir, fileBasename), content, 'utf8');
      });

      // Save raw JSON copy
      fs.writeFileSync(path.join(docsDir, 'milestones.json'), JSON.stringify(milestones, null, 2), 'utf8');

      return { ok: true, docsPath: docsDir };
    } catch (e) {
      console.error('Failed to render milestones', e);
      return { ok: false, message: e.message || String(e) };
    }
  }

  return {
    listMilestones,
    saveMilestones,
    updateMilestoneStatus,
    updateMilestoneTask,
    linkMilestoneCommit,
    renderMilestones,
  };
}

module.exports = {
  createMilestoneService,
};

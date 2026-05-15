function normalizeGuidanceText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStacks(projectInfo = {}) {
  return (Array.isArray(projectInfo && projectInfo.stacks) ? projectInfo.stacks : [])
    .map((stack) => String(stack || '').trim())
    .filter(Boolean);
}

function hasStack(projectInfo, expectedStack) {
  const expected = normalizeGuidanceText(expectedStack);
  return normalizeStacks(projectInfo).some((stack) => normalizeGuidanceText(stack) === expected);
}

function hasAnyStack(projectInfo, expectedStacks = []) {
  return expectedStacks.some((stack) => hasStack(projectInfo, stack));
}

function buildRunbook(id, title, platform, steps, verification = [], requiredUserInputs = [], envVars = []) {
  return {
    id,
    title,
    platform,
    steps,
    verification,
    requiredUserInputs,
    envVars,
    automation: 'manual_guided',
  };
}

function createPlatformGuidanceService() {
  function shouldSuggestSupabase({ projectInfo = {}, userMessage = '' } = {}) {
    const source = normalizeGuidanceText([
      userMessage,
      normalizeStacks(projectInfo).join(' '),
      (Array.isArray(projectInfo.files) ? projectInfo.files : []).join(' '),
    ].join(' '));
    return /\b(supabase|auth|login|banco|database|postgres|storage|rls)\b/.test(source);
  }

  function buildPlatformRunbooks({ projectInfo = null, userMessage = '' } = {}) {
    const runbooks = [];
    const hasNext = hasStack(projectInfo, 'Next.js');
    const hasLamp = hasStack(projectInfo, 'PHP/LAMP');

    runbooks.push(buildRunbook(
      'github-basic',
      'Publicar base no GitHub',
      'GitHub',
      [
        'Conferir autenticação GitHub CLI pelo fluxo GitHub do Faber Code.',
        'Criar ou escolher um repositório GitHub.',
        'Conferir `git status` e revisar arquivos alterados.',
        'Gerar o plano de publicação para validar nome, visibilidade, branch e remote.',
        'Fazer commit com mensagem objetiva.',
        'Enviar branch para o remoto.',
      ],
      [
        '`gh auth status --hostname github.com` autenticado quando for criar repo novo.',
        '`git status` sem alterações inesperadas.',
        'Commit aparece no repositório remoto.',
      ],
      ['conta GitHub autenticada no gh', 'nome do repositório', 'visibilidade', 'branch alvo']
    ));

    if (hasNext) {
      runbooks.push(buildRunbook(
        'vercel-next',
        'Deploy Next.js na Vercel',
        'Vercel',
        [
          'Importar o repositório GitHub na Vercel.',
          'Confirmar preset de framework como Next.js.',
          'Conferir build command e output defaults da Vercel.',
          'Cadastrar variáveis de ambiente antes do primeiro deploy.',
          'Rodar deploy preview e validar página inicial.',
          'Promover para produção quando o preview estiver aprovado.',
        ],
        [
          'Verificação Faber sem bloqueios obrigatórios antes do preview.',
          '`npm run build` passa localmente ou no build da Vercel.',
          'Preview da Vercel abre sem erro de runtime.',
          'Variáveis públicas usam prefixo `NEXT_PUBLIC_` somente quando podem ir para o cliente.',
        ],
        ['Conta/escopo Vercel', 'repositório GitHub', 'variáveis de ambiente']
      ));
    }

    if (shouldSuggestSupabase({ projectInfo, userMessage })) {
      runbooks.push(buildRunbook(
        'supabase-basic',
        'Configurar Supabase com segurança',
        'Supabase',
        [
          'Criar projeto Supabase e registrar região escolhida.',
          'Copiar URL do projeto e anon key para `.env.local` ou ambiente do servidor.',
          'Criar schema/tabelas por SQL versionado antes de conectar UI.',
          'Ativar RLS nas tabelas expostas ao cliente.',
          'Configurar policies mínimas por papel de usuário.',
          'Cadastrar redirect URLs de Auth quando houver login.',
          'Replicar variáveis no provedor de deploy.',
        ],
        [
          'Nenhuma service role key aparece em código cliente.',
          'RLS ativo nas tabelas acessadas pelo frontend.',
          '`.env.local` não é enviado para Git.',
        ],
        ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'schema SQL', 'redirect URLs'],
        ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
      ));
    }

    if (hasLamp) {
      runbooks.push(buildRunbook(
        'lamp-hosting-basic',
        'Deploy LAMP em hospedagem PHP',
        'LAMP Hosting',
        [
          'Confirmar versão PHP disponível no servidor.',
          'Enviar arquivos por SFTP/SSH ou painel da hospedagem.',
          'Conferir permissões de arquivos e pastas.',
          'Configurar variáveis/arquivos locais fora do diretório público quando houver segredos.',
          'Testar rota principal e formulário em ambiente real.',
          'Revisar logs Apache/PHP depois do primeiro acesso.',
        ],
      [
        'Verificação Faber confirma entrada PHP e sintaxe quando PHP local estiver disponível.',
        '`php -l` sem erro quando PHP local estiver disponível.',
        'Página inicial abre no domínio final.',
        'Logs não mostram fatal error ou warning crítico.',
        ],
        ['host', 'usuário SFTP/SSH', 'versão PHP', 'domínio final']
      ));
    }

    return runbooks;
  }

  function summarizeRunbook(runbook) {
    if (!runbook || !runbook.title) return '';
    const firstStep = Array.isArray(runbook.steps) && runbook.steps.length ? runbook.steps[0] : '';
    return firstStep ? `${runbook.title}: ${firstStep}` : runbook.title;
  }

  function buildProjectNextSteps(projectInfo = null) {
    if (!projectInfo) {
      return [
        'Selecione um projeto para receber recomendações de próximos passos.',
        'Depois da primeira alteração, valide o resultado no terminal com testes/lint/build conforme a stack.',
      ];
    }

    if (hasStack(projectInfo, 'Next.js')) {
      return [
        '1) Rode a verificação do projeto para checar dependências, build, typecheck/lint/test quando existirem.',
        '2) Abra o plano de preview local e valide a página antes de deploy.',
        '3) Instale dependências somente quando a verificação apontar falta de `node_modules` (ex.: `npm install`).',
        '4) Revise `git status` e use o runbook GitHub/Vercel para publicar preview e produção.',
      ];
    }

    if (hasStack(projectInfo, 'PHP/LAMP')) {
      return [
        '1) Rode a verificação do projeto para confirmar entrada PHP e sintaxe quando PHP local estiver disponível.',
        '2) Abra o plano de preview local e valide a página antes de subir para hospedagem.',
        '3) Faça backup rápido do arquivo antes de subir para produção.',
        '4) Use o runbook LAMP para SFTP/SSH, permissões e variáveis.',
        '5) Revise logs do Apache/PHP após deploy para confirmar estabilidade.',
      ];
    }

    if (hasAnyStack(projectInfo, ['React', 'Tailwind CSS'])) {
      return [
        '1) Rode a verificação do projeto para orientar install, build e checks disponíveis.',
        '2) Abra o plano de preview local e revise integração visual, responsividade e estados principais.',
        '3) Confira `git status` e publique via GitHub quando aprovado.',
      ];
    }

    return [
      '1) Rode a verificação do projeto e complemente com validações locais da stack.',
      '2) Gere o plano de preview quando houver entrada web conhecida.',
      '3) Faça commit com mensagem clara e envie para o remoto.',
    ];
  }

  return {
    buildPlatformRunbooks,
    buildProjectNextSteps,
    normalizeGuidanceText,
    shouldSuggestSupabase,
    summarizeRunbook,
  };
}

module.exports = {
  createPlatformGuidanceService,
  normalizeGuidanceText,
};

(function () {
  const SUPPORTED_LOCALES = ['pt-BR', 'en-US', 'es-ES'];

  const COPY = {
    'pt-BR': {
      ui: {
        confirm: 'Confirmar',
        continue: 'Continuar',
        nameQuestion: 'Como devemos chamar você?',
        namePlaceholder: 'Digite seu nome',
        nameRequired: 'Digite seu nome para continuar.',
        namePersonalizeError: 'Não foi possível personalizar o briefing. Tente novamente.',
        nameDocumentsError: 'Não foi possível organizar os documentos técnicos. Tente novamente.',
      },
      api: {
        serviceName: 'API de exemplo do tutorial',
        placeholder: 'Aqui coloque sua chave de API',
        sampleKeyLabel: 'API Key de exemplo',
      },
      documents: {
        welcome: {
          title: 'Briefing: Página de Boas-vindas',
          description: 'Página estática de boas-vindas para apresentar o Faber Code ao usuário.',
          content: '# Olá Mundo\n\n## Seja bem-vindo ao Faber Code\n\nCrie uma página estática de boas-vindas que receba o usuário com uma mensagem clara, acolhedora e objetiva.\n\n### Conteúdo principal\n\n- Exibir o título **Olá Mundo** em destaque.\n- Apresentar uma mensagem de boas-vindas ao usuário.\n- Explicar, em uma frase curta, que o Faber Code transforma ideias em projetos bem estruturados.\n- Incluir uma ação principal para o usuário começar.\n\n### Direção visual\n\n- Aplicar o Design System oficial do Faber Code.\n- Usar a identidade escura da marca, o verde como cor de destaque e alto contraste para leitura.\n- Manter a composição responsiva, simples e acessível em desktop e dispositivos móveis.',
        },
        design: {
          title: 'Design System Faber Code',
          description: 'Cores, tipografias e regras visuais para a página de boas-vindas.',
          content: '# Design System Faber Code\n\n## Cores\n\n- **Verde Faber:** #50C985 para ações, destaques e estados ativos.\n- **Fundo principal:** #050505.\n- **Superfícies:** #121212 e #0D0D0D.\n- **Texto principal:** #E8E4DF.\n- **Texto secundário:** #B3B3B3.\n- **Bordas:** #2B2B2B.\n\n## Tipografia\n\n- Usar **Inter** ou uma fonte sans-serif equivalente na interface.\n- Usar **Fira Code** ou monospace equivalente em trechos técnicos.\n- Priorizar títulos expressivos, hierarquia clara e boa legibilidade.\n\n## Aplicação\n\n- Preservar contraste acessível.\n- Usar o verde com intenção, sem competir com o conteúdo.\n- Manter espaçamento consistente, cantos discretamente arredondados e linguagem visual tecnológica.',
        },
        gap: {
          title: 'SEO e Estados da Interface',
          description: 'Metadados, acessibilidade e estados necessários antes da análise do projeto.',
          content: '# SEO e Estados da Interface\n\n## Metadados\n\n- Definir um título curto e descritivo para a página.\n- Escrever uma descrição de busca coerente com a mensagem de boas-vindas.\n- Configurar imagem, título e descrição para compartilhamento social.\n- Manter idioma, favicon e nome da aplicação consistentes com o Faber Code.\n\n## Estados da interface\n\n- Preservar foco visível e navegação completa por teclado.\n- Respeitar a preferência do sistema por movimento reduzido.\n- Exibir uma alternativa textual caso o logo ou outro recurso visual não carregue.\n- Evitar mudanças bruscas de layout durante o carregamento.\n\n## Validação\n\n- Conferir contraste, hierarquia dos títulos e texto alternativo.\n- Validar os metadados no HTML final antes da publicação.',
        },
        architecture: {
          title: 'Arquitetura Frontend',
          description: 'Stack, estrutura de arquivos e estratégia de entrega.',
          content: '# Arquitetura Frontend\n\n## Stack recomendada\n\n- **Next.js** com App Router.\n- **JavaScript** para componentes e interações.\n- **Tailwind CSS** para acelerar um demonstrativo visual consistente e responsivo.\n- Saída final renderizada em **HTML, CSS e JavaScript** no navegador.\n\n## Estrutura sugerida\n\n- `app/layout.js`: metadados, idioma e estilos globais.\n- `app/page.js`: composição da página de boas-vindas.\n- `app/globals.css`: tokens complementares e ajustes globais.\n- `components/WelcomeHero.js`: saudação principal.\n- `components/SocialLinks.js`: links de GitHub e LinkedIn.\n- `public/faber-code-logo.png`: logo oficial.\n\n## Restrições\n\n- Não adicionar backend ou banco de dados nesta primeira entrega.\n- Manter a página exportável e simples de executar localmente.',
        },
        components: {
          title: 'Componentes da Página',
          description: 'Responsabilidades dos componentes da experiência de boas-vindas.',
          content: '# Componentes da Página\n\n## Estrutura visual\n\n1. **BrandHeader**: logo Faber Code e identificação da marca.\n2. **WelcomeHero**: título “Olá, {{name}}!”, descrição e ação principal.\n3. **SocialLinks**: botões acessíveis para GitHub e LinkedIn.\n4. **Footer**: mensagem curta e identificação do projeto.\n\n## Comportamento\n\n- Receber o nome do usuário como dado de conteúdo, sem deixá-lo fixo dentro do componente.\n- Usar HTML semântico e foco visível.\n- Adaptar tipografia, espaçamento e distribuição para telas menores.\n- Respeitar os tokens documentados no Design System Faber Code.',
        },
        contentLinks: {
          title: 'Conteúdo e Links',
          description: 'Textos finais, personalização e links sociais.',
          content: '# Conteúdo da Página\n\n## Saudação\n\n**Olá, {{name}}!**\n\nSeja bem-vindo ao Faber Code. Este espaço transforma ideias em projetos claros, organizados e prontos para evoluir.\n\n## Ação principal\n\n**Começar agora**\n\n## Links sociais\n\n- GitHub: {{github}}\n- LinkedIn: {{linkedin}}\n\n## Observações\n\n- Manter os placeholders até o fornecimento dos links reais.\n- Abrir links externos em nova aba com atributos seguros.\n- Oferecer nome acessível e estado de foco para cada link.',
        },
        logo: {
          title: 'Logo Faber Code',
          description: 'Logo horizontal oficial para uso na página de boas-vindas.',
        },
        frontendGroup: {
          title: 'Frontend',
          description: 'Briefings e referências visuais da página de boas-vindas.',
        },
        rulesGroup: {
          title: 'Regras',
          description: 'Diretrizes obrigatórias e critérios de aceite do projeto.',
        },
        interfaceRules: {
          title: 'Regras de Interface',
          description: 'Padrões obrigatórios para a implementação visual.',
          content: '# Regras de Interface\n\n- Reutilizar os tokens do Design System Faber Code.\n- Garantir responsividade em desktop e dispositivos móveis.\n- Manter contraste acessível, foco visível e HTML semântico.\n- Não introduzir cores ou tipografias fora da identidade definida.\n- Preservar o logo sem distorção, recorte ou alteração de proporção.',
        },
        acceptance: {
          title: 'Critérios de Aceite',
          description: 'Condições para considerar a página pronta.',
          content: '# Critérios de Aceite\n\n- A página exibe **Olá Mundo** e uma mensagem de boas-vindas.\n- O logo Faber Code aparece com boa legibilidade.\n- A ação principal é clara e utilizável por teclado.\n- O layout usa as cores e tipografias documentadas.\n- Não há rolagem horizontal nem perda de conteúdo em telas menores.',
        },
        personalizedWelcome: {
          title: 'Briefing: Boas-vindas para {{name}}',
          description: 'Página estática de boas-vindas personalizada para {{name}}.',
          content: '# Olá, {{name}}!\n\n## Seja bem-vindo ao Faber Code\n\nCrie uma página estática, acolhedora e responsiva para apresentar o Faber Code a **{{name}}**.\n\n### Conteúdo principal\n\n- Exibir a saudação **Olá, {{name}}!** como título principal.\n- Mostrar uma mensagem curta de boas-vindas.\n- Explicar que o Faber Code transforma ideias em projetos bem estruturados.\n- Incluir uma ação principal para começar.\n\n### Links sociais\n\n- [GitHub]({{github}})\n- [LinkedIn]({{linkedin}})\n\n> Os dois endereços são placeholders e serão substituídos pelos links reais depois.\n\n### Direção visual\n\n- Aplicar o Design System Faber Code.\n- Usar a identidade escura, o verde da marca e contraste acessível.\n- Garantir boa experiência em desktop, tablet e dispositivos móveis.',
        },
      },
      mapChat: {
        conversationTitle: 'Planejamento da página de boas-vindas',
        prompt: 'Revise este mapa antes da análise do projeto. Ainda falta alguma informação importante para implementar e renderizar a página de boas-vindas?',
        reply: 'O mapa está bem estruturado, mas ainda falta documentar SEO, metadados de compartilhamento e os estados essenciais da interface. Inclua título e descrição da página, imagem social, comportamento de foco, preferência por movimento reduzido e alternativas para falhas de carregamento antes de iniciar a análise do projeto.',
        addGap: 'Adicionar documento de SEO ao mapa',
        correction: 'A sugestão foi adicionada ao mapa como “SEO e Estados da Interface”. O mapa agora está pronto para renderização.',
        thinking: 'Pensando...',
      },
      development: {
        prompt: 'Vamos iniciar o desenvolvimento do projeto começando pela milestone 1',
        replies: [
          'Perfeito. Vou começar pela Milestone 1: preparar a fundação da página de boas-vindas em Next.js com JavaScript e Tailwind CSS.',
          'Antes de alterar arquivos, vou consultar os Markdowns Arquitetura Frontend, Briefing de Boas-vindas e Design System Faber Code, além das decisões registradas no mapa.',
          'O plano da Milestone 1 está contextualizado e esta conversa ficou salva no projeto. Vou criar agora a fundação da landing page para revisarmos o primeiro commit.',
        ],
        conversationSaved: 'Conversa de desenvolvimento do tutorial salva no projeto',
        folderUnavailable: 'Não foi possível acessar a pasta do projeto do tutorial.',
        creating: 'Criando {{label}}...',
        createFailed: 'Não foi possível criar os arquivos desta etapa.',
        fileCreationInterrupted: 'A criação de {{file}} foi interrompida: {{reason}}',
        creationInterrupted: 'Criação de arquivos interrompida',
        unknownFailure: 'falha desconhecida',
        stageComplete: 'Etapa concluída',
        filesHeading: 'Arquivos criados:',
        filesCreated: '{{count}} arquivos criados',
        fallbackCommit: 'feat: concluir etapa {{number}}',
      },
      rightTools: [
        { label: 'Arquivos', description: 'abre os arquivos do projeto' },
        { label: 'IA do Mapa', description: 'tira dúvidas e revisa as informações do mapa' },
        { label: 'Git', description: 'acompanha versionamento, commits e publicação' },
        { label: 'Terminal', description: 'executa comandos dentro do projeto' },
        { label: 'Milestones', description: 'organiza o planejamento em etapas executáveis' },
        { label: 'Executar', description: 'inicia o projeto em um servidor local' },
      ],
      steps: {
        mapBuild: {
          title: 'Aula de Criação de Projeto',
          body: 'Documente a página de boas-vindas, o Design System e as regras do projeto diretamente no mapa.',
          hint: 'Comece pelo briefing da página de boas-vindas.',
          checklist: ['Briefing de boas-vindas', 'Zoom reduzido e Markdowns organizados', 'Design System Faber Code', 'Logo oficial inserido', 'Grupo Frontend organizado', 'Grupo Regras documentado', 'Saudação personalizada', 'Arquitetura Next.js e Tailwind', 'Componentes documentados', 'Conteúdo e links sociais', 'Mapa pronto para desenvolvimento'],
          frontendPreview: 'Olá Mundo + Design System',
          rulesPreview: 'Interface + Aceite',
        },
        mapChat: {
          title: 'Assistente do Mapa',
          body: 'Converse com a IA do mapa para validar se os documentos fornecem contexto suficiente para o projeto.',
          hint: 'Primeiro conheça o painel direito; depois abra a IA do Mapa para iniciar uma validação simulada.',
          checklist: ['Painel direito expandido', 'Ferramentas do painel direito exploradas', 'IA do Mapa aberta', 'Pergunta enviada', 'Lacuna identificada pela conversa', 'Informação adicionada ao mapa'],
        },
        mapAnalysis: {
          title: 'Planejamento em Milestones',
          body: 'Transforme o mapa corrigido em um plano completo, salve as etapas, abra a Milestone 1 e inicie o desenvolvimento pelo botão + do projeto.',
          hint: 'Use os controles destacados na interface; a análise do tutorial é local e não utiliza nenhuma API.',
          checklist: ['Histórico do mapa revisado', 'Planejamento de desenvolvimento gerado', 'Plano salvo em Milestones', 'Milestone 1 aberta', 'Chat de desenvolvimento aberto'],
          previewTitle: 'Mapa → Milestones → Desenvolvimento',
          previewBody: 'O planejamento referencia os Markdowns do mapa e fica salvo dentro do projeto.',
        },
        developmentChat: {
          title: 'Início do Desenvolvimento',
          body: 'Inicie a Milestone 1 em uma conversa do projeto. A IA simulada contextualiza o mapa e cria a fundação real da landing page sem consumir créditos.',
          hint: 'A conversa e os arquivos desta demonstração serão persistidos localmente dentro do projeto.',
          checklist: ['Mensagem da Milestone 1 preparada', 'Mensagem enviada', 'Conversa salva no projeto', 'Fundação Next.js criada na pasta do projeto'],
          previewReply: 'Milestone 1 contextualizada com os Markdowns do mapa.',
        },
        git: {
          title: 'Desenvolvimento e commits',
          body: 'Acompanhe a conversa criar a fundação e depois concluir a experiência. Versione a base, volte ao chat, revise as diffs finais e faça o último commit.',
          hint: 'Use somente o controle apontado pelo cursor; cada ação é executada de verdade dentro da pasta do projeto.',
          checklist: ['Fundação da landing page criada', 'Commit da fundação', 'Experiência responsiva criada pelo chat', 'Arquivos finais e diffs revisados', 'Commit final do projeto'],
          preview: 'Os arquivos são criados em dois blocos visíveis no chat e versionados pelo Git real do projeto.',
        },
        finish: {
          pendingTitle: 'Executar a página de boas-vindas',
          successTitle: 'Projeto criado com sucesso',
          pendingBody: 'Com o histórico organizado, execute a aplicação real. O Faber Code prepara as dependências, inicia o servidor local e abre a página no navegador.',
          successBody: 'A página foi aberta no navegador e todos os arquivos e commits do tutorial continuam disponíveis neste projeto.',
          pendingHint: 'A execução usa os arquivos criados no projeto do tutorial.',
          successHint: 'Conclua o tutorial quando terminar de conferir a página. O projeto permanecerá no Faber Code.',
          checklist: ['Dois commits locais concluídos', 'Servidor local iniciado'],
          preview: 'Olá, {{name}}.',
          previewBody: 'A página responsiva será aberta no navegador local.',
        },
      },
      render: {
        conversationTitle: 'Planejamento de desenvolvimento da página de boas-vindas',
        exportStatus: 'Exportando o mapa para a análise local do tutorial...',
        assistantSummary: 'Análise local concluída sem consumir créditos de IA. O mapa contém briefing personalizado, Design System Faber Code, logo, arquitetura Next.js com Tailwind CSS, componentes, conteúdo, links sociais, regras de interface, critérios de aceite e o documento de SEO e estados essenciais. Organizei o desenvolvimento em três milestones objetivas: fundação técnica, experiência completa e validação final. Cada etapa indica tarefas executáveis e os Markdowns que devem ser consultados antes de alterar o projeto.',
        reviewPrompt: 'O planejamento está pronto para revisão. Salve-o em Milestones para transformar esta análise em etapas persistidas no projeto.',
        readyStatus: 'Planejamento completo. Revise as etapas e salve em Milestones.',
        failure: 'Falha ao preparar o planejamento local: {{message}}',
        incomplete: 'Ainda faltam informações para consolidar as milestones.',
        confirmSave: 'Confirma a criação deste plano de milestones no projeto?',
        saving: 'Salvando milestones no projeto...',
        saved: 'Milestones salvas e documentação atualizada.',
        saveFailure: 'Falha ao salvar milestones: {{message}}',
        checks: ['Briefing e conteúdo', 'Arquitetura Next.js e Tailwind', 'Design System e logo', 'SEO, acessibilidade e critérios'],
        milestones: [
          {
            title: 'Preparar a fundação da página de boas-vindas',
            summary: 'Criar a base executável em Next.js com JavaScript e Tailwind CSS.',
            tasks: ['Criar o projeto com App Router e Tailwind CSS.', 'Organizar app, components, public e estilos globais.', 'Validar o escopo do briefing personalizado.', 'Configurar scripts de desenvolvimento, lint e build.'],
            acceptanceCriteria: 'O projeto inicia localmente, compila sem erros e segue a arquitetura definida no mapa.',
            validationCommands: 'npm run lint\nnpm run build',
            notes: 'Consultar Arquitetura Frontend, briefing personalizado e decisões do mapa.',
          },
          {
            title: 'Construir a experiência Faber Code',
            summary: 'Aplicar identidade, conteúdo e componentes responsivos em um único bloco de desenvolvimento.',
            tasks: ['Criar tokens de cor, tipografia e espaçamento.', 'Inserir o logo oficial com alternativa textual.', 'Implementar saudação, apresentação, ação principal e links sociais.', 'Garantir semântica, teclado e adaptação para desktop, tablet e celular.'],
            acceptanceCriteria: 'A página apresenta a identidade Faber Code e todo o conteúdo previsto em qualquer viewport.',
            notes: 'Consultar Design System, Componentes da Página e Conteúdo e Links.',
          },
          {
            title: 'Finalizar SEO, acessibilidade e entrega',
            summary: 'Completar os estados essenciais e validar o demonstrativo antes da execução local.',
            tasks: ['Definir metadados, idioma, favicon e compartilhamento social.', 'Respeitar foco visível e movimento reduzido.', 'Revisar textos, contraste, fallbacks e links.', 'Executar lint e build de produção.'],
            acceptanceCriteria: 'SEO, acessibilidade, build e critérios visuais estão aprovados.',
            validationCommands: 'npm run lint\nnpm run build',
            notes: 'Consultar SEO e Estados da Interface, Regras de Interface e Critérios de Aceite.',
          },
        ],
      },
    },
    'en-US': {
      ui: {
        confirm: 'Confirm',
        continue: 'Continue',
        nameQuestion: 'What should we call you?',
        namePlaceholder: 'Enter your name',
        nameRequired: 'Enter your name to continue.',
        namePersonalizeError: 'The briefing could not be personalized. Please try again.',
        nameDocumentsError: 'The technical documents could not be organized. Please try again.',
      },
      api: {
        serviceName: 'Tutorial sample API',
        placeholder: 'Enter your API key here',
        sampleKeyLabel: 'Sample API key',
      },
      documents: {
        welcome: {
          title: 'Brief: Welcome Page',
          description: 'A static welcome page that introduces Faber Code to the user.',
          content: '# Hello World\n\n## Welcome to Faber Code\n\nCreate a static welcome page that greets the user with a clear, warm, and concise message.\n\n### Main content\n\n- Display **Hello World** as the primary heading.\n- Show a welcome message for the user.\n- Explain in one short sentence that Faber Code turns ideas into well-structured projects.\n- Include a primary action to help the user begin.\n\n### Visual direction\n\n- Apply the official Faber Code Design System.\n- Use the brand dark identity, green as the accent color, and high reading contrast.\n- Keep the composition responsive, simple, and accessible on desktop and mobile devices.',
        },
        design: {
          title: 'Faber Code Design System',
          description: 'Colors, typography, and visual rules for the welcome page.',
          content: '# Faber Code Design System\n\n## Colors\n\n- **Faber Green:** #50C985 for actions, highlights, and active states.\n- **Main background:** #050505.\n- **Surfaces:** #121212 and #0D0D0D.\n- **Primary text:** #E8E4DF.\n- **Secondary text:** #B3B3B3.\n- **Borders:** #2B2B2B.\n\n## Typography\n\n- Use **Inter** or an equivalent sans-serif font in the interface.\n- Use **Fira Code** or an equivalent monospace font for technical excerpts.\n- Prioritize expressive headings, clear hierarchy, and legibility.\n\n## Application\n\n- Preserve accessible contrast.\n- Use green intentionally without competing with the content.\n- Keep spacing consistent, corners subtly rounded, and the visual language technological.',
        },
        gap: {
          title: 'SEO and Interface States',
          description: 'Metadata, accessibility, and states required before project analysis.',
          content: '# SEO and Interface States\n\n## Metadata\n\n- Define a short, descriptive page title.\n- Write a search description consistent with the welcome message.\n- Configure image, title, and description for social sharing.\n- Keep language, favicon, and application name consistent with Faber Code.\n\n## Interface states\n\n- Preserve visible focus and complete keyboard navigation.\n- Respect the system reduced-motion preference.\n- Show a text alternative if the logo or another visual asset fails to load.\n- Avoid abrupt layout shifts while loading.\n\n## Validation\n\n- Check contrast, heading hierarchy, and alternative text.\n- Validate the final HTML metadata before publishing.',
        },
        architecture: {
          title: 'Frontend Architecture',
          description: 'Stack, file structure, and delivery strategy.',
          content: '# Frontend Architecture\n\n## Recommended stack\n\n- **Next.js** with App Router.\n- **JavaScript** for components and interactions.\n- **Tailwind CSS** for a consistent, responsive visual demo.\n- Final output rendered as **HTML, CSS, and JavaScript** in the browser.\n\n## Suggested structure\n\n- `app/layout.js`: metadata, language, and global styles.\n- `app/page.js`: welcome page composition.\n- `app/globals.css`: complementary tokens and global adjustments.\n- `components/WelcomeHero.js`: primary greeting.\n- `components/SocialLinks.js`: GitHub and LinkedIn links.\n- `public/faber-code-logo.png`: official logo.\n\n## Constraints\n\n- Do not add a backend or database in this first delivery.\n- Keep the page exportable and easy to run locally.',
        },
        components: {
          title: 'Page Components',
          description: 'Responsibilities of the welcome experience components.',
          content: '# Page Components\n\n## Visual structure\n\n1. **BrandHeader**: Faber Code logo and brand identification.\n2. **WelcomeHero**: “Hello, {{name}}!” heading, description, and primary action.\n3. **SocialLinks**: accessible GitHub and LinkedIn buttons.\n4. **Footer**: short message and project identification.\n\n## Behavior\n\n- Receive the user name as content data instead of hard-coding it in the component.\n- Use semantic HTML and visible focus.\n- Adapt typography, spacing, and distribution for smaller screens.\n- Follow the tokens documented in the Faber Code Design System.',
        },
        contentLinks: {
          title: 'Content and Links',
          description: 'Final copy, personalization, and social links.',
          content: '# Page Content\n\n## Greeting\n\n**Hello, {{name}}!**\n\nWelcome to Faber Code. This space turns ideas into clear, organized projects that are ready to evolve.\n\n## Primary action\n\n**Start now**\n\n## Social links\n\n- GitHub: {{github}}\n- LinkedIn: {{linkedin}}\n\n## Notes\n\n- Keep the placeholders until the real links are provided.\n- Open external links in a new tab with secure attributes.\n- Provide an accessible name and visible focus state for every link.',
        },
        logo: { title: 'Faber Code Logo', description: 'Official horizontal logo for the welcome page.' },
        frontendGroup: { title: 'Frontend', description: 'Briefs and visual references for the welcome page.' },
        rulesGroup: { title: 'Rules', description: 'Required guidelines and project acceptance criteria.' },
        interfaceRules: {
          title: 'Interface Rules',
          description: 'Required standards for the visual implementation.',
          content: '# Interface Rules\n\n- Reuse the Faber Code Design System tokens.\n- Ensure responsive behavior on desktop and mobile devices.\n- Preserve accessible contrast, visible focus, and semantic HTML.\n- Do not introduce colors or typefaces outside the defined identity.\n- Preserve the logo without distortion, cropping, or proportion changes.',
        },
        acceptance: {
          title: 'Acceptance Criteria',
          description: 'Conditions required for the page to be considered complete.',
          content: '# Acceptance Criteria\n\n- The page displays **Hello World** and a welcome message.\n- The Faber Code logo is clearly legible.\n- The primary action is clear and keyboard accessible.\n- The layout uses the documented colors and typography.\n- Smaller screens have no horizontal scrolling or missing content.',
        },
        personalizedWelcome: {
          title: 'Brief: Welcome {{name}}',
          description: 'A personalized static welcome page for {{name}}.',
          content: '# Hello, {{name}}!\n\n## Welcome to Faber Code\n\nCreate a warm, responsive static page that introduces Faber Code to **{{name}}**.\n\n### Main content\n\n- Display **Hello, {{name}}!** as the primary heading.\n- Show a short welcome message.\n- Explain that Faber Code turns ideas into well-structured projects.\n- Include a primary action to begin.\n\n### Social links\n\n- [GitHub]({{github}})\n- [LinkedIn]({{linkedin}})\n\n> Both addresses are placeholders and will be replaced by the real links later.\n\n### Visual direction\n\n- Apply the Faber Code Design System.\n- Use the dark identity, brand green, and accessible contrast.\n- Ensure a good experience on desktop, tablet, and mobile devices.',
        },
      },
      mapChat: {
        conversationTitle: 'Welcome page planning',
        prompt: 'Review this map before project analysis. Is any important information still missing to implement and render the welcome page?',
        reply: 'The map is well structured, but SEO, sharing metadata, and essential interface states are still missing. Add the page title and description, social image, focus behavior, reduced-motion preference, and fallbacks for loading failures before starting project analysis.',
        addGap: 'Add SEO document to the map',
        correction: 'The suggestion was added to the map as “SEO and Interface States”. The map is now ready to render.',
        thinking: 'Thinking...',
      },
      development: {
        prompt: 'Let’s start project development with milestone 1',
        replies: [
          'Perfect. I will start with Milestone 1: prepare the welcome page foundation in Next.js with JavaScript and Tailwind CSS.',
          'Before editing files, I will review the Frontend Architecture, Welcome Brief, and Faber Code Design System Markdown documents, along with the decisions recorded on the map.',
          'The Milestone 1 plan is contextualized and this conversation was saved in the project. I will now create the landing page foundation for our first commit review.',
        ],
        conversationSaved: 'Tutorial development conversation saved in the project',
        folderUnavailable: 'The tutorial project folder could not be accessed.',
        creating: 'Creating {{label}}...',
        createFailed: 'The files for this stage could not be created.',
        fileCreationInterrupted: 'Creating {{file}} was interrupted: {{reason}}',
        creationInterrupted: 'File creation interrupted',
        unknownFailure: 'unknown failure',
        stageComplete: 'Stage complete',
        filesHeading: 'Files created:',
        filesCreated: '{{count}} files created',
        fallbackCommit: 'feat: complete stage {{number}}',
      },
      rightTools: [
        { label: 'Files', description: 'opens the project files' },
        { label: 'Map AI', description: 'answers questions and reviews map information' },
        { label: 'Git', description: 'tracks versions, commits, and publishing' },
        { label: 'Terminal', description: 'runs commands inside the project' },
        { label: 'Milestones', description: 'organizes the plan into executable stages' },
        { label: 'Run', description: 'starts the project on a local server' },
      ],
      steps: {
        mapBuild: {
          title: 'Project Creation Lesson',
          body: 'Document the welcome page, Design System, and project rules directly on the map.',
          hint: 'Start with the welcome page brief.',
          checklist: ['Welcome brief', 'Zoom reduced and Markdown documents organized', 'Faber Code Design System', 'Official logo added', 'Frontend group organized', 'Rules group documented', 'Personalized greeting', 'Next.js and Tailwind architecture', 'Components documented', 'Content and social links', 'Map ready for development'],
          frontendPreview: 'Hello World + Design System',
          rulesPreview: 'Interface + Acceptance',
        },
        mapChat: {
          title: 'Map Assistant',
          body: 'Talk to the map AI to validate whether the documents provide enough context for the project.',
          hint: 'First explore the right panel, then open Map AI to begin a simulated validation.',
          checklist: ['Right panel expanded', 'Right-panel tools explored', 'Map AI open', 'Question sent', 'Missing information identified', 'Information added to the map'],
        },
        mapAnalysis: {
          title: 'Milestone Planning',
          body: 'Turn the corrected map into a complete plan, save the stages, open Milestone 1, and start development from the project + button.',
          hint: 'Use the highlighted controls; the tutorial analysis is local and does not use an API.',
          checklist: ['Map history reviewed', 'Development plan generated', 'Plan saved to Milestones', 'Milestone 1 opened', 'Development chat opened'],
          previewTitle: 'Map → Milestones → Development',
          previewBody: 'The plan references the map Markdown documents and is saved inside the project.',
        },
        developmentChat: {
          title: 'Start Development',
          body: 'Start Milestone 1 in a project conversation. The simulated AI uses the map context and creates the real landing page foundation without consuming credits.',
          hint: 'This demonstration conversation and its files are persisted locally inside the project.',
          checklist: ['Milestone 1 message prepared', 'Message sent', 'Conversation saved in the project', 'Next.js foundation created in the project folder'],
          previewReply: 'Milestone 1 contextualized with the map Markdown documents.',
        },
        git: {
          title: 'Development and commits',
          body: 'Watch the conversation create the foundation and then complete the experience. Version the base, return to chat, review the final diffs, and make the last commit.',
          hint: 'Use only the control indicated by the cursor; each action runs for real inside the project folder.',
          checklist: ['Landing page foundation created', 'Foundation commit', 'Responsive experience created from chat', 'Final files and diffs reviewed', 'Final project commit'],
          preview: 'Files are created in two visible chat batches and versioned with the project’s real Git repository.',
        },
        finish: {
          pendingTitle: 'Run the welcome page',
          successTitle: 'Project created successfully',
          pendingBody: 'With the history organized, run the real application. Faber Code prepares dependencies, starts the local server, and opens the page in the browser.',
          successBody: 'The page opened in the browser, and all tutorial files and commits remain available in this project.',
          pendingHint: 'The run uses the files created in the tutorial project.',
          successHint: 'Finish the tutorial after checking the page. The project will remain in Faber Code.',
          checklist: ['Two local commits completed', 'Local server started'],
          preview: 'Hello, {{name}}.',
          previewBody: 'The responsive page will open in the local browser.',
        },
      },
      render: {
        conversationTitle: 'Welcome page development plan',
        exportStatus: 'Exporting the map for the tutorial’s local analysis...',
        assistantSummary: 'Local analysis completed without consuming AI credits. The map includes a personalized brief, the Faber Code Design System, logo, Next.js and Tailwind CSS architecture, components, content, social links, interface rules, acceptance criteria, and the SEO and essential states document. I organized development into three focused milestones: technical foundation, complete experience, and final validation. Each stage lists executable tasks and the Markdown documents to review before editing the project.',
        reviewPrompt: 'The plan is ready for review. Save it to Milestones to turn this analysis into persistent project stages.',
        readyStatus: 'Plan complete. Review the stages and save them to Milestones.',
        failure: 'Could not prepare the local plan: {{message}}',
        incomplete: 'More information is required before the milestones can be consolidated.',
        confirmSave: 'Create this milestone plan in the project?',
        saving: 'Saving milestones to the project...',
        saved: 'Milestones saved and documentation updated.',
        saveFailure: 'Could not save milestones: {{message}}',
        checks: ['Brief and content', 'Next.js and Tailwind architecture', 'Design System and logo', 'SEO, accessibility, and criteria'],
        milestones: [
          {
            title: 'Prepare the welcome page foundation',
            summary: 'Create the executable Next.js foundation with JavaScript and Tailwind CSS.',
            tasks: ['Create the project with App Router and Tailwind CSS.', 'Organize app, components, public, and global styles.', 'Validate the personalized brief scope.', 'Configure development, lint, and build scripts.'],
            acceptanceCriteria: 'The project starts locally, builds without errors, and follows the architecture defined on the map.',
            validationCommands: 'npm run lint\nnpm run build',
            notes: 'Review Frontend Architecture, the personalized brief, and map decisions.',
          },
          {
            title: 'Build the Faber Code experience',
            summary: 'Apply identity, content, and responsive components in one development block.',
            tasks: ['Create color, typography, and spacing tokens.', 'Add the official logo with a text fallback.', 'Implement the greeting, product introduction, primary action, and social links.', 'Ensure semantics, keyboard use, and desktop, tablet, and mobile layouts.'],
            acceptanceCriteria: 'The page presents the Faber Code identity and all planned content at every viewport.',
            notes: 'Review Design System, Page Components, and Content and Links.',
          },
          {
            title: 'Complete SEO, accessibility, and delivery',
            summary: 'Finish essential states and validate the demo before local execution.',
            tasks: ['Define metadata, language, favicon, and social sharing.', 'Respect visible focus and reduced motion.', 'Review copy, contrast, fallbacks, and links.', 'Run lint and the production build.'],
            acceptanceCriteria: 'SEO, accessibility, build, and visual criteria are approved.',
            validationCommands: 'npm run lint\nnpm run build',
            notes: 'Review SEO and Interface States, Interface Rules, and Acceptance Criteria.',
          },
        ],
      },
    },
    'es-ES': {
      ui: {
        confirm: 'Confirmar',
        continue: 'Continuar',
        nameQuestion: '¿Cómo debemos llamarte?',
        namePlaceholder: 'Escribe tu nombre',
        nameRequired: 'Escribe tu nombre para continuar.',
        namePersonalizeError: 'No se pudo personalizar el briefing. Inténtalo de nuevo.',
        nameDocumentsError: 'No se pudieron organizar los documentos técnicos. Inténtalo de nuevo.',
      },
      api: {
        serviceName: 'API de ejemplo del tutorial',
        placeholder: 'Escribe aquí tu clave de API',
        sampleKeyLabel: 'Clave de API de ejemplo',
      },
      documents: {
        welcome: {
          title: 'Briefing: Página de bienvenida',
          description: 'Página estática de bienvenida para presentar Faber Code al usuario.',
          content: '# Hola Mundo\n\n## Bienvenido a Faber Code\n\nCrea una página estática de bienvenida que reciba al usuario con un mensaje claro, acogedor y conciso.\n\n### Contenido principal\n\n- Mostrar el título **Hola Mundo** de forma destacada.\n- Presentar un mensaje de bienvenida al usuario.\n- Explicar en una frase breve que Faber Code transforma ideas en proyectos bien estructurados.\n- Incluir una acción principal para que el usuario comience.\n\n### Dirección visual\n\n- Aplicar el Design System oficial de Faber Code.\n- Usar la identidad oscura de la marca, el verde como color de énfasis y alto contraste de lectura.\n- Mantener una composición adaptable, simple y accesible en escritorio y dispositivos móviles.',
        },
        design: {
          title: 'Design System Faber Code',
          description: 'Colores, tipografías y reglas visuales para la página de bienvenida.',
          content: '# Design System Faber Code\n\n## Colores\n\n- **Verde Faber:** #50C985 para acciones, destacados y estados activos.\n- **Fondo principal:** #050505.\n- **Superficies:** #121212 y #0D0D0D.\n- **Texto principal:** #E8E4DF.\n- **Texto secundario:** #B3B3B3.\n- **Bordes:** #2B2B2B.\n\n## Tipografía\n\n- Usar **Inter** o una fuente sans-serif equivalente en la interfaz.\n- Usar **Fira Code** o una fuente monoespaciada equivalente en fragmentos técnicos.\n- Priorizar títulos expresivos, jerarquía clara y buena legibilidad.\n\n## Aplicación\n\n- Mantener un contraste accesible.\n- Usar el verde con intención, sin competir con el contenido.\n- Mantener espaciado coherente, esquinas discretamente redondeadas y un lenguaje visual tecnológico.',
        },
        gap: {
          title: 'SEO y Estados de la Interfaz',
          description: 'Metadatos, accesibilidad y estados necesarios antes del análisis del proyecto.',
          content: '# SEO y Estados de la Interfaz\n\n## Metadatos\n\n- Definir un título corto y descriptivo para la página.\n- Escribir una descripción de búsqueda coherente con el mensaje de bienvenida.\n- Configurar imagen, título y descripción para compartir en redes.\n- Mantener idioma, favicon y nombre de la aplicación coherentes con Faber Code.\n\n## Estados de la interfaz\n\n- Mantener el foco visible y la navegación completa por teclado.\n- Respetar la preferencia del sistema por movimiento reducido.\n- Mostrar una alternativa textual si el logo u otro recurso visual no se carga.\n- Evitar cambios bruscos de diseño durante la carga.\n\n## Validación\n\n- Revisar contraste, jerarquía de títulos y texto alternativo.\n- Validar los metadatos del HTML final antes de publicar.',
        },
        architecture: {
          title: 'Arquitectura Frontend',
          description: 'Stack, estructura de archivos y estrategia de entrega.',
          content: '# Arquitectura Frontend\n\n## Stack recomendado\n\n- **Next.js** con App Router.\n- **JavaScript** para componentes e interacciones.\n- **Tailwind CSS** para acelerar una demostración visual coherente y adaptable.\n- Salida final renderizada en **HTML, CSS y JavaScript** en el navegador.\n\n## Estructura sugerida\n\n- `app/layout.js`: metadatos, idioma y estilos globales.\n- `app/page.js`: composición de la página de bienvenida.\n- `app/globals.css`: tokens complementarios y ajustes globales.\n- `components/WelcomeHero.js`: saludo principal.\n- `components/SocialLinks.js`: enlaces de GitHub y LinkedIn.\n- `public/faber-code-logo.png`: logo oficial.\n\n## Restricciones\n\n- No añadir backend ni base de datos en esta primera entrega.\n- Mantener la página exportable y fácil de ejecutar localmente.',
        },
        components: {
          title: 'Componentes de la Página',
          description: 'Responsabilidades de los componentes de la experiencia de bienvenida.',
          content: '# Componentes de la Página\n\n## Estructura visual\n\n1. **BrandHeader**: logo Faber Code e identificación de la marca.\n2. **WelcomeHero**: título “¡Hola, {{name}}!”, descripción y acción principal.\n3. **SocialLinks**: botones accesibles para GitHub y LinkedIn.\n4. **Footer**: mensaje breve e identificación del proyecto.\n\n## Comportamiento\n\n- Recibir el nombre del usuario como dato de contenido, sin fijarlo dentro del componente.\n- Usar HTML semántico y foco visible.\n- Adaptar tipografía, espaciado y distribución a pantallas pequeñas.\n- Respetar los tokens documentados en el Design System Faber Code.',
        },
        contentLinks: {
          title: 'Contenido y Enlaces',
          description: 'Textos finales, personalización y enlaces sociales.',
          content: '# Contenido de la Página\n\n## Saludo\n\n**¡Hola, {{name}}!**\n\nBienvenido a Faber Code. Este espacio transforma ideas en proyectos claros, organizados y listos para evolucionar.\n\n## Acción principal\n\n**Comenzar ahora**\n\n## Enlaces sociales\n\n- GitHub: {{github}}\n- LinkedIn: {{linkedin}}\n\n## Observaciones\n\n- Mantener los placeholders hasta recibir los enlaces reales.\n- Abrir enlaces externos en una pestaña nueva con atributos seguros.\n- Ofrecer un nombre accesible y un estado de foco visible para cada enlace.',
        },
        logo: { title: 'Logo Faber Code', description: 'Logo horizontal oficial para la página de bienvenida.' },
        frontendGroup: { title: 'Frontend', description: 'Briefings y referencias visuales de la página de bienvenida.' },
        rulesGroup: { title: 'Reglas', description: 'Directrices obligatorias y criterios de aceptación del proyecto.' },
        interfaceRules: {
          title: 'Reglas de Interfaz',
          description: 'Estándares obligatorios para la implementación visual.',
          content: '# Reglas de Interfaz\n\n- Reutilizar los tokens del Design System Faber Code.\n- Garantizar adaptabilidad en escritorio y dispositivos móviles.\n- Mantener contraste accesible, foco visible y HTML semántico.\n- No introducir colores ni tipografías fuera de la identidad definida.\n- Preservar el logo sin distorsión, recorte ni cambios de proporción.',
        },
        acceptance: {
          title: 'Criterios de Aceptación',
          description: 'Condiciones para considerar terminada la página.',
          content: '# Criterios de Aceptación\n\n- La página muestra **Hola Mundo** y un mensaje de bienvenida.\n- El logo Faber Code se ve con buena legibilidad.\n- La acción principal es clara y utilizable con teclado.\n- El diseño usa los colores y tipografías documentados.\n- No hay desplazamiento horizontal ni pérdida de contenido en pantallas pequeñas.',
        },
        personalizedWelcome: {
          title: 'Briefing: Bienvenida para {{name}}',
          description: 'Página estática de bienvenida personalizada para {{name}}.',
          content: '# ¡Hola, {{name}}!\n\n## Bienvenido a Faber Code\n\nCrea una página estática, acogedora y adaptable para presentar Faber Code a **{{name}}**.\n\n### Contenido principal\n\n- Mostrar **¡Hola, {{name}}!** como título principal.\n- Presentar un mensaje breve de bienvenida.\n- Explicar que Faber Code transforma ideas en proyectos bien estructurados.\n- Incluir una acción principal para comenzar.\n\n### Enlaces sociales\n\n- [GitHub]({{github}})\n- [LinkedIn]({{linkedin}})\n\n> Ambas direcciones son placeholders y se sustituirán por los enlaces reales más adelante.\n\n### Dirección visual\n\n- Aplicar el Design System Faber Code.\n- Usar la identidad oscura, el verde de la marca y contraste accesible.\n- Garantizar una buena experiencia en escritorio, tableta y dispositivos móviles.',
        },
      },
      mapChat: {
        conversationTitle: 'Planificación de la página de bienvenida',
        prompt: 'Revisa este mapa antes del análisis del proyecto. ¿Falta alguna información importante para implementar y renderizar la página de bienvenida?',
        reply: 'El mapa está bien estructurado, pero aún falta documentar SEO, metadatos para compartir y los estados esenciales de la interfaz. Incluye el título y la descripción de la página, imagen social, comportamiento del foco, preferencia por movimiento reducido y alternativas para fallos de carga antes de iniciar el análisis del proyecto.',
        addGap: 'Añadir documento de SEO al mapa',
        correction: 'La sugerencia se añadió al mapa como “SEO y Estados de la Interfaz”. El mapa ya está listo para renderizar.',
        thinking: 'Pensando...',
      },
      development: {
        prompt: 'Vamos a iniciar el desarrollo del proyecto con la milestone 1',
        replies: [
          'Perfecto. Comenzaré con la Milestone 1: preparar la base de la página de bienvenida en Next.js con JavaScript y Tailwind CSS.',
          'Antes de modificar archivos, revisaré los documentos Markdown Arquitectura Frontend, Briefing de bienvenida y Design System Faber Code, además de las decisiones registradas en el mapa.',
          'El plan de la Milestone 1 ya tiene contexto y esta conversación quedó guardada en el proyecto. Ahora crearé la base de la landing page para revisar el primer commit.',
        ],
        conversationSaved: 'Conversación de desarrollo del tutorial guardada en el proyecto',
        folderUnavailable: 'No se pudo acceder a la carpeta del proyecto del tutorial.',
        creating: 'Creando {{label}}...',
        createFailed: 'No se pudieron crear los archivos de esta etapa.',
        fileCreationInterrupted: 'La creación de {{file}} se interrumpió: {{reason}}',
        creationInterrupted: 'Creación de archivos interrumpida',
        unknownFailure: 'fallo desconocido',
        stageComplete: 'Etapa completada',
        filesHeading: 'Archivos creados:',
        filesCreated: '{{count}} archivos creados',
        fallbackCommit: 'feat: completar etapa {{number}}',
      },
      rightTools: [
        { label: 'Archivos', description: 'abre los archivos del proyecto' },
        { label: 'IA del Mapa', description: 'responde dudas y revisa la información del mapa' },
        { label: 'Git', description: 'acompaña versiones, commits y publicación' },
        { label: 'Terminal', description: 'ejecuta comandos dentro del proyecto' },
        { label: 'Milestones', description: 'organiza el plan en etapas ejecutables' },
        { label: 'Ejecutar', description: 'inicia el proyecto en un servidor local' },
      ],
      steps: {
        mapBuild: {
          title: 'Lección de Creación de Proyecto',
          body: 'Documenta la página de bienvenida, el Design System y las reglas del proyecto directamente en el mapa.',
          hint: 'Comienza por el briefing de la página de bienvenida.',
          checklist: ['Briefing de bienvenida', 'Zoom reducido y documentos Markdown organizados', 'Design System Faber Code', 'Logo oficial añadido', 'Grupo Frontend organizado', 'Grupo Reglas documentado', 'Saludo personalizado', 'Arquitectura Next.js y Tailwind', 'Componentes documentados', 'Contenido y enlaces sociales', 'Mapa listo para el desarrollo'],
          frontendPreview: 'Hola Mundo + Design System',
          rulesPreview: 'Interfaz + Aceptación',
        },
        mapChat: {
          title: 'Asistente del Mapa',
          body: 'Conversa con la IA del mapa para validar si los documentos ofrecen suficiente contexto para el proyecto.',
          hint: 'Primero conoce el panel derecho; después abre la IA del Mapa para iniciar una validación simulada.',
          checklist: ['Panel derecho expandido', 'Herramientas del panel derecho exploradas', 'IA del Mapa abierta', 'Pregunta enviada', 'Información faltante identificada', 'Información añadida al mapa'],
        },
        mapAnalysis: {
          title: 'Planificación en Milestones',
          body: 'Convierte el mapa corregido en un plan completo, guarda las etapas, abre la Milestone 1 e inicia el desarrollo desde el botón + del proyecto.',
          hint: 'Usa los controles destacados; el análisis del tutorial es local y no utiliza ninguna API.',
          checklist: ['Historial del mapa revisado', 'Plan de desarrollo generado', 'Plan guardado en Milestones', 'Milestone 1 abierta', 'Chat de desarrollo abierto'],
          previewTitle: 'Mapa → Milestones → Desarrollo',
          previewBody: 'El plan referencia los documentos Markdown del mapa y queda guardado dentro del proyecto.',
        },
        developmentChat: {
          title: 'Inicio del Desarrollo',
          body: 'Inicia la Milestone 1 en una conversación del proyecto. La IA simulada utiliza el contexto del mapa y crea la base real de la landing page sin consumir créditos.',
          hint: 'La conversación y los archivos de esta demostración se guardarán localmente dentro del proyecto.',
          checklist: ['Mensaje de la Milestone 1 preparado', 'Mensaje enviado', 'Conversación guardada en el proyecto', 'Base Next.js creada en la carpeta del proyecto'],
          previewReply: 'Milestone 1 contextualizada con los documentos Markdown del mapa.',
        },
        git: {
          title: 'Desarrollo y commits',
          body: 'Acompaña cómo la conversación crea la base y después completa la experiencia. Versiona la base, vuelve al chat, revisa los diffs finales y realiza el último commit.',
          hint: 'Usa solo el control señalado por el cursor; cada acción se ejecuta realmente dentro de la carpeta del proyecto.',
          checklist: ['Base de la landing page creada', 'Commit de la base', 'Experiencia adaptable creada desde el chat', 'Archivos finales y diffs revisados', 'Commit final del proyecto'],
          preview: 'Los archivos se crean en dos bloques visibles en el chat y se versionan con el repositorio Git real del proyecto.',
        },
        finish: {
          pendingTitle: 'Ejecutar la página de bienvenida',
          successTitle: 'Proyecto creado con éxito',
          pendingBody: 'Con el historial organizado, ejecuta la aplicación real. Faber Code prepara las dependencias, inicia el servidor local y abre la página en el navegador.',
          successBody: 'La página se abrió en el navegador y todos los archivos y commits del tutorial siguen disponibles en este proyecto.',
          pendingHint: 'La ejecución utiliza los archivos creados en el proyecto del tutorial.',
          successHint: 'Finaliza el tutorial después de revisar la página. El proyecto permanecerá en Faber Code.',
          checklist: ['Dos commits locales completados', 'Servidor local iniciado'],
          preview: 'Hola, {{name}}.',
          previewBody: 'La página adaptable se abrirá en el navegador local.',
        },
      },
      render: {
        conversationTitle: 'Plan de desarrollo de la página de bienvenida',
        exportStatus: 'Exportando el mapa para el análisis local del tutorial...',
        assistantSummary: 'Análisis local completado sin consumir créditos de IA. El mapa contiene un briefing personalizado, el Design System Faber Code, logo, arquitectura Next.js con Tailwind CSS, componentes, contenido, enlaces sociales, reglas de interfaz, criterios de aceptación y el documento de SEO y estados esenciales. Organicé el desarrollo en tres milestones concretas: base técnica, experiencia completa y validación final. Cada etapa indica tareas ejecutables y los documentos Markdown que deben revisarse antes de modificar el proyecto.',
        reviewPrompt: 'El plan está listo para revisión. Guárdalo en Milestones para transformar este análisis en etapas persistentes del proyecto.',
        readyStatus: 'Plan completo. Revisa las etapas y guárdalas en Milestones.',
        failure: 'No se pudo preparar el plan local: {{message}}',
        incomplete: 'Todavía falta información para consolidar las milestones.',
        confirmSave: '¿Confirmas la creación de este plan de milestones en el proyecto?',
        saving: 'Guardando milestones en el proyecto...',
        saved: 'Milestones guardadas y documentación actualizada.',
        saveFailure: 'No se pudieron guardar las milestones: {{message}}',
        checks: ['Briefing y contenido', 'Arquitectura Next.js y Tailwind', 'Design System y logo', 'SEO, accesibilidad y criterios'],
        milestones: [
          {
            title: 'Preparar la base de la página de bienvenida',
            summary: 'Crear la base ejecutable en Next.js con JavaScript y Tailwind CSS.',
            tasks: ['Crear el proyecto con App Router y Tailwind CSS.', 'Organizar app, components, public y estilos globales.', 'Validar el alcance del briefing personalizado.', 'Configurar scripts de desarrollo, lint y build.'],
            acceptanceCriteria: 'El proyecto se inicia localmente, compila sin errores y sigue la arquitectura definida en el mapa.',
            validationCommands: 'npm run lint\nnpm run build',
            notes: 'Revisar Arquitectura Frontend, el briefing personalizado y las decisiones del mapa.',
          },
          {
            title: 'Construir la experiencia Faber Code',
            summary: 'Aplicar identidad, contenido y componentes adaptables en un único bloque de desarrollo.',
            tasks: ['Crear tokens de color, tipografía y espaciado.', 'Añadir el logo oficial con alternativa textual.', 'Implementar saludo, presentación, acción principal y enlaces sociales.', 'Garantizar semántica, teclado y adaptación para ordenador, tableta y móvil.'],
            acceptanceCriteria: 'La página presenta la identidad Faber Code y todo el contenido previsto en cualquier viewport.',
            notes: 'Revisar Design System, Componentes de la Página y Contenido y Enlaces.',
          },
          {
            title: 'Finalizar SEO, accesibilidad y entrega',
            summary: 'Completar los estados esenciales y validar la demostración antes de la ejecución local.',
            tasks: ['Definir metadatos, idioma, favicon y contenido para compartir.', 'Respetar el foco visible y el movimiento reducido.', 'Revisar textos, contraste, alternativas y enlaces.', 'Ejecutar lint y el build de producción.'],
            acceptanceCriteria: 'SEO, accesibilidad, build y criterios visuales están aprobados.',
            validationCommands: 'npm run lint\nnpm run build',
            notes: 'Revisar SEO y Estados de la Interfaz, Reglas de Interfaz y Criterios de Aceptación.',
          },
        ],
      },
    },
  };

  const PHRASES = {
    'Clique no ícone de lápis para editar': ['Click the pencil icon to edit', 'Haz clic en el icono del lápiz para editar'],
    'Ferramenta do mapa': ['Map tool', 'Herramienta del mapa'],
    'Mapa da aplicação': ['Application map', 'Mapa de la aplicación'],
    'Serviço': ['Service', 'Servicio'],
    'Aqui coloque sua chave de API': ['Enter your API key here', 'Escribe aquí tu clave de API'],
    'API Key de exemplo': ['Sample API key', 'Clave de API de ejemplo'],
    'Agora clique em Salvar edição para mostrar como esse cadastro seria confirmado.': ['Now click Save changes to see how this setup would be confirmed.', 'Ahora haz clic en Guardar cambios para ver cómo se confirmaría esta configuración.'],
    'Agora clique em Adicionar API para abrir um cadastro novo de exemplo.': ['Now click Add API to open a new sample setup.', 'Ahora haz clic en Añadir API para abrir una nueva configuración de ejemplo.'],
    'Clique nesse seletor e escolha qualquer serviço. O tutorial vai usar exatamente essa escolha como exemplo, sem editar a API que já está ativa.': ['Click this selector and choose any service. The tutorial will use that exact choice as its example without editing the currently active API.', 'Haz clic en este selector y elige cualquier servicio. El tutorial usará exactamente esa opción como ejemplo sin modificar la API que ya está activa.'],
    'Expanda o painel esquerdo para acessar o projeto criado.': ['Expand the left panel to access the created project.', 'Expande el panel izquierdo para acceder al proyecto creado.'],
    'Clique para recolher painel esquerdo': ['Click to collapse the left panel', 'Haz clic para contraer el panel izquierdo'],
    'Clique para recolher painel direito': ['Click to collapse the right panel', 'Haz clic para contraer el panel derecho'],
    'Clique em Novo Markdown para criar o briefing da página de boas-vindas.': ['Click New Markdown to create the welcome page brief.', 'Haz clic en Nuevo Markdown para crear el briefing de la página de bienvenida.'],
    'Criar briefing de boas-vindas': ['Create welcome brief', 'Crear briefing de bienvenida'],
    'Clique no lápis do Markdown criado para abrir os detalhes do item.': ['Click the pencil on the new Markdown item to open its details.', 'Haz clic en el lápiz del nuevo elemento Markdown para abrir sus detalles.'],
    'Editar briefing': ['Edit brief', 'Editar briefing'],
    'Clique no campo Título. O tutorial escreverá o título do briefing.': ['Click the Title field. The tutorial will write the brief title.', 'Haz clic en el campo Título. El tutorial escribirá el título del briefing.'],
    'Preencher título': ['Fill in title', 'Completar título'],
    'Clique em Descrição para registrar o objetivo da página estática.': ['Click Description to record the goal of the static page.', 'Haz clic en Descripción para registrar el objetivo de la página estática.'],
    'Preencher descrição': ['Fill in description', 'Completar descripción'],
    'Clique no editor Markdown para inserir o briefing completo com “Olá Mundo”, boas-vindas e direção visual.': ['Click the Markdown editor to add the full brief with “Hello World,” a welcome message, and visual direction.', 'Haz clic en el editor Markdown para añadir el briefing completo con “Hola Mundo”, bienvenida y dirección visual.'],
    'Escrever briefing': ['Write brief', 'Escribir briefing'],
    'O primeiro briefing está pronto. Clique no X para voltar ao mapa.': ['The first brief is ready. Click X to return to the map.', 'El primer briefing está listo. Haz clic en la X para volver al mapa.'],
    'Fechar detalhes': ['Close details', 'Cerrar detalles'],
    'Crie outro Markdown para documentar o Design System do Faber Code.': ['Create another Markdown document for the Faber Code Design System.', 'Crea otro documento Markdown para el Design System de Faber Code.'],
    'Criar Design System': ['Create Design System', 'Crear Design System'],
    'Recolha o painel direito para ganhar espaço e organizar os dois Markdowns no mapa.': ['Collapse the right panel to gain space and arrange both Markdown items on the map.', 'Contrae el panel derecho para ganar espacio y organizar ambos elementos Markdown en el mapa.'],
    'Os Markdowns estão organizados lado a lado. Clique no lápis do novo item para documentar cores e tipografias.': ['The Markdown items are arranged side by side. Click the pencil on the new item to document colors and typography.', 'Los elementos Markdown están organizados lado a lado. Haz clic en el lápiz del nuevo elemento para documentar colores y tipografías.'],
    'Editar Design System': ['Edit Design System', 'Editar Design System'],
    'Clique no Título para identificar este documento como Design System Faber Code.': ['Click Title to identify this document as the Faber Code Design System.', 'Haz clic en Título para identificar este documento como Design System Faber Code.'],
    'Clique em Descrição para resumir o propósito deste documento.': ['Click Description to summarize this document’s purpose.', 'Haz clic en Descripción para resumir el propósito de este documento.'],
    'Clique no editor para inserir as cores, tipografias e regras visuais da marca.': ['Click the editor to add the brand colors, typography, and visual rules.', 'Haz clic en el editor para añadir los colores, tipografías y reglas visuales de la marca.'],
    'Escrever Design System': ['Write Design System', 'Escribir Design System'],
    'O Design System está documentado. Feche os detalhes para continuar.': ['The Design System is documented. Close the details to continue.', 'El Design System está documentado. Cierra los detalles para continuar.'],
    'Clique em Referência Visual. O tutorial inserirá o logo horizontal oficial do Faber Code.': ['Click Visual Reference. The tutorial will add the official horizontal Faber Code logo.', 'Haz clic en Referencia Visual. El tutorial añadirá el logo horizontal oficial de Faber Code.'],
    'Inserir logo Faber Code': ['Add Faber Code logo', 'Añadir logo Faber Code'],
    'Clique em Novo Grupo para organizar o briefing, o Design System e o logo em Frontend.': ['Click New Group to organize the brief, Design System, and logo under Frontend.', 'Haz clic en Nuevo Grupo para organizar el briefing, el Design System y el logo en Frontend.'],
    'Criar grupo Frontend': ['Create Frontend group', 'Crear grupo Frontend'],
    'Crie mais um grupo. Ele receberá as regras de interface e os critérios de aceite.': ['Create one more group for the interface rules and acceptance criteria.', 'Crea un grupo más para las reglas de interfaz y los criterios de aceptación.'],
    'Criar grupo Regras': ['Create Rules group', 'Crear grupo Reglas'],
    'Digite seu nome e confirme. O briefing será personalizado com uma saudação feita para você.': ['Enter your name and confirm. The brief will be personalized with a greeting for you.', 'Escribe tu nombre y confirma. El briefing se personalizará con un saludo para ti.'],
    'Digite seu nome': ['Enter your name', 'Escribe tu nombre'],
    'O Markdown de arquitetura foi preparado. Clique no lápis para abrir e revisar Next.js, JavaScript e Tailwind CSS.': ['The architecture Markdown is ready. Click the pencil to review Next.js, JavaScript, and Tailwind CSS.', 'El Markdown de arquitectura está listo. Haz clic en el lápiz para revisar Next.js, JavaScript y Tailwind CSS.'],
    'O Markdown de componentes foi criado. Clique no lápis para abrir e revisar as responsabilidades da interface.': ['The components Markdown is ready. Click the pencil to review the interface responsibilities.', 'El Markdown de componentes está listo. Haz clic en el lápiz para revisar las responsabilidades de la interfaz.'],
    'O último Markdown foi criado. Clique no lápis para revisar a saudação e os placeholders de GitHub e LinkedIn.': ['The final Markdown is ready. Click the pencil to review the greeting and GitHub and LinkedIn placeholders.', 'El último Markdown está listo. Haz clic en el lápiz para revisar el saludo y los placeholders de GitHub y LinkedIn.'],
    'Criar arquitetura frontend': ['Create frontend architecture', 'Crear arquitectura frontend'],
    'Crie outro Markdown para documentar os componentes e suas responsabilidades.': ['Create another Markdown document for the components and their responsibilities.', 'Crea otro documento Markdown para los componentes y sus responsabilidades.'],
    'Criar componentes da página': ['Create page components', 'Crear componentes de la página'],
    'Crie o último Markdown com os textos da página e placeholders para GitHub e LinkedIn.': ['Create the final Markdown with the page copy and GitHub and LinkedIn placeholders.', 'Crea el último Markdown con los textos de la página y placeholders para GitHub y LinkedIn.'],
    'Criar conteúdo e links': ['Create content and links', 'Crear contenido y enlaces'],
    'Finalize as informações do mapa antes de avançar.': ['Finish the map information before moving on.', 'Completa la información del mapa antes de continuar.'],
    'Expanda o painel direito para conhecer as ferramentas disponíveis antes de abrir o chat do mapa.': ['Expand the right panel to explore the available tools before opening the map chat.', 'Expande el panel derecho para conocer las herramientas disponibles antes de abrir el chat del mapa.'],
    'Clique em IA do Mapa para iniciar uma conversa contextualizada.': ['Click Map AI to start a contextual conversation.', 'Haz clic en IA del Mapa para iniciar una conversación contextualizada.'],
    'Abrir IA do Mapa': ['Open Map AI', 'Abrir IA del Mapa'],
    'Clique no campo de texto. O tutorial escreverá uma pergunta para revisar o mapa antes da análise.': ['Click the text field. The tutorial will write a question to review the map before analysis.', 'Haz clic en el campo de texto. El tutorial escribirá una pregunta para revisar el mapa antes del análisis.'],
    'Escrever pergunta': ['Write question', 'Escribir pregunta'],
    'Clique em Enviar para ver a resposta simulada da IA sobre o mapa criado.': ['Click Send to see the simulated AI response about the map.', 'Haz clic en Enviar para ver la respuesta simulada de la IA sobre el mapa creado.'],
    'Enviar pergunta': ['Send question', 'Enviar pregunta'],
    'A conversa identificou a lacuna. Clique em Adicionar documento de SEO ao mapa para voltar ao canvas e registrar a informação no grupo Regras.': ['The conversation identified the gap. Click Add SEO document to the map to return to the canvas and record it in the Rules group.', 'La conversación identificó la información faltante. Haz clic en Añadir documento SEO al mapa para volver al lienzo y registrarla en el grupo Reglas.'],
    'Adicionar SEO ao mapa': ['Add SEO to map', 'Añadir SEO al mapa'],
    'O tutorial voltou ao mapa e adicionou “SEO e Estados da Interface” ao grupo Regras. A análise do projeto será aberta em seguida.': ['The tutorial returned to the map and added “SEO and Interface States” to the Rules group. Project analysis will open next.', 'El tutorial volvió al mapa y añadió “SEO y Estados de la Interfaz” al grupo Reglas. A continuación se abrirá el análisis del proyecto.'],
    'Informação adicionada ao mapa': ['Information added to map', 'Información añadida al mapa'],
    'A resposta é emulada localmente para ensinar o fluxo sem consumir créditos ou exigir uma API.': ['The response is emulated locally to teach the workflow without using credits or requiring an API.', 'La respuesta se emula localmente para enseñar el flujo sin consumir créditos ni exigir una API.'],
    'Carregando o histórico corrigido do mapa.': ['Loading the corrected map history.', 'Cargando el historial corregido del mapa.'],
    'A correção ficou registrada no histórico. Clique em Renderizar o Mapa para transformar os documentos em um plano de desenvolvimento.': ['The correction is recorded in history. Click Render Map to turn the documents into a development plan.', 'La corrección quedó registrada en el historial. Haz clic en Renderizar el Mapa para convertir los documentos en un plan de desarrollo.'],
    'Clique em Renderizar o Mapa. Nesta demonstração, a análise será local e não consumirá créditos de nenhuma API.': ['Click Render Map. In this demonstration, analysis runs locally and uses no API credits.', 'Haz clic en Renderizar el Mapa. En esta demostración, el análisis será local y no consumirá créditos de ninguna API.'],
    'O Faber Code está lendo o mapa e seus Markdowns para montar a sequência completa de desenvolvimento.': ['Faber Code is reading the map and its Markdown documents to build the complete development sequence.', 'Faber Code está leyendo el mapa y sus documentos Markdown para crear la secuencia completa de desarrollo.'],
    'O planejamento está pronto e cada etapa cita os Markdowns importantes. Clique em Salvar em Milestones.': ['The plan is ready, and each stage references the important Markdown documents. Click Save to Milestones.', 'El plan está listo y cada etapa cita los documentos Markdown importantes. Haz clic en Guardar en Milestones.'],
    'Confirme clicando em Continuar para gravar o planejamento no projeto.': ['Confirm by clicking Continue to save the plan in the project.', 'Confirma haciendo clic en Continuar para guardar el plan en el proyecto.'],
    'Salvando as milestones e gerando a documentação do planejamento dentro do projeto.': ['Saving milestones and generating planning documentation inside the project.', 'Guardando las milestones y generando la documentación del plan dentro del proyecto.'],
    'As etapas foram salvas. Clique em Milestones no painel direito para encontrá-las.': ['The stages were saved. Click Milestones in the right panel to find them.', 'Las etapas se guardaron. Haz clic en Milestones en el panel derecho para encontrarlas.'],
    'Carregando o planejamento salvo no projeto.': ['Loading the plan saved in the project.', 'Cargando el plan guardado en el proyecto.'],
    'Abra a Milestone 1 para revisar tarefas, critérios e Markdowns de referência.': ['Open Milestone 1 to review tasks, criteria, and reference Markdown documents.', 'Abre la Milestone 1 para revisar tareas, criterios y documentos Markdown de referencia.'],
    'A Milestone 1 está aberta. No projeto, clique no botão + à direita do ícone do Mapa da Aplicação para abrir o chat de desenvolvimento.': ['Milestone 1 is open. In the project, click the + button to the right of the Application Map icon to open development chat.', 'La Milestone 1 está abierta. En el proyecto, haz clic en el botón + a la derecha del icono del Mapa de la Aplicación para abrir el chat de desarrollo.'],
    'Preparando uma conversa de desenvolvimento vinculada ao projeto e à Milestone 1.': ['Preparing a development conversation linked to the project and Milestone 1.', 'Preparando una conversación de desarrollo vinculada al proyecto y a la Milestone 1.'],
    'O chat de desenvolvimento está aberto. A próxima etapa vai preparar a primeira mensagem.': ['Development chat is open. The next stage will prepare the first message.', 'El chat de desarrollo está abierto. La siguiente etapa preparará el primer mensaje.'],
    'Clique na caixa de texto. O tutorial escreverá a solicitação para iniciar a Milestone 1.': ['Click the text box. The tutorial will write the request to start Milestone 1.', 'Haz clic en el cuadro de texto. El tutorial escribirá la solicitud para iniciar la Milestone 1.'],
    'Clique em Enviar. A conversa será emulada e salva no projeto sem consumir créditos.': ['Click Send. The conversation will be emulated and saved in the project without using credits.', 'Haz clic en Enviar. La conversación se emulará y guardará en el proyecto sin consumir créditos.'],
    'A IA do tutorial está contextualizando a Milestone 1 e os Markdowns necessários.': ['The tutorial AI is contextualizing Milestone 1 and the required Markdown documents.', 'La IA del tutorial está contextualizando la Milestone 1 y los documentos Markdown necesarios.'],
    'A IA do tutorial está criando a fundação da landing page dentro da pasta real do projeto.': ['The tutorial AI is creating the landing page foundation inside the real project folder.', 'La IA del tutorial está creando la base de la landing page dentro de la carpeta real del proyecto.'],
    'Fundação criada. Agora vamos revisar e salvar este primeiro conjunto de arquivos no Git.': ['Foundation created. Now we will review and save this first set of files in Git.', 'Base creada. Ahora revisaremos y guardaremos este primer conjunto de archivos en Git.'],
    'Título do briefing': ['Brief title', 'Título del briefing'],
    'Título do Design System': ['Design System title', 'Título del Design System'],
    'Descrição do briefing': ['Brief description', 'Descripción del briefing'],
    'Descrição do Design System': ['Design System description', 'Descripción del Design System'],
    'Pergunta para a IA do Mapa': ['Question for Map AI', 'Pregunta para la IA del Mapa'],
    'Mensagem da Milestone 1': ['Milestone 1 message', 'Mensaje de la Milestone 1'],
    'Clique no Mapa da Aplicação': ['Open the Application Map', 'Abrir el Mapa de la Aplicación'],
    'Novo projeto': ['New project', 'Nuevo proyecto'],
    'Mapa aberto': ['Map open', 'Mapa abierto'],
    'Painel esquerdo recolhido': ['Left panel collapsed', 'Panel izquierdo contraído'],
    'Painel direito recolhido': ['Right panel collapsed', 'Panel derecho contraído'],
    'Ferramentas do mapa exploradas': ['Map tools explored', 'Herramientas del mapa exploradas'],
    'Expandir painel esquerdo': ['Expand left panel', 'Expandir panel izquierdo'],
    'Expandir painel direito': ['Expand right panel', 'Expandir panel derecho'],
    'Recolher painel esquerdo': ['Collapse left panel', 'Contraer panel izquierdo'],
    'Recolher painel direito': ['Collapse right panel', 'Contraer panel derecho'],
    'Cancelar e continuar': ['Cancel and continue', 'Cancelar y continuar'],
    'Salvar edição': ['Save changes', 'Guardar cambios'],
    'Adicionar API': ['Add API', 'Añadir API'],
    'Escolha um serviço': ['Choose a service', 'Elige un servicio'],
    'Adicionar': ['Add', 'Añadir'],
    'Fechar Cortex': ['Close Cortex', 'Cerrar Cortex'],
    'Arquivos': ['Files', 'Archivos'],
    'IA do Mapa': ['Map AI', 'IA del Mapa'],
    'Terminal': ['Terminal', 'Terminal'],
    'Milestones': ['Milestones', 'Milestones'],
    'Geral': ['General', 'General'],
    'Executar': ['Run', 'Ejecutar'],
    'abre os arquivos do projeto': ['opens the project files', 'abre los archivos del proyecto'],
    'tira dúvidas e revisa as informações do mapa': ['answers questions and reviews map information', 'responde dudas y revisa la información del mapa'],
    'acompanha versionamento, commits e publicação': ['tracks versions, commits, and publishing', 'acompaña versiones, commits y publicación'],
    'executa comandos dentro do projeto': ['runs commands inside the project', 'ejecuta comandos dentro del proyecto'],
    'organiza o planejamento em etapas executáveis': ['organizes the plan into executable stages', 'organiza el plan en etapas ejecutables'],
    'inicia o projeto em um servidor local': ['starts the project on a local server', 'inicia el proyecto en un servidor local'],
    'Seleção': ['Select', 'Selección'],
    'Mover pelo mapa': ['Pan around the map', 'Moverse por el mapa'],
    'Novo Grupo': ['New Group', 'Nuevo Grupo'],
    'Novo Markdown': ['New Markdown', 'Nuevo Markdown'],
    'Upload de imagem': ['Upload image', 'Subir imagen'],
    'Nova Decisão': ['New Decision', 'Nueva Decisión'],
    'Alterações': ['Changes', 'Cambios'],
    'Novos Arquivos': ['New Files', 'Archivos nuevos'],
    'Mensagem do commit': ['Commit message', 'Mensaje del commit'],
    'Desenvolvimento concluído em dois commits objetivos. Agora vamos executar o projeto localmente.': ['Development completed in two focused commits. Now we will run the project locally.', 'Desarrollo completado en dos commits concretos. Ahora ejecutaremos el proyecto localmente.'],
    'Instalando dependências quando necessário e iniciando o servidor local. O navegador abrirá automaticamente.': ['Installing dependencies when needed and starting the local server. The browser will open automatically.', 'Instalando dependencias cuando sea necesario e iniciando el servidor local. El navegador se abrirá automáticamente.'],
    'Servidor local iniciado e página aberta no navegador. Tutorial concluído.': ['Local server started and page opened in the browser. Tutorial complete.', 'Servidor local iniciado y página abierta en el navegador. Tutorial completado.'],
    'Clique em Executar. O Faber Code iniciará o projeto de verdade em um servidor local e abrirá o navegador.': ['Click Run. Faber Code will start the real project on a local server and open the browser.', 'Haz clic en Ejecutar. Faber Code iniciará el proyecto real en un servidor local y abrirá el navegador.'],
    'A conversa de desenvolvimento está criando o próximo conjunto de arquivos na pasta do projeto.': ['The development conversation is creating the next set of files in the project folder.', 'La conversación de desarrollo está creando el siguiente conjunto de archivos en la carpeta del proyecto.'],
    'A fundação está versionada. Volte ao Chat para acompanhar a IA concluir a experiência antes da revisão final.': ['The foundation is versioned. Return to Chat to watch the AI complete the experience before the final review.', 'La base está versionada. Vuelve al Chat para ver cómo la IA completa la experiencia antes de la revisión final.'],
    'Abra Repositório local para ativar o Git somente dentro desta pasta.': ['Open Local repository to enable Git only inside this folder.', 'Abre Repositorio local para activar Git solo dentro de esta carpeta.'],
    'Clique em Init repo. Nada será publicado; criaremos apenas o histórico local.': ['Click Init repo. Nothing will be published; we will only create local history.', 'Haz clic en Init repo. No se publicará nada; solo crearemos el historial local.'],
    'Selecione todos os arquivos deste conjunto antes de enviá-los para Staged.': ['Select every file in this set before sending them to Staged.', 'Selecciona todos los archivos de este conjunto antes de enviarlos a Staged.'],
    'Clique em Stage it para preparar estes arquivos para o commit.': ['Click Stage it to prepare these files for the commit.', 'Haz clic en Stage it para preparar estos archivos para el commit.'],
    'Os arquivos estão em Staged. Selecione todos para compor o próximo commit.': ['The files are Staged. Select all of them for the next commit.', 'Los archivos están en Staged. Selecciónalos todos para el siguiente commit.'],
    'Clique no campo de mensagem. O tutorial escreverá uma descrição clara para este commit.': ['Click the message field. The tutorial will write a clear description for this commit.', 'Haz clic en el campo de mensaje. El tutorial escribirá una descripción clara para este commit.'],
    'Clique em Criar commit com selecionados para salvar esta etapa do desenvolvimento.': ['Click Commit selected to save this development stage.', 'Haz clic en Crear commit con seleccionados para guardar esta etapa del desarrollo.'],
    'A implementação está completa. Abra Arquivos para ver os arquivos finais ainda com as diffs pendentes.': ['The implementation is complete. Open Files to see the final files with their diffs still pending.', 'La implementación está completa. Abre Archivos para ver los archivos finales con sus diffs pendientes.'],
    'Clique em um arquivo com diff para visualizar o conteúdo criado antes do último commit.': ['Click a file with a diff to review the content before the final commit.', 'Haz clic en un archivo con diff para revisar el contenido antes del último commit.'],
    'A diff foi revisada. Feche o arquivo para preparar o commit final.': ['The diff was reviewed. Close the file to prepare the final commit.', 'El diff fue revisado. Cierra el archivo para preparar el commit final.'],
    'Salvando o commit local...': ['Saving the local commit...', 'Guardando el commit local...'],
    'Atualizando o estado real do repositório...': ['Refreshing the real repository state...', 'Actualizando el estado real del repositorio...'],
    'Abra a ferramenta Git no painel direito para revisar os arquivos que a conversa acabou de criar.': ['Open Git in the right panel to review the files just created by the conversation.', 'Abre Git en el panel derecho para revisar los archivos que acaba de crear la conversación.'],
  };

  function normalizeLocale(locale) {
    const raw = String(locale || '').trim();
    if (SUPPORTED_LOCALES.includes(raw)) return raw;
    if (/^en\b/i.test(raw)) return 'en-US';
    if (/^es\b/i.test(raw)) return 'es-ES';
    return 'pt-BR';
  }

  function getPath(source, path) {
    return String(path || '').split('.').filter(Boolean).reduce((value, key) => (
      value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined
    ), source);
  }

  function interpolate(value, variables = {}) {
    if (typeof value !== 'string') return value;
    return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => (
      Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : ''
    ));
  }

  function value(locale, path, fallback) {
    const normalized = normalizeLocale(locale);
    const localized = getPath(COPY[normalized], path);
    if (localized !== undefined) return localized;
    const portuguese = getPath(COPY['pt-BR'], path);
    return portuguese !== undefined ? portuguese : fallback;
  }

  function translate(locale, path, variables = {}, fallback = '') {
    const resolved = value(locale, path, fallback);
    return interpolate(resolved, variables);
  }

  function translatePhrase(locale, input) {
    const normalized = normalizeLocale(locale);
    const source = String(input || '');
    if (normalized === 'pt-BR' || !source) return source;
    const entry = PHRASES[source];
    if (entry) return entry[normalized === 'en-US' ? 0 : 1];

    let match = source.match(/^Passe o mouse sobre (.+): esta ferramenta (.+)\.$/);
    if (match) {
      const label = translatePhrase(normalized, match[1]);
      const description = translatePhrase(normalized, match[2]);
      return normalized === 'en-US'
        ? `Hover over ${label}: this tool ${description}.`
        : `Pasa el cursor sobre ${label}: esta herramienta ${description}.`;
    }
    match = source.match(/^Agora o tutorial vai escrever "(.+)" no campo Serviço para refletir a escolha feita acima\.$/);
    if (match) {
      return normalized === 'en-US'
        ? `The tutorial will now enter “${match[1]}” in the Service field to reflect the selection made above.`
        : `Ahora el tutorial escribirá “${match[1]}” en el campo Servicio para reflejar la opción elegida anteriormente.`;
    }
    match = source.match(/^Revise ou edite o título, a descrição e o conteúdo de (.+)\. Quando estiver pronto, clique no X para concluir este Markdown\.$/);
    if (match) {
      return normalized === 'en-US'
        ? `Review or edit the title, description, and content of ${match[1]}. When ready, click X to finish this Markdown document.`
        : `Revisa o edita el título, la descripción y el contenido de ${match[1]}. Cuando esté listo, haz clic en la X para finalizar este documento Markdown.`;
    }
    match = source.match(/^Editar (.+)$/);
    if (match) return normalized === 'en-US' ? `Edit ${match[1]}` : `Editar ${match[1]}`;
    match = source.match(/^Concluir (.+)$/);
    if (match) return normalized === 'en-US' ? `Finish ${match[1]}` : `Finalizar ${match[1]}`;
    match = source.match(/^Olá, (.+)\. Crie um Markdown para registrar Next\.js, JavaScript e Tailwind CSS como arquitetura do demonstrativo\.$/);
    if (match) {
      return normalized === 'en-US'
        ? `Hello, ${match[1]}. Create a Markdown document that records Next.js, JavaScript, and Tailwind CSS as the demo architecture.`
        : `Hola, ${match[1]}. Crea un documento Markdown que registre Next.js, JavaScript y Tailwind CSS como arquitectura de la demostración.`;
    }
    match = source.match(/^Mapa pronto para desenvolvimento: saudação para (.+), Design System, arquitetura Next\.js com Tailwind, componentes, regras, conteúdo e links placeholders\. Agora o tutorial abrirá a apresentação do painel direito\.$/);
    if (match) {
      return normalized === 'en-US'
        ? `Map ready for development: greeting for ${match[1]}, Design System, Next.js with Tailwind architecture, components, rules, content, and link placeholders. The tutorial will now introduce the right panel.`
        : `Mapa listo para el desarrollo: saludo para ${match[1]}, Design System, arquitectura Next.js con Tailwind, componentes, reglas, contenido y placeholders de enlaces. Ahora el tutorial presentará el panel derecho.`;
    }
    match = source.match(/^Abra (.+) para revisar o lote "(.+)"\.$/);
    if (match) {
      const scope = translatePhrase(normalized, match[1]);
      return normalized === 'en-US'
        ? `Open ${scope} to review the “${match[2]}” batch.`
        : `Abre ${scope} para revisar el lote “${match[2]}”.`;
    }
    match = source.match(/^Zoom atual: (.+)\.$/);
    if (match) {
      return normalized === 'en-US' ? `Current zoom: ${match[1]}.` : `Zoom actual: ${match[1]}.`;
    }
    return source;
  }

  function translateHtml(locale, html) {
    const normalized = normalizeLocale(locale);
    if (normalized === 'pt-BR') return String(html || '');
    return String(html || '').replace(/>([^<>]+)</g, (full, text) => {
      const leading = text.match(/^\s*/)?.[0] || '';
      const trailing = text.match(/\s*$/)?.[0] || '';
      const core = text.trim();
      return core ? `>${leading}${translatePhrase(normalized, core)}${trailing}<` : full;
    });
  }

  window.FaberTutorialCopy = {
    COPY,
    SUPPORTED_LOCALES,
    normalizeLocale,
    translate,
    translateHtml,
    translatePhrase,
    value,
  };
})();

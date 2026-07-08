(function () {
  const REQUIREMENTS_ACK_KEY = 'fabercode:requirements-acknowledged';
  const TUTORIAL_COMPLETED_KEY = 'fabercode:tutorial-completed';
  const TUTORIAL_DISMISSED_KEY = 'fabercode:tutorial-dismissed';
  const TUTORIAL_PROGRESS_KEY = 'fabercode:tutorial-progress';
  const WANTS_TUTORIAL_KEY = 'fabercode:wants-tutorial';

  const LEFT_PANEL_HOVER_SELECTORS = [
    '#btn-cortex-mode',
    '#btn-archived-projects',
    '#btn-trash-projects',
    '#btn-project-settings',
  ];

  const PROVIDER_LINKS = [
    { id: 'anthropic', label: 'Anthropic', url: 'https://console.anthropic.com/settings/keys' },
    { id: 'openai', label: 'OpenAI', url: 'https://platform.openai.com/api-keys' },
    { id: 'google', label: 'Google', url: 'https://aistudio.google.com/app/apikey' },
    { id: 'deepseek', label: 'DeepSeek', url: 'https://platform.deepseek.com/api_keys' },
  ];

  const COPY = {
    'pt-BR': {
      requirementsTitle: 'Requisitos locais do Faber Code',
      requirementsLead: 'Antes de continuar, confirme que este computador tem Node.js e Git instalados. O Faber Code depende deles para terminal, preview local e commits.',
      requirementsReady: 'Tudo pronto neste computador.',
      requirementsMissing: 'Ainda faltam dependências obrigatórias.',
      installNode: 'Instalar Node.js',
      installGit: 'Instalar Git',
      recheck: 'Verificar novamente',
      continue: 'Continuar',
      previous: 'Voltar',
      stopTutorial: 'Interromper',
      finishTutorial: 'Concluir tutorial',
      waiting: 'Aguardando',
      done: 'Concluído',
      tutorialLive: 'Tutorial ao vivo',
      tutorialHintLabel: 'Próxima ação',
      tutorialIntroTitle: 'Tutorial guiado do Faber Code',
      tutorialIntroBody: 'O usuário novo passa por um tour visual da interface antes de usar a ferramenta de fato.',
      panelsTitle: 'Painel e configurações básicas',
      panelsBody: 'Primeiro o usuário conhece os três painéis, entende onde ficam as ferramentas fixas e passa pelas configurações essenciais antes de começar a usar o fluxo real.',
      panelsHint: 'Recolha e expanda os dois painéis laterais para entender onde a navegação principal acontece.',
      panelsHoverSingle: 'Passe o mouse sobre o ícone destacado para ver o nome da ferramenta.',
      leftToolsTitle: 'Ferramentas do painel esquerdo',
      leftToolsBody: 'Agora o usuário conhece os ícones fixos da base esquerda antes de começar a usar qualquer fluxo de projeto.',
      leftToolsHint: 'Passe o mouse por cada ícone destacado. Aqui o tutorial só apresenta os nomes; ainda não é hora de clicar.',
      openCortexHint: 'Clique em Regras e memória para abrir o Cortex.',
      openSettingsHint: 'Clique em Configurações para abrir este hub da ferramenta.',
      openApisHint: 'Clique em Configurar APIs para ver onde conectar sua IA.',
      panelsLeftCollapse: 'Recolha o painel esquerdo',
      panelsLeftExpand: 'Expanda o painel esquerdo',
      panelsRightCollapse: 'Recolha o painel direito',
      panelsRightExpand: 'Expanda o painel direito',
      panelsLeft: 'Recolher e expandir o painel esquerdo',
      panelsRight: 'Recolher e expandir o painel direito',
      panelsHover: 'Passar o mouse por todos os ícones destacados',
      sidebarTitle: 'Projetos arquivados e lixeira',
      sidebarBody: 'Projetos arquivados ainda podem servir como memória e referência para o Faber Code. A lixeira é diferente: ela existe apenas para excluir de verdade.',
      sidebarHint: 'Vamos mostrar essa diferença restaurando um projeto placeholder dos arquivados e depois enviando esse mesmo item para exclusão definitiva.',
      sidebarModalHint: 'Agora você pode testar este modal com o projeto demo.',
      sidebarDoneHint: 'Feche a lixeira para concluir esta etapa e seguir para o Cortex.',
      sidebarIntroHint: 'Clique em Projetos arquivados para abrir a primeira demonstração.',
      sidebarRestoreHint: 'Restaure o projeto placeholder para mostrar que arquivados ainda podem voltar e servir como memória.',
      sidebarProjectHint: 'Abra o menu do projeto demo e clique em Excluir para enviá-lo à lixeira.',
      sidebarOpenTrashHint: 'Agora abra a lixeira para mostrar que ela serve só para exclusão final.',
      sidebarDeleteHint: 'Clique em Excluir definitivo no projeto demo para concluir a demonstração.',
      sidebarCloseHint: 'Feche a lixeira para encerrar esta etapa.',
      sidebarPlaceholderProject: 'Projeto demo restaurado',
      cortexTitle: 'Cortex e regras do projeto',
      cortexBody: 'Aqui o usuário entende onde salvar regras, decisões e referências para orientar o Faber Code.',
      cortexHint: 'Veja o cursor abrir o Cortex e escrever uma regra de exemplo. Nada será salvo de verdade.',
      cortexAddHint: 'Clique em Adicionar para registrar esta regra de exemplo no Cortex.',
      cortexCloseHint: 'Agora feche o Cortex para seguir para a próxima etapa.',
      apiTitle: 'Configurar API de IA',
      apiBody: 'Aqui o usuário vê que pode conectar a IA que preferir quando quiser. O objetivo desta etapa é apenas mostrar onde ficam as opções e os links oficiais para conseguir as APIs.',
      apiHint: 'O tutorial mostra o painel de APIs sem pressionar o usuário a cadastrar uma chave agora.',
      apiSaveHint: 'O tutorial já montou um exemplo visual. Agora clique em Salvar para fechar as APIs e seguir para o mapa da aplicação.',
      projectClassTitle: 'Funcionamento do Faber Code',
      projectClassBody: 'Agora começa a simulação prática: criar um projeto, escolher a pasta do tutorial e preparar o terreno para o Hello World guiado.',
      projectClassHint: 'Acompanhe a criação da pasta e do projeto. Os arquivos de demonstração só entram nessa pasta no fim do tutorial.',
      mapTitle: 'Mapa da aplicação',
      mapBody: 'O exemplo monta um Hello World no mapa com briefing, imagem, documentação em Markdown, grupos e elementos visuais do design system do Faber Code.',
      mapHint: 'Aqui o usuário vê como planejar, anexar referências e estruturar o que será construído antes do desenvolvimento.',
      chatTitle: 'Chat, milestones e renderização',
      chatBody: 'Depois do mapa, o tutorial mostra como tirar dúvidas com a IA, ajustar o planejamento e renderizar a aplicação com milestones guiando cada parte.',
      chatHint: 'A demonstração usa o chat para pedir ajuda sobre o que está no mapa e depois segue para a renderização do exemplo.',
      gitTitle: 'Git e primeira entrega',
      gitBody: 'Com o projeto em andamento, o usuário vê onde ativar o Git, revisar o progresso por milestones e fazer commits locais. GitHub aparece apenas como possibilidade futura.',
      gitHint: 'O foco aqui é mostrar o fluxo de versionamento local que acompanha o desenvolvimento guiado.',
      finishTitle: 'Tudo pronto para começar',
      finishBody: 'No final, o exemplo mostra o projeto concluído, os commits organizados e o momento de rodar a aplicação no navegador do próprio usuário.',
      finishHint: 'Finalize o tutorial para entrar no uso real com uma visão clara de como o Faber Code cria, organiza e executa projetos.',
      openCortex: 'Abrir Cortex',
      openApis: 'Abrir APIs',
      cortexToolLabel: 'Regras e memória',
      archivedToolLabel: 'Projetos arquivados',
      trashToolLabel: 'Lixeira',
      settingsToolLabel: 'Configurações',
      archivedMock: 'Landing page arquivada',
      trashMock: 'App antigo na lixeira',
      restore: 'Restaurar',
      deleteForever: 'Excluir definitivo',
      mockRule: 'Sempre manter layout limpo, componentes consistentes e contexto registrado no Cortex.',
      mockFolder: 'Pasta do projeto: /Sites/hello-world-faber',
      projectFlowCreate: 'Criar novo projeto',
      projectFlowFolder: 'Selecionar a pasta do tutorial',
      projectFlowReady: 'Projeto aparece pronto no painel esquerdo',
      mockMapBrief: 'Briefing: criar uma página simples de Hello World com identidade do Faber Code.',
      mockMapDesign: 'Design system: grafite, âmbar e marfim, com títulos fortes e leitura limpa.',
      mockUserPrompt: 'Crie a milestone 1 com a página Hello World e o design system básico.',
      mockAssistantReply: 'Plano inicial criado. Vou começar pela estrutura da página, tokens visuais e componentes base.',
      mockGitStatus: 'Git inicializado, arquivos adicionados e primeiro commit preparado.',
      mockRunStatus: 'Servidor local iniciado. A página Hello World seria aberta no navegador neste ponto.',
      mockApiStatus: 'Anthropic recomendada, OpenAI, Google e DeepSeek disponíveis como alternativas.',
      mockSettingsFlow: 'As configurações básicas mostram onde conectar APIs e então voltar para o fluxo principal da ferramenta.',
      mockPanelLeft: 'Projetos, Cortex, arquivados, lixeira e configurações.',
      mockPanelCenter: 'Chat, mapa da aplicação e execução guiada.',
      mockPanelRight: 'Arquivos, Git, terminal, milestones e preview local.',
      panelLeftTitle: 'Esquerda',
      panelCenterTitle: 'Centro',
      panelRightTitle: 'Direita',
      mapDemoMarkdownTitle: 'Adicionando Markdown de Título...',
      mapDemoMarkdownBrief: 'Adicionando Resumo...',
      mapDemoLogo: 'Adicionando Logos...',
      mapDemoGroupFrontend: 'Criando grupo Frontend...',
      mapDemoGroupRules: 'Criando grupo Regras...',
      mapDemoChatQuestion: 'Precisa de ajuda com o mapa?',
      mapDemoChatReply: 'O assistente do mapa pode ajudar a estruturar e revisar sua arquitetura.',
      devMilestonesHint: 'Abrindo o chat de desenvolvimento e solicitando a primeira milestone...',
      gitDemoInit: 'Ativando controle de versão...',
      gitDemoCommit: 'Preparando primeiro commit...',
      runDemoPlay: 'Rodando aplicação no navegador...'
    },
    'en-US': {
      requirementsTitle: 'Local requirements for Faber Code',
      requirementsLead: 'Before moving on, confirm this computer has Node.js and Git installed. Faber Code depends on them for terminal access, local preview, and commits.',
      requirementsReady: 'Everything is ready on this computer.',
      requirementsMissing: 'Required dependencies are still missing.',
      installNode: 'Install Node.js',
      installGit: 'Install Git',
      recheck: 'Check again',
      continue: 'Continue',
      previous: 'Back',
      stopTutorial: 'Stop',
      finishTutorial: 'Finish tutorial',
      waiting: 'Waiting',
      done: 'Done',
      tutorialLive: 'Live tutorial',
      tutorialHintLabel: 'Next action',
      tutorialIntroTitle: 'Faber Code guided tutorial',
      tutorialIntroBody: 'New users go through a visual tour before using the tool for real.',
      panelsTitle: 'Panels and basic settings',
      panelsBody: 'First the user meets the three panels, understands the fixed tools, and passes through the essential settings before starting the real workflow.',
      panelsHint: 'Collapse and expand both side panels so the user understands where the main navigation lives.',
      panelsHoverSingle: 'Hover the highlighted icon to reveal the tool name.',
      leftToolsTitle: 'Left panel tools',
      leftToolsBody: 'Now the user learns the fixed icons at the bottom of the left panel before entering any project flow.',
      leftToolsHint: 'Hover each highlighted icon. This step only reveals names; clicking is still blocked.',
      openCortexHint: 'Click Rules and memory to open Cortex.',
      openSettingsHint: 'Click Settings to open this tool hub.',
      openApisHint: 'Click Configure APIs to see where your model is connected.',
      panelsLeftCollapse: 'Collapse the left panel',
      panelsLeftExpand: 'Expand the left panel',
      panelsRightCollapse: 'Collapse the right panel',
      panelsRightExpand: 'Expand the right panel',
      panelsLeft: 'Collapse and expand the left panel',
      panelsRight: 'Collapse and expand the right panel',
      panelsHover: 'Hover all highlighted icons',
      sidebarTitle: 'Archived projects and trash',
      sidebarBody: 'Archived projects can still serve as memory and reference for Faber Code. Trash is different: it only exists for real deletion.',
      sidebarHint: 'We will show that difference by restoring a placeholder project from archived items and then sending that same item to permanent deletion.',
      sidebarModalHint: 'Now you can test this modal with the demo project.',
      sidebarDoneHint: 'Close the trash modal to finish this step and move on to Cortex.',
      sidebarIntroHint: 'Click Archived projects to open the first demo.',
      sidebarRestoreHint: 'Restore the placeholder project to show that archived items can return and still serve as memory.',
      sidebarProjectHint: 'Open the demo project menu and click Delete to send it to trash.',
      sidebarOpenTrashHint: 'Now open trash to show that it is only used for final deletion.',
      sidebarDeleteHint: 'Click Delete forever on the demo project to finish the demonstration.',
      sidebarCloseHint: 'Close the trash modal to finish this step.',
      sidebarPlaceholderProject: 'Restored demo project',
      cortexTitle: 'Cortex and project rules',
      cortexBody: 'Here the user sees where to save rules, decisions, and references to guide Faber Code.',
      cortexHint: 'Watch the cursor open Cortex and type a sample rule. Nothing will be saved for real.',
      cortexAddHint: 'Click Add to register this sample rule in Cortex.',
      cortexCloseHint: 'Now close Cortex to move to the next step.',
      apiTitle: 'Configure an AI API',
      apiBody: 'Here the user sees that they can connect the AI provider they prefer whenever they are ready. This step only shows where the options and official provider links live.',
      apiHint: 'The tutorial shows the API panel without pushing the user to add a key right now.',
      apiSaveHint: 'The tutorial has already prepared a visual example. Now click Save to close the API panel and continue to the application map.',
      projectClassTitle: 'How Faber Code works',
      projectClassBody: 'Now the practical simulation begins: create a project, choose the tutorial folder, and prepare the ground for the guided Hello World example.',
      projectClassHint: 'Follow the creation of the folder and project. Demo files are only copied into that folder after the tutorial is finished.',
      mapTitle: 'Application map',
      mapBody: 'The example builds a Hello World in the map with a brief, image, Markdown documentation, grouped items, and visual references from the Faber Code design system.',
      mapHint: 'This is where the user sees how planning, references, and structure come together before development starts.',
      chatTitle: 'Chat, milestones, and rendering',
      chatBody: 'After the map, the tutorial shows how to ask the AI questions, refine the plan, and render the application while milestones guide each phase.',
      chatHint: 'The demo uses chat to ask about the map content and then continues into rendering the example.',
      gitTitle: 'Git and first delivery',
      gitBody: 'With the project underway, the user sees where to enable Git, follow milestone progress, and make local commits. GitHub remains an optional next step.',
      gitHint: 'This step focuses on the local versioning flow that supports guided development.',
      finishTitle: 'Ready to start',
      finishBody: 'At the end, the example shows the project completed, commits organized, and the moment to run the app in the user’s own browser.',
      finishHint: 'Finish the tutorial to enter the real workflow with a clear view of how Faber Code creates, organizes, and runs projects.',
      openCortex: 'Open Cortex',
      openApis: 'Open APIs',
      cortexToolLabel: 'Rules and memory',
      archivedToolLabel: 'Archived projects',
      trashToolLabel: 'Trash',
      settingsToolLabel: 'Settings',
      archivedMock: 'Archived landing page',
      trashMock: 'Old app in trash',
      restore: 'Restore',
      deleteForever: 'Delete forever',
      mockRule: 'Always keep the layout clean, components consistent, and context recorded in Cortex.',
      mockFolder: 'Project folder: /Sites/hello-world-faber',
      projectFlowCreate: 'Create a new project',
      projectFlowFolder: 'Choose the tutorial folder',
      projectFlowReady: 'Project appears ready in the left panel',
      mockMapBrief: 'Brief: create a simple Hello World page with Faber Code identity.',
      mockMapDesign: 'Design system: graphite, amber, and ivory, with strong headings and clean readability.',
      mockUserPrompt: 'Create milestone 1 with the Hello World page and the basic design system.',
      mockAssistantReply: 'Initial plan created. I will start with the page structure, visual tokens, and base components.',
      mockGitStatus: 'Git initialized, files added, and the first commit prepared.',
      mockRunStatus: 'Local server started. The Hello World page would open in the browser at this point.',
      mockApiStatus: 'Anthropic recommended, with OpenAI, Google, and DeepSeek available as alternatives.',
      mockSettingsFlow: 'Basic settings show where APIs are connected before returning to the main workflow.',
      mockPanelLeft: 'Projects, Cortex, archived items, trash, and settings.',
      mockPanelCenter: 'Chat, application map, and guided execution.',
      mockPanelRight: 'Files, Git, terminal, milestones, and local preview.',
      panelLeftTitle: 'Left',
      panelCenterTitle: 'Center',
      panelRightTitle: 'Right',
      mapDemoMarkdownTitle: 'Adding Title Markdown...',
      mapDemoMarkdownBrief: 'Adding Brief...',
      mapDemoLogo: 'Adding Logos...',
      mapDemoGroupFrontend: 'Creating Frontend group...',
      mapDemoGroupRules: 'Creating Rules group...',
      mapDemoChatQuestion: 'Need help with the map?',
      mapDemoChatReply: 'The map assistant can help you structure and review your architecture.',
      devMilestonesHint: 'Opening dev chat and requesting the first milestone...',
      gitDemoInit: 'Activating version control...',
      gitDemoCommit: 'Preparing first commit...',
      runDemoPlay: 'Running app in browser...'
    },
    'es-ES': {
      requirementsTitle: 'Requisitos locales de Faber Code',
      requirementsLead: 'Antes de continuar, confirma que este equipo tiene Node.js y Git instalados. Faber Code depende de ellos para terminal, preview local y commits.',
      requirementsReady: 'Todo está listo en este equipo.',
      requirementsMissing: 'Todavía faltan dependencias obligatorias.',
      installNode: 'Instalar Node.js',
      installGit: 'Instalar Git',
      recheck: 'Verificar de nuevo',
      continue: 'Continuar',
      previous: 'Volver',
      stopTutorial: 'Interrumpir',
      finishTutorial: 'Finalizar tutorial',
      waiting: 'En espera',
      done: 'Hecho',
      tutorialLive: 'Tutorial en vivo',
      tutorialHintLabel: 'Próxima acción',
      tutorialIntroTitle: 'Tutorial guiado de Faber Code',
      tutorialIntroBody: 'Los usuarios nuevos pasan por un recorrido visual antes de usar la herramienta de verdad.',
      panelsTitle: 'Paneles y configuraciones básicas',
      panelsBody: 'Primero el usuario conoce los tres paneles, entiende las herramientas fijas y pasa por las configuraciones esenciales antes de empezar el flujo real.',
      panelsHint: 'Contrae y expande ambos paneles laterales para entender dónde vive la navegación principal.',
      panelsHoverSingle: 'Pasa el mouse por el icono destacado para ver el nombre de la herramienta.',
      leftToolsTitle: 'Herramientas del panel izquierdo',
      leftToolsBody: 'Ahora el usuario aprende los iconos fijos de la base izquierda antes de entrar en cualquier flujo de proyecto.',
      leftToolsHint: 'Pasa el mouse por cada icono destacado. En este paso solo se muestran los nombres; todavía no se puede hacer clic.',
      openCortexHint: 'Haz clic en Reglas y memoria para abrir Cortex.',
      openSettingsHint: 'Haz clic en Configuraciones para abrir este hub de la herramienta.',
      openApisHint: 'Haz clic en Configurar APIs para ver dónde conectar tu IA.',
      panelsLeftCollapse: 'Contrae el panel izquierdo',
      panelsLeftExpand: 'Expande el panel izquierdo',
      panelsRightCollapse: 'Contrae el panel derecho',
      panelsRightExpand: 'Expande el panel derecho',
      panelsLeft: 'Contraer y expandir el panel izquierdo',
      panelsRight: 'Contraer y expandir el panel derecho',
      panelsHover: 'Pasar el mouse por todos los iconos destacados',
      sidebarTitle: 'Proyectos archivados y papelera',
      sidebarBody: 'Los proyectos archivados todavía pueden servir como memoria y referencia para Faber Code. La papelera es diferente: solo existe para excluir de verdad.',
      sidebarHint: 'Vamos a mostrar esa diferencia restaurando un proyecto placeholder desde archivados y luego enviando ese mismo item a la exclusión definitiva.',
      sidebarModalHint: 'Ahora puedes probar este modal con el proyecto demo.',
      sidebarDoneHint: 'Cierra la papelera para completar esta etapa y seguir hacia Cortex.',
      sidebarIntroHint: 'Haz clic en Proyectos archivados para abrir la primera demostración.',
      sidebarRestoreHint: 'Restaura el proyecto placeholder para mostrar que los archivados todavía pueden volver y servir como memoria.',
      sidebarProjectHint: 'Abre el menú del proyecto demo y haz clic en Eliminar para enviarlo a la papelera.',
      sidebarOpenTrashHint: 'Ahora abre la papelera para mostrar que solo sirve para la exclusión final.',
      sidebarDeleteHint: 'Haz clic en Eliminar definitivo en el proyecto demo para completar la demostración.',
      sidebarCloseHint: 'Cierra la papelera para finalizar esta etapa.',
      sidebarPlaceholderProject: 'Proyecto demo restaurado',
      cortexTitle: 'Cortex y reglas del proyecto',
      cortexBody: 'Aquí el usuario ve dónde guardar reglas, decisiones y referencias para guiar a Faber Code.',
      cortexHint: 'Mira al cursor abrir Cortex y escribir una regla de ejemplo. Nada se guardará de verdad.',
      cortexAddHint: 'Haz clic en Agregar para registrar esta regla de ejemplo en Cortex.',
      cortexCloseHint: 'Ahora cierra Cortex para pasar a la siguiente etapa.',
      apiTitle: 'Configurar una API de IA',
      apiBody: 'Aquí el usuario ve que puede conectar la IA que prefiera cuando quiera. Esta etapa solo muestra dónde están las opciones y los enlaces oficiales para conseguir las APIs.',
      apiHint: 'El tutorial muestra el panel de APIs sin presionar al usuario para registrar una clave ahora.',
      apiSaveHint: 'El tutorial ya preparó un ejemplo visual. Ahora haz clic en Guardar para cerrar APIs y seguir al mapa de la aplicación.',
      projectClassTitle: 'Cómo funciona Faber Code',
      projectClassBody: 'Ahora empieza la simulación práctica: crear un proyecto, elegir la carpeta del tutorial y preparar el terreno para el Hello World guiado.',
      projectClassHint: 'Sigue la creación de la carpeta y del proyecto. Los archivos demo solo se copian a esa carpeta al final del tutorial.',
      mapTitle: 'Mapa de la aplicación',
      mapBody: 'El ejemplo arma un Hello World en el mapa con brief, imagen, documentación en Markdown, grupos y referencias visuales del design system de Faber Code.',
      mapHint: 'Aquí el usuario ve cómo se unen planificación, referencias y estructura antes del desarrollo.',
      chatTitle: 'Chat, milestones y renderizado',
      chatBody: 'Después del mapa, el tutorial muestra cómo preguntar a la IA, ajustar el plan y renderizar la aplicación mientras las milestones guían cada fase.',
      chatHint: 'La demo usa el chat para preguntar sobre lo que está en el mapa y luego continúa hacia el render del ejemplo.',
      gitTitle: 'Git y primera entrega',
      gitBody: 'Con el proyecto en marcha, el usuario ve dónde activar Git, seguir el progreso por milestones y hacer commits locales. GitHub queda como paso opcional.',
      gitHint: 'Este paso muestra el flujo de versionado local que acompaña el desarrollo guiado.',
      finishTitle: 'Todo listo para empezar',
      finishBody: 'Al final, el ejemplo muestra el proyecto terminado, los commits organizados y el momento de ejecutar la app en el navegador del propio usuario.',
      finishHint: 'Finaliza el tutorial para entrar al flujo real con una visión clara de cómo Faber Code crea, organiza y ejecuta proyectos.',
      openCortex: 'Abrir Cortex',
      openApis: 'Abrir APIs',
      cortexToolLabel: 'Reglas y memoria',
      archivedToolLabel: 'Proyectos archivados',
      trashToolLabel: 'Papelera',
      settingsToolLabel: 'Configuraciones',
      archivedMock: 'Landing page archivada',
      trashMock: 'App antigua en papelera',
      restore: 'Restaurar',
      deleteForever: 'Eliminar definitivo',
      mockRule: 'Mantener siempre el layout limpio, componentes consistentes y contexto registrado en Cortex.',
      mockFolder: 'Carpeta del proyecto: /Sites/hello-world-faber',
      projectFlowCreate: 'Crear un nuevo proyecto',
      projectFlowFolder: 'Elegir la carpeta del tutorial',
      projectFlowReady: 'El proyecto aparece listo en el panel izquierdo',
      mockMapBrief: 'Brief: crear una página simple de Hello World con identidad de Faber Code.',
      mockMapDesign: 'Design system: grafito, ámbar y marfil, con títulos fuertes y lectura limpia.',
      mockUserPrompt: 'Crea la milestone 1 con la página Hello World y el design system básico.',
      mockAssistantReply: 'Plan inicial creado. Empezaré por la estructura de la página, tokens visuales y componentes base.',
      mockGitStatus: 'Git inicializado, archivos agregados y primer commit preparado.',
      mockRunStatus: 'Servidor local iniciado. La página Hello World se abriría en el navegador en este punto.',
      mockApiStatus: 'Anthropic recomendada, con OpenAI, Google y DeepSeek como alternativas.',
      mockSettingsFlow: 'Las configuraciones básicas muestran dónde conectar APIs antes de volver al flujo principal.',
      mockPanelLeft: 'Proyectos, Cortex, archivados, papelera y configuraciones.',
      mockPanelCenter: 'Chat, mapa de la aplicación y ejecución guiada.',
      mockPanelRight: 'Archivos, Git, terminal, milestones y preview local.',
      panelLeftTitle: 'Izquierda',
      panelCenterTitle: 'Centro',
      panelRightTitle: 'Derecha',
    },
  };

  function createProgressiveDisclosureController(options = {}) {
    const doc = options.documentRef || document;
    const api = options.api || {};
    const actions = options.actions || {};
    const getLocale = typeof options.getLocale === 'function' ? options.getLocale : () => 'pt-BR';
    const getAccountUnlocked = typeof options.getAccountUnlocked === 'function' ? options.getAccountUnlocked : () => false;
    const getProjects = typeof options.getProjects === 'function' ? options.getProjects : () => [];
    const getSelectedProjectId = typeof options.getSelectedProjectId === 'function' ? options.getSelectedProjectId : () => null;

    const elements = {
      requirements: doc.getElementById('progressive-requirements-modal'),
      requirementsTitle: doc.getElementById('progressive-requirements-title'),
      requirementsLead: doc.getElementById('progressive-requirements-lead'),
      requirementsStatus: doc.getElementById('progressive-requirements-status'),
      requirementsList: doc.getElementById('progressive-requirements-list'),
      requirementsRecheck: doc.getElementById('progressive-requirements-recheck'),
      requirementsContinue: doc.getElementById('progressive-requirements-continue'),
      tutorial: doc.getElementById('progressive-tutorial'),
      tutorialLive: doc.getElementById('progressive-tutorial-live'),
      tutorialTitle: doc.getElementById('progressive-tutorial-title'),
      tutorialBody: doc.getElementById('progressive-tutorial-body'),
      tutorialHint: doc.getElementById('progressive-tutorial-hint'),
      tutorialCounter: doc.getElementById('progressive-tutorial-step-counter'),
      tutorialProgress: doc.getElementById('progressive-tutorial-progress'),
      tutorialChecklist: doc.getElementById('progressive-tutorial-checklist'),
      tutorialPreview: doc.getElementById('progressive-tutorial-preview'),
      tutorialPrev: doc.getElementById('progressive-tutorial-prev'),
      tutorialSkipAll: doc.getElementById('progressive-tutorial-skip-all'),
      tutorialNext: doc.getElementById('progressive-tutorial-next'),
      tutorialSpotlight: doc.getElementById('progressive-tutorial-spotlight'),
      tutorialCursor: doc.getElementById('progressive-tutorial-cursor'),
      tutorialCursorLabel: doc.getElementById('progressive-tutorial-cursor-label'),
    };

    let requirementsState = null;
    let active = false;
    let currentStepIndex = 0;
    let activeStepId = '';
    let leftCollapsedSeen = false;
    let leftExpandedSeen = false;
    let rightCollapsedSeen = false;
    let rightExpandedSeen = false;
    let sidebarOpenedOnce = false;
    let sidebarClosedOnce = false;
    let sidebarDemoStage = 'intro';
    let cortexSavedOnce = false;
    let apiDemoPrepared = false;
    let apiProviderSelected = false;
    let apiSelectedProviderValue = '';
    let apiSelectedProviderLabel = '';
    let apiServiceTyped = false;
    let apiPlaceholderTyped = false;
    let apiEditorSaved = false;
    const API_PLACEHOLDER_VALUE = 'sk-faber-tutorial-placeholder-not-real';
    const API_TUTORIAL_SERVICE_NAME = 'API de exemplo do tutorial';
    let apiKeyInputOriginalType = '';
    let apiTutorialKeyValue = '';
    const SIDEBAR_DEMO_PROJECT_ID = '__tutorial-demo-project__';
    const MAP_TOOL_HOVER_SELECTORS = [
      '#btn-map-tool-select',
      '#btn-map-tool-hand',
      '#btn-map-tool-add-group',
      '#btn-map-tool-add-card',
      '#btn-map-tool-add-image',
      '#btn-map-tool-add-decision',
    ];
    let hoveredSelectors = new Set();
    let hoveredMapSelectors = new Set();
    let tutorialCortexEntry = null;
    let tutorialMapIconClicked = false;
    let tutorialCreatedProjectId = '';
    let highlightedElements = [];
    let demoRunId = 0;
    let activeGuideSignature = '';
    let cursorPosition = {
      x: Math.max(180, Math.round((window.innerWidth || 1280) * 0.52)),
      y: Math.max(180, Math.round((window.innerHeight || 720) * 0.42)),
    };
    let typingRestoreEntries = new Map();
    let tutorialTypingInProgress = false;
    let pendingTutorialRender = false;
    let cursorSuppressed = false;
    let tutorialBaselineProjectIds = new Set();
    let allowTutorialSyntheticClick = false;
    const contextualModalSelectors = [
      '#cortex-modal',
      '#ai-settings-modal',
      '#welcome-project-modal',
      '#project-state-modal',
      '#project-file-modal',
      '#unsaved-exit-modal',
      '#faber-confirm-modal',
    ];

    function translate(key) {
      const locale = COPY[getLocale()] ? getLocale() : 'pt-BR';
      return COPY[locale][key] || COPY['pt-BR'][key] || key;
    }

    function getStorage() {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    }

    function readStorage(key, fallback = '') {
      const storage = getStorage();
      if (!storage) return fallback;
      try {
        const value = storage.getItem(key);
        return value == null ? fallback : value;
      } catch {
        return fallback;
      }
    }

    function writeStorage(key, value) {
      const storage = getStorage();
      if (!storage) return;
      try {
        if (value === '' || value == null) storage.removeItem(key);
        else storage.setItem(key, String(value));
      } catch {}
    }

    function isSidebarTutorialStep() {
      const current = steps()[currentStepIndex];
      return Boolean(active && current && current.id === 'sidebar');
    }

    function hasSelectedProject() {
      return Boolean(getSelectedProjectId());
    }

    function isMapTabOpen() {
      return Boolean(
        hasSelectedProject()
        && resolveElement('#btn-tab-map')
        && resolveElement('#btn-tab-map').classList.contains('active')
      );
    }

    function isLeftWorkspaceCollapsed() {
      const body = doc.body;
      return Boolean(body && body.classList && body.classList.contains('workspace-left-collapsed'));
    }

    function isRightWorkspaceCollapsed() {
      const body = doc.body;
      return Boolean(body && body.classList && body.classList.contains('workspace-right-collapsed'));
    }

    function getActiveProjects() {
      const projects = Array.isArray(getProjects()) ? getProjects() : [];
      return projects.filter((project) => project && !project.archivedAt && !project.deletedAt && !project.__tutorialPlaceholder);
    }

    function captureTutorialProjectBaseline() {
      tutorialBaselineProjectIds = new Set(
        getActiveProjects()
          .map((project) => project.id)
          .filter(Boolean)
      );
    }

    function hasCreatedProjectSinceTutorialStart() {
      return getActiveProjects().some((project) => project && project.id && !tutorialBaselineProjectIds.has(project.id));
    }

    function getTutorialCreatedProject() {
      if (tutorialCreatedProjectId) {
        const explicitProject = getActiveProjects().find((project) => project && project.id === tutorialCreatedProjectId);
        if (explicitProject) return explicitProject;
      }
      return getActiveProjects().find((project) => project && project.id && !tutorialBaselineProjectIds.has(project.id)) || null;
    }

    function hasTutorialReadyProject() {
      return Boolean(getTutorialCreatedProject());
    }

    function getTutorialCreatedProjectMapSelector() {
      const project = getTutorialCreatedProject();
      if (!project || !project.id) return '.project-mini-btn-map';
      if (window.CSS && typeof window.CSS.escape === 'function') {
        return `.project-item[data-project-id="${window.CSS.escape(project.id)}"] .project-mini-btn-map`;
      }
      return '.project-item.active .project-mini-btn-map';
    }

    function getNextMapHoverSelector() {
      return MAP_TOOL_HOVER_SELECTORS.find((selector) => !hoveredMapSelectors.has(selector)) || '';
    }

    function buildSidebarDemoProject() {
      return {
        id: SIDEBAR_DEMO_PROJECT_ID,
        name: translate('sidebarPlaceholderProject'),
        rootPath: '/tutorial/demo-restored-project',
        __tutorialPlaceholder: true,
      };
    }

    function getSidebarTutorialProjects() {
      if (!isSidebarTutorialStep()) return null;
      if (sidebarDemoStage != 'restored') return [];
      return [buildSidebarDemoProject()];
    }

    function getSidebarTutorialRows(mode) {
      if (!isSidebarTutorialStep()) return null;
      if (mode === 'archived') {
        if (sidebarDemoStage === 'intro') {
          return [{
            ...buildSidebarDemoProject(),
            archivedAt: new Date().toISOString(),
          }];
        }
        return [];
      }
      if (mode === 'deleted') {
        if (sidebarDemoStage === 'trashed') {
          return [{
            ...buildSidebarDemoProject(),
            deletedAt: new Date().toISOString(),
          }];
        }
        return [];
      }
      return null;
    }

    function dispatchTutorialProjectsChanged() {
      window.dispatchEvent(new CustomEvent('faber:tutorial-projects-changed'));
    }

    function dispatchTutorialCortexChanged() {
      window.dispatchEvent(new CustomEvent('faber:tutorial-cortex-changed'));
    }

    async function handleProjectStateAction(payload = {}) {
      if (!isSidebarTutorialStep()) return { handled: false };
      if (payload.projectId !== SIDEBAR_DEMO_PROJECT_ID) return { handled: false };
      if (payload.mode === 'archived' && payload.action === 'restore' && sidebarDemoStage === 'intro') {
        sidebarOpenedOnce = true;
        sidebarDemoStage = 'restored';
        syncTutorialRuntime();
        dispatchTutorialProjectsChanged();
        return { handled: true, closeModal: true };
      }
      if (payload.mode === 'deleted' && payload.action === 'delete' && sidebarDemoStage === 'trashed') {
        sidebarDemoStage = 'deleted';
        syncTutorialRuntime();
        dispatchTutorialProjectsChanged();
        return { handled: true, rerender: true };
      }
      return { handled: false };
    }

    async function handleProjectContextAction(action, projectId) {
      if (!isSidebarTutorialStep()) return false;
      if (projectId !== SIDEBAR_DEMO_PROJECT_ID) return false;
      if (action === 'trash' && sidebarDemoStage === 'restored') {
        sidebarDemoStage = 'trashed';
        syncTutorialRuntime();
        dispatchTutorialProjectsChanged();
        return true;
      }
      return action === 'rename' || action === 'archive';
    }

    function syncTutorialRuntime() {
      window.FaberTutorialRuntime = {
        isTutorialActive: () => active,
        isSidebarProjectDemoEnabled: () => isSidebarTutorialStep(),
        getProjectStateRows: (mode) => getSidebarTutorialRows(mode),
        getSidebarProjects: () => getSidebarTutorialProjects(),
        handleProjectStateAction,
        handleProjectContextAction,
        getTutorialCortexOverlay: () => (
          tutorialCortexEntry
            ? {
                topics: [{ id: 'geral', label: 'Geral' }],
                events: [tutorialCortexEntry],
              }
            : null
        ),
      };
    }

    function setVisible(element, visible) {
      if (!element) return;
      element.classList.toggle('hidden', !visible);
      element.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    function hasOpenContextualModal() {
      return contextualModalSelectors.some((selector) => {
        const element = resolveElement(selector);
        return isVisibleElement(element) && !element.classList.contains('hidden');
      });
    }

    function refreshTutorialContext() {
      if (!elements.tutorial) return;
      elements.tutorial.classList.toggle('progressive-tutorial--modal-open', hasOpenContextualModal());
    }

    function getViewportSize() {
      return {
        width: Math.max(window.innerWidth || 0, doc.documentElement?.clientWidth || 0, 1280),
        height: Math.max(window.innerHeight || 0, doc.documentElement?.clientHeight || 0, 720),
      };
    }

    function resolveElement(selector) {
      if (!selector) return null;
      try {
        return doc.querySelector(selector);
      } catch {
        return null;
      }
    }

    function resolveVisibleElement(selector) {
      if (!selector) return null;
      try {
        const elements = doc.querySelectorAll(selector);
        for (const el of elements) {
          if (isVisibleElement(el)) return el;
        }
        return null;
      } catch {
        return null;
      }
    }

    function isVisibleElement(element) {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function getElementLabel(element, fallback = '') {
      if (!element) return fallback;
      return (
        element.getAttribute('data-progressive-label')
        || element.getAttribute('data-faber-tooltip')
        || element.getAttribute('aria-label')
        || element.getAttribute('title')
        || (element.textContent || '').trim()
        || fallback
      );
    }

    function clearHighlights() {
      highlightedElements.forEach((element) => {
        element.classList.remove('progressive-target-active');
        element.classList.remove('progressive-target-pulse');
      });
      highlightedElements = [];
    }

    function highlightTargets(selectors = []) {
      clearHighlights();
      highlightedElements = selectors
        .map((selector) => resolveElement(selector))
        .filter((element) => isVisibleElement(element));
      highlightedElements.forEach((element) => element.classList.add('progressive-target-active'));
    }

    function getUnionRectFromSelectors(selectors = []) {
      const visible = selectors
        .map((selector) => resolveElement(selector))
        .filter((element) => isVisibleElement(element));
      if (!visible.length) return null;
      return visible.reduce((acc, element) => {
        const rect = element.getBoundingClientRect();
        if (!acc) {
          return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        }
        return {
          left: Math.min(acc.left, rect.left),
          top: Math.min(acc.top, rect.top),
          right: Math.max(acc.right, rect.right),
          bottom: Math.max(acc.bottom, rect.bottom),
        };
      }, null);
    }

    function showSpotlightRect(rect, padding = 10) {
      refreshTutorialContext();
      if (!elements.tutorialSpotlight || !rect) {
        setVisible(elements.tutorialSpotlight, false);
        return;
      }
      elements.tutorialSpotlight.style.setProperty('--spotlight-left', `${Math.max(10, rect.left - padding)}px`);
      elements.tutorialSpotlight.style.setProperty('--spotlight-top', `${Math.max(10, rect.top - padding)}px`);
      elements.tutorialSpotlight.style.setProperty('--spotlight-width', `${Math.max(40, (rect.right - rect.left) + (padding * 2))}px`);
      elements.tutorialSpotlight.style.setProperty('--spotlight-height', `${Math.max(40, (rect.bottom - rect.top) + (padding * 2))}px`);
      setVisible(elements.tutorialSpotlight, true);
    }

    function showSpotlightAroundElement(element) {
      if (!isVisibleElement(element)) {
        setVisible(elements.tutorialSpotlight, false);
        return;
      }
      const rect = element.getBoundingClientRect();
      showSpotlightRect(rect, 10);
    }

    function showSpotlightForGuide(guide) {
      if (!guide) {
        hideSpotlight();
        return;
      }
      const revealSelectors = Array.isArray(guide.revealSelectors) && guide.revealSelectors.length
        ? guide.revealSelectors
        : guide.targets || [];
      const unionRect = getUnionRectFromSelectors(revealSelectors);
      const padding = guide.revealPadding == null ? 18 : Number(guide.revealPadding);
      showSpotlightRect(unionRect, Number.isFinite(padding) ? padding : 18);
    }

    function hideSpotlight() {
      setVisible(elements.tutorialSpotlight, false);
    }

    function showCursor() {
      cursorSuppressed = false;
      if (elements.tutorialCursor) setVisible(elements.tutorialCursor, true);
      if (elements.tutorialCursorLabel && elements.tutorialCursorLabel.textContent) {
        setVisible(elements.tutorialCursorLabel, true);
      }
    }

    function hideCursor() {
      cursorSuppressed = true;
      if (elements.tutorialCursor) setVisible(elements.tutorialCursor, false);
      if (elements.tutorialCursorLabel) setVisible(elements.tutorialCursorLabel, false);
    }

    function pulseElement(element) {
      if (!element) return;
      element.classList.remove('progressive-target-pulse');
      void element.offsetWidth;
      element.classList.add('progressive-target-pulse');
      window.setTimeout(() => {
        element.classList.remove('progressive-target-pulse');
      }, 720);
    }

    function restoreTypedFields() {
      typingRestoreEntries.forEach((value, element) => {
        try {
          if (
            active
            && activeStepId === 'apis'
            && (
              element === resolveElement('#ai-settings-editor-provider')
              || element === resolveElement('#ai-settings-editor-key')
            )
          ) {
            return;
          }
          if ('value' in element) {
            element.value = value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            element.textContent = value;
          }
        } catch {}
      });
      typingRestoreEntries = new Map();
    }

    function rememberFieldValue(element) {
      if (!element || typingRestoreEntries.has(element)) return;
      typingRestoreEntries.set(element, 'value' in element ? element.value : element.textContent || '');
    }

    function dispatchNativeChange(element) {
      if (!element) return;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function getSelectOptionLabel(select) {
      if (!select || !select.options) return '';
      const selectedIndex = typeof select.selectedIndex === 'number' ? select.selectedIndex : -1;
      const option = selectedIndex >= 0 ? select.options[selectedIndex] : null;
      return option ? String(option.textContent || option.label || option.value || '').trim() : '';
    }

    function syncTutorialApiProviderSelection(options = {}) {
      const select = resolveElement('#ai-settings-add-provider');
      if (!select || !('value' in select)) return false;
      const value = String(select.value || '').trim();
      const label = getSelectOptionLabel(select) || value;
      if (!value && !label) return false;
      apiSelectedProviderValue = value;
      apiSelectedProviderLabel = label;
      if (options.markSelected) apiProviderSelected = true;
      return true;
    }

    function getTutorialApiServiceName() {
      const label = String(apiSelectedProviderLabel || '').trim();
      if (label) return label;
      const value = String(apiSelectedProviderValue || '').trim();
      if (value) return value;
      return API_TUTORIAL_SERVICE_NAME;
    }

    function revealTutorialApiKeyField() {
      const input = resolveElement('#ai-settings-editor-key');
      if (!input) return;
      if (!apiKeyInputOriginalType) apiKeyInputOriginalType = String(input.getAttribute('type') || input.type || 'password');
      input.setAttribute('type', 'text');
    }

    function restoreTutorialFieldDecorators() {
      const input = resolveElement('#ai-settings-editor-key');
      if (input && apiKeyInputOriginalType) input.setAttribute('type', apiKeyInputOriginalType);
      apiKeyInputOriginalType = '';
    }

    async function scrollModalBodyToElement(selector, options = {}) {
      const runId = options.runId;
      const element = resolveElement(selector);
      const body = resolveElement('#ai-settings-modal .ai-settings-modal__body');
      if (!element || !body || (runId != null && runId !== demoRunId)) return false;
      try {
        element.scrollIntoView({
          block: options.block || 'center',
          inline: 'nearest',
          behavior: 'smooth',
        });
      } catch {
        const bodyRect = body.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        body.scrollTop += (elementRect.top - bodyRect.top) - Math.max(80, Math.round(bodyRect.height * 0.28));
      }
      return wait(options.afterDelay || 220, runId);
    }

    function buildTutorialApiKeyValue() {
      if (apiTutorialKeyValue) return apiTutorialKeyValue;
      const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let suffix = '';
      for (let index = 0; index < 24; index += 1) {
        suffix += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
      }
      apiTutorialKeyValue = `sk-faber-${suffix}`;
      return apiTutorialKeyValue;
    }

    function getAlternateTutorialLocale(currentLocale) {
      const locale = String(currentLocale || 'pt-BR');
      if (locale === 'pt-BR') return 'en-US';
      if (locale === 'en-US') return 'es-ES';
      return 'pt-BR';
    }

    function setCursorLabel(label) {
      if (!elements.tutorialCursorLabel) return;
      if (!label) {
        setVisible(elements.tutorialCursorLabel, false);
        return;
      }
      elements.tutorialCursorLabel.textContent = label;
      setVisible(elements.tutorialCursorLabel, true);
      const { width, height } = getViewportSize();
      const bubbleRect = elements.tutorialCursorLabel.getBoundingClientRect();
      const bubbleWidth = Math.max(120, Math.round(bubbleRect.width || 160));
      const bubbleHeight = Math.max(34, Math.round(bubbleRect.height || 40));
      const gutter = 18;
      let left = Math.round(cursorPosition.x + gutter);
      let top = Math.round(cursorPosition.y - (bubbleHeight / 2));
      let side = 'right';
      if ((left + bubbleWidth + 16) > width) {
        left = Math.round(cursorPosition.x - bubbleWidth - gutter);
        side = 'left';
      }
      if (left < 12) {
        left = 12;
        side = 'right';
      }
      if ((left + bubbleWidth + 12) > width) {
        left = Math.max(12, width - bubbleWidth - 12);
      }
      top = Math.max(12, Math.min(height - bubbleHeight - 12, top));
      elements.tutorialCursorLabel.dataset.side = side;
      elements.tutorialCursorLabel.style.left = `${left}px`;
      elements.tutorialCursorLabel.style.top = `${top}px`;
    }

    function moveCursorInstant(x, y, label = '') {
      cursorPosition = { x, y };
      if (elements.tutorialCursor) {
        elements.tutorialCursor.classList.remove('is-clicking');
        elements.tutorialCursor.style.left = `${Math.round(x)}px`;
        elements.tutorialCursor.style.top = `${Math.round(y)}px`;
        elements.tutorialCursor.style.transitionDuration = '0ms';
        if (!cursorSuppressed) setVisible(elements.tutorialCursor, true);
      }
      setCursorLabel(label);
    }

    function animateCursorClick() {
      if (!elements.tutorialCursor) return;
      elements.tutorialCursor.classList.remove('is-clicking');
      void elements.tutorialCursor.offsetWidth;
      elements.tutorialCursor.classList.add('is-clicking');
      window.setTimeout(() => {
        if (elements.tutorialCursor) elements.tutorialCursor.classList.remove('is-clicking');
      }, 260);
    }

    async function animateCursorToAndClick(selector, options = {}) {
      const runId = options.runId;
      const reached = await animateCursorTo(selector, options);
      if (!reached) return false;
      const element = resolveElement(selector);
      if (!isVisibleElement(element) || (runId != null && runId !== demoRunId)) return false;
      animateCursorClick();
      const keepGoing = await wait(options.clickDelay || 120, runId);
      if (!keepGoing) return false;
      if (typeof element.click === 'function') element.click();
      await wait(options.afterDelay || 180, runId);
      refreshTutorialContext();
      if (active) renderStep();
      return true;
    }

    function wait(ms, runId) {
      return new Promise((resolve) => {
        window.setTimeout(() => {
          resolve(runId === demoRunId && active);
        }, ms);
      });
    }

    async function animateCursorTo(selector, options = {}) {
      const runId = options.runId;
      let element = resolveVisibleElement(selector) || resolveElement(selector);
      if (!element && typeof selector === 'string') {
        element = document.querySelector(selector); // Fallback force
      }
      if (!element) {
        setCursorLabel(`DEBUG: Element ${selector} not found in DOM`);
        return false;
      }
      if (runId != null && runId !== demoRunId) {
        setCursorLabel(`DEBUG: animateCursorTo aborted due to runId`);
        return false;
      }
      const rect = element.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2 + (options.offsetX || 0));
      const y = Math.round(rect.top + rect.height / 2 + (options.offsetY || 0));
      cursorPosition = { x, y };
      if (elements.tutorialCursor) {
        elements.tutorialCursor.classList.remove('is-clicking');
        elements.tutorialCursor.style.transitionDuration = `${options.duration || 480}ms`;
        elements.tutorialCursor.style.left = `${x}px`;
        elements.tutorialCursor.style.top = `${y}px`;
        if (!cursorSuppressed) setVisible(elements.tutorialCursor, true);
      }
      setCursorLabel(options.label || getElementLabel(element));
      if (options.focusTarget) showSpotlightAroundElement(element);
      const stillActive = await wait((options.duration || 480) + 70, runId);
      if (options.pulse) pulseElement(element);
      return stillActive;
    }
    async function animateCursorToCanvasNode(nodeIndex, options = {}) {
      if (!active) return false;
      const { runId, mapController } = options;
      if (!mapController) return false;

      const canvasController = typeof mapController.getCanvasController === 'function' ? mapController.getCanvasController() : null;
      if (!canvasController) return false;

      const mapContainer = document.getElementById('workspace-map-region');
      if (!mapContainer) return false;

      let tracking = true;
      let initialMoveDone = false;

      if (runId !== demoRunId) {
        setCursorLabel(`DEBUG: runId ${runId} !== demoRunId ${demoRunId}`);
      } else {
        setCursorLabel('DEBUG: starting loop');
      }

      // Un-cancellable tracking loop for canvas coordinates
      (async () => {
        while (tracking && runId === demoRunId && active) {
          try {
            const mapData = typeof canvasController.getMapData === 'function' ? canvasController.getMapData() : null;
            if (!mapData) {
              setCursorLabel('DEBUG: mapData is null');
            } else if (!mapData.nodes || mapData.nodes.length === 0) {
              setCursorLabel('DEBUG: mapData.nodes is empty');
            } else if (!mapData.nodes[nodeIndex]) {
              setCursorLabel(`DEBUG: nodeIndex ${nodeIndex} not found. Total nodes: ${mapData.nodes.length}`);
            } else {
              const node = mapData.nodes[nodeIndex];
              const panOffset = typeof mapController.getPanOffset === 'function' ? mapController.getPanOffset() : { x: 0, y: 0 };
              const zoomLevel = typeof mapController.getZoomLevel === 'function' ? mapController.getZoomLevel() : 1;
              const rect = mapContainer.getBoundingClientRect();
              
              // Edit button is approx at top-right (width=220, height=120)
              const targetX = node.position.x + 220 - 24;
              const targetY = node.position.y + 24;

              const screenX = Math.round(rect.left + panOffset.x + (targetX * zoomLevel));
              const screenY = Math.round(rect.top + panOffset.y + (targetY * zoomLevel));

              cursorPosition = { x: screenX, y: screenY };
              const cursor = elements.tutorialCursor;
              if (cursor) {
                if (!initialMoveDone) {
                  cursor.style.transitionDuration = '480ms';
                  initialMoveDone = true;
                } else {
                  cursor.style.transitionDuration = '100ms';
                }
                if (isNaN(screenX) || isNaN(screenY)) {
                  setCursorLabel(`DEBUG: NaN screen coords. panX=${panOffset.x}, zoom=${zoomLevel}`);
                } else {
                  cursor.style.left = `${screenX}px`;
                  cursor.style.top = `${screenY}px`;
                  if (!cursorSuppressed) setVisible(elements.tutorialCursor, true);
                  setCursorLabel(options.label || 'Clique no ícone de lápis para editar');
                }
              } else {
                 setCursorLabel('DEBUG: elements.tutorialCursor is null');
              }
            }
          } catch (e) {
            setCursorLabel('DEBUG ERROR: ' + e.message);
          }
          await delay(50);
        }
      })();
      
      const stillActive = await wait((options.duration || 480) + 70, runId);
      return stillActive;
    }


    async function typeInto(selector, text, options = {}) {
      const runId = options.runId;
      const element = resolveElement(selector);
      if (!isVisibleElement(element) || !('value' in element) || (runId != null && runId !== demoRunId)) return false;
      if (!options.preserveValue) rememberFieldValue(element);
      tutorialTypingInProgress = true;
      pendingTutorialRender = false;
      element.focus({ preventScroll: true });
      if (options.focusTarget) showSpotlightAroundElement(element);
      setCursorLabel(options.label || getElementLabel(element));
      const seed = options.clearFirst === false ? String(element.value || '') : '';
      try {
        element.value = seed;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        for (let index = 0; index < text.length; index += 1) {
          if (runId != null && runId !== demoRunId) return false;
          element.value = `${seed}${text.slice(0, index + 1)}`;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          const keepGoing = await wait(options.typingDelay || 24, runId);
          if (!keepGoing) return false;
        }
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      } finally {
        tutorialTypingInProgress = false;
        if (pendingTutorialRender && active) {
          pendingTutorialRender = false;
          window.setTimeout(() => {
            if (active && !tutorialTypingInProgress) renderStep();
          }, 0);
        }
      }
    }

    function waitForUserInteraction(selector, runId) {
      return new Promise((resolve) => {
        const checkRun = setInterval(() => {
          if (runId != null && runId !== demoRunId) {
            clearInterval(checkRun);
            resolve(false);
          }
        }, 100);

        const handler = (e) => {
          const el = resolveElement(selector);
          if (el && (e.target === el || el.contains(e.target))) {
            window.removeEventListener('click', handler, true);
            window.removeEventListener('mousedown', handler, true);
            clearInterval(checkRun);
            resolve(true);
          }
        };
        window.addEventListener('click', handler, true);
        window.addEventListener('mousedown', handler, true);
      });
    }

    async function runAction(name) {
      if (!name || typeof actions[name] !== 'function') return;
      await actions[name]();
      refreshTutorialContext();
      await wait(260);
    }

    async function stepPause(runId, ms = 220) {
      return wait(ms, runId);
    }

    function buildPanelCards() {
      return [
        { title: translate('panelLeftTitle'), body: translate('mockPanelLeft') },
        { title: translate('panelCenterTitle'), body: translate('mockPanelCenter') },
        { title: translate('panelRightTitle'), body: translate('mockPanelRight') },
      ].map((item) => (
        `<article class="progressive-mini-card"><small>${item.title}</small><strong>${item.body}</strong></article>`
      )).join('');
    }

    function buildMapToolHoverHint(selector) {
      const element = resolveElement(selector);
      const label = getElementLabel(element, 'Ferramenta do mapa');
      const locale = String(getLocale() || 'pt-BR');
      if (locale === 'en-US') return `Hover over "${label}" to learn what this map tool does.`;
      if (locale === 'es-ES') return `Pasa el mouse sobre "${label}" para entender qué hace esta herramienta del mapa.`;
      return `Passe o mouse sobre "${label}" para entender o que essa ferramenta do mapa faz.`;
    }

    function buildApiPlaceholderHint() {
      const locale = String(getLocale() || 'pt-BR');
      if (locale === 'en-US') return 'The tutorial fills a fake placeholder API key here, saves it, and then moves on automatically.';
      if (locale === 'es-ES') return 'El tutorial completa aquí una clave placeholder falsa, la guarda y luego continúa automáticamente.';
      return 'O tutorial preenche aqui uma chave placeholder falsa, salva e depois segue automaticamente.';
    }

    function getCurrentPanelGuide() {
      if (!leftCollapsedSeen) {
        return {
          signature: 'panels:left:collapse',
          targets: ['#workspace-collapse-left'],
          revealSelectors: ['.panel-left'],
          revealPadding: 14,
          hint: translate('panelsLeftCollapse'),
          demo: async ({ runId }) => {
            await animateCursorTo('#workspace-collapse-left', { runId, pulse: true, label: translate('panelsLeftCollapse') });
          },
        };
      }
      if (!leftExpandedSeen) {
        return {
          signature: 'panels:left:expand',
          targets: ['#workspace-collapse-left'],
          revealSelectors: ['.panel-left'],
          revealPadding: 14,
          hint: translate('panelsLeftExpand'),
          demo: async ({ runId }) => {
            await animateCursorTo('#workspace-collapse-left', { runId, pulse: true, label: translate('panelsLeftExpand') });
          },
        };
      }
      if (!rightCollapsedSeen) {
        return {
          signature: 'panels:right:collapse',
          targets: ['#workspace-collapse-right'],
          revealSelectors: ['.panel-right'],
          revealPadding: 14,
          hint: translate('panelsRightCollapse'),
          demo: async ({ runId }) => {
            await animateCursorTo('#workspace-collapse-right', { runId, pulse: true, label: translate('panelsRightCollapse') });
          },
        };
      }
      if (!rightExpandedSeen) {
        return {
          signature: 'panels:right:expand',
          targets: ['#workspace-collapse-right'],
          revealSelectors: ['.panel-right'],
          revealPadding: 14,
          hint: translate('panelsRightExpand'),
          demo: async ({ runId }) => {
            await animateCursorTo('#workspace-collapse-right', { runId, pulse: true, label: translate('panelsRightExpand') });
          },
        };
      }
      return {
        signature: 'panels:intro:complete',
        targets: ['.panel-left', '.panel-center', '.panel-right'],
        revealSelectors: ['.panel-left', '.panel-center', '.panel-right'],
        revealPadding: 10,
        hint: translate('panelsHint'),
        demo: async ({ runId }) => {
          await animateCursorTo('#workspace-collapse-left', { runId, pulse: true, label: translate('panelLeftTitle') });
        },
      };
    }

    function getLeftPanelHoverGuide() {
      const nextHoverSelector = LEFT_PANEL_HOVER_SELECTORS.find((selector) => !hoveredSelectors.has(selector))
        || LEFT_PANEL_HOVER_SELECTORS[LEFT_PANEL_HOVER_SELECTORS.length - 1];
      return {
        signature: `left-tools:hover:${nextHoverSelector}`,
        targets: [nextHoverSelector],
        revealSelectors: ['.left-bottom-actions'],
        revealPadding: 10,
        hint: translate('panelsHoverSingle'),
        demo: async ({ runId }) => {
          await animateCursorTo(nextHoverSelector, { runId, pulse: true, label: getElementLabel(resolveElement(nextHoverSelector), '') });
        },
      };
    }

    function getSidebarGuide() {
      const demoMenuSelector = '.project-item[data-project-id="' + SIDEBAR_DEMO_PROJECT_ID + '"] .project-mini-btn-menu';
      const demoTrashActionSelector = '#project-context-menu [data-action="trash"]';

      if (isModalOpen('#project-state-modal')) {
        if (sidebarDemoStage === 'intro') {
          return {
            signature: 'sidebar:archived:restore',
            targets: ['.project-state-restore'],
            revealSelectors: ['#project-state-modal'],
            revealPadding: 14,
            hint: translate('sidebarRestoreHint'),
            demo: async ({ runId }) => {
              await animateCursorTo('.project-state-restore', { runId, pulse: true, label: getElementLabel(resolveElement('.project-state-restore'), '') });
            },
          };
        }
        if (sidebarDemoStage === 'trashed') {
          return {
            signature: 'sidebar:trash:delete',
            targets: ['.project-state-clear'],
            revealSelectors: ['#project-state-modal'],
            revealPadding: 14,
            hint: translate('sidebarDeleteHint'),
            demo: async ({ runId }) => {
              await animateCursorTo('.project-state-clear', { runId, pulse: true, label: getElementLabel(resolveElement('.project-state-clear'), '') });
            },
          };
        }
        return {
          signature: 'sidebar:trash:close',
          targets: ['#project-state-modal-close', '#project-state-modal [data-close="1"]'].filter((selector) => isVisibleElement(resolveElement(selector))),
          revealSelectors: ['#project-state-modal'],
          revealPadding: 14,
          hint: translate('sidebarCloseHint'),
          demo: async ({ runId }) => {
            await animateCursorTo('#project-state-modal-close', { runId, pulse: true, label: getElementLabel(resolveElement('#project-state-modal-close'), '') });
          },
        };
      }

      if (sidebarDemoStage === 'restored' && isVisibleElement(resolveElement(demoTrashActionSelector))) {
        return {
          signature: 'sidebar:project:trash-action',
          targets: [demoTrashActionSelector],
          revealSelectors: ['#project-context-menu', '.panel-left'],
          revealPadding: 12,
          hint: translate('sidebarProjectHint'),
          demo: async ({ runId }) => {
            await animateCursorTo(demoTrashActionSelector, { runId, pulse: true, label: getElementLabel(resolveElement(demoTrashActionSelector), '') });
          },
        };
      }

      if (sidebarDemoStage === 'restored') {
        return {
          signature: 'sidebar:project:menu',
          targets: [demoMenuSelector],
          revealSelectors: ['.panel-left'],
          revealPadding: 12,
          hint: translate('sidebarProjectHint'),
          demo: async ({ runId }) => {
            await animateCursorTo(demoMenuSelector, { runId, pulse: true, label: getElementLabel(resolveElement(demoMenuSelector), '') });
          },
        };
      }

      if (sidebarDemoStage === 'trashed' || sidebarDemoStage === 'deleted') {
        return {
          signature: 'sidebar:open-trash',
          targets: ['#btn-trash-projects'],
          revealSelectors: ['.left-bottom-actions'],
          revealPadding: 10,
          hint: translate('sidebarOpenTrashHint'),
          demo: async ({ runId }) => {
            await animateCursorTo('#btn-trash-projects', { runId, pulse: true, label: getElementLabel(resolveElement('#btn-trash-projects'), '') });
          },
        };
      }

      return {
        signature: 'sidebar:open-archived',
        targets: ['#btn-archived-projects'],
        revealSelectors: ['.left-bottom-actions'],
        revealPadding: 10,
        hint: translate('sidebarIntroHint'),
        demo: async ({ runId }) => {
          await animateCursorTo('#btn-archived-projects', { runId, pulse: true, label: getElementLabel(resolveElement('#btn-archived-projects'), '') });
        },
      };
    }

    function isModalOpen(selector) {
      const element = resolveElement(selector);
      return isVisibleElement(element) && !element.classList.contains('hidden');
    }

    function getCortexGuide() {
      if (!isModalOpen('#cortex-modal')) {
        return {
          signature: 'cortex:open',
          targets: ['#btn-cortex-mode'],
          revealSelectors: ['.panel-left'],
          revealPadding: 14,
          hint: translate('openCortexHint'),
          demo: async ({ runId }) => {
            await animateCursorTo('#btn-cortex-mode', { runId, pulse: true, label: getElementLabel(resolveElement('#btn-cortex-mode'), 'Cortex') });
          },
        };
      }
      if (cortexSavedOnce) {
        return {
          signature: 'cortex:close',
          targets: ['#cortex-modal-close', '#cortex-modal-backdrop'].filter((selector) => isVisibleElement(resolveElement(selector))),
          revealSelectors: ['#cortex-modal'],
          revealPadding: 18,
          hint: translate('cortexCloseHint'),
          demo: async ({ runId }) => {
            await animateCursorTo('#cortex-modal-close', { runId, pulse: true, label: getElementLabel(resolveElement('#cortex-modal-close'), 'Fechar Cortex') });
          },
        };
      }
      const inputValue = String(resolveElement('#cortex-input') && resolveElement('#cortex-input').value || '').trim();
      if (inputValue) {
        return {
          signature: 'cortex:send',
          targets: ['#cortex-send'],
          revealSelectors: ['#cortex-modal'],
          revealPadding: 18,
          hint: translate('cortexAddHint'),
          demo: async ({ runId }) => {
            await animateCursorTo('#cortex-send', { runId, pulse: true, label: getElementLabel(resolveElement('#cortex-send'), 'Adicionar') });
          },
        };
      }
      return {
        signature: 'cortex:input',
        targets: ['#cortex-input'],
        revealSelectors: ['#cortex-modal'],
        revealPadding: 18,
        hint: translate('cortexHint'),
        demo: async ({ runId }) => {
          const reached = await animateCursorTo('#cortex-input', { runId, pulse: true, label: 'Cortex' });
          if (!reached) return;
          await typeInto('#cortex-input', translate('mockRule'), { runId, preserveValue: true });
          window.setTimeout(() => {
            if (active) renderStep();
          }, 120);
        },
      };
    }

    function getApiGuide() {
      if (apiDemoPrepared && !isModalOpen('#ai-settings-modal')) {
        return {
          signature: 'apis:done',
          targets: [],
          revealSelectors: ['.panel-left', '.panel-center', '.panel-right'],
          revealPadding: 12,
          hint: translate('apiSaveHint'),
          demo: async ({ runId }) => {
            await stepPause(runId, 120);
          },
        };
      }
      if (isVisibleElement(resolveElement('#ai-settings-save')) && apiEditorSaved && !isVisibleElement(resolveElement('#ai-settings-editor-key'))) {
        return {
          signature: 'apis:save-modal',
          targets: ['#ai-settings-save'],
          revealSelectors: ['#ai-settings-modal'],
          revealPadding: 18,
          hint: translate('apiSaveHint'),
          demo: async ({ runId }) => {
            await scrollModalBodyToElement('#ai-settings-save', { runId, block: 'end', afterDelay: 180 });
            await animateCursorTo('#ai-settings-save', {
              runId,
              pulse: true,
              duration: 900,
              label: 'Salvar',
            });
          },
        };
      }
      if (!isModalOpen('#ai-settings-modal')) {
        return {
          signature: 'apis:open-settings',
          targets: ['#btn-project-settings'],
          revealSelectors: ['.panel-left'],
          revealPadding: 14,
          hint: translate('openSettingsHint'),
          demo: async ({ runId }) => {
            await animateCursorTo('#btn-project-settings', {
              runId,
              pulse: true,
              duration: 900,
              label: getElementLabel(resolveElement('#btn-project-settings'), 'Configurações'),
            });
          },
        };
      }
      if (isVisibleElement(resolveElement('#ai-settings-open-apis'))) {
        return {
          signature: 'apis:home-card',
          targets: ['#ai-settings-open-apis'],
          revealSelectors: ['#ai-settings-modal'],
          revealPadding: 18,
          hint: translate('openApisHint'),
          demo: async ({ runId }) => {
            await animateCursorTo('#ai-settings-open-apis', {
              runId,
              pulse: true,
              duration: 900,
              label: getElementLabel(resolveElement('#ai-settings-open-apis strong'), 'APIs'),
            });
          },
        };
      }
      if (isVisibleElement(resolveElement('#ai-settings-editor-save')) && apiServiceTyped && apiPlaceholderTyped) {
        return {
          signature: 'apis:editor-save',
          targets: ['#ai-settings-editor-save'],
          revealSelectors: ['#ai-settings-modal'],
          revealPadding: 18,
          hint: 'Agora clique em Salvar edição para mostrar como esse cadastro seria confirmado.',
          demo: async ({ runId }) => {
            await scrollModalBodyToElement('#ai-settings-editor-save', { runId, block: 'center', afterDelay: 180 });
            await animateCursorTo('#ai-settings-editor-save', {
              runId,
              pulse: true,
              duration: 900,
              label: 'Salvar edição',
            });
          },
        };
      }
      if (isVisibleElement(resolveElement('#ai-settings-editor-key')) && apiServiceTyped && !apiPlaceholderTyped) {
        return {
          signature: 'apis:editor-key',
          targets: ['#ai-settings-editor-key'],
          revealSelectors: ['#ai-settings-modal'],
          revealPadding: 18,
          hint: buildApiPlaceholderHint(),
          demo: async ({ runId }) => {
            const input = resolveElement('#ai-settings-editor-key');
            if (input && input.getAttribute('placeholder') !== 'Aqui coloque sua chave de API') {
              input.setAttribute('placeholder', 'Aqui coloque sua chave de API');
            }
            revealTutorialApiKeyField();
            await scrollModalBodyToElement('#ai-settings-editor-key', { runId, block: 'center', afterDelay: 180 });
            const reached = await animateCursorTo('#ai-settings-editor-key', {
              runId,
              pulse: true,
              duration: 900,
              label: 'Aqui coloque sua chave de API',
            });
            if (!reached || apiPlaceholderTyped) return;
            const typed = await typeInto('#ai-settings-editor-key', buildTutorialApiKeyValue(), {
              runId,
              preserveValue: true,
              typingDelay: 48,
              label: 'API Key de exemplo',
            });
            if (!typed) return;
            apiPlaceholderTyped = true;
            refreshTutorialContext();
            if (active) renderStep();
          },
        };
      }
      if (isVisibleElement(resolveElement('#ai-settings-editor-provider')) && !apiServiceTyped) {
        return {
          signature: 'apis:editor-provider',
          targets: ['#ai-settings-editor-provider'],
          revealSelectors: ['#ai-settings-modal'],
          revealPadding: 18,
          hint: `Agora o tutorial vai escrever "${getTutorialApiServiceName()}" no campo Serviço para refletir a escolha feita acima.`,
          demo: async ({ runId }) => {
            await animateCursorTo('#ai-settings-editor-provider', {
              runId,
              pulse: true,
              duration: 900,
              label: getTutorialApiServiceName(),
            });
          },
        };
      }
      if (isVisibleElement(resolveElement('#ai-settings-add-api')) && apiProviderSelected) {
        return {
          signature: 'apis:add-api',
          targets: ['#ai-settings-add-api'],
          revealSelectors: ['#ai-settings-modal'],
          revealPadding: 18,
          hint: 'Agora clique em Adicionar API para abrir um cadastro novo de exemplo.',
          demo: async ({ runId }) => {
            await animateCursorTo('#ai-settings-add-api', {
              runId,
              pulse: true,
              duration: 900,
              label: 'Adicionar API',
            });
          },
        };
      }
      return {
        signature: 'apis:provider',
        targets: ['#ai-settings-add-provider'],
        revealSelectors: ['#ai-settings-modal'],
        revealPadding: 18,
        hint: 'Clique nesse seletor e escolha qualquer serviço. O tutorial vai usar exatamente essa escolha como exemplo, sem editar a API que já está ativa.',
        demo: async ({ runId }) => {
          await animateCursorTo('#ai-settings-add-provider', {
            runId,
            pulse: true,
            duration: 900,
            label: getElementLabel(resolveElement('#ai-settings-add-provider'), 'Escolha um serviço'),
          });
        },
      };
    }

    function getMapGuide() {
      if (!tutorialMapIconClicked) {
        const tutorialSelector = getTutorialCreatedProjectMapSelector();
        const selector = resolveElement(tutorialSelector)
          ? tutorialSelector
          : '.project-mini-btn-map';
        return {
          signature: 'map:open-project-map',
          targets: [selector],
          revealSelectors: ['.panel-left'],
          revealPadding: 14,
          hint: translate('mapHint'),
          demo: async ({ runId }) => {
            await animateCursorTo(selector, {
              runId,
              pulse: true,
              label: getElementLabel(resolveElement(selector), 'Clique no Mapa da Aplicação'),
            });
          },
        };
      }

      if (!isLeftWorkspaceCollapsed()) {
        return {
          signature: 'map:collapse-left',
          targets: ['#workspace-collapse-left'],
          revealSelectors: ['#workspace-collapse-left', '#workspace-map-region', '.panel-left'],
          revealPadding: 16,
          hint: translate('mapHint'),
          demo: async ({ runId }) => {
            await animateCursorTo('#workspace-collapse-left', {
              runId,
              pulse: true,
              label: getElementLabel(resolveElement('#workspace-collapse-left'), 'Clique para recolher painel esquerdo'),
            });
          },
        };
      }

      if (!isRightWorkspaceCollapsed()) {
        return {
          signature: 'map:collapse-right',
          targets: ['#workspace-collapse-right'],
          revealSelectors: ['#workspace-collapse-right', '#workspace-map-region', '.panel-right'],
          revealPadding: 16,
          hint: translate('mapHint'),
          demo: async ({ runId }) => {
            await animateCursorTo('#workspace-collapse-right', {
              runId,
              pulse: true,
              label: getElementLabel(resolveElement('#workspace-collapse-right'), 'Clique para recolher painel direito'),
            });
          },
        };
      }

      const nextHoverSelector = getNextMapHoverSelector();
      if (nextHoverSelector) {
        return {
          signature: `map:hover:${nextHoverSelector}`,
          targets: [nextHoverSelector],
          revealSelectors: ['#workspace-map-region'],
          revealPadding: 16,
          hint: buildMapToolHoverHint(nextHoverSelector),
          demo: async ({ runId }) => {
            const element = resolveElement(nextHoverSelector);
            await animateCursorTo(nextHoverSelector, {
              runId,
              pulse: true,
              label: getElementLabel(element, element && element.getAttribute ? (element.getAttribute('data-faber-tooltip') || element.getAttribute('title') || 'Ferramenta do mapa') : 'Ferramenta do mapa'),
            });
          },
        };
      }

      return {
        signature: 'map:opened',
        targets: ['#workspace-map-region'],
        revealSelectors: ['#workspace-map-region'],
        revealPadding: 16,
        hint: translate('mapHint'),
        demo: async ({ runId }) => {
          await animateCursorTo('#workspace-map-region', { runId, pulse: true, label: 'Mapa da aplicação' });
        },
      };
    }

    function getStepGuide(step) {
      if (!step) return { signature: '', targets: [], hint: '', demo: null };
      if (step.id === 'panels') return getCurrentPanelGuide();
      if (step.id === 'left-tools') return getLeftPanelHoverGuide();
      if (step.id === 'sidebar') return getSidebarGuide();
      if (step.id === 'cortex') return getCortexGuide();
      if (step.id === 'apis') return getApiGuide();
      if (step.id === 'map-intro') return getMapGuide();
      return {
        signature: step.id,
        targets: typeof step.targets === 'function' ? step.targets() : [],
        revealSelectors: typeof step.revealSelectors === 'function' ? step.revealSelectors() : (step.revealSelectors || []),
        revealPadding: step.revealPadding,
        hint: step.hint || '',
        demo: step.demo || null,
      };
    }

    function steps() {
      return [
        {
          id: 'panels',
          title: translate('panelsTitle'),
          body: translate('panelsBody'),
          hint: translate('panelsHint'),
          checklist: () => [
            { label: translate('panelsLeft'), done: leftCollapsedSeen && leftExpandedSeen },
            { label: translate('panelsRight'), done: rightCollapsedSeen && rightExpandedSeen },
          ],
          canAdvance: () => (
            leftCollapsedSeen && leftExpandedSeen && rightCollapsedSeen && rightExpandedSeen
          ),
          preview: () => `<div class="progressive-card-grid">${buildPanelCards()}</div>`,
          targets: () => getCurrentPanelGuide().targets,
          demo: async ({ runId }) => {
            await getCurrentPanelGuide().demo({ runId });
          },
        },
        {
          id: 'left-tools',
          title: translate('leftToolsTitle'),
          body: translate('leftToolsBody'),
          hint: translate('leftToolsHint'),
          checklist: () => [
            { label: translate('panelsHover'), done: hoveredSelectors.size >= LEFT_PANEL_HOVER_SELECTORS.length },
          ],
          canAdvance: () => hoveredSelectors.size >= LEFT_PANEL_HOVER_SELECTORS.length,
          preview: () => `<div class="progressive-card-grid">${[
            translate('cortexToolLabel'),
            translate('archivedToolLabel'),
            translate('trashToolLabel'),
            translate('settingsToolLabel'),
          ].map((item) => `<article class="progressive-mini-card"><small>${translate('tutorialHintLabel')}</small><strong>${item}</strong></article>`).join('')}</div>`,
          targets: () => getLeftPanelHoverGuide().targets,
          demo: async ({ runId }) => {
            await getLeftPanelHoverGuide().demo({ runId });
          },
        },
        {
          id: 'sidebar',
          title: translate('sidebarTitle'),
          body: translate('sidebarBody'),
          hint: translate('sidebarHint'),
          canAdvance: () => true,
          preview: () => `<div class="progressive-card-grid"><article class="progressive-mini-card"><small>1</small><strong>${translate('archivedToolLabel')}</strong><p>${translate('sidebarRestoreHint')}</p></article><article class="progressive-mini-card"><small>2</small><strong>${translate('trashToolLabel')}</strong><p>${translate('sidebarDeleteHint')}</p></article></div>`,
          targets: () => getSidebarGuide().targets,
          revealSelectors: () => getSidebarGuide().revealSelectors,
          revealPadding: 14,
          demo: async ({ runId }) => {
            await getSidebarGuide().demo({ runId });
          },
        },
        {
          id: 'cortex',
          title: translate('cortexTitle'),
          body: translate('cortexBody'),
          hint: translate('cortexHint'),
          canAdvance: () => true,
          preview: () => `<div class="progressive-note"><strong>Cortex</strong><p>${translate('mockRule')}</p><button type="button" data-progressive-action="openCortex">${translate('openCortex')}</button></div>`,
          targets: () => getCortexGuide().targets,
          demo: async ({ runId }) => {
            await getCortexGuide().demo({ runId });
          },
        },
        {
          id: 'apis',
          title: translate('apiTitle'),
          body: translate('apiBody'),
          hint: translate('apiHint'),
          canAdvance: () => apiDemoPrepared && !isModalOpen('#ai-settings-modal'),
          preview: () => `<div class="progressive-provider-list"><button type="button" data-progressive-action="openApis">${translate('openApis')}</button>${PROVIDER_LINKS.map((provider) => `<button type="button" data-progressive-link="${provider.url}">${provider.label}</button>`).join('')}</div><div class="progressive-note"><strong>APIs</strong><p>${translate('mockApiStatus')}</p></div>`,
          targets: () => getApiGuide().targets,
          demo: async ({ runId }) => {
            await getApiGuide().demo({ runId });
          },
        },
        {
          id: 'project-class',
          title: translate('projectClassTitle'),
          body: translate('projectClassBody'),
          hint: hasTutorialReadyProject() ? translate('done') : translate('projectClassHint'),
          checklist: () => [
            { label: translate('mockFolder'), done: hasTutorialReadyProject() },
          ],
          canAdvance: () => hasTutorialReadyProject(),
          preview: () => `<div class="progressive-flow"><div>${translate('mockFolder')}</div><div>1. ${translate('projectFlowCreate')}</div><div>2. ${translate('projectFlowFolder')}</div><div>3. ${translate('projectFlowReady')}</div></div>`,
          targets: () => {
            const tutorialMapSelector = getTutorialCreatedProjectMapSelector();
            if (hasTutorialReadyProject() && resolveElement(tutorialMapSelector)) {
              return [tutorialMapSelector];
            }
            return ['#btn-add-project', '#projects-search'];
          },
          revealSelectors: () => ['.panel-left'],
          revealPadding: 14,
          demo: async ({ runId }) => {
            const tutorialMapSelector = getTutorialCreatedProjectMapSelector();
            if (hasTutorialReadyProject() && resolveElement(tutorialMapSelector)) {
              await animateCursorTo(tutorialMapSelector, { runId, pulse: true, label: 'Clique no Mapa da Aplicação' });
              return;
            }
            await animateCursorTo('#btn-add-project', { runId, pulse: true, label: 'Novo projeto' });
          },
        },
        {
          id: 'map-intro',
          title: translate('mapTitle'),
          body: translate('mapBody'),
          hint: translate('mapHint'),
          checklist: () => [
            { label: 'Mapa aberto', done: tutorialMapIconClicked },
            { label: 'Painel esquerdo recolhido', done: isLeftWorkspaceCollapsed() },
            { label: 'Painel direito recolhido', done: isRightWorkspaceCollapsed() },
            { label: 'Ferramentas do mapa exploradas', done: hoveredMapSelectors.size >= MAP_TOOL_HOVER_SELECTORS.length },
          ],
          canAdvance: () => (
            tutorialMapIconClicked
            && isLeftWorkspaceCollapsed()
            && isRightWorkspaceCollapsed()
            && hoveredMapSelectors.size >= MAP_TOOL_HOVER_SELECTORS.length
          ),
          preview: () => `<div class="progressive-map-preview"><div class="progressive-mini-card"><small>Hello World</small><strong>${translate('mockMapBrief')}</strong></div><div class="progressive-mini-card"><small>Design System</small><strong>${translate('mockMapDesign')}</strong></div></div>`,
          targets: () => getMapGuide().targets,
          revealSelectors: () => getMapGuide().revealSelectors,
          revealPadding: 16,
          demo: async ({ runId }) => {
            await getMapGuide().demo({ runId });
          },
        },
        {
          id: 'map-build',
          title: 'Aula de Criação de Projeto',
          body: 'O tutorial monta um planejamento no mapa simulando a criação de um grupo Frontend e de Regras.',
          hint: 'Acompanhe a construção visual do projeto.',
          canAdvance: () => true,
          preview: () => `<div class="progressive-map-preview"><div class="progressive-mini-card"><strong>Frontend</strong></div><div class="progressive-mini-card"><strong>Regras</strong></div></div>`,
          targets: () => [
            '#btn-map-tool-add-card',
            '.map-node-edit-btn',
            '#inspector-node-title',
            '#inspector-node-desc',
            '#inspector-node-content',
            '.CodeMirror'
          ],
          revealSelectors: () => ['.panel-center', '.map-inspector-panel'],
          revealPadding: 16,
          demo: async ({ runId }) => {
            try {
              setCursorLabel('DEBUG: init map-build');
              const mapController = options.actions && options.actions.getMapController ? options.actions.getMapController() : null;
              if (!mapController) {
                setCursorLabel('DEBUG: mapController is null');
                return;
              }
              
              setCursorLabel('DEBUG: waiting canvasController');
              let canvasController = null;
              for (let i = 0; i < 40; i++) {
                canvasController = typeof mapController.getCanvasController === 'function' ? mapController.getCanvasController() : null;
                if (canvasController) break;
                await delay(100);
              }
              if (!canvasController) {
                setCursorLabel('DEBUG: canvasController timeout');
                return;
              }
              
              setCursorLabel('DEBUG: waiting nodes');
              for (let i = 0; i < 20; i++) {
                if (document.querySelectorAll('.map-node').length > 0) break;
                await delay(100);
              }
              
              const initialNodeCount = document.querySelectorAll('.map-node').length;
              
              // Wait for the button to become visible before animating
              for (let i = 0; i < 20; i++) {
                if (resolveVisibleElement('#btn-map-tool-add-card')) break;
                await delay(100);
              }
              
              setCursorLabel('DEBUG: animating to markdown btn');
              cursorSuppressed = false;
              await animateCursorTo('#btn-map-tool-add-card', { runId, pulse: true, label: 'Clique na ferramenta Markdown' });
            
            while (document.querySelectorAll('.map-node').length <= initialNodeCount) {
              if (runId !== demoRunId) return;
              await delay(100);
            }

            // Utiliza o novo motor de cálculo matemático direto da matriz do canvas, ignorando o DOM
            if (runId !== demoRunId) return;
            cursorSuppressed = false;
            
            const mapData = canvasController.getMapData ? canvasController.getMapData() : { nodes: [] };
            const newNodeIndex = Math.max(0, (mapData.nodes || []).length - 1);
            
            // Assume que estamos mirando no nó recém-criado (último índice)
            let trackingCanvas = animateCursorToCanvasNode(newNodeIndex, {
              runId,
              mapController,
              label: 'Clique no ícone de lápis para editar'
            });
            } catch (e) {
              setCursorLabel('DEBUG ERROR: ' + e.message);
              console.error(e);
            }
            
            // Wait for inspector to open
            while (!resolveVisibleElement('#inspector-node-title')) {
              if (runId !== demoRunId) {
                tracking = false;
                return;
              }
              await delay(100);
            }
            tracking = false;
              
            // 2. Wait for user to click Title and type Hello World
            cursorSuppressed = false;
            await animateCursorTo('#inspector-node-title', { runId, pulse: true, label: 'Clique no Título' });
            
            while (document.activeElement !== resolveElement('#inspector-node-title')) {
              if (runId !== demoRunId) return;
              await delay(100);
            }
            await typeInto('#inspector-node-title', 'Hello World', { runId });

            const node = typeof canvasController !== 'undefined' && canvasController.getMapData().nodes[0];
            const hasDesc = node && node.description && node.description.includes('boas-vindas');
            const hasContent = node && node.content && node.content.includes('Hello Word');

            if (!hasDesc && !hasContent) {
              // Wait a bit for UI to settle
              for (let i = 0; i < 5; i++) {
                if (resolveVisibleElement('#inspector-node-desc')) break;
                await delay(50);
              }
              // 3. Wait for user to click Description and type
              cursorSuppressed = false;
              await animateCursorTo('#inspector-node-desc', { runId, pulse: true, label: 'Clique na Descrição' });
              
              while (document.activeElement !== resolveElement('#inspector-node-desc')) {
                if (runId !== demoRunId) return;
                await delay(100);
              }
              await typeInto('#inspector-node-desc', 'markdown se trata da descrição para o Faber Code criar um hello world.', { runId });
            }

            if (!hasContent) {
              // Wait a bit for UI to settle
              for (let i = 0; i < 5; i++) {
                if (resolveVisibleElement('.CodeMirror, #inspector-node-content')) break;
                await delay(50);
              }
              // 4. Wait for user to click Content and type
              cursorSuppressed = false;
              await animateCursorTo('.CodeMirror', { runId, pulse: true, label: 'Clique no Conteúdo', offsetX: 30, offsetY: 30 });
              
              while (!document.activeElement || !document.activeElement.closest('.CodeMirror')) {
                if (runId !== demoRunId) return;
                await delay(100);
              }
              
              // Type into CodeMirror
              const cmEl = resolveVisibleElement('.CodeMirror');
              if (cmEl && cmEl.CodeMirror) {
                const cm = cmEl.CodeMirror;
                const text = 'página Hello Word recebendo bem o usuário e dando as boas-vindas a plataforma.';
                cm.setValue('');
                for (let i = 0; i < text.length; i++) {
                  if (runId !== demoRunId) return;
                  cm.replaceRange(text[i], { line: cm.lastLine(), ch: cm.getLine(cm.lastLine()).length });
                  await delay(24);
                }
                const contentEl = document.getElementById('inspector-node-content');
                if (contentEl) {
                  contentEl.value = cm.getValue();
                  contentEl.dispatchEvent(new Event('input'));
                }
              } else {
                 await typeInto('#inspector-node-content', 'página Hello Word recebendo bem o usuário e dando as boas-vindas a plataforma.', { runId });
              }
            }

            await delay(1000);
            if (runId !== demoRunId) return;
            // Advance to next step (map-chat)
            const current = steps()[currentStepIndex];
            if (current && current.id === 'map-build' && current.canAdvance()) nextStep();
          },
        },
        {
          id: 'map-chat',
          title: 'Assistente do Mapa',
          body: 'Você pode usar o chat do mapa da aplicação para tirar dúvidas sobre o que está desenvolvendo.',
          hint: 'Observe a interação com o assistente do mapa.',
          canAdvance: () => true,
          preview: () => `<div class="progressive-chat-preview"><div class="progressive-chat-message is-assistant">${translate('mapDemoChatReply')}</div></div>`,
          targets: () => ['#btn-map-ai'],
          revealSelectors: () => ['.panel-center', '.map-side-panel'],
          revealPadding: 16,
          demo: async ({ runId }) => {
            const mapBtn = await animateCursorTo('#btn-map-ai', { runId, pulse: true, label: translate('mapDemoChatQuestion') });
            if (!mapBtn) return;
            
            const aiPanel = document.getElementById('workspace-map-chat-panel');
            if (aiPanel && aiPanel.classList.contains('hidden')) {
               const btn = resolveElement('#btn-map-ai');
               if (btn) btn.click();
            }
            await delay(1000);
            await animateCursorTo('#workspace-chat-region', { runId, pulse: true, label: translate('devMilestonesHint') });
          },
        },
        {
          id: 'dev-chat',
          title: translate('chatTitle'),
          body: translate('chatBody'),
          hint: translate('chatHint'),
          canAdvance: () => true,
          preview: () => `<div class="progressive-chat-preview"><div class="progressive-chat-message is-user">${translate('mockUserPrompt')}</div><div class="progressive-chat-message is-assistant">${translate('mockAssistantReply')}</div></div>`,
          targets: () => ['#user-input', '#btn-project-milestones'],
          revealSelectors: () => ['.panel-center', '.panel-right'],
          revealPadding: 16,
          demo: async ({ runId }) => {
            const first = await animateCursorTo('#user-input', { runId, pulse: true, label: 'Chat' });
            if (!first) return;
            await typeInto('#user-input', translate('mockUserPrompt'), { runId });
            await delay(1000);
            if (options.actions && options.actions.simulateChatReply) {
              options.actions.simulateChatReply(translate('mockAssistantReply'));
            }
          },
        },
        {
          id: 'git',
          title: translate('gitTitle'),
          body: translate('gitBody'),
          hint: translate('gitHint'),
          canAdvance: () => true,
          preview: () => `<div class="progressive-note"><strong>Git</strong><p>${translate('mockGitStatus')}</p></div>`,
          targets: () => ['#btn-project-git'],
          revealSelectors: () => ['.panel-right'],
          revealPadding: 16,
          demo: async ({ runId }) => {
            await animateCursorTo('#btn-project-git', { runId, pulse: true, label: translate('gitDemoInit') });
            await delay(1000);
            await animateCursorTo('#btn-project-git', { runId, pulse: true, label: translate('gitDemoCommit') });
          },
        },
        {
          id: 'finish',
          title: translate('finishTitle'),
          body: translate('finishBody'),
          hint: translate('finishHint'),
          canAdvance: () => true,
          preview: () => `<div class="progressive-note"><strong>Hello World</strong><p>${translate('mockRunStatus')}</p></div>`,
          targets: () => ['#btn-project-deploy'],
          revealSelectors: () => ['.panel-right'],
          revealPadding: 16,
          demo: async ({ runId }) => {
            await animateCursorTo('#btn-project-deploy', { runId, pulse: true, label: translate('runDemoPlay') });
          },
        },
      ];
    }

    function findStepIndex(stepId) {
      const list = steps();
      const index = list.findIndex((step) => step.id === stepId);
      return index >= 0 ? index : 0;
    }

    function renderRequirements() {
      if (!requirementsState || !elements.requirementsStatus || !elements.requirementsList) return;
      if (elements.requirementsTitle) elements.requirementsTitle.textContent = translate('requirementsTitle');
      if (elements.requirementsLead) elements.requirementsLead.textContent = translate('requirementsLead');
      elements.requirementsStatus.innerHTML = '';
      const title = doc.createElement('strong');
      title.textContent = requirementsState.ready ? translate('requirementsReady') : translate('requirementsMissing');
      elements.requirementsStatus.appendChild(title);
      elements.requirementsList.innerHTML = '';
      (requirementsState.requirements || []).forEach((item) => {
        const row = doc.createElement('div');
        row.className = `progressive-requirement-row${item.installed ? ' is-ready' : ' is-missing'}`;
        const meta = doc.createElement('div');
        meta.className = 'progressive-requirement-meta';
        const strong = doc.createElement('strong');
        strong.textContent = item.id === 'node' ? 'Node.js' : 'Git';
        const span = doc.createElement('span');
        const locale = String(getLocale() || 'pt-BR');
        const guidance = item.guidance && (
          item.guidance[locale]
          || item.guidance[locale.slice(0, 2)]
          || item.guidance.pt
          || item.guidance.en
          || item.guidance.es
        );
        span.textContent = item.installed ? (item.version || translate('done')) : (guidance || '');
        meta.append(strong, span);
        row.appendChild(meta);
        if (!item.installed && item.installUrl) {
          const button = doc.createElement('button');
          button.type = 'button';
          button.dataset.progressiveLink = item.installUrl;
          button.textContent = item.id === 'node' ? translate('installNode') : translate('installGit');
          row.appendChild(button);
        }
        elements.requirementsList.appendChild(row);
      });
      if (elements.requirementsRecheck) elements.requirementsRecheck.textContent = translate('recheck');
      if (elements.requirementsContinue) {
        elements.requirementsContinue.textContent = translate('continue');
        elements.requirementsContinue.disabled = !requirementsState.ready;
      }
    }

    async function refreshRequirements() {
      if (!api || typeof api.getHostRequirements !== 'function') {
        requirementsState = { ok: true, ready: true, requirements: [] };
        return requirementsState;
      }
      requirementsState = await api.getHostRequirements();
      renderRequirements();
      return requirementsState;
    }

    function renderChecklist(step) {
      if (!elements.tutorialChecklist) return;
      const items = typeof step.checklist === 'function' ? step.checklist() : [];
      elements.tutorialChecklist.innerHTML = '';
      elements.tutorialChecklist.classList.toggle('hidden', items.length === 0);
      items.forEach((item) => {
        const row = doc.createElement('div');
        row.className = `progressive-check-row${item.done ? ' is-done' : ''}`;
        row.innerHTML = `<span>${item.done ? translate('done') : translate('waiting')}</span><strong>${item.label}</strong>`;
        elements.tutorialChecklist.appendChild(row);
      });
    }

    function stopDemoVisuals() {
      demoRunId += 1;
      restoreTypedFields();
      restoreTutorialFieldDecorators();
      hideSpotlight();
      hideCursor();
      activeGuideSignature = '';
    }

    async function startStepDemo(step) {
      if (!step || typeof step.demo !== 'function') return;
      const runId = ++demoRunId;
      restoreTypedFields();
      restoreTutorialFieldDecorators();
      showCursor();
      moveCursorInstant(cursorPosition.x, cursorPosition.y, '');
      setVisible(elements.tutorialCursor, true);
      setVisible(elements.tutorialCursorLabel, false);
      try {
        await step.demo({ runId });
      } catch {
        if (runId === demoRunId) hideSpotlight();
      }
    }

    function activateStep(step, guide) {
      highlightTargets(guide.targets || []);
      positionCoach(guide.targets || []);
      showSpotlightForGuide(guide);
      if (guide && typeof guide.demo === 'function') {
        void startStepDemo({ demo: guide.demo });
      }
      activeStepId = step.id;
    }

    function positionCoach(targetSelectors = []) {
      const coach = elements.tutorial;
      const card = coach && coach.querySelector ? coach.querySelector('.progressive-tutorial__coach') : null;
      if (!card) return;
      refreshTutorialContext();
      const visibleTargets = targetSelectors
        .map((selector) => resolveElement(selector))
        .filter((element) => isVisibleElement(element));
      const padding = hasOpenContextualModal() ? 14 : 18;
      const { width: viewportWidth, height: viewportHeight } = getViewportSize();
      card.style.left = '';
      card.style.right = '';
      card.style.top = '';
      card.style.bottom = '';
      if (!visibleTargets.length) {
        card.dataset.position = 'bottom-left';
        card.style.left = `${padding}px`;
        card.style.bottom = `${padding}px`;
        return;
      }
      const targetRect = visibleTargets.reduce((acc, element) => {
        const rect = element.getBoundingClientRect();
        if (!acc) return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        return {
          left: Math.min(acc.left, rect.left),
          top: Math.min(acc.top, rect.top),
          right: Math.max(acc.right, rect.right),
          bottom: Math.max(acc.bottom, rect.bottom),
        };
      }, null);
      const cardRect = card.getBoundingClientRect();
      const cardWidth = Math.max(260, Math.round(cardRect.width || 310));
      const cardHeight = Math.max(132, Math.round(cardRect.height || 180));
      const defaultCandidates = [
        {
          name: 'bottom-left',
          left: padding,
          top: Math.max(padding, viewportHeight - cardHeight - padding),
        },
        {
          name: 'bottom-right',
          left: Math.max(padding, viewportWidth - cardWidth - padding),
          top: Math.max(padding, viewportHeight - cardHeight - padding),
        },
        {
          name: 'top-left',
          left: padding,
          top: padding,
        },
        {
          name: 'top-right',
          left: Math.max(padding, viewportWidth - cardWidth - padding),
          top: padding,
        },
      ];
      let candidates = defaultCandidates;
      if (activeStepId === 'panels') {
        candidates = [
          defaultCandidates[1],
          defaultCandidates[3],
          defaultCandidates[2],
          defaultCandidates[0],
        ];
      } else if (activeStepId === 'left-tools' || activeStepId === 'sidebar') {
        candidates = [
          defaultCandidates[3],
          defaultCandidates[1],
          defaultCandidates[2],
          defaultCandidates[0],
        ];
      } else if (activeStepId === 'apis') {
        const preferTop = targetRect.bottom > (viewportHeight * 0.58);
        candidates = preferTop
          ? [
              defaultCandidates[2],
              defaultCandidates[3],
              defaultCandidates[1],
              defaultCandidates[0],
            ]
          : [
              defaultCandidates[3],
              defaultCandidates[2],
              defaultCandidates[1],
              defaultCandidates[0],
            ];
      }
      const targetCenterX = (targetRect.left + targetRect.right) / 2;
      const targetCenterY = (targetRect.top + targetRect.bottom) / 2;
      const ranked = candidates
        .map((candidate) => {
          const rect = {
            left: candidate.left,
            top: candidate.top,
            right: candidate.left + cardWidth,
            bottom: candidate.top + cardHeight,
          };
          const overlaps = !(
            rect.right < targetRect.left
            || rect.left > targetRect.right
            || rect.bottom < targetRect.top
            || rect.top > targetRect.bottom
          );
          const centerX = rect.left + (cardWidth / 2);
          const centerY = rect.top + (cardHeight / 2);
          const distance = Math.hypot(centerX - targetCenterX, centerY - targetCenterY);
          return { ...candidate, overlaps, distance };
        })
        .sort((a, b) => {
          if (a.overlaps !== b.overlaps) return a.overlaps ? 1 : -1;
          return b.distance - a.distance;
        });
      const choice = ranked[0] || candidates[0];
      card.dataset.position = choice.name;
      card.style.left = `${Math.round(choice.left)}px`;
      card.style.top = `${Math.round(choice.top)}px`;
      card.style.right = 'auto';
      card.style.bottom = 'auto';
    }

    function renderStep() {
      const list = steps();
      const step = list[currentStepIndex];
      if (!step) return;
      syncTutorialRuntime();
      dispatchTutorialProjectsChanged();
      refreshTutorialContext();
      const guide = getStepGuide(step);
      const stepChanged = activeStepId !== step.id;
      const guideChanged = activeGuideSignature !== guide.signature;
      if (stepChanged || guideChanged) {
        stopDemoVisuals();
        activateStep(step, guide);
        activeGuideSignature = guide.signature;
      }
      if (elements.tutorialLive) elements.tutorialLive.textContent = translate('tutorialLive');
      if (elements.tutorialTitle) elements.tutorialTitle.textContent = step.title;
      if (elements.tutorialHint) elements.tutorialHint.textContent = guide.hint || step.hint || '';
      if (elements.tutorialCounter) elements.tutorialCounter.textContent = `${currentStepIndex + 1} / ${list.length}`;
      if (elements.tutorialProgress) {
        elements.tutorialProgress.style.setProperty('--progressive-ratio', String((currentStepIndex + 1) / list.length));
      }
      if (elements.tutorialPreview) elements.tutorialPreview.innerHTML = typeof step.preview === 'function' ? step.preview() : '';
      renderChecklist(step);
      positionCoach(guide.targets || []);
      if (elements.tutorialNext) {
        elements.tutorialNext.textContent = currentStepIndex === list.length - 1 ? translate('finishTutorial') : translate('continue');
        elements.tutorialNext.disabled = !step.canAdvance();
      }
      if (elements.tutorialPrev) {
        elements.tutorialPrev.textContent = translate('previous');
        elements.tutorialPrev.disabled = currentStepIndex === 0;
      }
      if (elements.tutorialSkipAll) elements.tutorialSkipAll.textContent = translate('stopTutorial');
      writeStorage(TUTORIAL_PROGRESS_KEY, step.id);
      if (step.id === 'panels' && step.canAdvance()) {
        window.setTimeout(() => {
          if (!active) return;
          const current = steps()[currentStepIndex];
          if (current && current.id === 'panels' && current.canAdvance()) nextStep();
        }, 260);
      }
      if (step.id === 'left-tools' && step.canAdvance()) {
        window.setTimeout(() => {
          if (!active) return;
          const current = steps()[currentStepIndex];
          if (current && current.id === 'left-tools' && current.canAdvance()) nextStep();
        }, 260);
      }
      if (step.id === 'apis' && step.canAdvance()) {
        window.setTimeout(() => {
          if (!active) return;
          const current = steps()[currentStepIndex];
          if (current && current.id === 'apis' && current.canAdvance()) nextStep();
        }, 260);
      }
      if (step.id === 'project-class' && step.canAdvance()) {
        window.setTimeout(() => {
          if (!active) return;
          const current = steps()[currentStepIndex];
          if (current && current.id === 'project-class' && current.canAdvance()) nextStep();
        }, 260);
      }
      if (step.id === 'sidebar' && sidebarClosedOnce) {
        window.setTimeout(() => {
          if (!active) return;
          const current = steps()[currentStepIndex];
          if (current && current.id === 'sidebar') nextStep();
        }, 260);
      }
      if (step.id === 'project-class' && step.canAdvance()) {
        window.setTimeout(() => {
          if (!active) return;
          const current = steps()[currentStepIndex];
          if (current && current.id === 'project-class' && current.canAdvance()) nextStep();
        }, 260);
      }
      if (step.id === 'map-intro' && step.canAdvance()) {
        window.setTimeout(() => {
          if (!active) return;
          const current = steps()[currentStepIndex];
          if (current && current.id === 'map-intro' && current.canAdvance()) nextStep();
        }, 260);
      }
    }

    function completeTutorial() {
      active = false;
      tutorialCortexEntry = null;
      dispatchTutorialCortexChanged();
      stopDemoVisuals();
      clearHighlights();
      setVisible(elements.tutorial, false);
      syncTutorialRuntime();
      dispatchTutorialProjectsChanged();
      writeStorage(TUTORIAL_COMPLETED_KEY, 'true');
      writeStorage(TUTORIAL_DISMISSED_KEY, 'false');
      writeStorage(TUTORIAL_PROGRESS_KEY, '');
      activeStepId = '';
    }

    function dismissTutorial() {
      active = false;
      tutorialCortexEntry = null;
      dispatchTutorialCortexChanged();
      stopDemoVisuals();
      clearHighlights();
      setVisible(elements.tutorial, false);
      syncTutorialRuntime();
      dispatchTutorialProjectsChanged();
      writeStorage(TUTORIAL_DISMISSED_KEY, 'true');
      activeStepId = '';
    }

    function nextStep() {
      const list = steps();
      const step = list[currentStepIndex];
      if (step && !step.canAdvance()) return;
      if (currentStepIndex >= list.length - 1) {
        completeTutorial();
        return;
      }
      currentStepIndex += 1;
      activeStepId = '';
      renderStep();
    }

    function previousStep() {
      if (currentStepIndex <= 0) return;
      currentStepIndex -= 1;
      activeStepId = '';
      renderStep();
    }

    function startTutorial() {
      active = true;
      leftCollapsedSeen = false;
      leftExpandedSeen = false;
      rightCollapsedSeen = false;
      rightExpandedSeen = false;
      sidebarOpenedOnce = false;
      sidebarClosedOnce = false;
      sidebarDemoStage = 'intro';
      tutorialCreatedProjectId = '';
      tutorialMapIconClicked = false;
      cortexSavedOnce = false;
      apiDemoPrepared = false;
      apiProviderSelected = false;
      apiSelectedProviderValue = '';
      apiSelectedProviderLabel = '';
      apiServiceTyped = false;
      apiPlaceholderTyped = false;
      apiEditorSaved = false;
      apiKeyInputOriginalType = '';
      apiTutorialKeyValue = '';
      tutorialCortexEntry = null;
      dispatchTutorialCortexChanged();
      hoveredSelectors = new Set();
      captureTutorialProjectBaseline();
      currentStepIndex = findStepIndex(readStorage(TUTORIAL_PROGRESS_KEY, 'panels'));
      activeStepId = '';
      syncTutorialRuntime();
      dispatchTutorialProjectsChanged();
      setVisible(elements.tutorial, true);
      refreshTutorialContext();
      renderStep();
    }

    async function restartTutorial() {
      writeStorage(WANTS_TUTORIAL_KEY, 'true');
      writeStorage(TUTORIAL_COMPLETED_KEY, 'false');
      writeStorage(TUTORIAL_DISMISSED_KEY, 'false');
      writeStorage(TUTORIAL_PROGRESS_KEY, 'panels');
      if (!getAccountUnlocked()) return false;
      stopDemoVisuals();
      clearHighlights();
      currentStepIndex = 0;
      activeStepId = '';
      startTutorial();
      return true;
    }

    async function maybeStart() {
      if (!getAccountUnlocked()) return false;
      const requirementsAcknowledged = readStorage(REQUIREMENTS_ACK_KEY, '') === 'true';
      const wantsTutorial = readStorage(WANTS_TUTORIAL_KEY, '') === 'true';
      const tutorialCompleted = readStorage(TUTORIAL_COMPLETED_KEY, '') === 'true';
      const tutorialDismissed = readStorage(TUTORIAL_DISMISSED_KEY, '') === 'true';
      const requirements = await refreshRequirements();
      if (!requirementsAcknowledged && requirements && requirements.ready === false) {
        setVisible(elements.requirements, true);
        return true;
      }
      if (!wantsTutorial || tutorialCompleted || tutorialDismissed) return false;
      startTutorial();
      return true;
    }

    function updatePanelProgress() {
      if (!active) return;
      const body = doc.body;
      if (!body || !body.classList) return;
      if (body.classList.contains('workspace-left-collapsed')) leftCollapsedSeen = true;
      if (leftCollapsedSeen && !body.classList.contains('workspace-left-collapsed')) leftExpandedSeen = true;
      if (body.classList.contains('workspace-right-collapsed')) rightCollapsedSeen = true;
      if (rightCollapsedSeen && !body.classList.contains('workspace-right-collapsed')) rightExpandedSeen = true;
      renderStep();
    }

    function deferProgressRefresh() {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          updatePanelProgress();
          refreshTutorialContext();
        });
      });
      window.setTimeout(() => {
        updatePanelProgress();
        refreshTutorialContext();
      }, 220);
    }

    function onMouseOver(event) {
      if (!active) return;
      const step = steps()[currentStepIndex];
      if (!step) return;
      const guide = getStepGuide(step);
      const targets = (guide.targets || []).filter(Boolean);
      const matchedSelector = targets.find((selector) => event.target && event.target.closest ? event.target.closest(selector) : null);
      if (!matchedSelector) return;
      hideCursor();
      if (step.id === 'left-tools') {
        const selector = LEFT_PANEL_HOVER_SELECTORS.find((entry) => matchedSelector === entry);
        if (!selector) return;
        hoveredSelectors.add(selector);
        renderStep();
        return;
      }
      if (step.id === 'map-intro') {
        const selector = MAP_TOOL_HOVER_SELECTORS.find((entry) => matchedSelector === entry);
        if (!selector) return;
        hoveredMapSelectors.add(selector);
        renderStep();
      }
    }

    function onMouseOut(event) {
      if (!active) return;
      const step = steps()[currentStepIndex];
      if (!step) return;
      const guide = getStepGuide(step);
      const targets = (guide.targets || []).filter(Boolean);
      const leavingSelector = targets.find((selector) => event.target && event.target.closest ? event.target.closest(selector) : null);
      if (!leavingSelector) return;
      const related = event.relatedTarget;
      const stillInside = targets.some((selector) => related && related.closest ? related.closest(selector) : null);
      if (stillInside) return;
      showCursor();
      setCursorLabel(elements.tutorialCursorLabel ? elements.tutorialCursorLabel.textContent : '');
    }

    function isInsideCoach(node) {
      const coach = elements.tutorial && elements.tutorial.querySelector
        ? elements.tutorial.querySelector('.progressive-tutorial__coach')
        : null;
      return Boolean(coach && node && node.closest && node.closest('.progressive-tutorial__coach'));
    }

    function matchCurrentGuideTarget(node, guide) {
      const selectors = (guide && guide.targets ? guide.targets : []).filter(Boolean);
      if (!node || !node.closest) return { selector: '', element: null };
      for (const selector of selectors) {
        const element = node.closest(selector);
        // Ignora a checagem rigorosa de visibilidade se for um botão crítico do mapa,
        // porque animações e o canvas svg fazem o rect.width reportar 0
        const isCriticalMapTarget = element && (element.id === 'btn-map-tool-add-card' || element.classList.contains('map-node-edit-btn') || element.id === 'inspector-node-title');
        if (element && (isCriticalMapTarget || isVisibleElement(element))) return { selector, element };
      }
      return { selector: '', element: null };
    }

    function onDocumentClick(event) {
      if (!active) return;
      const step = steps()[currentStepIndex];
      if (!step) return;
      if (step.id === 'apis' && event.type === 'mousedown') return;
      if (step.id === 'apis' && tutorialTypingInProgress) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      const guide = getStepGuide(step);
      if (step.id === 'apis') {
        const directSave = event.target && event.target.closest ? event.target.closest('#ai-settings-save') : null;
        if (directSave && event.type === 'click' && !isVisibleElement(resolveElement('#ai-settings-editor-key'))) {
          animateCursorClick();
          hideCursor();
          window.setTimeout(() => {
            const watchSave = () => {
              if (!active) return;
              if (!isModalOpen('#ai-settings-modal')) {
                apiDemoPrepared = true;
                apiEditorSaved = true;
                restoreTutorialFieldDecorators();
                refreshTutorialContext();
                renderStep();
                const current = steps()[currentStepIndex];
                if (current && current.id === 'apis') nextStep();
                return;
              }
              window.setTimeout(watchSave, 120);
            };
            watchSave();
          }, 80);
          return;
        }
      }
      if (isInsideCoach(event.target)) return;
      const match = matchCurrentGuideTarget(event.target, guide);
      if (!match.element) {
        if (step.id === 'sidebar' && isModalOpen('#project-state-modal')) {
          const modalDialog = event.target && event.target.closest ? event.target.closest('#project-state-modal .project-state-modal__dialog') : null;
          const modalBackdrop = event.target && event.target.closest ? event.target.closest('#project-state-modal [data-close=\"1\"]') : null;
          if (modalDialog || modalBackdrop) {
            hideCursor();
            window.setTimeout(() => {
              refreshTutorialContext();
              renderStep();
            }, 220);
            return;
          }
        }
        if (step.id === 'sidebar' && isModalOpen('#faber-confirm-modal')) {
          const confirmDialog = event.target && event.target.closest ? event.target.closest('#faber-confirm-modal .unsaved-exit-modal__dialog') : null;
          const confirmBackdrop = event.target && event.target.closest ? event.target.closest('#faber-confirm-backdrop') : null;
          if (confirmDialog || confirmBackdrop) {
            hideCursor();
            window.setTimeout(() => {
              refreshTutorialContext();
              renderStep();
            }, 220);
            return;
          }
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      if (step.id === 'left-tools') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      if (step.id === 'sidebar') {
        if (match.selector === '#btn-archived-projects' || match.selector === '#btn-trash-projects') sidebarOpenedOnce = true;
        animateCursorClick();
        hideCursor();
        window.setTimeout(() => {
          if (!isModalOpen('#project-state-modal') && sidebarDemoStage === 'deleted') sidebarClosedOnce = true;
          refreshTutorialContext();
          renderStep();
        }, 220);
        return;
      }
      if (step.id === 'cortex') {
        if (match.selector === '#cortex-send') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          const input = resolveElement('#cortex-input');
          const text = String(input && input.value || '').trim() || translate('mockRule');
          tutorialCortexEntry = {
            id: '__tutorial-cortex-entry__',
            memoryId: '__tutorial-cortex-entry__',
            type: 'cortex.user_input',
            title: 'Regra do tutorial',
            topic: 'geral',
            text,
            status: 'active',
            promoted: false,
          };
          cortexSavedOnce = true;
          syncTutorialRuntime();
          dispatchTutorialCortexChanged();
        }
        hideCursor();
        window.setTimeout(() => {
          if (!isModalOpen('#cortex-modal') && cortexSavedOnce) {
            refreshTutorialContext();
            renderStep();
            nextStep();
            return;
          }
          refreshTutorialContext();
          renderStep();
        }, 220);
        return;
      }
      if (step.id === 'apis') {
        if (match.selector === '#ai-settings-add-provider') {
          hideCursor();
          return;
        }
        if (match.selector === '#ai-settings-add-api') {
          const select = resolveElement('#ai-settings-add-provider');
          syncTutorialApiProviderSelection({ markSelected: true });
          if (select && 'value' in select) {
            const chosen = String(apiSelectedProviderValue || select.value || '').trim().toLowerCase();
            if (chosen === 'openai' || chosen === 'gemini' || chosen === 'sambanova') {
              select.value = 'custom';
              dispatchNativeChange(select);
            }
          }
          animateCursorClick();
          hideCursor();
          window.setTimeout(() => {
            refreshTutorialContext();
            renderStep();
          }, 260);
          return;
        }
        if (match.selector === '#ai-settings-editor-provider') {
          hideCursor();
          window.setTimeout(async () => {
            if (!active || apiServiceTyped) {
              refreshTutorialContext();
              renderStep();
              return;
            }
            await typeInto('#ai-settings-editor-provider', getTutorialApiServiceName(), {
              preserveValue: true,
              typingDelay: 42,
              label: 'Serviço',
            });
            apiServiceTyped = true;
            refreshTutorialContext();
            renderStep();
          }, 180);
          return;
        }
        if (match.selector === '#ai-settings-editor-key') {
          hideCursor();
          window.setTimeout(async () => {
            if (!active || apiPlaceholderTyped) {
              refreshTutorialContext();
              renderStep();
              return;
            }
            const input = resolveElement('#ai-settings-editor-key');
            if (input && input.getAttribute('placeholder') !== 'Aqui coloque sua chave de API') {
              input.setAttribute('placeholder', 'Aqui coloque sua chave de API');
            }
            revealTutorialApiKeyField();
            await scrollModalBodyToElement('#ai-settings-editor-key', { block: 'center', afterDelay: 160 });
            refreshTutorialContext();
            renderStep();
          }, 180);
          return;
        }
        if (match.selector === '#ai-settings-editor-save') {
          animateCursorClick();
          hideCursor();
          window.setTimeout(() => {
            apiEditorSaved = true;
            restoreTutorialFieldDecorators();
            refreshTutorialContext();
            renderStep();
          }, 260);
          return;
        }
        if (match.selector === '#ai-settings-save') {
          animateCursorClick();
          hideCursor();
          window.setTimeout(() => {
            const watchSave = () => {
              if (!active) return;
              if (!isModalOpen('#ai-settings-modal')) {
                apiDemoPrepared = true;
                apiEditorSaved = true;
                restoreTutorialFieldDecorators();
                refreshTutorialContext();
                renderStep();
                const current = steps()[currentStepIndex];
                if (current && current.id === 'apis') nextStep();
                return;
              }
              window.setTimeout(watchSave, 120);
            };
            watchSave();
          }, 80);
          return;
        }
        animateCursorClick();
        hideCursor();
        window.setTimeout(() => {
          refreshTutorialContext();
          renderStep();
        }, 260);
        return;
      }
      if (step.id === 'map-intro') {
        if (
          match.selector === '#workspace-collapse-left'
          || match.selector === '#workspace-collapse-right'
          || match.selector === getTutorialCreatedProjectMapSelector()
          || match.selector === '.project-mini-btn-map'
        ) {
          if ((event.type === 'click' || event.type === 'mousedown') && (match.selector === getTutorialCreatedProjectMapSelector() || match.selector === '.project-mini-btn-map')) {
            tutorialMapIconClicked = true;
          }
          animateCursorClick();
          hideCursor();
          deferProgressRefresh();
          return;
        }
        if (MAP_TOOL_HOVER_SELECTORS.includes(match.selector)) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          return;
        }
      }
      if (step.id === 'map-build') {
        animateCursorClick();
        hideCursor();
        return;
      }
      animateCursorClick();
      if (step.id !== 'panels') {
        hideCursor();
        window.setTimeout(() => {
          refreshTutorialContext();
          renderStep();
        }, 220);
        return;
      }
      if (
        match.selector === '#workspace-collapse-left'
        || match.selector === '#workspace-collapse-right'
        || match.selector === '#workspace-restore-left'
        || match.selector === '#workspace-restore-right'
      ) {
        hideCursor();
        deferProgressRefresh();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      deferProgressRefresh();
    }

    function onDocumentChange(event) {
      if (!active) return;
      const step = steps()[currentStepIndex];
      if (!step || step.id !== 'apis') return;
      const target = event.target;
      if (!target || !target.matches || !target.matches('#ai-settings-add-provider')) return;
      if (!syncTutorialApiProviderSelection({ markSelected: true })) return;
      hideCursor();
      window.setTimeout(() => {
        refreshTutorialContext();
        renderStep();
      }, 90);
    }

    async function onPreviewClick(event) {
      const button = event.target && event.target.closest ? event.target.closest('[data-progressive-action], [data-progressive-link]') : null;
      if (!button) return;
      const link = button.getAttribute('data-progressive-link');
      if (link && api && typeof api.openExternalUrl === 'function') {
        await api.openExternalUrl({ url: link });
        return;
      }
      const action = button.getAttribute('data-progressive-action');
      if (action && typeof actions[action] === 'function') await actions[action]();
    }

    function bindEvents() {
      if (elements.requirementsRecheck) {
        elements.requirementsRecheck.addEventListener('click', async () => {
          await refreshRequirements();
        });
      }
      if (elements.requirementsContinue) {
        elements.requirementsContinue.addEventListener('click', () => {
          if (!requirementsState || !requirementsState.ready) return;
          writeStorage(REQUIREMENTS_ACK_KEY, 'true');
          setVisible(elements.requirements, false);
          if (readStorage(WANTS_TUTORIAL_KEY, '') === 'true' && readStorage(TUTORIAL_COMPLETED_KEY, '') !== 'true') {
            startTutorial();
          }
        });
      }
      if (elements.tutorialNext) elements.tutorialNext.addEventListener('click', nextStep);
      if (elements.tutorialPrev) elements.tutorialPrev.addEventListener('click', previousStep);
      if (elements.tutorialSkipAll) elements.tutorialSkipAll.addEventListener('click', dismissTutorial);
      if (elements.tutorialPreview) {
        elements.tutorialPreview.addEventListener('click', (event) => {
          onPreviewClick(event).catch(() => {});
        });
      }
      doc.addEventListener('mouseover', onMouseOver, true);
      doc.addEventListener('mouseout', onMouseOut, true);
      doc.addEventListener('change', onDocumentChange, true);
      doc.addEventListener('click', onDocumentClick, true);
      doc.addEventListener('mousedown', onDocumentClick, true);
      window.addEventListener('resize', () => {
        const list = steps();
        const step = list[currentStepIndex];
        refreshTutorialContext();
        if (!active || !step) return;
        const guide = getStepGuide(step);
        highlightTargets(guide.targets || []);
        positionCoach(guide.targets || []);
        setCursorLabel(elements.tutorialCursorLabel && !elements.tutorialCursorLabel.classList.contains('hidden') ? elements.tutorialCursorLabel.textContent : '');
      });
    }

    function notifyStateChanged() {
      if (!active) return;
      if (tutorialTypingInProgress) {
        pendingTutorialRender = true;
        return;
      }
      renderStep();
    }

    function notifyProjectCreated(projectId) {
      tutorialCreatedProjectId = String(projectId || '').trim();
      if (!active) return;
      renderStep();
      const current = steps()[currentStepIndex];
      if (current && current.id === 'project-class' && current.canAdvance()) {
        window.setTimeout(() => {
          if (!active) return;
          const refreshed = steps()[currentStepIndex];
          if (refreshed && refreshed.id === 'project-class' && refreshed.canAdvance()) {
            nextStep();
          }
        }, 80);
      }
    }

    return {
      bindEvents,
      maybeStart,
      notifyStateChanged,
      notifyProjectCreated,
      restartTutorial,
      handleProjectStateAction,
      handleProjectContextAction,
    };
  }

  window.FaberProgressiveDisclosure = {
    createProgressiveDisclosureController,
  };
})();

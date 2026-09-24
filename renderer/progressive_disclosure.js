(function () {
  const REQUIREMENTS_ACK_KEY = 'fabercode:requirements-acknowledged';
  const TUTORIAL_COMPLETED_KEY = 'fabercode:tutorial-completed';
  const TUTORIAL_DISMISSED_KEY = 'fabercode:tutorial-dismissed';
  const TUTORIAL_PROGRESS_KEY = 'fabercode:tutorial-progress';
  const WANTS_TUTORIAL_KEY = 'fabercode:wants-tutorial';
  const TUTORIAL_PROJECT_ID_KEY = 'fabercode:tutorial-project-id';
  const TUTORIAL_USER_NAME_KEY = 'fabercode:tutorial-user-name';
  const TUTORIAL_DEVELOPMENT_STATE_KEY = 'fabercode:tutorial-development-state';

  const CURSOR_ANIMATION_MS = 480;
  const CURSOR_SETTLE_MS = 70;
  const TRACKING_INTERVAL_MS = 50;
  const POLLING_TIMEOUT_MS = 5000;
  const CANVAS_NODE_WIDTH = 220;
  const CANVAS_EDIT_BTN_OFFSET_X = 24;
  const CANVAS_EDIT_BTN_OFFSET_Y = 24;
  const MIN_VIEWPORT_WIDTH = 1280;
  const MIN_VIEWPORT_HEIGHT = 720;
  const PULSE_DURATION_MS = 720;
  const CLICK_ANIMATION_MS = 260;
  const TYPE_CHAR_DELAY_MS = 24;
  const MIN_CARD_WIDTH = 260;
  const MIN_CARD_HEIGHT = 132;
  const TUTORIAL_MAP_AUTO_ZOOM = 0.6;


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
      next: 'Próximo',
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
      apiSaveHint: 'O exemplo está pronto. Clique em Cancelar para fechar sem salvar a API fake e seguir para o mapa da aplicação.',
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
      next: 'Next',
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
      apiSaveHint: 'The example is ready. Click Cancel to close without saving the fake API and continue to the application map.',
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
      next: 'Siguiente',
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
      apiSaveHint: 'El ejemplo está listo. Haz clic en Cancelar para cerrar sin guardar la API falsa y seguir al mapa de la aplicación.',
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
      tutorialNamePrompt: doc.getElementById('progressive-tutorial-name-prompt'),
      tutorialNameInput: doc.getElementById('progressive-tutorial-name-input'),
      tutorialNameSave: doc.getElementById('progressive-tutorial-name-save'),
      tutorialNameError: doc.getElementById('progressive-tutorial-name-error'),
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
    const TUTORIAL_GITHUB_PLACEHOLDER = 'https://github.com/SEU_USUARIO';
    const TUTORIAL_LINKEDIN_PLACEHOLDER = 'https://www.linkedin.com/in/SEU_PERFIL';
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
    const RIGHT_PANEL_TOOL_SELECTORS = [
      '#btn-project-files',
      '#btn-map-ai',
      '#btn-project-git',
      '#btn-project-terminal',
      '#btn-project-milestones',
      '#btn-project-deploy',
    ];
    const RIGHT_PANEL_TOOL_GUIDES = RIGHT_PANEL_TOOL_SELECTORS.map((selector, index) => ({ selector, index }));
    const RIGHT_PANEL_HOVER_SELECTORS = RIGHT_PANEL_TOOL_GUIDES.map((tool) => tool.selector);
    let hoveredSelectors = new Set();
    let hoveredMapSelectors = new Set();
    let hoveredRightPanelSelectors = new Set();
    let tutorialCortexEntry = null;
    let tutorialMapIconClicked = false;
    let tutorialCreatedProjectId = '';
    let tutorialMapNodeId = '';
    let tutorialMapInspectorOpened = false;
    let tutorialMapBuildStage = 'welcome-create';
    let tutorialWelcomeNodeId = '';
    let tutorialWelcomeBriefReady = false;
    let tutorialDesignSystemNodeId = '';
    let tutorialDesignSystemReady = false;
    let tutorialMapZoomReady = false;
    let tutorialLogoNodeId = '';
    let tutorialFrontendGroupId = '';
    let tutorialRulesGroupId = '';
    let tutorialRulesNodeIds = [];
    let tutorialUserName = '';
    let tutorialArchitectureNodeIds = [];
    let tutorialDevelopmentReady = false;
    let tutorialMapCreationPending = false;
    let tutorialMapChatStage = 'expand-right';
    let tutorialMapGapNodeId = '';
    let tutorialMapConversationComplete = false;
    let tutorialMapAnalysisStage = 'history-loading';
    let tutorialMapHistoryPreparing = false;
    let tutorialMilestonesSaved = false;
    let tutorialDevelopmentChatStage = 'compose';
    let tutorialDevelopmentConversationComplete = false;
    let tutorialDevelopmentBatchIndex = -1;
    let tutorialDevelopmentWorkflowStage = 'idle';
    let tutorialDevelopmentCommitCount = 0;
    let tutorialDevelopmentFilesReviewed = false;
    let tutorialDevelopmentBusy = false;
    let tutorialGitChangeScope = 'untracked';
    let tutorialPreviewStarted = false;
    let tutorialPreviewLaunching = false;
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
    let autoAdvanceTimer = null;
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

    function tutorialText(path, variables = {}, fallback = '') {
      const copy = window.FaberTutorialCopy;
      if (!copy || typeof copy.translate !== 'function') return fallback;
      return copy.translate(getLocale(), path, variables, fallback);
    }

    function tutorialValue(path, fallback = null) {
      const copy = window.FaberTutorialCopy;
      if (!copy || typeof copy.value !== 'function') return fallback;
      return copy.value(getLocale(), path, fallback);
    }

    function tutorialPhrase(value) {
      const copy = window.FaberTutorialCopy;
      if (!copy || typeof copy.translatePhrase !== 'function') return String(value || '');
      return copy.translatePhrase(getLocale(), value);
    }

    function tutorialHtml(value) {
      const copy = window.FaberTutorialCopy;
      if (!copy || typeof copy.translateHtml !== 'function') return String(value || '');
      return copy.translateHtml(getLocale(), value);
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

    function persistTutorialDevelopmentState() {
      writeStorage(TUTORIAL_DEVELOPMENT_STATE_KEY, JSON.stringify({
        batchIndex: tutorialDevelopmentBatchIndex,
        workflowStage: tutorialDevelopmentWorkflowStage,
        commitCount: tutorialDevelopmentCommitCount,
        filesReviewed: tutorialDevelopmentFilesReviewed,
        chatStage: tutorialDevelopmentChatStage,
        conversationComplete: tutorialDevelopmentConversationComplete,
      }));
    }

    function restoreTutorialDevelopmentState() {
      const raw = readStorage(TUTORIAL_DEVELOPMENT_STATE_KEY, '');
      if (!raw) return;
      try {
        const state = JSON.parse(raw);
        const parsedBatchIndex = Number(state.batchIndex);
        tutorialDevelopmentBatchIndex = Number.isFinite(parsedBatchIndex)
          ? Math.max(-1, Math.min(1, parsedBatchIndex))
          : -1;
        tutorialDevelopmentWorkflowStage = String(state.workflowStage || 'idle');
        tutorialDevelopmentCommitCount = Math.max(0, Math.min(2, Number(state.commitCount) || 0));
        tutorialDevelopmentFilesReviewed = Boolean(state.filesReviewed);
        tutorialDevelopmentChatStage = String(state.chatStage || 'compose');
        tutorialDevelopmentConversationComplete = Boolean(state.conversationComplete);
      } catch {
        writeStorage(TUTORIAL_DEVELOPMENT_STATE_KEY, '');
      }
    }

    function resetTutorialDevelopmentState() {
      tutorialDevelopmentChatStage = 'compose';
      tutorialDevelopmentConversationComplete = false;
      tutorialDevelopmentBatchIndex = -1;
      tutorialDevelopmentWorkflowStage = 'idle';
      tutorialDevelopmentCommitCount = 0;
      tutorialDevelopmentFilesReviewed = false;
      tutorialDevelopmentBusy = false;
      tutorialGitChangeScope = 'untracked';
      tutorialPreviewStarted = false;
      tutorialPreviewLaunching = false;
      writeStorage(TUTORIAL_DEVELOPMENT_STATE_KEY, '');
    }

    function getTutorialDevelopmentBatches() {
      const factory = window.FaberTutorialWelcomeProject;
      if (!factory || typeof factory.createWelcomeProjectBatches !== 'function') return [];
      return factory.createWelcomeProjectBatches({ name: tutorialUserName, locale: getLocale() });
    }

    function getTutorialDevelopmentBatch(index = tutorialDevelopmentBatchIndex) {
      return getTutorialDevelopmentBatches()[Number(index)] || null;
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

    function getTutorialCreatedProjectConversationSelector() {
      const project = getTutorialCreatedProject();
      const scope = isLeftWorkspaceCollapsed() ? '#project-rail-lightbox-list' : '#projects-list';
      if (!project || !project.id) return `${scope} .project-item.active .project-mini-btn-new-conv`;
      if (window.CSS && typeof window.CSS.escape === 'function') {
        return `${scope} .project-item[data-project-id="${window.CSS.escape(project.id)}"] .project-mini-btn-new-conv`;
      }
      return `${scope} .project-item.active .project-mini-btn-new-conv`;
    }

    function getNextMapHoverSelector() {
      return MAP_TOOL_HOVER_SELECTORS.find((selector) => !hoveredMapSelectors.has(selector)) || '';
    }

    function getNextRightPanelToolGuide() {
      const tool = RIGHT_PANEL_TOOL_GUIDES.find((candidate) => !hoveredRightPanelSelectors.has(candidate.selector)) || null;
      if (!tool) return null;
      const localizedTools = tutorialValue('rightTools', []);
      return { ...tool, ...(localizedTools[tool.index] || {}) };
    }

    function getTutorialMapNodeEditSelector(nodeId = tutorialMapNodeId) {
      if (!nodeId) return '.map-node.node-text:last-child .map-node-edit-btn';
      if (window.CSS && typeof window.CSS.escape === 'function') {
        return `#${window.CSS.escape(nodeId)} .map-node-edit-btn`;
      }
      return '.map-node.node-text:last-child .map-node-edit-btn';
    }

    function getTutorialMapNodeSelector(nodeId) {
      if (!nodeId) return '.map-node:last-child';
      if (window.CSS && typeof window.CSS.escape === 'function') {
        return `#${window.CSS.escape(nodeId)}`;
      }
      return '.map-node:last-child';
    }

    function getTutorialMapController() {
      if (!options.actions || typeof options.actions.getMapController !== 'function') return null;
      return options.actions.getMapController();
    }

    function getTutorialMapCanvasController() {
      const controller = getTutorialMapController();
      if (!controller || typeof controller.getCanvasController !== 'function') return null;
      return controller.getCanvasController();
    }

    function updateTutorialMapNode(nodeId, updatedData) {
      const canvas = getTutorialMapCanvasController();
      if (!canvas || typeof canvas.updateNode !== 'function') return null;
      return canvas.updateNode(nodeId, updatedData);
    }

    function configureTutorialLogoNode(nodeId) {
      return updateTutorialMapNode(nodeId, {
        title: tutorialText('documents.logo.title'),
        description: tutorialText('documents.logo.description'),
        content: 'assets/Faber-Code-Logo-horizontal.png',
        assetId: 'assets/Faber-Code-Logo-horizontal.png',
        imageFit: 'contain',
        tags: ['marca', 'logo', 'frontend'],
      });
    }

    function arrangeTutorialMarkdownNodes() {
      const canvas = getTutorialMapCanvasController();
      if (!canvas || typeof canvas.getMapData !== 'function' || typeof canvas.updateNode !== 'function') return false;
      const mapData = canvas.getMapData();
      const welcomeNode = mapData.nodes.find((node) => node.id === tutorialWelcomeNodeId);
      const designNode = mapData.nodes.find((node) => node.id === tutorialDesignSystemNodeId);
      if (!welcomeNode || !designNode) return false;

      const centerX = (welcomeNode.position.x + designNode.position.x) / 2;
      const gap = 140;
      const layoutWidth = (CANVAS_NODE_WIDTH * 2) + gap;
      const firstX = Math.max(80, Math.round(centerX - (layoutWidth / 2)));
      const alignedY = Math.max(120, Math.min(welcomeNode.position.y, designNode.position.y));
      canvas.updateNode(welcomeNode.id, { position: { x: firstX, y: alignedY } });
      canvas.updateNode(designNode.id, { position: { x: firstX + CANVAS_NODE_WIDTH + gap, y: alignedY } });
      return true;
    }

    function applyTutorialMapLayout() {
      if (!arrangeTutorialMarkdownNodes()) return false;
      const canvas = getTutorialMapCanvasController();
      if (canvas && typeof canvas.focusNodes === 'function') {
        canvas.focusNodes([tutorialWelcomeNodeId, tutorialDesignSystemNodeId], {
          zoom: TUTORIAL_MAP_AUTO_ZOOM,
          horizontalAnchor: 0.5,
          verticalAnchor: 0.3,
        });
      } else if (canvas && typeof canvas.setZoomLevel === 'function') {
        canvas.setZoomLevel(TUTORIAL_MAP_AUTO_ZOOM);
      } else {
        const slider = resolveElement('#map-zoom-slider');
        if (slider) {
          slider.value = String(TUTORIAL_MAP_AUTO_ZOOM);
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      tutorialMapZoomReady = true;
      tutorialMapBuildStage = 'design-edit';
      return true;
    }

    function configureTutorialFrontendGroup(nodeId) {
      const group = updateTutorialMapNode(nodeId, {
        title: tutorialText('documents.frontendGroup.title'),
        description: tutorialText('documents.frontendGroup.description'),
        position: { x: 450, y: 350 },
        size: { width: 620, height: 230 },
        collapsed: false,
        tags: ['frontend'],
      });
      if (!group) return false;

      const frontendNodes = [
        [tutorialWelcomeNodeId, { x: 200, y: 700 }],
        [tutorialDesignSystemNodeId, { x: 500, y: 880 }],
        [tutorialLogoNodeId, { x: 780, y: 730 }],
      ];
      frontendNodes.forEach(([childId, position]) => {
        if (!childId) return;
        updateTutorialMapNode(childId, { parentId: nodeId, position });
      });
      return true;
    }

    function configureTutorialRulesGroup(nodeId) {
      const canvas = getTutorialMapCanvasController();
      if (!canvas || typeof canvas.addNodeAtCenter !== 'function') return false;
      const group = updateTutorialMapNode(nodeId, {
        title: tutorialText('documents.rulesGroup.title'),
        description: tutorialText('documents.rulesGroup.description'),
        position: { x: 1250, y: 350 },
        size: { width: 460, height: 230 },
        collapsed: false,
        tags: ['regras'],
      });
      if (!group) return false;

      const stamp = Date.now();
      const interfaceRules = canvas.addNodeAtCenter('text', {
        id: `tutorial-interface-rules-${stamp}`,
        title: tutorialText('documents.interfaceRules.title'),
        description: tutorialText('documents.interfaceRules.description'),
        content: tutorialText('documents.interfaceRules.content'),
        parentId: nodeId,
        position: { x: 1500, y: 700 },
        tags: ['regras', 'frontend'],
      });
      const acceptanceRules = canvas.addNodeAtCenter('text', {
        id: `tutorial-acceptance-rules-${stamp}`,
        title: tutorialText('documents.acceptance.title'),
        description: tutorialText('documents.acceptance.description'),
        content: tutorialText('documents.acceptance.content'),
        parentId: nodeId,
        position: { x: 1320, y: 850 },
        tags: ['regras', 'qualidade'],
      });
      tutorialRulesNodeIds = [interfaceRules && interfaceRules.id, acceptanceRules && acceptanceRules.id].filter(Boolean);
      if (tutorialRulesNodeIds.length === 2 && typeof canvas.selectNode === 'function') canvas.selectNode(null);
      return tutorialRulesNodeIds.length === 2;
    }

    function personalizeTutorialWelcomeNode(name) {
      const variables = {
        name,
        github: TUTORIAL_GITHUB_PLACEHOLDER,
        linkedin: TUTORIAL_LINKEDIN_PLACEHOLDER,
      };
      return updateTutorialMapNode(tutorialWelcomeNodeId, {
        title: tutorialText('documents.personalizedWelcome.title', variables),
        description: tutorialText('documents.personalizedWelcome.description', variables),
        content: tutorialText('documents.personalizedWelcome.content', variables),
        tags: ['briefing', 'boas-vindas', 'personalização'],
      });
    }

    function getTutorialArchitectureDefinition(kind) {
      const variables = {
        name: tutorialUserName,
        github: TUTORIAL_GITHUB_PLACEHOLDER,
        linkedin: TUTORIAL_LINKEDIN_PLACEHOLDER,
      };
      const definitions = {
        stack: {
          title: tutorialText('documents.architecture.title'),
          description: tutorialText('documents.architecture.description'),
          position: { x: 200, y: 1050 },
          tags: ['arquitetura', 'nextjs', 'tailwind'],
          content: tutorialText('documents.architecture.content', variables),
        },
        components: {
          title: tutorialText('documents.components.title'),
          description: tutorialText('documents.components.description'),
          position: { x: 500, y: 1100 },
          tags: ['arquitetura', 'componentes', 'frontend'],
          content: tutorialText('documents.components.content', variables),
        },
        content: {
          title: tutorialText('documents.contentLinks.title'),
          description: tutorialText('documents.contentLinks.description'),
          position: { x: 800, y: 1050 },
          tags: ['conteúdo', 'links', 'personalização'],
          content: tutorialText('documents.contentLinks.content', variables),
        },
      };
      return definitions[kind] || null;
    }

    function configureTutorialArchitectureNode(nodeId, kind) {
      const definition = getTutorialArchitectureDefinition(kind);
      if (!definition || !tutorialFrontendGroupId) return false;
      const updated = updateTutorialMapNode(nodeId, {
        ...definition,
        parentId: tutorialFrontendGroupId,
      });
      if (!updated) return false;
      if (!tutorialArchitectureNodeIds.includes(nodeId)) tutorialArchitectureNodeIds.push(nodeId);
      return true;
    }

    function createTutorialArchitectureBundle() {
      const canvas = getTutorialMapCanvasController();
      if (
        !canvas
        || !tutorialFrontendGroupId
        || typeof canvas.getMapData !== 'function'
        || typeof canvas.addNodeAtCenter !== 'function'
      ) return false;

      const mapData = canvas.getMapData();
      const nodes = Array.isArray(mapData && mapData.nodes) ? mapData.nodes : [];
      const stamp = Date.now();
      tutorialArchitectureNodeIds = [];

      for (const kind of ['stack', 'components', 'content']) {
        const definition = getTutorialArchitectureDefinition(kind);
        if (!definition) return false;
        const marker = `tutorial-architecture-${kind}`;
        let node = nodes.find((candidate) => (
          candidate
          && (
            candidate.title === definition.title
            || (Array.isArray(candidate.tags) && candidate.tags.includes(marker))
          )
        ));
        if (!node) {
          node = canvas.addNodeAtCenter('text', {
            id: `${marker}-${stamp}`,
            ...definition,
            parentId: tutorialFrontendGroupId,
            tags: [...definition.tags, marker],
          });
        } else {
          node = updateTutorialMapNode(node.id, {
            ...definition,
            parentId: tutorialFrontendGroupId,
            tags: [...definition.tags, marker],
          });
        }
        if (!node || !node.id) return false;
        tutorialArchitectureNodeIds.push(node.id);
      }

      if (typeof canvas.selectNode === 'function') canvas.selectNode(null);
      focusTutorialDevelopmentMap();
      return tutorialArchitectureNodeIds.length === 3;
    }

    function prepareTutorialArchitectureNode(nodeId, kind) {
      if (!configureTutorialArchitectureNode(nodeId, kind)) return false;
      tutorialMapNodeId = nodeId;
      tutorialMapInspectorOpened = false;
      tutorialMapBuildStage = `architecture-${kind}-edit`;
      focusTutorialMapNodeForEditing(nodeId);
      return true;
    }

    function focusTutorialMapNodeForEditing(nodeId) {
      const canvas = getTutorialMapCanvasController();
      if (!canvas || !nodeId) return false;
      if (typeof canvas.selectNode === 'function') canvas.selectNode(null);
      if (typeof canvas.focusNodes === 'function') {
        return canvas.focusNodes([nodeId], {
          zoom: TUTORIAL_MAP_AUTO_ZOOM,
          horizontalAnchor: 0.58,
          verticalAnchor: 0.5,
        });
      }
      return typeof canvas.setZoomLevel === 'function'
        ? canvas.setZoomLevel(TUTORIAL_MAP_AUTO_ZOOM)
        : false;
    }

    function focusTutorialDevelopmentMap() {
      const canvas = getTutorialMapCanvasController();
      if (!canvas) return false;
      const nodeIds = [
        tutorialFrontendGroupId,
        tutorialRulesGroupId,
        tutorialWelcomeNodeId,
        tutorialDesignSystemNodeId,
        tutorialLogoNodeId,
        ...tutorialArchitectureNodeIds,
        ...tutorialRulesNodeIds,
      ].filter(Boolean);
      if (typeof canvas.selectNode === 'function') canvas.selectNode(null);
      if (typeof canvas.focusNodes === 'function' && nodeIds.length) {
        return canvas.focusNodes(nodeIds, {
          zoom: TUTORIAL_MAP_AUTO_ZOOM,
          horizontalAnchor: 0.5,
          verticalAnchor: 0.42,
        });
      }
      if (typeof canvas.setZoomLevel === 'function') return canvas.setZoomLevel(TUTORIAL_MAP_AUTO_ZOOM);
      return false;
    }

    function applyTutorialMapGapCorrection() {
      const canvas = getTutorialMapCanvasController();
      if (!canvas || typeof canvas.getMapData !== 'function' || typeof canvas.addNodeAtCenter !== 'function') return false;
      const actionButton = resolveElement('#btn-map-chat-add-gap');
      if (actionButton) actionButton.disabled = true;
      tutorialMapChatStage = 'applying-gap';
      const controller = getTutorialMapController();
      if (controller && typeof controller.showTutorialMapCanvas === 'function') {
        controller.showTutorialMapCanvas();
      }
      const mapData = canvas.getMapData();
      let gapNode = (mapData.nodes || []).find((node) => (
        node
        && (
          node.id === tutorialMapGapNodeId
          || node.title === tutorialText('documents.gap.title', {}, 'SEO e Estados da Interface')
          || (Array.isArray(node.tags) && node.tags.includes('tutorial-gap'))
        )
      ));

      if (!gapNode) {
        gapNode = canvas.addNodeAtCenter('text', {
          id: `tutorial-map-gap-${Date.now()}`,
          title: tutorialText('documents.gap.title', {}, 'SEO e Estados da Interface'),
          description: tutorialText('documents.gap.description', {}, 'Metadados, acessibilidade e estados necessários antes da análise do projeto.'),
          content: tutorialText('documents.gap.content', {}, ''),
          parentId: tutorialRulesGroupId || undefined,
          position: { x: 1600, y: 1030 },
          tags: ['tutorial-gap', 'regras', 'seo', 'acessibilidade'],
        });
      }
      if (!gapNode || !gapNode.id) {
        tutorialMapChatStage = 'missing-info';
        if (actionButton) actionButton.disabled = false;
        renderStep();
        return false;
      }

      tutorialMapGapNodeId = gapNode.id;
      if (!tutorialRulesNodeIds.includes(gapNode.id)) tutorialRulesNodeIds.push(gapNode.id);
      if (typeof canvas.selectNode === 'function') canvas.selectNode(null);
      if (typeof canvas.focusNodes === 'function') {
        canvas.focusNodes([tutorialRulesGroupId, gapNode.id].filter(Boolean), {
          zoom: TUTORIAL_MAP_AUTO_ZOOM,
          horizontalAnchor: 0.5,
          verticalAnchor: 0.42,
        });
      }
      tutorialMapChatStage = 'adjustment-complete';
      tutorialMapConversationComplete = true;
      renderStep();
      return true;
    }

    function prepareTutorialMapAnalysisPanel() {
      const controller = getTutorialMapController();
      if (!controller || typeof controller.prepareTutorialMapAnalysis !== 'function') return false;
      return controller.prepareTutorialMapAnalysis();
    }

    function prepareTutorialMapAnalysisHistory() {
      const controller = getTutorialMapController();
      if (!controller || typeof controller.prepareTutorialMapHistory !== 'function') return false;
      return controller.prepareTutorialMapHistory();
    }

    function submitTutorialUserName() {
      const current = steps()[currentStepIndex];
      if (!active || !current || current.id !== 'map-build' || tutorialMapBuildStage !== 'user-name') return false;
      const rawName = String(elements.tutorialNameInput && elements.tutorialNameInput.value || '');
      const normalizedName = rawName.replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!normalizedName) {
        if (elements.tutorialNameError) elements.tutorialNameError.textContent = tutorialText('ui.nameRequired', {}, 'Digite seu nome para continuar.');
        if (elements.tutorialNameInput) {
          elements.tutorialNameInput.setAttribute('aria-invalid', 'true');
          elements.tutorialNameInput.focus();
        }
        return false;
      }

      tutorialUserName = normalizedName;
      writeStorage(TUTORIAL_USER_NAME_KEY, normalizedName);
      if (tutorialWelcomeNodeId && !personalizeTutorialWelcomeNode(normalizedName)) {
        if (elements.tutorialNameError) elements.tutorialNameError.textContent = tutorialText('ui.namePersonalizeError', {}, 'Não foi possível personalizar o briefing. Tente novamente.');
        return false;
      }
      if (elements.tutorialNameInput) {
        elements.tutorialNameInput.value = normalizedName;
        elements.tutorialNameInput.removeAttribute('aria-invalid');
      }
      if (elements.tutorialNameError) elements.tutorialNameError.textContent = '';
      if (tutorialFrontendGroupId && !createTutorialArchitectureBundle()) {
        if (elements.tutorialNameError) elements.tutorialNameError.textContent = tutorialText('ui.nameDocumentsError', {}, 'Não foi possível organizar os documentos técnicos. Tente novamente.');
        return false;
      }
      tutorialDevelopmentReady = true;
      tutorialMapBuildStage = 'development-ready';
      renderStep();
      return true;
    }

    function isTutorialMapInspectorOpen() {
      const inspector = resolveVisibleElement('#workspace-map-inspector-panel');
      return Boolean(
        tutorialMapNodeId
        && inspector
        && inspector.classList.contains('open')
        && doc.body.classList.contains('mode-map-inspector')
      );
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

    function refreshSidebarTutorialGuide() {
      window.setTimeout(() => {
        if (!isSidebarTutorialStep()) return;
        refreshTutorialContext();
        renderStep();
      }, 0);
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
        refreshSidebarTutorialGuide();
        return { handled: true, closeModal: true };
      }
      if (payload.mode === 'deleted' && payload.action === 'delete' && sidebarDemoStage === 'trashed') {
        sidebarDemoStage = 'deleted';
        syncTutorialRuntime();
        dispatchTutorialProjectsChanged();
        refreshSidebarTutorialGuide();
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
        refreshSidebarTutorialGuide();
        return true;
      }
      return action === 'rename' || action === 'archive';
    }

    function syncTutorialRuntime() {
      if (doc.body) doc.body.classList.toggle('progressive-tutorial-active', active);
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
        element.classList.remove('progressive-target-positioned');
      });
      highlightedElements = [];
    }

    function highlightTargets(selectors = []) {
      clearHighlights();
      highlightedElements = selectors
        .map((selector) => resolveVisibleElement(selector))
        .filter((element) => isVisibleElement(element));
      highlightedElements.forEach((element) => {
        if (window.getComputedStyle(element).position === 'static') {
          element.classList.add('progressive-target-positioned');
        }
        element.classList.add('progressive-target-active');
      });
    }

    function getUnionRectFromSelectors(selectors = []) {
      const visible = selectors
        .map((selector) => resolveVisibleElement(selector))
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
      if (!guide || guide.disableSpotlight) {
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
      return tutorialText('api.serviceName', {}, 'API de exemplo do tutorial');
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

    function discardTutorialApiDraft() {
      restoreTutorialFieldDecorators();
      if (!isModalOpen('#ai-settings-modal')) return;
      if (typeof actions.closeApis === 'function') {
        actions.closeApis();
        return;
      }
      const cancel = resolveElement('#ai-settings-cancel');
      if (cancel && typeof cancel.click === 'function') cancel.click();
    }

    function finishTutorialApiDemoAfterModalClose() {
      const watchClose = () => {
        if (!active) return;
        if (isModalOpen('#ai-settings-modal')) {
          window.setTimeout(watchClose, 120);
          return;
        }
        apiDemoPrepared = true;
        apiEditorSaved = true;
        restoreTutorialFieldDecorators();
        refreshTutorialContext();
        renderStep();
        const current = steps()[currentStepIndex];
        if (current && current.id === 'apis') nextStep();
      };
      window.setTimeout(watchClose, 80);
    }


    function positionCursorLabel() {
      if (!elements.tutorialCursorLabel) return;
      if (elements.tutorialCursorLabel.classList.contains('hidden')) return;
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

    function setCursorLabel(label) {
      if (!elements.tutorialCursorLabel) return;
      if (!label) {
        setVisible(elements.tutorialCursorLabel, false);
        return;
      }
      elements.tutorialCursorLabel.textContent = tutorialPhrase(label);
      setVisible(elements.tutorialCursorLabel, true);
      positionCursorLabel();
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

    function waitForElement(selector, { timeout = POLLING_TIMEOUT_MS, visible = false, runId } = {}) {
      return new Promise((resolve) => {
        const check = () => {
          const el = visible ? resolveVisibleElement(selector) : resolveElement(selector);
          if (el) return el;
          return null;
        };
        const existing = check();
        if (existing) { resolve(existing); return; }

        let resolved = false;
        const observer = new MutationObserver(() => {
          if (runId != null && runId !== demoRunId) { cleanup(); resolve(null); return; }
          const el = check();
          if (el) { cleanup(); resolve(el); }
        });
        const timer = setTimeout(() => { cleanup(); resolve(null); }, timeout);

        function cleanup() {
          if (resolved) return;
          resolved = true;
          observer.disconnect();
          clearTimeout(timer);
        }

        observer.observe(doc.body, { childList: true, subtree: true, attributes: true });
      });
    }

    function waitForFocus(selector, { timeout = POLLING_TIMEOUT_MS, runId } = {}) {
      return new Promise((resolve) => {
        const check = () => {
          if (document.activeElement) {
            if (document.activeElement.matches(selector) || document.activeElement.closest(selector)) return document.activeElement;
          }
          return null;
        };
        const existing = check();
        if (existing) { resolve(existing); return; }

        let resolved = false;
        const observer = new MutationObserver(() => {
          if (runId != null && runId !== demoRunId) { cleanup(); resolve(null); return; }
          const el = check();
          if (el) { cleanup(); resolve(el); }
        });
        const timer = setTimeout(() => { cleanup(); resolve(null); }, timeout);

        function cleanup() {
          if (resolved) return;
          resolved = true;
          observer.disconnect();
          clearTimeout(timer);
        }

        observer.observe(doc.body, { childList: true, subtree: true, attributes: true });
      });
    }


    async function animateCursorTo(selector, options = {}) {
      const runId = options.runId;
      let element = resolveVisibleElement(selector) || resolveElement(selector);
      if (!element && typeof selector === 'string') {
        element = document.querySelector(selector); // Fallback force
      }
      if (!element) {
                return false;
      }
      if (runId != null && runId !== demoRunId) {
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
      setCursorLabel(options.hideLabel ? '' : (options.label || getElementLabel(element)));
      if (options.focusTarget) showSpotlightAroundElement(element);
      const stillActive = await wait((options.duration || 480) + 70, runId);
      if (options.pulse) pulseElement(element);
      if (stillActive && options.trackTarget) {
        startElementCursorTracking(selector, {
          ...options,
          label: options.hideLabel ? '' : (options.label || getElementLabel(element)),
        });
      }
      return stillActive;
    }

    function startElementCursorTracking(selector, options = {}) {
      const { runId } = options;
      let previousX = Number.NaN;
      let previousY = Number.NaN;

      const intervalId = window.setInterval(() => {
        if (!active || (runId != null && runId !== demoRunId)) {
          window.clearInterval(intervalId);
          return;
        }

        const element = resolveVisibleElement(selector) || resolveElement(selector);
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const x = Math.round(rect.left + (rect.width / 2) + (options.offsetX || 0));
        const y = Math.round(rect.top + (rect.height / 2) + (options.offsetY || 0));
        if (!Number.isFinite(x) || !Number.isFinite(y) || (x === previousX && y === previousY)) return;

        previousX = x;
        previousY = y;
        cursorPosition = { x, y };
        if (elements.tutorialCursor) {
          elements.tutorialCursor.style.transitionDuration = '0ms';
          elements.tutorialCursor.style.left = `${x}px`;
          elements.tutorialCursor.style.top = `${y}px`;
          if (!cursorSuppressed) setVisible(elements.tutorialCursor, true);
        }
        if (options.label && elements.tutorialCursorLabel && elements.tutorialCursorLabel.textContent !== options.label) {
          setCursorLabel(options.label);
        } else {
          positionCursorLabel();
        }
      }, TRACKING_INTERVAL_MS);

      return () => window.clearInterval(intervalId);
    }
    function startCanvasNodeTracking(nodeIndex, options = {}) {
      const { runId, mapController, label } = options;
      let stopped = false;
      const canvasController = typeof mapController.getCanvasController === 'function' ? mapController.getCanvasController() : null;
      const mapContainer = document.getElementById('workspace-map-region');

      let initialMoveDone = false;

      const intervalId = setInterval(() => {
        if (stopped || !active || (runId != null && runId !== demoRunId)) {
          clearInterval(intervalId);
          return;
        }

        if (!canvasController || !mapContainer) return;

        try {
          const mapData = typeof canvasController.getMapData === 'function' ? canvasController.getMapData() : null;
          if (!mapData || !mapData.nodes || !mapData.nodes[nodeIndex]) return;

          const node = mapData.nodes[nodeIndex];
          const panOffset = typeof mapController.getPanOffset === 'function' ? mapController.getPanOffset() : { x: 0, y: 0 };
          const zoomLevel = typeof mapController.getZoomLevel === 'function' ? mapController.getZoomLevel() : 1;
          const rect = mapContainer.getBoundingClientRect();

          const targetX = node.position.x + CANVAS_NODE_WIDTH - CANVAS_EDIT_BTN_OFFSET_X;
          const targetY = node.position.y + CANVAS_EDIT_BTN_OFFSET_Y;

          const screenX = Math.round(rect.left + panOffset.x + (targetX * zoomLevel));
          const screenY = Math.round(rect.top + panOffset.y + (targetY * zoomLevel));

          cursorPosition = { x: screenX, y: screenY };
          const cursor = elements.tutorialCursor;
          if (cursor && !isNaN(screenX) && !isNaN(screenY)) {
            if (!initialMoveDone) {
              cursor.style.transitionDuration = CURSOR_ANIMATION_MS + 'ms';
              initialMoveDone = true;
            } else {
              cursor.style.transitionDuration = '100ms';
            }
            cursor.style.left = `${screenX}px`;
            cursor.style.top = `${screenY}px`;
            if (!cursorSuppressed) setVisible(elements.tutorialCursor, true);
            setCursorLabel(label || 'Clique no ícone de lápis para editar');
          }
        } catch (e) {
          // Silent catch
        }
      }, TRACKING_INTERVAL_MS);

      return {
        stop() {
          stopped = true;
          clearInterval(intervalId);
        }
      };
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
          targets: ['#cortex-modal-close'],
          revealSelectors: ['#cortex-modal-close'],
          revealPadding: 10,
          disableSpotlight: true,
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
      if (isVisibleElement(resolveElement('#ai-settings-cancel')) && apiEditorSaved && !isVisibleElement(resolveElement('#ai-settings-editor-key'))) {
        return {
          signature: 'apis:discard-modal',
          targets: ['#ai-settings-cancel'],
          revealSelectors: ['#ai-settings-modal'],
          revealPadding: 18,
          hint: translate('apiSaveHint'),
          demo: async ({ runId }) => {
            await scrollModalBodyToElement('#ai-settings-cancel', { runId, block: 'end', afterDelay: 180 });
            await animateCursorTo('#ai-settings-cancel', {
              runId,
              pulse: true,
              duration: 900,
              label: 'Cancelar e continuar',
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
      if ((!tutorialMapIconClicked || !isMapTabOpen()) && isLeftWorkspaceCollapsed()) {
        return {
          signature: 'map:restore-left-for-project',
          targets: ['#workspace-collapse-left'],
          revealSelectors: ['#workspace-collapse-left', '.panel-left'],
          revealPadding: 16,
          hint: 'Expanda o painel esquerdo para acessar o projeto criado.',
          demo: async ({ runId }) => {
            await animateCursorTo('#workspace-collapse-left', {
              runId,
              pulse: true,
              label: 'Expandir painel esquerdo',
            });
          },
        };
      }

      if (!tutorialMapIconClicked || !isMapTabOpen()) {
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

    function getMapBuildGuide() {
      const makeGuide = ({
        signature,
        target,
        hint,
        label,
        revealSelectors,
        interactiveSelectors,
        disableCursor = false,
      }) => ({
        signature: `map-build:${signature}`,
        targets: [target],
        revealSelectors: revealSelectors || ['#workspace-map-region', target],
        interactiveSelectors: interactiveSelectors || [],
        revealPadding: 18,
        hint,
        disableCursor,
        demo: disableCursor
          ? null
          : label
            ? async ({ runId }) => {
                await animateCursorTo(target, {
                  runId,
                  pulse: true,
                  label,
                  trackTarget: true,
                });
              }
            : null,
      });

      if (tutorialMapBuildStage === 'welcome-create') {
        return makeGuide({
          signature: 'welcome-create',
          target: '#btn-map-tool-add-card',
          hint: 'Clique em Novo Markdown para criar o briefing da página de boas-vindas.',
          label: 'Criar briefing de boas-vindas',
          revealSelectors: ['#workspace-map-region', '.application-map-toolbar'],
        });
      }
      if (tutorialMapBuildStage === 'welcome-edit') {
        const target = getTutorialMapNodeEditSelector(tutorialWelcomeNodeId);
        return makeGuide({
          signature: `welcome-edit:${tutorialWelcomeNodeId}`,
          target,
          hint: 'Clique no lápis do Markdown criado para abrir os detalhes do item.',
          label: 'Editar briefing',
        });
      }
      if (tutorialMapBuildStage === 'welcome-title') {
        return makeGuide({
          signature: 'welcome-title',
          target: '#inspector-node-title',
          hint: 'Clique no campo Título. O tutorial escreverá o título do briefing.',
          label: 'Preencher título',
          revealSelectors: ['#workspace-map-inspector-panel'],
        });
      }
      if (tutorialMapBuildStage === 'welcome-description') {
        return makeGuide({
          signature: 'welcome-description',
          target: '#inspector-node-desc',
          hint: 'Clique em Descrição para registrar o objetivo da página estática.',
          label: 'Preencher descrição',
          revealSelectors: ['#workspace-map-inspector-panel'],
        });
      }
      if (tutorialMapBuildStage === 'welcome-content') {
        return makeGuide({
          signature: 'welcome-content',
          target: '#workspace-map-inspector-panel .CodeMirror',
          hint: 'Clique no editor Markdown para inserir o briefing completo com “Olá Mundo”, boas-vindas e direção visual.',
          label: 'Escrever briefing',
          revealSelectors: ['#workspace-map-inspector-panel'],
        });
      }
      if (tutorialMapBuildStage === 'welcome-close') {
        return makeGuide({
          signature: 'welcome-close',
          target: '#btn-map-inspector-close',
          hint: 'O primeiro briefing está pronto. Clique no X para voltar ao mapa.',
          label: 'Fechar detalhes',
          revealSelectors: ['#workspace-map-inspector-panel'],
        });
      }
      if (tutorialMapBuildStage === 'design-create') {
        return makeGuide({
          signature: 'design-create',
          target: '#btn-map-tool-add-card',
          hint: 'Crie outro Markdown para documentar o Design System do Faber Code.',
          label: 'Criar Design System',
          revealSelectors: ['#workspace-map-region', '.application-map-toolbar'],
        });
      }
      if (tutorialMapBuildStage === 'design-collapse-right') {
        return makeGuide({
          signature: 'design-collapse-right',
          target: '#workspace-collapse-right',
          hint: 'Recolha o painel direito para ganhar espaço e organizar os dois Markdowns no mapa.',
          label: 'Recolher painel direito',
          revealSelectors: ['#workspace-collapse-right', '#workspace-map-region'],
        });
      }
      if (tutorialMapBuildStage === 'design-edit') {
        const target = getTutorialMapNodeEditSelector(tutorialDesignSystemNodeId);
        return makeGuide({
          signature: `design-edit:${tutorialDesignSystemNodeId}`,
          target,
          hint: 'Os Markdowns estão organizados lado a lado. Clique no lápis do novo item para documentar cores e tipografias.',
          label: 'Editar Design System',
        });
      }
      if (tutorialMapBuildStage === 'design-title') {
        return makeGuide({
          signature: 'design-title',
          target: '#inspector-node-title',
          hint: 'Clique no Título para identificar este documento como Design System Faber Code.',
          label: 'Preencher título',
          revealSelectors: ['#workspace-map-inspector-panel'],
        });
      }
      if (tutorialMapBuildStage === 'design-description') {
        return makeGuide({
          signature: 'design-description',
          target: '#inspector-node-desc',
          hint: 'Clique em Descrição para resumir o propósito deste documento.',
          label: 'Preencher descrição',
          revealSelectors: ['#workspace-map-inspector-panel'],
        });
      }
      if (tutorialMapBuildStage === 'design-content') {
        return makeGuide({
          signature: 'design-content',
          target: '#workspace-map-inspector-panel .CodeMirror',
          hint: 'Clique no editor para inserir as cores, tipografias e regras visuais da marca.',
          label: 'Escrever Design System',
          revealSelectors: ['#workspace-map-inspector-panel'],
        });
      }
      if (tutorialMapBuildStage === 'design-close') {
        return makeGuide({
          signature: 'design-close',
          target: '#btn-map-inspector-close',
          hint: 'O Design System está documentado. Feche os detalhes para continuar.',
          label: 'Fechar detalhes',
          revealSelectors: ['#workspace-map-inspector-panel'],
        });
      }
      if (tutorialMapBuildStage === 'logo-create') {
        return makeGuide({
          signature: 'logo-create',
          target: '#btn-map-tool-add-image',
          hint: 'Clique em Referência Visual. O tutorial inserirá o logo horizontal oficial do Faber Code.',
          label: 'Inserir logo Faber Code',
          revealSelectors: ['#workspace-map-region', '.application-map-toolbar'],
        });
      }
      if (tutorialMapBuildStage === 'frontend-group') {
        return makeGuide({
          signature: 'frontend-group',
          target: '#btn-map-tool-add-group',
          hint: 'Clique em Novo Grupo para organizar o briefing, o Design System e o logo em Frontend.',
          label: 'Criar grupo Frontend',
          revealSelectors: ['#workspace-map-region', '.application-map-toolbar'],
        });
      }
      if (tutorialMapBuildStage === 'rules-group') {
        return makeGuide({
          signature: 'rules-group',
          target: '#btn-map-tool-add-group',
          hint: 'Crie mais um grupo. Ele receberá as regras de interface e os critérios de aceite.',
          label: 'Criar grupo Regras',
          revealSelectors: ['#workspace-map-region', '.application-map-toolbar'],
        });
      }
      if (tutorialMapBuildStage === 'user-name') {
        return makeGuide({
          signature: 'user-name',
          target: '#progressive-tutorial-name-input',
          hint: 'Digite seu nome e confirme. O briefing será personalizado com uma saudação feita para você.',
          label: 'Digite seu nome',
          revealSelectors: ['#progressive-tutorial-name-prompt'],
        });
      }
      const architectureStageMatch = /^architecture-(stack|components|content)-(edit|review)$/.exec(tutorialMapBuildStage);
      if (architectureStageMatch) {
        const [, kind, phase] = architectureStageMatch;
        const labels = {
          stack: {
            name: tutorialText('documents.architecture.title'),
            editHint: 'O Markdown de arquitetura foi preparado. Clique no lápis para abrir e revisar Next.js, JavaScript e Tailwind CSS.',
          },
          components: {
            name: tutorialText('documents.components.title'),
            editHint: 'O Markdown de componentes foi criado. Clique no lápis para abrir e revisar as responsabilidades da interface.',
          },
          content: {
            name: tutorialText('documents.contentLinks.title'),
            editHint: 'O último Markdown foi criado. Clique no lápis para revisar a saudação e os placeholders de GitHub e LinkedIn.',
          },
        };
        const copy = labels[kind];
        if (phase === 'edit') {
          return makeGuide({
            signature: `architecture-${kind}-edit:${tutorialMapNodeId}`,
            target: getTutorialMapNodeEditSelector(tutorialMapNodeId),
            hint: copy.editHint,
            label: `Editar ${copy.name}`,
          });
        }
        return makeGuide({
          signature: `architecture-${kind}-review:${tutorialMapNodeId}`,
          target: '#btn-map-inspector-close',
          hint: `Revise ou edite o título, a descrição e o conteúdo de ${copy.name}. Quando estiver pronto, clique no X para concluir este Markdown.`,
          label: `Concluir ${copy.name}`,
          revealSelectors: ['#workspace-map-inspector-panel'],
          interactiveSelectors: ['#workspace-map-inspector-panel'],
        });
      }
      if (tutorialMapBuildStage === 'architecture-stack-create') {
        return makeGuide({
          signature: 'architecture-stack-create',
          target: '#btn-map-tool-add-card',
          hint: `Olá, ${tutorialUserName}. Crie um Markdown para registrar Next.js, JavaScript e Tailwind CSS como arquitetura do demonstrativo.`,
          label: 'Criar arquitetura frontend',
          revealSelectors: ['#workspace-map-region', '.application-map-toolbar'],
        });
      }
      if (tutorialMapBuildStage === 'architecture-components-create') {
        return makeGuide({
          signature: 'architecture-components-create',
          target: '#btn-map-tool-add-card',
          hint: 'Crie outro Markdown para documentar os componentes e suas responsabilidades.',
          label: 'Criar componentes da página',
          revealSelectors: ['#workspace-map-region', '.application-map-toolbar'],
        });
      }
      if (tutorialMapBuildStage === 'architecture-content-create') {
        return makeGuide({
          signature: 'architecture-content-create',
          target: '#btn-map-tool-add-card',
          hint: 'Crie o último Markdown com os textos da página e placeholders para GitHub e LinkedIn.',
          label: 'Criar conteúdo e links',
          revealSelectors: ['#workspace-map-region', '.application-map-toolbar'],
        });
      }
      if (tutorialMapBuildStage === 'development-ready') {
        return makeGuide({
          signature: 'development-ready',
          target: '#workspace-map-region',
          hint: `Mapa pronto para desenvolvimento: saudação para ${tutorialUserName}, Design System, arquitetura Next.js com Tailwind, componentes, regras, conteúdo e links placeholders. Agora o tutorial abrirá a apresentação do painel direito.`,
          label: '',
          revealSelectors: ['#workspace-map-region'],
          disableCursor: true,
        });
      }
      return makeGuide({
        signature: 'complete',
        target: '#workspace-map-region',
        hint: 'Finalize as informações do mapa antes de avançar.',
        label: '',
        revealSelectors: ['#workspace-map-region'],
      });
    }

    function getMapChatGuide() {
      if (tutorialMapChatStage === 'expand-right' && isRightWorkspaceCollapsed()) {
        return {
          signature: 'map-chat:expand-right',
          targets: ['#workspace-restore-right'],
          revealSelectors: ['#workspace-restore-right', '#workspace-map-region'],
          revealPadding: 16,
          hint: 'Expanda o painel direito para conhecer as ferramentas disponíveis antes de abrir o chat do mapa.',
          demo: async ({ runId }) => {
            await animateCursorTo('#workspace-restore-right', { runId, pulse: true, label: 'Expandir painel direito' });
          },
        };
      }
      if (tutorialMapChatStage === 'expand-right' || tutorialMapChatStage === 'right-tools') {
        const nextTool = getNextRightPanelToolGuide();
        if (nextTool) {
          return {
            signature: `map-chat:right-tool:${nextTool.selector}`,
            targets: [nextTool.selector],
            revealSelectors: ['#workspace-actions-region', nextTool.selector],
            revealPadding: 14,
            hint: `Passe o mouse sobre ${nextTool.label}: esta ferramenta ${nextTool.description}.`,
            demo: async ({ runId }) => {
              await animateCursorTo(nextTool.selector, { runId, pulse: true, label: nextTool.label });
            },
          };
        }
      }
      if (tutorialMapChatStage === 'open') {
        return {
          signature: 'map-chat:open',
          targets: ['#btn-map-ai'],
          revealSelectors: ['#workspace-actions-region', '#btn-map-ai'],
          revealPadding: 18,
          hint: 'Clique em IA do Mapa para iniciar uma conversa contextualizada.',
          demo: async ({ runId }) => {
            await animateCursorTo('#btn-map-ai', { runId, pulse: true, label: 'Abrir IA do Mapa' });
          },
        };
      }
      if (tutorialMapChatStage === 'compose') {
        return {
          signature: 'map-chat:compose',
          targets: ['#map-chat-textarea'],
          revealSelectors: ['#workspace-map-chat-panel'],
          revealPadding: 18,
          hint: 'Clique no campo de texto. O tutorial escreverá uma pergunta para revisar o mapa antes da análise.',
          demo: async ({ runId }) => {
            await animateCursorTo('#map-chat-textarea', { runId, pulse: true, label: 'Escrever pergunta' });
          },
        };
      }
      if (tutorialMapChatStage === 'send') {
        return {
          signature: 'map-chat:send',
          targets: ['#btn-map-chat-send'],
          revealSelectors: ['#workspace-map-chat-panel'],
          revealPadding: 18,
          hint: 'Clique em Enviar para ver a resposta simulada da IA sobre o mapa criado.',
          demo: async ({ runId }) => {
            await animateCursorTo('#btn-map-chat-send', { runId, pulse: true, label: 'Enviar pergunta' });
          },
        };
      }
      if (tutorialMapChatStage === 'missing-info') {
        return {
          signature: 'map-chat:missing-info',
          targets: ['#btn-map-chat-add-gap'],
          revealSelectors: ['#btn-map-chat-add-gap'],
          revealPadding: 12,
          disableHighlight: true,
          hint: 'A conversa identificou a lacuna. Clique em Adicionar documento de SEO ao mapa para voltar ao canvas e registrar a informação no grupo Regras.',
          demo: async ({ runId }) => {
            await animateCursorTo('#btn-map-chat-add-gap', { runId, pulse: true, label: 'Adicionar SEO ao mapa' });
          },
        };
      }
      if (tutorialMapChatStage === 'adjustment-complete') {
        const target = getTutorialMapNodeSelector(tutorialMapGapNodeId);
        return {
          signature: `map-chat:adjustment-complete:${tutorialMapGapNodeId}`,
          targets: [target],
          revealSelectors: ['#workspace-map-region', target],
          revealPadding: 18,
          hint: 'O tutorial voltou ao mapa e adicionou “SEO e Estados da Interface” ao grupo Regras. A análise do projeto será aberta em seguida.',
          demo: async ({ runId }) => {
            await animateCursorTo(target, { runId, pulse: true, label: 'Informação adicionada ao mapa' });
          },
        };
      }
      return {
        signature: `map-chat:${tutorialMapChatStage}`,
        targets: ['#map-chat-log'],
        revealSelectors: ['#workspace-map-chat-panel'],
        revealPadding: 18,
        hint: 'A resposta é emulada localmente para ensinar o fluxo sem consumir créditos ou exigir uma API.',
        demo: null,
      };
    }

    function getMapAnalysisGuide() {
      if (tutorialMapAnalysisStage === 'history-loading') {
        return {
          signature: 'map-analysis:history-loading',
          targets: [],
          revealSelectors: [],
          disableCursor: true,
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Carregando o histórico corrigido do mapa.',
          demo: null,
        };
      }
      if (tutorialMapAnalysisStage === 'history') {
        return {
          signature: 'map-analysis:history',
          targets: ['#btn-map-render-launcher'],
          revealSelectors: ['#btn-map-render-launcher'],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'A correção ficou registrada no histórico. Clique em Renderizar o Mapa para transformar os documentos em um plano de desenvolvimento.',
          demo: async ({ runId }) => {
            await animateCursorTo('#btn-map-render-launcher', { runId, hideLabel: true });
          },
        };
      }
      if (tutorialMapAnalysisStage === 'render-list') {
        return {
          signature: 'map-analysis:render-list',
          targets: ['#btn-map-render-open'],
          revealSelectors: ['#btn-map-render-open'],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Clique em Renderizar o Mapa. Nesta demonstração, a análise será local e não consumirá créditos de nenhuma API.',
          demo: async ({ runId }) => {
            await animateCursorTo('#btn-map-render-open', { runId, hideLabel: true });
          },
        };
      }
      if (tutorialMapAnalysisStage === 'rendering') {
        return {
          signature: 'map-analysis:rendering',
          targets: [],
          revealSelectors: [],
          disableCursor: true,
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'O Faber Code está lendo o mapa e seus Markdowns para montar a sequência completa de desenvolvimento.',
          demo: null,
        };
      }
      if (tutorialMapAnalysisStage === 'plan-ready') {
        return {
          signature: 'map-analysis:plan-ready',
          targets: ['#btn-map-render-save'],
          revealSelectors: ['#btn-map-render-save'],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'O planejamento está pronto e cada etapa cita os Markdowns importantes. Clique em Salvar em Milestones.',
          demo: async ({ runId }) => {
            await animateCursorTo('#btn-map-render-save', { runId, hideLabel: true });
          },
        };
      }
      if (tutorialMapAnalysisStage === 'confirm') {
        const confirmButton = resolveElement('#faber-confirm-yes');
        if (confirmButton) confirmButton.textContent = tutorialText('ui.continue');
        return {
          signature: 'map-analysis:confirm',
          targets: ['#faber-confirm-yes'],
          revealSelectors: ['#faber-confirm-yes'],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Confirme clicando em Continuar para gravar o planejamento no projeto.',
          demo: async ({ runId }) => {
            await animateCursorTo('#faber-confirm-yes', { runId, hideLabel: true });
          },
        };
      }
      if (tutorialMapAnalysisStage === 'saving') {
        return {
          signature: 'map-analysis:saving',
          targets: [],
          revealSelectors: [],
          disableCursor: true,
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Salvando as milestones e gerando a documentação do planejamento dentro do projeto.',
          demo: null,
        };
      }
      if (tutorialMapAnalysisStage === 'milestones') {
        return {
          signature: 'map-analysis:milestones',
          targets: ['#btn-project-milestones'],
          revealSelectors: ['#btn-project-milestones'],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'As etapas foram salvas. Clique em Milestones no painel direito para encontrá-las.',
          demo: async ({ runId }) => {
            await animateCursorTo('#btn-project-milestones', { runId, hideLabel: true });
          },
        };
      }
      if (tutorialMapAnalysisStage === 'milestones-loading') {
        return {
          signature: 'map-analysis:milestones-loading',
          targets: [],
          revealSelectors: [],
          disableCursor: true,
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Carregando o planejamento salvo no projeto.',
          demo: null,
        };
      }
      if (tutorialMapAnalysisStage === 'milestone-open') {
        return {
          signature: 'map-analysis:milestone-open',
          targets: ['.milestone-item:first-child .milestone-card'],
          revealSelectors: ['.milestone-item:first-child .milestone-card'],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Abra a Milestone 1 para revisar tarefas, critérios e Markdowns de referência.',
          demo: async ({ runId }) => {
            await animateCursorTo('.milestone-item:first-child .milestone-card', { runId, hideLabel: true });
          },
        };
      }
      if (tutorialMapAnalysisStage === 'project-chat') {
        const target = getTutorialCreatedProjectConversationSelector();
        return {
          signature: `map-analysis:project-chat:${target}`,
          targets: [target],
          revealSelectors: [target],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'A Milestone 1 está aberta. No projeto, clique no botão + à direita do ícone do Mapa da Aplicação para abrir o chat de desenvolvimento.',
          demo: async ({ runId }) => {
            await animateCursorTo(target, { runId, hideLabel: true });
          },
        };
      }
      if (tutorialMapAnalysisStage === 'opening-development-chat') {
        return {
          signature: 'map-analysis:opening-development-chat',
          targets: [],
          revealSelectors: [],
          disableCursor: true,
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Preparando uma conversa de desenvolvimento vinculada ao projeto e à Milestone 1.',
          demo: null,
        };
      }
      return {
        signature: `map-analysis:${tutorialMapAnalysisStage}`,
        targets: [],
        revealSelectors: [],
        disableCursor: true,
        disableHighlight: true,
        disableSpotlight: true,
        hint: 'O chat de desenvolvimento está aberto. A próxima etapa vai preparar a primeira mensagem.',
        demo: null,
      };
    }

    function getDevelopmentChatGuide() {
      if (tutorialDevelopmentChatStage === 'compose') {
        return {
          signature: 'development-chat:compose',
          targets: ['#user-input'],
          revealSelectors: ['#user-input'],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Clique na caixa de texto. O tutorial escreverá a solicitação para iniciar a Milestone 1.',
          demo: async ({ runId }) => {
            await animateCursorTo('#user-input', { runId, hideLabel: true });
          },
        };
      }
      if (tutorialDevelopmentChatStage === 'send') {
        return {
          signature: 'development-chat:send',
          targets: ['#btn-send'],
          revealSelectors: ['#btn-send'],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Clique em Enviar. A conversa será emulada e salva no projeto sem consumir créditos.',
          demo: async ({ runId }) => {
            await animateCursorTo('#btn-send', { runId, hideLabel: true });
          },
        };
      }
      if (tutorialDevelopmentChatStage === 'sending') {
        return {
          signature: 'development-chat:sending',
          targets: [],
          revealSelectors: [],
          disableCursor: true,
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'A IA do tutorial está contextualizando a Milestone 1 e os Markdowns necessários.',
          demo: null,
        };
      }
      return {
        signature: 'development-chat:complete',
        targets: [],
        revealSelectors: [],
        disableCursor: true,
        disableHighlight: true,
        disableSpotlight: true,
        hint: tutorialDevelopmentBusy
          ? 'A IA do tutorial está criando a fundação da landing page dentro da pasta real do projeto.'
          : 'Fundação criada. Agora vamos revisar e salvar este primeiro conjunto de arquivos no Git.',
        demo: null,
      };
    }

    async function revealAndTrackTutorialTarget(selector, options = {}) {
      const element = resolveElement(selector);
      if (!element) return false;
      try {
        element.scrollIntoView({
          block: options.block || 'center',
          inline: 'nearest',
          behavior: 'smooth',
        });
      } catch {}
      const ready = await wait(options.scrollDelay || 240, options.runId);
      if (!ready) return false;
      return animateCursorTo(selector, {
        ...options,
        trackTarget: true,
        hideLabel: options.hideLabel !== false,
      });
    }

    function detectTutorialGitChangeScope() {
      if (resolveElement('[data-tutorial-git-action="stage"][data-tutorial-git-scope="untracked"]')) {
        return 'untracked';
      }
      if (resolveElement('[data-tutorial-git-action="stage"][data-tutorial-git-scope="modified"]')) {
        return 'modified';
      }
      return tutorialGitChangeScope || 'untracked';
    }

    function syncTutorialGitPanelStage() {
      const current = steps()[currentStepIndex];
      if (!active || !current || current.id !== 'git') return false;
      if (!doc.body.classList.contains('mode-git')) {
        tutorialDevelopmentWorkflowStage = 'open-git';
        persistTutorialDevelopmentState();
        renderStep();
        return false;
      }
      if (resolveElement('[data-tutorial-git-action="init"]')) {
        tutorialDevelopmentWorkflowStage = 'open-repo';
      } else if (resolveElement('[data-tutorial-git-action="commit"]')) {
        tutorialDevelopmentWorkflowStage = 'select-staged';
      } else if (resolveElement('[data-tutorial-git-action="stage"]')) {
        tutorialGitChangeScope = detectTutorialGitChangeScope();
        tutorialDevelopmentWorkflowStage = 'open-changes';
      } else if (tutorialDevelopmentCommitCount >= 2) {
        tutorialDevelopmentWorkflowStage = 'complete';
      } else {
        tutorialDevelopmentWorkflowStage = 'open-git';
      }
      persistTutorialDevelopmentState();
      renderStep();
      return true;
    }

    async function startTutorialDevelopmentBatch(index) {
      if (tutorialDevelopmentBusy) return false;
      const batch = getTutorialDevelopmentBatch(index);
      if (!batch || typeof actions.simulateTutorialDevelopmentBatch !== 'function') return false;
      tutorialDevelopmentBusy = true;
      tutorialDevelopmentWorkflowStage = 'creating';
      persistTutorialDevelopmentState();
      renderStep();
      try {
        const result = await actions.simulateTutorialDevelopmentBatch(batch);
        if (!result || result.ok === false) {
          throw new Error(result && result.message ? result.message : tutorialText('development.createFailed'));
        }
        tutorialDevelopmentBatchIndex = index;
        if (index >= 1) {
          tutorialDevelopmentWorkflowStage = 'open-files';
        } else if (index === 0) {
          tutorialDevelopmentWorkflowStage = 'open-git';
        } else {
          tutorialGitChangeScope = detectTutorialGitChangeScope();
          tutorialDevelopmentWorkflowStage = 'open-changes';
        }
        persistTutorialDevelopmentState();
        return true;
      } catch {
        tutorialDevelopmentWorkflowStage = index <= 0 ? 'idle' : 'open-git';
        persistTutorialDevelopmentState();
        return false;
      } finally {
        tutorialDevelopmentBusy = false;
        if (active) renderStep();
      }
    }

    function resumeTutorialDevelopmentWorkflow(stepId) {
      if (tutorialDevelopmentBusy) return;
      if (
        stepId === 'development-chat'
        && tutorialDevelopmentConversationComplete
        && tutorialDevelopmentBatchIndex < 0
      ) {
        window.setTimeout(() => {
          if (active && steps()[currentStepIndex]?.id === 'development-chat') {
            void startTutorialDevelopmentBatch(0);
          }
        }, 0);
        return;
      }
    }

    function getDevelopmentWorkflowGuide() {
      const stage = tutorialDevelopmentWorkflowStage;
      const changeScope = tutorialGitChangeScope || 'untracked';
      const scopeTitle = tutorialPhrase(changeScope === 'modified' ? 'Alterações' : 'Novos Arquivos');
      const batch = getTutorialDevelopmentBatch(Math.max(0, tutorialDevelopmentBatchIndex));

      if (stage === 'creating') {
        return {
          signature: `git:creating:${tutorialDevelopmentBatchIndex + 1}`,
          targets: [],
          revealSelectors: [],
          disableCursor: true,
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'A conversa de desenvolvimento está criando o próximo conjunto de arquivos na pasta do projeto.',
          demo: null,
        };
      }
      if (stage === 'return-chat') {
        return {
          signature: `git:return-chat:${tutorialDevelopmentBatchIndex}`,
          targets: ['#btn-tab-chat'],
          revealSelectors: ['#btn-tab-chat'],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'A fundação está versionada. Volte ao Chat para acompanhar a IA concluir a experiência antes da revisão final.',
          demo: async ({ runId }) => revealAndTrackTutorialTarget('#btn-tab-chat', { runId }),
        };
      }
      if (stage === 'open-repo') {
        const selector = '[data-tutorial-git-step="repo"] .right-tool-git-step__head';
        return {
          signature: 'git:open-repo',
          targets: [selector],
          revealSelectors: [selector],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Abra Repositório local para ativar o Git somente dentro desta pasta.',
          demo: async ({ runId }) => revealAndTrackTutorialTarget(selector, { runId }),
        };
      }
      if (stage === 'init-repo') {
        const selector = '[data-tutorial-git-action="init"]';
        return {
          signature: 'git:init-repo',
          targets: [selector],
          revealSelectors: [selector],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Clique em Init repo. Nada será publicado; criaremos apenas o histórico local.',
          demo: async ({ runId }) => revealAndTrackTutorialTarget(selector, { runId }),
        };
      }
      if (stage === 'open-changes') {
        const selector = `[data-tutorial-git-step="${changeScope}"] .right-tool-git-step__head`;
        return {
          signature: `git:open-changes:${changeScope}:${tutorialDevelopmentBatchIndex}`,
          targets: [selector],
          revealSelectors: [selector],
          disableHighlight: true,
          disableSpotlight: true,
          hint: `Abra ${scopeTitle} para revisar o lote "${batch ? batch.label : 'em desenvolvimento'}".`,
          demo: async ({ runId }) => revealAndTrackTutorialTarget(selector, { runId }),
        };
      }
      if (stage === 'select-changes') {
        const selector = `[data-tutorial-git-action="select-all"][data-tutorial-git-scope="${changeScope}"]`;
        return {
          signature: `git:select-changes:${changeScope}:${tutorialDevelopmentBatchIndex}`,
          targets: [selector],
          revealSelectors: [selector],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Selecione todos os arquivos deste conjunto antes de enviá-los para Staged.',
          demo: async ({ runId }) => revealAndTrackTutorialTarget(selector, { runId }),
        };
      }
      if (stage === 'stage-changes') {
        const selector = `[data-tutorial-git-action="stage"][data-tutorial-git-scope="${changeScope}"]`;
        return {
          signature: `git:stage-changes:${changeScope}:${tutorialDevelopmentBatchIndex}`,
          targets: [selector],
          revealSelectors: [selector],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Clique em Stage it para preparar estes arquivos para o commit.',
          demo: async ({ runId }) => revealAndTrackTutorialTarget(selector, { runId }),
        };
      }
      if (stage === 'select-staged') {
        const selector = '[data-tutorial-git-action="select-all"][data-tutorial-git-scope="staged"]';
        return {
          signature: `git:select-staged:${tutorialDevelopmentBatchIndex}`,
          targets: [selector],
          revealSelectors: [selector],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Os arquivos estão em Staged. Selecione todos para compor o próximo commit.',
          demo: async ({ runId }) => revealAndTrackTutorialTarget(selector, { runId }),
        };
      }
      if (stage === 'commit-message') {
        const selector = '[data-tutorial-git-action="message"]';
        return {
          signature: `git:commit-message:${tutorialDevelopmentBatchIndex}`,
          targets: [selector],
          revealSelectors: [selector],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Clique no campo de mensagem. O tutorial escreverá uma descrição clara para este commit.',
          demo: async ({ runId }) => revealAndTrackTutorialTarget(selector, { runId }),
        };
      }
      if (stage === 'commit') {
        const selector = '[data-tutorial-git-action="commit"]';
        return {
          signature: `git:commit:${tutorialDevelopmentBatchIndex}`,
          targets: [selector],
          revealSelectors: [selector],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Clique em Criar commit com selecionados para salvar esta etapa do desenvolvimento.',
          demo: async ({ runId }) => revealAndTrackTutorialTarget(selector, { runId }),
        };
      }
      if (stage === 'open-files') {
        return {
          signature: 'git:open-files',
          targets: ['#btn-project-files'],
          revealSelectors: ['#btn-project-files'],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'A implementação está completa. Abra Arquivos para ver os arquivos finais ainda com as diffs pendentes.',
          demo: async ({ runId }) => revealAndTrackTutorialTarget('#btn-project-files', { runId }),
        };
      }
      if (stage === 'review-file') {
        const selector = '.project-tree-row.file.has-diff';
        return {
          signature: 'git:review-file',
          targets: [selector],
          revealSelectors: [selector],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Clique em um arquivo com diff para visualizar o conteúdo criado antes do último commit.',
          demo: async ({ runId }) => revealAndTrackTutorialTarget(selector, { runId, block: 'nearest' }),
        };
      }
      if (stage === 'close-file') {
        return {
          signature: 'git:close-file',
          targets: ['#project-file-modal-close'],
          revealSelectors: ['#project-file-modal-close'],
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'A diff foi revisada. Feche o arquivo para preparar o commit final.',
          demo: async ({ runId }) => revealAndTrackTutorialTarget('#project-file-modal-close', { runId }),
        };
      }
      if (['inspect-git', 'initializing', 'staging', 'committing', 'loading-files', 'opening-file'].includes(stage)) {
        return {
          signature: `git:busy:${stage}`,
          targets: [],
          revealSelectors: [],
          disableCursor: true,
          disableHighlight: true,
          disableSpotlight: true,
          hint: stage === 'committing' ? 'Salvando o commit local...' : 'Atualizando o estado real do repositório...',
          demo: null,
        };
      }
      if (stage === 'complete') {
        return {
          signature: 'git:complete',
          targets: [],
          revealSelectors: [],
          disableCursor: true,
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Desenvolvimento concluído em dois commits objetivos. Agora vamos executar o projeto localmente.',
          demo: null,
        };
      }
      return {
        signature: `git:open:${tutorialDevelopmentBatchIndex}:${tutorialDevelopmentCommitCount}`,
        targets: ['#btn-project-git'],
        revealSelectors: ['#btn-project-git'],
        disableHighlight: true,
        disableSpotlight: true,
        hint: 'Abra a ferramenta Git no painel direito para revisar os arquivos que a conversa acabou de criar.',
        demo: async ({ runId }) => revealAndTrackTutorialTarget('#btn-project-git', { runId }),
      };
    }

    function getFinishGuide() {
      if (tutorialPreviewLaunching) {
        return {
          signature: 'finish:launching',
          targets: [],
          revealSelectors: [],
          disableCursor: true,
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Instalando dependências quando necessário e iniciando o servidor local. O navegador abrirá automaticamente.',
          demo: null,
        };
      }
      if (tutorialPreviewStarted) {
        return {
          signature: 'finish:started',
          targets: [],
          revealSelectors: [],
          disableCursor: true,
          disableHighlight: true,
          disableSpotlight: true,
          hint: 'Servidor local iniciado e página aberta no navegador. Tutorial concluído.',
          demo: null,
        };
      }
      return {
        signature: 'finish:run',
        targets: ['#btn-project-deploy'],
        revealSelectors: ['#btn-project-deploy'],
        disableHighlight: true,
        disableSpotlight: true,
        hint: 'Clique em Executar. O Faber Code iniciará o projeto de verdade em um servidor local e abrirá o navegador.',
        demo: async ({ runId }) => revealAndTrackTutorialTarget('#btn-project-deploy', { runId }),
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
      if (step.id === 'map-build') return getMapBuildGuide();
      if (step.id === 'map-chat') return getMapChatGuide();
      if (step.id === 'map-analysis') return getMapAnalysisGuide();
      if (step.id === 'development-chat') return getDevelopmentChatGuide();
      if (step.id === 'git') return getDevelopmentWorkflowGuide();
      if (step.id === 'finish') return getFinishGuide();
      return {
        signature: step.id,
        targets: typeof step.targets === 'function' ? step.targets() : [],
        revealSelectors: typeof step.revealSelectors === 'function' ? step.revealSelectors() : (step.revealSelectors || []),
        revealPadding: step.revealPadding,
        hint: step.hint || '',
        demo: step.demo || null,
        disableHighlight: typeof step.disableHighlight === 'function'
          ? step.disableHighlight()
          : Boolean(step.disableHighlight),
      };
    }

    function steps() {
      const checklist = (path, states) => {
        const labels = tutorialValue(path, []);
        return states.map((done, index) => ({ label: labels[index] || '', done }));
      };
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
            return ['#btn-add-project'];
          },
          revealSelectors: () => {
            const tutorialMapSelector = getTutorialCreatedProjectMapSelector();
            if (hasTutorialReadyProject() && resolveElement(tutorialMapSelector)) {
              return [tutorialMapSelector];
            }
            return ['#btn-add-project'];
          },
          revealPadding: 10,
          disableHighlight: () => !hasTutorialReadyProject(),
          demo: async ({ runId }) => {
            const tutorialMapSelector = getTutorialCreatedProjectMapSelector();
            if (hasTutorialReadyProject() && resolveElement(tutorialMapSelector)) {
              await animateCursorTo(tutorialMapSelector, { runId, pulse: true, label: 'Clique no Mapa da Aplicação' });
              return;
            }
            await animateCursorTo('#btn-add-project', {
              runId,
              pulse: true,
              offsetX: 112,
              label: 'Novo projeto',
            });
          },
        },
        {
          id: 'map-intro',
          title: translate('mapTitle'),
          body: translate('mapBody'),
          hint: translate('mapHint'),
          checklist: () => [
            { label: 'Mapa aberto', done: tutorialMapIconClicked && isMapTabOpen() },
            { label: 'Painel esquerdo recolhido', done: isLeftWorkspaceCollapsed() },
            { label: 'Painel direito recolhido', done: isRightWorkspaceCollapsed() },
            { label: 'Ferramentas do mapa exploradas', done: hoveredMapSelectors.size >= MAP_TOOL_HOVER_SELECTORS.length },
          ],
          canAdvance: () => (
            tutorialMapIconClicked
            && isMapTabOpen()
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
          title: tutorialText('steps.mapBuild.title', {}, 'Aula de Criação de Projeto'),
          body: tutorialText('steps.mapBuild.body', {}, 'Documente a página de boas-vindas, o Design System e as regras do projeto diretamente no mapa.'),
          hint: tutorialText('steps.mapBuild.hint', {}, 'Comece pelo briefing da página de boas-vindas.'),
          checklist: () => checklist('steps.mapBuild.checklist', [
            tutorialWelcomeBriefReady,
            tutorialMapZoomReady,
            tutorialDesignSystemReady,
            Boolean(tutorialLogoNodeId),
            Boolean(tutorialFrontendGroupId),
            Boolean(tutorialRulesGroupId && tutorialRulesNodeIds.length >= 2),
            Boolean(tutorialUserName),
            tutorialArchitectureNodeIds.length >= 1,
            tutorialArchitectureNodeIds.length >= 2,
            tutorialArchitectureNodeIds.length >= 3,
            tutorialDevelopmentReady,
          ]),
          canAdvance: () => tutorialMapBuildStage === 'development-ready',
          preview: () => `<div class="progressive-map-preview"><div class="progressive-mini-card"><small>FRONTEND</small><strong>${tutorialText('steps.mapBuild.frontendPreview', {}, 'Olá Mundo + Design System')}</strong></div><div class="progressive-mini-card"><small>${tutorialText('documents.rules.title', {}, 'REGRAS').toUpperCase()}</small><strong>${tutorialText('steps.mapBuild.rulesPreview', {}, 'Interface + Aceite')}</strong></div></div>`,
          targets: () => getMapBuildGuide().targets,
          revealSelectors: () => getMapBuildGuide().revealSelectors,
          revealPadding: 16,
          demo: async ({ runId }) => {
            await getMapBuildGuide().demo?.({ runId });
          },
        },
        {
          id: 'map-chat',
          title: tutorialText('steps.mapChat.title', {}, 'Assistente do Mapa'),
          body: tutorialText('steps.mapChat.body', {}, 'Converse com a IA do mapa para validar os documentos.'),
          hint: tutorialText('steps.mapChat.hint', {}, 'Conheça o painel direito e abra a IA do Mapa.'),
          checklist: () => checklist('steps.mapChat.checklist', [
            !isRightWorkspaceCollapsed(),
            hoveredRightPanelSelectors.size >= RIGHT_PANEL_HOVER_SELECTORS.length,
            !['expand-right', 'right-tools', 'open'].includes(tutorialMapChatStage),
            ['reply', 'missing-info', 'adjustment-complete'].includes(tutorialMapChatStage),
            ['missing-info', 'adjustment-complete'].includes(tutorialMapChatStage),
            Boolean(tutorialMapGapNodeId),
          ]),
          canAdvance: () => tutorialMapConversationComplete,
          preview: () => `<div class="progressive-chat-preview"><div class="progressive-chat-message is-user">${tutorialText('mapChat.prompt')}</div><div class="progressive-chat-message is-assistant">${tutorialText('mapChat.reply')}</div></div>`,
          targets: () => getMapChatGuide().targets,
          revealSelectors: () => getMapChatGuide().revealSelectors,
          revealPadding: 16,
          demo: async ({ runId }) => {
            await getMapChatGuide().demo?.({ runId });
          },
        },
        {
          id: 'map-analysis',
          title: tutorialText('steps.mapAnalysis.title', {}, 'Planejamento em Milestones'),
          body: tutorialText('steps.mapAnalysis.body', {}, 'Transforme o mapa corrigido em um plano completo.'),
          hint: tutorialText('steps.mapAnalysis.hint', {}, 'A análise do tutorial é local e não utiliza nenhuma API.'),
          checklist: () => checklist('steps.mapAnalysis.checklist', [
            !['history-loading', 'history'].includes(tutorialMapAnalysisStage),
            !['history-loading', 'history', 'render-list', 'rendering'].includes(tutorialMapAnalysisStage),
            tutorialMilestonesSaved,
            ['project-chat', 'opening-development-chat', 'development-chat-open'].includes(tutorialMapAnalysisStage),
            tutorialMapAnalysisStage === 'development-chat-open',
          ]),
          canAdvance: () => tutorialMapAnalysisStage === 'development-chat-open',
          preview: () => `<div class="progressive-note"><strong>${tutorialText('steps.mapAnalysis.previewTitle', {}, 'Mapa → Milestones → Desenvolvimento')}</strong><p>${tutorialText('steps.mapAnalysis.previewBody', {}, 'O planejamento fica salvo dentro do projeto.')}</p></div>`,
          targets: () => getMapAnalysisGuide().targets,
          revealSelectors: () => getMapAnalysisGuide().revealSelectors,
          revealPadding: 18,
          demo: async ({ runId }) => {
            await getMapAnalysisGuide().demo?.({ runId });
          },
        },
        {
          id: 'development-chat',
          title: tutorialText('steps.developmentChat.title', {}, 'Início do Desenvolvimento'),
          body: tutorialText('steps.developmentChat.body', {}, 'Inicie a Milestone 1 em uma conversa do projeto.'),
          hint: tutorialText('steps.developmentChat.hint', {}, 'A demonstração será persistida localmente.'),
          checklist: () => checklist('steps.developmentChat.checklist', [
            tutorialDevelopmentChatStage !== 'compose',
            ['sending', 'complete'].includes(tutorialDevelopmentChatStage),
            tutorialDevelopmentConversationComplete,
            tutorialDevelopmentBatchIndex >= 0,
          ]),
          canAdvance: () => tutorialDevelopmentConversationComplete && tutorialDevelopmentBatchIndex >= 0,
          preview: () => `<div class="progressive-chat-preview"><div class="progressive-chat-message is-user">${tutorialText('development.prompt')}</div><div class="progressive-chat-message is-assistant">${tutorialText('steps.developmentChat.previewReply')}</div></div>`,
          targets: () => getDevelopmentChatGuide().targets,
          revealSelectors: () => getDevelopmentChatGuide().revealSelectors,
          revealPadding: 18,
          demo: async ({ runId }) => {
            await getDevelopmentChatGuide().demo?.({ runId });
          },
        },
        {
          id: 'git',
          title: tutorialText('steps.git.title', {}, 'Desenvolvimento e commits'),
          body: tutorialText('steps.git.body', {}, 'Acompanhe a conversa, revise as diffs e faça dois commits objetivos.'),
          hint: tutorialText('steps.git.hint', {}, 'Use o controle apontado pelo cursor.'),
          checklist: () => checklist('steps.git.checklist', [
            tutorialDevelopmentBatchIndex >= 0,
            tutorialDevelopmentCommitCount >= 1,
            tutorialDevelopmentBatchIndex >= 1,
            tutorialDevelopmentFilesReviewed,
            tutorialDevelopmentCommitCount >= 2,
          ]),
          canAdvance: () => tutorialDevelopmentWorkflowStage === 'complete' && tutorialDevelopmentCommitCount >= 2,
          preview: () => `<div class="progressive-note"><strong>${tutorialDevelopmentCommitCount}/2 commits</strong><p>${tutorialText('steps.git.preview')}</p></div>`,
          targets: () => getDevelopmentWorkflowGuide().targets,
          revealSelectors: () => getDevelopmentWorkflowGuide().revealSelectors,
          revealPadding: 16,
          demo: async ({ runId }) => {
            await getDevelopmentWorkflowGuide().demo?.({ runId });
          },
        },
        {
          id: 'finish',
          title: tutorialPreviewStarted
            ? tutorialText('steps.finish.successTitle', {}, 'Projeto criado com sucesso')
            : tutorialText('steps.finish.pendingTitle', {}, 'Executar a página de boas-vindas'),
          body: tutorialPreviewStarted
            ? tutorialText('steps.finish.successBody')
            : tutorialText('steps.finish.pendingBody'),
          hint: tutorialPreviewStarted
            ? tutorialText('steps.finish.successHint')
            : tutorialText('steps.finish.pendingHint'),
          checklist: () => checklist('steps.finish.checklist', [
            tutorialDevelopmentCommitCount >= 2,
            tutorialPreviewStarted,
          ]),
          canAdvance: () => tutorialPreviewStarted,
          preview: () => `<div class="progressive-note"><strong>${tutorialText('steps.finish.preview', { name: tutorialUserName || tutorialText('ui.world', {}, 'mundo') })}</strong><p>${tutorialText('steps.finish.previewBody')}</p></div>`,
          targets: () => getFinishGuide().targets,
          revealSelectors: () => getFinishGuide().revealSelectors,
          revealPadding: 16,
          demo: async ({ runId }) => {
            await getFinishGuide().demo?.({ runId });
          },
        },
      ];
    }

    function findStepIndex(stepId) {
      const list = steps();
      const normalizedStepId = stepId === 'dev-chat' ? 'development-chat' : stepId;
      const index = list.findIndex((step) => step.id === normalizedStepId);
      return index >= 0 ? index : 0;
    }

    function renderRequirements() {
      if (!requirementsState || !elements.requirementsStatus || !elements.requirementsList) return;
      if (elements.requirementsTitle) elements.requirementsTitle.textContent = translate('requirementsTitle');
      if (elements.requirementsLead) elements.requirementsLead.textContent = translate('requirementsLead');
      elements.requirementsStatus.innerHTML = '';
      const title = doc.createElement('strong');
      title.textContent = requirementsState.ready ? translate('requirementsReady') : translate('requirementsMissing');
      elements.requirementsStatus.classList.toggle('is-ready', requirementsState.ready);
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
          button.className = 'btn btn-muted progressive-requirement-action';
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
        const status = doc.createElement('span');
        status.textContent = item.done ? translate('done') : translate('waiting');
        const label = doc.createElement('strong');
        label.textContent = tutorialPhrase(item.label);
        row.append(status, label);
        elements.tutorialChecklist.appendChild(row);
      });
    }

    function clearAutoAdvance() {
      if (autoAdvanceTimer != null) window.clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }

    function scheduleAutoAdvance(stepId, delay = 260, predicate = null) {
      clearAutoAdvance();
      autoAdvanceTimer = window.setTimeout(() => {
        autoAdvanceTimer = null;
        if (!active) return;
        const current = steps()[currentStepIndex];
        if (!current || current.id !== stepId || !current.canAdvance()) return;
        if (typeof predicate === 'function' && !predicate()) return;
        nextStep();
      }, delay);
    }

    function stopDemoVisuals() {
      clearAutoAdvance();
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
      highlightTargets(guide.disableHighlight ? [] : (guide.targets || []));
      positionCoach(guide.targets || []);
      showSpotlightForGuide(guide);
      if (guide && guide.disableCursor) {
        hideCursor();
      } else if (guide && typeof guide.demo === 'function') {
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
        .map((selector) => resolveVisibleElement(selector))
        .filter((element) => isVisibleElement(element));
      if (visibleTargets.some((element) => card.contains(element))) {
        card.dataset.position = 'anchored';
        return;
      }
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
      clearAutoAdvance();
      const list = steps();
      const step = list[currentStepIndex];
      if (!step) return;
      syncTutorialRuntime();
      dispatchTutorialProjectsChanged();
      refreshTutorialContext();
      if (step.id === 'map-analysis') {
        if (tutorialMapAnalysisStage === 'history-loading' && !tutorialMapHistoryPreparing) {
          tutorialMapHistoryPreparing = true;
          Promise.resolve(prepareTutorialMapAnalysisHistory()).then((completed) => {
            tutorialMapHistoryPreparing = false;
            const current = steps()[currentStepIndex];
            if (!active || !current || current.id !== 'map-analysis') return;
            tutorialMapAnalysisStage = completed ? 'history' : 'history-loading';
            activeGuideSignature = '';
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                if (active && steps()[currentStepIndex]?.id === 'map-analysis') renderStep();
              });
            });
          }).catch(() => {
            tutorialMapHistoryPreparing = false;
          });
        } else if (
          ['render-list', 'rendering', 'plan-ready', 'confirm', 'saving'].includes(tutorialMapAnalysisStage)
          && !doc.body.classList.contains('mode-map-render')
        ) {
          prepareTutorialMapAnalysisPanel();
          refreshTutorialContext();
        }
        if (tutorialMapAnalysisStage === 'project-chat') {
          const conversationSelector = getTutorialCreatedProjectConversationSelector();
          if (!resolveVisibleElement(conversationSelector) && typeof actions.revealProjectConversationButton === 'function') {
            actions.revealProjectConversationButton();
            activeGuideSignature = '';
            refreshTutorialContext();
          }
        }
      }
      resumeTutorialDevelopmentWorkflow(step.id);
      const showNamePrompt = step.id === 'map-build' && tutorialMapBuildStage === 'user-name';
      setVisible(elements.tutorialNamePrompt, showNamePrompt);
      if (!showNamePrompt && elements.tutorialNameError) elements.tutorialNameError.textContent = '';
      if (elements.tutorialNamePrompt) {
        const label = elements.tutorialNamePrompt.querySelector('label');
        if (label) label.textContent = tutorialText('ui.nameQuestion', {}, 'Como devemos chamar você?');
      }
      if (elements.tutorialNameInput) {
        elements.tutorialNameInput.placeholder = tutorialText('ui.namePlaceholder', {}, 'Digite seu nome');
      }
      if (elements.tutorialNameSave) {
        elements.tutorialNameSave.textContent = tutorialText('ui.confirm', {}, 'Confirmar');
      }
      const guide = getStepGuide(step);
      const stepChanged = activeStepId !== step.id;
      const guideChanged = activeGuideSignature !== guide.signature;
      if (stepChanged || guideChanged) {
        stopDemoVisuals();
        activateStep(step, guide);
        activeGuideSignature = guide.signature;
      }
      if (elements.tutorialLive) elements.tutorialLive.textContent = translate('tutorialLive');
      if (elements.tutorialTitle) elements.tutorialTitle.textContent = tutorialPhrase(step.title);
      if (elements.tutorialHint) elements.tutorialHint.textContent = tutorialPhrase(guide.hint || step.hint || '');
      if (elements.tutorialCounter) elements.tutorialCounter.textContent = `${currentStepIndex + 1} / ${list.length}`;
      if (elements.tutorialProgress) {
        elements.tutorialProgress.style.setProperty('--progressive-ratio', String((currentStepIndex + 1) / list.length));
      }
      if (elements.tutorialPreview) {
        elements.tutorialPreview.innerHTML = tutorialHtml(typeof step.preview === 'function' ? step.preview() : '');
      }
      renderChecklist(step);
      positionCoach(guide.targets || []);
      if (elements.tutorialNext) {
        const customNextLabel = typeof step.nextLabel === 'function' ? step.nextLabel() : step.nextLabel;
        elements.tutorialNext.textContent = customNextLabel || (
          currentStepIndex === list.length - 1
            ? translate('finishTutorial')
            : translate('next')
        );
        elements.tutorialNext.disabled = false;
        elements.tutorialNext.setAttribute('aria-busy', 'false');
      }
      if (elements.tutorialPrev) {
        elements.tutorialPrev.textContent = translate('previous');
        elements.tutorialPrev.disabled = currentStepIndex === 0;
      }
      if (elements.tutorialSkipAll) elements.tutorialSkipAll.textContent = translate('stopTutorial');
      writeStorage(TUTORIAL_PROGRESS_KEY, step.id);
      const fastSteps = new Set(['panels', 'left-tools', 'apis', 'project-class', 'map-intro', 'map-build']);
      if (fastSteps.has(step.id) && step.canAdvance()) {
        scheduleAutoAdvance(step.id, 240);
      } else if (step.id === 'sidebar' && sidebarClosedOnce) {
        scheduleAutoAdvance(step.id, 240);
      } else if (step.id === 'map-chat' && tutorialMapChatStage === 'adjustment-complete') {
        scheduleAutoAdvance(step.id, 720, () => tutorialMapChatStage === 'adjustment-complete');
      } else if (step.id === 'map-analysis' && step.canAdvance()) {
        scheduleAutoAdvance(step.id, 280);
      } else if (step.id === 'development-chat' && step.canAdvance()) {
        scheduleAutoAdvance(step.id, 360);
      } else if (step.id === 'git' && step.canAdvance()) {
        scheduleAutoAdvance(step.id, 420);
      }
    }

    function completeTutorial() {
      active = false;
      tutorialMapCreationPending = false;
      tutorialCortexEntry = null;
      dispatchTutorialCortexChanged();
      stopDemoVisuals();
      discardTutorialApiDraft();
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
      tutorialMapCreationPending = false;
      tutorialCortexEntry = null;
      dispatchTutorialCortexChanged();
      stopDemoVisuals();
      discardTutorialApiDraft();
      clearHighlights();
      setVisible(elements.tutorial, false);
      syncTutorialRuntime();
      dispatchTutorialProjectsChanged();
      writeStorage(TUTORIAL_DISMISSED_KEY, 'true');
      activeStepId = '';
    }

    function clickTutorialControl(selector) {
      const element = resolveVisibleElement(selector) || resolveElement(selector);
      if (!element || typeof element.click !== 'function') return false;
      allowTutorialSyntheticClick = true;
      try {
        element.click();
      } finally {
        allowTutorialSyntheticClick = false;
      }
      return true;
    }

    function prepareMapIntroForAdvance() {
      if (!tutorialMapIconClicked || !isMapTabOpen()) {
        const mapSelector = getTutorialCreatedProjectMapSelector();
        const opened = clickTutorialControl(mapSelector) || clickTutorialControl('.project-mini-btn-map');
        if (opened) tutorialMapIconClicked = true;
      }

      if (!isLeftWorkspaceCollapsed()) clickTutorialControl('#workspace-collapse-left');
      if (!isRightWorkspaceCollapsed()) clickTutorialControl('#workspace-collapse-right');

      hoveredMapSelectors = new Set(MAP_TOOL_HOVER_SELECTORS);
      refreshTutorialContext();
    }

    function closeTutorialContextForAdvance() {
      if (isModalOpen('#ai-settings-modal')) discardTutorialApiDraft();
      const closeSelectors = [
        '#project-state-modal-close',
        '#cortex-modal-close',
        '#welcome-project-close',
        '#project-file-modal-close',
        '#faber-confirm-no',
        '#btn-map-inspector-close',
      ];
      closeSelectors.forEach((selector) => {
        if (resolveVisibleElement(selector)) clickTutorialControl(selector);
      });
    }

    function nextStep() {
      const list = steps();
      const step = list[currentStepIndex];
      if (!step) return;
      if (step.id === 'map-build' && !tutorialUserName) {
        if (tutorialMapBuildStage !== 'user-name') {
          tutorialMapBuildStage = 'user-name';
          activeGuideSignature = '';
          renderStep();
          window.requestAnimationFrame(() => {
            if (elements.tutorialNameInput) elements.tutorialNameInput.focus();
          });
          return;
        }
        submitTutorialUserName();
        return;
      }
      if (step && step.id === 'map-intro' && !step.canAdvance()) {
        prepareMapIntroForAdvance();
      }
      closeTutorialContextForAdvance();
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
      tutorialCreatedProjectId = readStorage(TUTORIAL_PROJECT_ID_KEY, '');
      tutorialMapIconClicked = false;
      tutorialMapNodeId = '';
      tutorialMapInspectorOpened = false;
      tutorialMapBuildStage = 'welcome-create';
      tutorialWelcomeNodeId = '';
      tutorialWelcomeBriefReady = false;
      tutorialDesignSystemNodeId = '';
      tutorialDesignSystemReady = false;
      tutorialMapZoomReady = false;
      tutorialLogoNodeId = '';
      tutorialFrontendGroupId = '';
      tutorialRulesGroupId = '';
      tutorialRulesNodeIds = [];
      tutorialUserName = readStorage(TUTORIAL_USER_NAME_KEY, '');
      tutorialArchitectureNodeIds = [];
      tutorialDevelopmentReady = false;
      tutorialMapCreationPending = false;
      tutorialMapChatStage = 'expand-right';
      tutorialMapGapNodeId = '';
      tutorialMapConversationComplete = false;
      tutorialMapAnalysisStage = 'history-loading';
      tutorialMapHistoryPreparing = false;
      tutorialMilestonesSaved = false;
      tutorialDevelopmentChatStage = 'compose';
      tutorialDevelopmentConversationComplete = false;
      tutorialDevelopmentBatchIndex = -1;
      tutorialDevelopmentWorkflowStage = 'idle';
      tutorialDevelopmentCommitCount = 0;
      tutorialDevelopmentFilesReviewed = false;
      tutorialDevelopmentBusy = false;
      tutorialGitChangeScope = 'untracked';
      tutorialPreviewStarted = false;
      tutorialPreviewLaunching = false;
      restoreTutorialDevelopmentState();
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
      if (elements.tutorialNameInput) {
        elements.tutorialNameInput.value = tutorialUserName;
        elements.tutorialNameInput.removeAttribute('aria-invalid');
      }
      if (elements.tutorialNameError) elements.tutorialNameError.textContent = '';
      tutorialCortexEntry = null;
      dispatchTutorialCortexChanged();
      hoveredSelectors = new Set();
      hoveredMapSelectors = new Set();
      hoveredRightPanelSelectors = new Set();
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
      writeStorage(TUTORIAL_PROJECT_ID_KEY, '');
      writeStorage(TUTORIAL_USER_NAME_KEY, '');
      resetTutorialDevelopmentState();
      if (!getAccountUnlocked()) return false;
      stopDemoVisuals();
      discardTutorialApiDraft();
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

    function watchTutorialMapOpen(attempt = 0) {
      window.setTimeout(() => {
        if (!active) return;
        const current = steps()[currentStepIndex];
        if (!current || current.id !== 'map-intro') return;
        if (tutorialMapIconClicked && isMapTabOpen()) {
          renderStep();
          return;
        }
        if (attempt < 40) watchTutorialMapOpen(attempt + 1);
      }, attempt === 0 ? 0 : 100);
    }

    function waitForTutorialCreatedNode(selector, previousNodeIds, onCreated, attempt = 0) {
      window.setTimeout(() => {
        if (!active) {
          tutorialMapCreationPending = false;
          return;
        }
        const current = steps()[currentStepIndex];
        if (!current || current.id !== 'map-build') {
          tutorialMapCreationPending = false;
          return;
        }
        const nodes = Array.from(doc.querySelectorAll(selector));
        const createdNode = nodes.find((node) => node.id && !previousNodeIds.has(node.id));
        if (!createdNode) {
          if (attempt < 40) {
            waitForTutorialCreatedNode(selector, previousNodeIds, onCreated, attempt + 1);
          } else {
            tutorialMapCreationPending = false;
            activeGuideSignature = '';
            renderStep();
          }
          return;
        }
        tutorialMapCreationPending = false;
        onCreated(createdNode.id);
        renderStep();
      }, attempt === 0 ? 0 : 50);
    }

    function waitForTutorialMapInspector(nextStage, attempt = 0) {
      window.setTimeout(() => {
        if (!active) return;
        const current = steps()[currentStepIndex];
        if (!current || current.id !== 'map-build') return;
        if (isTutorialMapInspectorOpen()) {
          tutorialMapInspectorOpened = true;
          tutorialMapBuildStage = nextStage;
          renderStep();
          return;
        }
        if (attempt < 40) waitForTutorialMapInspector(nextStage, attempt + 1);
      }, attempt === 0 ? 0 : 50);
    }

    async function typeIntoTutorialMarkdown(text) {
      const wrapper = resolveVisibleElement('#workspace-map-inspector-panel .CodeMirror');
      const editor = wrapper && wrapper.CodeMirror;
      if (!editor) {
        const textarea = resolveElement('#inspector-node-content');
        if (!textarea) return false;
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      const runId = demoRunId;
      tutorialTypingInProgress = true;
      pendingTutorialRender = false;
      editor.focus();
      editor.setValue('');
      try {
        const chunkSize = 6;
        for (let index = chunkSize; index < text.length + chunkSize; index += chunkSize) {
          if (!active || runId !== demoRunId) return false;
          editor.setValue(text.slice(0, Math.min(index, text.length)));
          const keepGoing = await wait(10, runId);
          if (!keepGoing) return false;
        }
        return true;
      } finally {
        tutorialTypingInProgress = false;
        if (pendingTutorialRender && active) {
          pendingTutorialRender = false;
          window.setTimeout(() => renderStep(), 0);
        }
      }
    }

    async function fillTutorialMapField(selector, text, nextStage, options = {}) {
      if (tutorialTypingInProgress) return;
      const expectedStage = tutorialMapBuildStage;
      const runId = demoRunId;
      const completed = options.markdown
        ? await typeIntoTutorialMarkdown(text)
        : await typeInto(selector, text, {
            runId,
            preserveValue: true,
            typingDelay: options.typingDelay || 18,
            label: options.label || '',
          });
      const current = steps()[currentStepIndex];
      if (!completed || !active || !current || current.id !== 'map-build') return;
      if (tutorialMapBuildStage !== expectedStage) return;
      tutorialMapBuildStage = nextStage;
      if (options.completeWelcome) tutorialWelcomeBriefReady = true;
      if (options.completeDesign) tutorialDesignSystemReady = true;
      renderStep();
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
        return;
      }
      if (
        step.id === 'map-chat'
        && (tutorialMapChatStage === 'expand-right' || tutorialMapChatStage === 'right-tools')
      ) {
        const selector = RIGHT_PANEL_HOVER_SELECTORS.find((entry) => matchedSelector === entry);
        if (!selector) return;
        hoveredRightPanelSelectors.add(selector);
        tutorialMapChatStage = hoveredRightPanelSelectors.size >= RIGHT_PANEL_HOVER_SELECTORS.length
          ? 'open'
          : 'right-tools';
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
      if (guide.disableCursor) {
        hideCursor();
        return;
      }
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
      if (allowTutorialSyntheticClick && event.type === 'click' && event.isTrusted === false) return;
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
        const directCancel = event.target && event.target.closest ? event.target.closest('#ai-settings-cancel') : null;
        if (directCancel && event.type === 'click' && !isVisibleElement(resolveElement('#ai-settings-editor-key'))) {
          animateCursorClick();
          hideCursor();
          finishTutorialApiDemoAfterModalClose();
          return;
        }
      }
      if (isInsideCoach(event.target)) return;
      const match = matchCurrentGuideTarget(event.target, guide);
      if (!match.element) {
        const isInteractiveGuideArea = (guide.interactiveSelectors || []).some((selector) => (
          event.target && event.target.closest && event.target.closest(selector)
        ));
        if (isInteractiveGuideArea) {
          hideCursor();
          return;
        }
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
          const runId = demoRunId;
          hideCursor();
          window.setTimeout(async () => {
            if (!active || runId !== demoRunId || apiServiceTyped) {
              refreshTutorialContext();
              renderStep();
              return;
            }
            const typed = await typeInto('#ai-settings-editor-provider', getTutorialApiServiceName(), {
              runId,
              preserveValue: true,
              typingDelay: 42,
              label: 'Serviço',
            });
            if (!typed) return;
            apiServiceTyped = true;
            refreshTutorialContext();
            renderStep();
          }, 360);
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
        if (match.selector === '#ai-settings-cancel') {
          animateCursorClick();
          hideCursor();
          finishTutorialApiDemoAfterModalClose();
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
        const projectMapSelector = getTutorialCreatedProjectMapSelector();
        const isProjectMapTarget = (
          match.selector === projectMapSelector
          || match.selector === '.project-mini-btn-map'
        );
        if (
          match.selector === '#workspace-collapse-left'
          || match.selector === '#workspace-collapse-right'
          || isProjectMapTarget
        ) {
          if (event.type === 'mousedown') return;
          if (isProjectMapTarget) {
            tutorialMapIconClicked = true;
            watchTutorialMapOpen();
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
        if (event.type === 'mousedown') return;
        if (match.selector === '#btn-map-tool-add-card') {
          if (tutorialMapCreationPending) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return;
          }
          tutorialMapCreationPending = true;
          const previousNodeIds = new Set(
            Array.from(doc.querySelectorAll('.map-node.node-text'))
              .map((node) => node.id)
              .filter(Boolean)
          );
          animateCursorClick();
          hideCursor();
          if (tutorialMapBuildStage === 'welcome-create') {
            waitForTutorialCreatedNode('.map-node.node-text', previousNodeIds, (nodeId) => {
              tutorialWelcomeNodeId = nodeId;
              tutorialMapNodeId = nodeId;
              tutorialMapInspectorOpened = false;
              tutorialMapBuildStage = 'welcome-edit';
            });
          } else if (tutorialMapBuildStage === 'design-create') {
            waitForTutorialCreatedNode('.map-node.node-text', previousNodeIds, (nodeId) => {
              tutorialDesignSystemNodeId = nodeId;
              tutorialMapNodeId = nodeId;
              tutorialMapInspectorOpened = false;
              arrangeTutorialMarkdownNodes();
              tutorialMapBuildStage = isRightWorkspaceCollapsed()
                ? 'design-edit'
                : 'design-collapse-right';
              if (isRightWorkspaceCollapsed()) applyTutorialMapLayout();
            });
          } else if (tutorialMapBuildStage === 'architecture-stack-create') {
            waitForTutorialCreatedNode('.map-node.node-text', previousNodeIds, (nodeId) => {
              prepareTutorialArchitectureNode(nodeId, 'stack');
            });
          } else if (tutorialMapBuildStage === 'architecture-components-create') {
            waitForTutorialCreatedNode('.map-node.node-text', previousNodeIds, (nodeId) => {
              prepareTutorialArchitectureNode(nodeId, 'components');
            });
          } else if (tutorialMapBuildStage === 'architecture-content-create') {
            waitForTutorialCreatedNode('.map-node.node-text', previousNodeIds, (nodeId) => {
              prepareTutorialArchitectureNode(nodeId, 'content');
            });
          }
          return;
        }
        if (
          match.selector === '#workspace-collapse-right'
          && tutorialMapBuildStage === 'design-collapse-right'
        ) {
          animateCursorClick();
          hideCursor();
          window.setTimeout(() => {
            const current = steps()[currentStepIndex];
            if (!active || !current || current.id !== 'map-build' || !isRightWorkspaceCollapsed()) return;
            applyTutorialMapLayout();
            renderStep();
          }, 180);
          return;
        }
        if (match.element.classList.contains('map-node-edit-btn')) {
          const isArchitectureEdit = /^architecture-(stack|components|content)-edit$/.test(tutorialMapBuildStage);
          const nextStage = isArchitectureEdit
            ? tutorialMapBuildStage.replace(/-edit$/, '-review')
            : tutorialMapBuildStage === 'welcome-edit'
              ? 'welcome-title'
              : 'design-title';
          allowTutorialSyntheticClick = true;
          animateCursorClick();
          hideCursor();
          window.setTimeout(() => {
            allowTutorialSyntheticClick = false;
            waitForTutorialMapInspector(nextStage);
          }, 0);
          return;
        }
        if (match.selector === '#inspector-node-title') {
          animateCursorClick();
          hideCursor();
          if (tutorialMapBuildStage === 'welcome-title') {
            window.setTimeout(() => {
              void fillTutorialMapField(
                '#inspector-node-title',
                tutorialText('documents.welcome.title', {}, 'Briefing: Página de Boas-vindas'),
                'welcome-description',
                { label: 'Título do briefing' }
              );
            }, 90);
          } else if (tutorialMapBuildStage === 'design-title') {
            window.setTimeout(() => {
              void fillTutorialMapField(
                '#inspector-node-title',
                tutorialText('documents.design.title', {}, 'Design System Faber Code'),
                'design-description',
                { label: 'Título do Design System' }
              );
            }, 90);
          }
          return;
        }
        if (match.selector === '#inspector-node-desc') {
          animateCursorClick();
          hideCursor();
          if (tutorialMapBuildStage === 'welcome-description') {
            window.setTimeout(() => {
              void fillTutorialMapField(
                '#inspector-node-desc',
                tutorialText('documents.welcome.description', {}, 'Página estática de boas-vindas.'),
                'welcome-content',
                { label: 'Descrição do briefing', typingDelay: 14 }
              );
            }, 90);
          } else if (tutorialMapBuildStage === 'design-description') {
            window.setTimeout(() => {
              void fillTutorialMapField(
                '#inspector-node-desc',
                tutorialText('documents.design.description', {}, 'Cores, tipografias e regras visuais.'),
                'design-content',
                { label: 'Descrição do Design System', typingDelay: 14 }
              );
            }, 90);
          }
          return;
        }
        if (match.selector === '#workspace-map-inspector-panel .CodeMirror') {
          animateCursorClick();
          hideCursor();
          if (tutorialMapBuildStage === 'welcome-content') {
            window.setTimeout(() => {
              void fillTutorialMapField(
                '#inspector-node-content',
                tutorialText('documents.welcome.content'),
                'welcome-close',
                { markdown: true, completeWelcome: true }
              );
            }, 90);
          } else if (tutorialMapBuildStage === 'design-content') {
            window.setTimeout(() => {
              void fillTutorialMapField(
                '#inspector-node-content',
                tutorialText('documents.design.content'),
                'design-close',
                { markdown: true, completeDesign: true }
              );
            }, 90);
          }
          return;
        }
        if (match.selector === '#btn-map-inspector-close') {
          animateCursorClick();
          hideCursor();
          const closingStage = tutorialMapBuildStage;
          const nextStageByClosingStage = {
            'welcome-close': 'design-create',
            'design-close': 'logo-create',
            'architecture-stack-review': 'architecture-components-create',
            'architecture-components-review': 'architecture-content-create',
            'architecture-content-review': 'development-ready',
          };
          const nextStage = nextStageByClosingStage[closingStage];
          if (!nextStage) return;
          window.setTimeout(() => {
            tutorialMapInspectorOpened = false;
            tutorialMapBuildStage = nextStage;
            if (nextStage === 'development-ready') {
              tutorialDevelopmentReady = true;
              focusTutorialDevelopmentMap();
            }
            renderStep();
          }, 120);
          return;
        }
        if (match.selector === '#btn-map-tool-add-image') {
          if (tutorialMapCreationPending) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return;
          }
          tutorialMapCreationPending = true;
          const previousNodeIds = new Set(
            Array.from(doc.querySelectorAll('.map-node.node-image'))
              .map((node) => node.id)
              .filter(Boolean)
          );
          animateCursorClick();
          hideCursor();
          waitForTutorialCreatedNode('.map-node.node-image', previousNodeIds, (nodeId) => {
            if (!configureTutorialLogoNode(nodeId)) return;
            tutorialLogoNodeId = nodeId;
            tutorialMapBuildStage = 'frontend-group';
          });
          return;
        }
        if (match.selector === '#btn-map-tool-add-group') {
          if (tutorialMapCreationPending) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return;
          }
          tutorialMapCreationPending = true;
          const previousNodeIds = new Set(
            Array.from(doc.querySelectorAll('.map-node.node-group'))
              .map((node) => node.id)
              .filter(Boolean)
          );
          const groupStage = tutorialMapBuildStage;
          animateCursorClick();
          hideCursor();
          waitForTutorialCreatedNode('.map-node.node-group', previousNodeIds, (nodeId) => {
            if (groupStage === 'frontend-group') {
              if (!configureTutorialFrontendGroup(nodeId)) return;
              tutorialFrontendGroupId = nodeId;
              tutorialMapBuildStage = 'rules-group';
              return;
            }
            if (groupStage === 'rules-group') {
              if (!configureTutorialRulesGroup(nodeId)) return;
              tutorialRulesGroupId = nodeId;
              tutorialMapBuildStage = 'user-name';
            }
          });
          return;
        }
        animateCursorClick();
        hideCursor();
        return;
      }
      if (step.id === 'map-chat') {
        if (event.type === 'mousedown') {
          if (
            (tutorialMapChatStage === 'expand-right' || tutorialMapChatStage === 'right-tools')
            && RIGHT_PANEL_HOVER_SELECTORS.includes(match.selector)
          ) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
          }
          return;
        }
        if (match.selector === '#workspace-restore-right' && tutorialMapChatStage === 'expand-right') {
          animateCursorClick();
          hideCursor();
          window.setTimeout(() => {
            const current = steps()[currentStepIndex];
            if (!active || !current || current.id !== 'map-chat' || isRightWorkspaceCollapsed()) return;
            tutorialMapChatStage = 'right-tools';
            renderStep();
          }, 180);
          return;
        }
        if (
          (tutorialMapChatStage === 'expand-right' || tutorialMapChatStage === 'right-tools')
          && RIGHT_PANEL_HOVER_SELECTORS.includes(match.selector)
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          return;
        }
        if (match.selector === '#btn-map-ai' && tutorialMapChatStage === 'open') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          animateCursorClick();
          hideCursor();
          const controller = getTutorialMapController();
          allowTutorialSyntheticClick = true;
          const prepared = controller && typeof controller.prepareTutorialMapConversation === 'function'
            ? controller.prepareTutorialMapConversation()
            : false;
          window.setTimeout(() => {
            allowTutorialSyntheticClick = false;
            if (!prepared || !active) return;
            const current = steps()[currentStepIndex];
            if (!current || current.id !== 'map-chat') return;
            tutorialMapChatStage = 'compose';
            renderStep();
          }, 140);
          return;
        }
        if (match.selector === '#map-chat-textarea') {
          animateCursorClick();
          hideCursor();
          if (tutorialTypingInProgress) return;
          const runId = demoRunId;
          window.setTimeout(async () => {
            const completed = await typeInto('#map-chat-textarea', tutorialText('mapChat.prompt'), {
              runId,
              preserveValue: true,
              typingDelay: 18,
              label: 'Pergunta para a IA do Mapa',
            });
            const current = steps()[currentStepIndex];
            if (!completed || !active || !current || current.id !== 'map-chat') return;
            tutorialMapChatStage = 'send';
            renderStep();
          }, 90);
          return;
        }
        if (match.selector === '#btn-map-chat-send') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          animateCursorClick();
          hideCursor();
          const textarea = resolveElement('#map-chat-textarea');
          const userText = String(textarea && textarea.value || '').trim() || tutorialText('mapChat.prompt');
          if (textarea) textarea.value = '';
          tutorialMapChatStage = 'reply';
          renderStep();
          const controller = getTutorialMapController();
          const simulation = controller && typeof controller.simulateTutorialMapConversation === 'function'
            ? controller.simulateTutorialMapConversation(userText, tutorialText('mapChat.reply'))
            : Promise.resolve(false);
          Promise.resolve(simulation).then((completed) => {
            const current = steps()[currentStepIndex];
            if (!completed || !active || !current || current.id !== 'map-chat') return;
            tutorialMapChatStage = 'missing-info';
            renderStep();
          }).catch(() => {});
          return;
        }
        if (match.selector === '#btn-map-chat-add-gap' && tutorialMapChatStage === 'missing-info') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          animateCursorClick();
          hideCursor();
          applyTutorialMapGapCorrection();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      if (step.id === 'map-analysis') {
        if (event.type === 'mousedown') return;
        if (match.selector === '#btn-map-render-launcher' && tutorialMapAnalysisStage === 'history') {
          animateCursorClick();
          hideCursor();
          tutorialMapAnalysisStage = 'render-list';
          window.setTimeout(() => {
            refreshTutorialContext();
            renderStep();
          }, 240);
          return;
        }
        if (match.selector === '#btn-map-render-open' && tutorialMapAnalysisStage === 'render-list') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          animateCursorClick();
          hideCursor();
          tutorialMapAnalysisStage = 'rendering';
          renderStep();
          const controller = getTutorialMapController();
          const renderPromise = controller && typeof controller.generateTutorialRenderDraft === 'function'
            ? controller.generateTutorialRenderDraft()
            : Promise.resolve(false);
          Promise.resolve(renderPromise).then((completed) => {
            const current = steps()[currentStepIndex];
            if (!active || !current || current.id !== 'map-analysis') return;
            tutorialMapAnalysisStage = completed ? 'plan-ready' : 'render-list';
            renderStep();
          }).catch(() => {
            if (!active) return;
            tutorialMapAnalysisStage = 'render-list';
            renderStep();
          });
          return;
        }
        if (match.selector === '#btn-map-render-save' && tutorialMapAnalysisStage === 'plan-ready') {
          animateCursorClick();
          hideCursor();
          waitForElement('#faber-confirm-modal:not(.hidden)', { visible: true, timeout: 3000 }).then((modal) => {
            const current = steps()[currentStepIndex];
            if (!modal || !active || !current || current.id !== 'map-analysis') return;
            tutorialMapAnalysisStage = 'confirm';
            renderStep();
          });
          return;
        }
        if (match.selector === '#faber-confirm-yes' && tutorialMapAnalysisStage === 'confirm') {
          animateCursorClick();
          hideCursor();
          tutorialMapAnalysisStage = 'saving';
          window.setTimeout(() => {
            const confirmButton = resolveElement('#faber-confirm-yes');
            if (confirmButton) confirmButton.textContent = tutorialText('ui.confirm');
            if (active) renderStep();
          }, 180);
          return;
        }
        if (match.selector === '#btn-project-milestones' && tutorialMapAnalysisStage === 'milestones') {
          animateCursorClick();
          hideCursor();
          tutorialMapAnalysisStage = 'milestones-loading';
          waitForElement('.milestone-item:first-child .milestone-card', { visible: true, timeout: 5000 }).then((card) => {
            const current = steps()[currentStepIndex];
            if (!card || !active || !current || current.id !== 'map-analysis') return;
            tutorialMapAnalysisStage = 'milestone-open';
            renderStep();
          });
          return;
        }
        if (
          match.selector === '.milestone-item:first-child .milestone-card'
          && tutorialMapAnalysisStage === 'milestone-open'
        ) {
          animateCursorClick();
          hideCursor();
          window.setTimeout(() => {
            const current = steps()[currentStepIndex];
            if (!active || !current || current.id !== 'map-analysis') return;
            const selectedMilestone = resolveVisibleElement('.milestone-item.selected .milestone-card');
            if (!selectedMilestone) return;
            tutorialMapAnalysisStage = 'project-chat';
            if (typeof actions.revealProjectConversationButton === 'function') {
              actions.revealProjectConversationButton();
            }
            activeGuideSignature = '';
            renderStep();
          }, 180);
          return;
        }
        const projectConversationSelector = getTutorialCreatedProjectConversationSelector();
        if (match.selector === projectConversationSelector && tutorialMapAnalysisStage === 'project-chat') {
          animateCursorClick();
          hideCursor();
          tutorialMapAnalysisStage = 'opening-development-chat';
          window.setTimeout(() => {
            if (active) renderStep();
          }, 80);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      if (step.id === 'development-chat') {
        if (event.type === 'mousedown') return;
        if (match.selector === '#user-input' && tutorialDevelopmentChatStage === 'compose') {
          animateCursorClick();
          hideCursor();
          if (tutorialTypingInProgress) return;
          const runId = demoRunId;
          window.setTimeout(async () => {
            const completed = await typeInto('#user-input', tutorialText('development.prompt'), {
              runId,
              preserveValue: true,
              typingDelay: 18,
              label: 'Mensagem da Milestone 1',
            });
            const current = steps()[currentStepIndex];
            if (!completed || !active || !current || current.id !== 'development-chat') return;
            tutorialDevelopmentChatStage = 'send';
            persistTutorialDevelopmentState();
            renderStep();
          }, 90);
          return;
        }
        if (match.selector === '#btn-send' && tutorialDevelopmentChatStage === 'send') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          animateCursorClick();
          hideCursor();
          const input = resolveElement('#user-input');
          const userText = String(input && input.value || '').trim() || tutorialText('development.prompt');
          tutorialDevelopmentChatStage = 'sending';
          persistTutorialDevelopmentState();
          renderStep();
          const simulation = typeof actions.simulateTutorialDevelopmentConversation === 'function'
            ? actions.simulateTutorialDevelopmentConversation(userText, tutorialValue('development.replies', []))
            : Promise.resolve(false);
          Promise.resolve(simulation).then((completed) => {
            const current = steps()[currentStepIndex];
            if (!completed || !active || !current || current.id !== 'development-chat') return;
            tutorialDevelopmentChatStage = 'complete';
            tutorialDevelopmentConversationComplete = true;
            persistTutorialDevelopmentState();
            renderStep();
          }).catch(() => {
            if (!active) return;
            tutorialDevelopmentChatStage = 'send';
            persistTutorialDevelopmentState();
            renderStep();
          });
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      if (step.id === 'git') {
        if (event.type === 'mousedown') return;
        const stage = tutorialDevelopmentWorkflowStage;

        if (match.selector === '#btn-tab-chat' && stage === 'return-chat') {
          animateCursorClick();
          hideCursor();
          tutorialDevelopmentWorkflowStage = 'creating';
          persistTutorialDevelopmentState();
          window.setTimeout(() => {
            if (!active || steps()[currentStepIndex]?.id !== 'git') return;
            void startTutorialDevelopmentBatch(1);
          }, 260);
          return;
        }

        if (match.selector === '#btn-project-git' && (stage === 'open-git' || stage === 'idle')) {
          animateCursorClick();
          hideCursor();
          tutorialDevelopmentWorkflowStage = 'inspect-git';
          persistTutorialDevelopmentState();
          waitForElement('[data-tutorial-git-step]', { visible: true, timeout: 5000 }).then((panel) => {
            if (!panel || !active || steps()[currentStepIndex]?.id !== 'git') return;
            syncTutorialGitPanelStage();
          });
          return;
        }

        if (
          match.selector === '[data-tutorial-git-step="repo"] .right-tool-git-step__head'
          && stage === 'open-repo'
        ) {
          animateCursorClick();
          hideCursor();
          tutorialDevelopmentWorkflowStage = 'init-repo';
          persistTutorialDevelopmentState();
          window.setTimeout(() => active && renderStep(), 120);
          return;
        }

        if (match.selector === '[data-tutorial-git-action="init"]' && stage === 'init-repo') {
          animateCursorClick();
          hideCursor();
          tutorialDevelopmentWorkflowStage = 'initializing';
          persistTutorialDevelopmentState();
          window.setTimeout(() => {
            if (!active || tutorialDevelopmentWorkflowStage !== 'initializing') return;
            syncTutorialGitPanelStage();
          }, 3000);
          return;
        }

        if (
          match.selector === `[data-tutorial-git-step="${tutorialGitChangeScope}"] .right-tool-git-step__head`
          && stage === 'open-changes'
        ) {
          animateCursorClick();
          hideCursor();
          tutorialDevelopmentWorkflowStage = 'select-changes';
          persistTutorialDevelopmentState();
          window.setTimeout(async () => {
            if (!active || tutorialDevelopmentWorkflowStage !== 'select-changes') return;
            const selector = `[data-tutorial-git-action="select-all"][data-tutorial-git-scope="${tutorialGitChangeScope}"]`;
            const selectAll = await waitForElement(selector, { visible: true, timeout: 2400 });
            if (selectAll && active && tutorialDevelopmentWorkflowStage === 'select-changes') {
              selectAll.click();
            } else if (active) {
              renderStep();
            }
          }, 160);
          return;
        }

        if (
          match.selector === `[data-tutorial-git-action="select-all"][data-tutorial-git-scope="${tutorialGitChangeScope}"]`
          && stage === 'select-changes'
        ) {
          animateCursorClick();
          hideCursor();
          tutorialDevelopmentWorkflowStage = 'stage-changes';
          persistTutorialDevelopmentState();
          window.setTimeout(() => active && renderStep(), 120);
          return;
        }

        if (
          match.selector === `[data-tutorial-git-action="stage"][data-tutorial-git-scope="${tutorialGitChangeScope}"]`
          && stage === 'stage-changes'
        ) {
          animateCursorClick();
          hideCursor();
          tutorialDevelopmentWorkflowStage = 'staging';
          persistTutorialDevelopmentState();
          window.setTimeout(() => {
            if (!active || tutorialDevelopmentWorkflowStage !== 'staging') return;
            syncTutorialGitPanelStage();
          }, 3000);
          return;
        }

        if (
          match.selector === '[data-tutorial-git-action="select-all"][data-tutorial-git-scope="staged"]'
          && stage === 'select-staged'
        ) {
          animateCursorClick();
          hideCursor();
          tutorialDevelopmentWorkflowStage = 'commit-message';
          persistTutorialDevelopmentState();
          window.setTimeout(() => active && renderStep(), 120);
          return;
        }

        if (match.selector === '[data-tutorial-git-action="message"]' && stage === 'commit-message') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          animateCursorClick();
          hideCursor();
          if (tutorialTypingInProgress) return;
          const runId = demoRunId;
          const batch = getTutorialDevelopmentBatch(tutorialDevelopmentBatchIndex);
          window.setTimeout(async () => {
            const typed = await typeInto(
              '[data-tutorial-git-action="message"]',
              batch && batch.commitMessage
                ? batch.commitMessage
                : tutorialText('development.fallbackCommit', {
                    number: tutorialDevelopmentCommitCount + 1,
                  }),
              { runId, preserveValue: true, typingDelay: 22, label: 'Mensagem do commit' }
            );
            if (!typed || !active || steps()[currentStepIndex]?.id !== 'git') return;
            tutorialDevelopmentWorkflowStage = 'commit';
            persistTutorialDevelopmentState();
            renderStep();
          }, 80);
          return;
        }

        if (match.selector === '[data-tutorial-git-action="commit"]' && stage === 'commit') {
          animateCursorClick();
          hideCursor();
          tutorialDevelopmentWorkflowStage = 'committing';
          persistTutorialDevelopmentState();
          window.setTimeout(() => {
            if (!active || tutorialDevelopmentWorkflowStage !== 'committing') return;
            syncTutorialGitPanelStage();
          }, 3000);
          return;
        }

        if (match.selector === '#btn-project-files' && stage === 'open-files') {
          animateCursorClick();
          hideCursor();
          tutorialDevelopmentWorkflowStage = 'loading-files';
          persistTutorialDevelopmentState();
          window.setTimeout(async () => {
            if (!active || steps()[currentStepIndex]?.id !== 'git') return;
            if (typeof actions.refreshTutorialFiles === 'function') await actions.refreshTutorialFiles();
            const row = await waitForElement('.project-tree-row.file.has-diff', { visible: true, timeout: 5000 });
            if (!active || steps()[currentStepIndex]?.id !== 'git') return;
            tutorialDevelopmentWorkflowStage = row ? 'review-file' : 'open-files';
            persistTutorialDevelopmentState();
            renderStep();
          }, 260);
          return;
        }

        if (match.selector === '.project-tree-row.file.has-diff' && stage === 'review-file') {
          animateCursorClick();
          hideCursor();
          tutorialDevelopmentWorkflowStage = 'opening-file';
          persistTutorialDevelopmentState();
          waitForElement('#project-file-modal:not(.hidden)', { visible: true, timeout: 4000 }).then((modal) => {
            if (!modal || !active || steps()[currentStepIndex]?.id !== 'git') return;
            tutorialDevelopmentWorkflowStage = 'close-file';
            persistTutorialDevelopmentState();
            renderStep();
          });
          return;
        }

        if (match.selector === '#project-file-modal-close' && stage === 'close-file') {
          animateCursorClick();
          hideCursor();
          tutorialDevelopmentFilesReviewed = true;
          tutorialDevelopmentWorkflowStage = 'open-git';
          persistTutorialDevelopmentState();
          window.setTimeout(() => active && renderStep(), 220);
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      if (step.id === 'finish') {
        if (event.type === 'mousedown') return;
        if (match.selector === '#btn-project-deploy' && !tutorialPreviewLaunching && !tutorialPreviewStarted) {
          animateCursorClick();
          hideCursor();
          tutorialPreviewLaunching = true;
          window.setTimeout(() => active && renderStep(), 0);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
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
      if (elements.tutorialNameSave) elements.tutorialNameSave.addEventListener('click', submitTutorialUserName);
      if (elements.tutorialNameInput) {
        elements.tutorialNameInput.addEventListener('input', () => {
          elements.tutorialNameInput.removeAttribute('aria-invalid');
          if (elements.tutorialNameError) elements.tutorialNameError.textContent = '';
        });
        elements.tutorialNameInput.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          submitTutorialUserName();
        });
      }
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
      window.addEventListener('faber:milestones-updated', () => {
        if (!active) return;
        const current = steps()[currentStepIndex];
        if (!current || current.id !== 'map-analysis' || tutorialMapAnalysisStage !== 'saving') return;
        tutorialMilestonesSaved = true;
        tutorialMapAnalysisStage = 'milestones';
        const confirmButton = resolveElement('#faber-confirm-yes');
        if (confirmButton) confirmButton.textContent = tutorialText('ui.confirm');
        renderStep();
      });
      window.addEventListener('faber:project-conversation-prepared', (event) => {
        if (!active) return;
        const current = steps()[currentStepIndex];
        if (!current || current.id !== 'map-analysis' || tutorialMapAnalysisStage !== 'opening-development-chat') return;
        const projectId = String(event && event.detail && event.detail.projectId || '');
        const tutorialProject = getTutorialCreatedProject();
        if (tutorialProject && tutorialProject.id && projectId && projectId !== tutorialProject.id) return;
        tutorialMapAnalysisStage = 'development-chat-open';
        tutorialDevelopmentChatStage = 'compose';
        persistTutorialDevelopmentState();
        activeGuideSignature = '';
        renderStep();
      });
      window.addEventListener('faber:tutorial-git-action', (event) => {
        if (!active) return;
        const current = steps()[currentStepIndex];
        if (!current || current.id !== 'git') return;
        const action = String(event && event.detail && event.detail.action || '');
        if (action === 'init' && tutorialDevelopmentWorkflowStage === 'initializing') {
          tutorialDevelopmentWorkflowStage = 'inspect-git';
          persistTutorialDevelopmentState();
          window.setTimeout(syncTutorialGitPanelStage, 80);
          return;
        }
        if (action === 'stage' && tutorialDevelopmentWorkflowStage === 'staging') {
          tutorialDevelopmentWorkflowStage = 'select-staged';
          persistTutorialDevelopmentState();
          window.setTimeout(async () => {
            if (!active || tutorialDevelopmentWorkflowStage !== 'select-staged') return;
            const selectAll = await waitForElement(
              '[data-tutorial-git-action="select-all"][data-tutorial-git-scope="staged"]',
              { visible: true, timeout: 2400 }
            );
            if (selectAll && active && tutorialDevelopmentWorkflowStage === 'select-staged') {
              selectAll.click();
            } else if (active) {
              renderStep();
            }
          }, 100);
          return;
        }
        if (action === 'commit' && tutorialDevelopmentWorkflowStage === 'committing') {
          tutorialDevelopmentCommitCount = Math.min(2, tutorialDevelopmentCommitCount + 1);
          tutorialDevelopmentWorkflowStage = tutorialDevelopmentCommitCount >= 2 ? 'complete' : 'return-chat';
          persistTutorialDevelopmentState();
          renderStep();
        }
      });
      window.addEventListener('faber:project-preview-started', () => {
        if (!active) return;
        const current = steps()[currentStepIndex];
        if (!current || current.id !== 'finish') return;
        tutorialPreviewLaunching = false;
        tutorialPreviewStarted = true;
        renderStep();
      });
      window.addEventListener('faber:project-preview-failed', () => {
        if (!active) return;
        const current = steps()[currentStepIndex];
        if (!current || current.id !== 'finish') return;
        tutorialPreviewLaunching = false;
        tutorialPreviewStarted = false;
        renderStep();
      });
      window.addEventListener('resize', () => {
        const list = steps();
        const step = list[currentStepIndex];
        refreshTutorialContext();
        if (!active || !step) return;
        const guide = getStepGuide(step);
        highlightTargets(guide.disableHighlight ? [] : (guide.targets || []));
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
      maybeAdvanceProjectClassStep();
    }

    function notifyProjectCreated(projectId) {
      tutorialCreatedProjectId = String(projectId || '').trim();
      writeStorage(TUTORIAL_PROJECT_ID_KEY, tutorialCreatedProjectId);
      if (!active) return;
      renderStep();
      maybeAdvanceProjectClassStep();
    }

    function maybeAdvanceProjectClassStep() {
      const current = steps()[currentStepIndex];
      if (!active || !current || current.id !== 'project-class' || !current.canAdvance()) return;
      scheduleAutoAdvance('project-class', 180);
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

(function () {
  const GITHUB_URL = 'https://github.com/Eduardo-Frigo';
  const LINKEDIN_URL = 'https://www.linkedin.com/in/eduardo-frigo-b70067174/';

  const PROJECT_COPY = {
    'pt-BR': {
      locale: 'pt-BR',
      ogLocale: 'pt_BR',
      greeting: 'Olá,',
      metaDescription: 'Seja bem-vindo ao Faber Code, onde ideias ganham clareza, estrutura e espaço para evoluir.',
      socialDescription: 'Ideias claras. Projetos bem estruturados. Um novo ponto de partida.',
      keywords: ['Faber Code', 'boas-vindas', 'desenvolvimento', 'planejamento de produto'],
      logoAlt: 'Logo Faber Code',
      skipLink: 'Ir para o conteúdo principal',
      brandHomeLabel: 'Faber Code, voltar ao início',
      environmentReady: 'Ambiente preparado',
      welcome: 'BOAS-VINDAS',
      session: 'SESSÃO 01',
      heroLead: 'Seja bem-vindo ao Faber Code. Um espaço para transformar ideias em projetos',
      heroStrong: ' claros, organizados e prontos para evoluir.',
      startNow: 'Começar agora',
      knowFlow: 'Conhecer o fluxo',
      principlesLabel: 'Princípios do ambiente',
      clearDirection: 'Uma direção clara',
      roomToEvolve: 'Espaço para evoluir',
      blueprintLabel: 'Resumo do ponto de partida',
      signalAction: 'Ativar o percurso interativo de boas-vindas',
      signalPrompt: 'Toque no sinal para iniciar',
      signalConnected: 'Sinal conectado',
      stepWord: 'etapa',
      clarity: 'CLAREZA',
      structure: 'ESTRUTURA',
      evolution: 'EVOLUÇÃO',
      personalizedSession: 'Sessão personalizada para',
      codeConst: 'const',
      codeObject: 'começo',
      codePerson: 'pessoa',
      codeIdea: 'ideia',
      codeIdeaValue: 'em movimento',
      codeNextStep: 'próximoPasso',
      buildEyebrow: 'DO PENSAMENTO À ENTREGA',
      buildTitle: 'Todo projeto começa com uma direção.',
      buildSubtitle: 'Três movimentos, um fluxo contínuo.',
      orbitGesture: 'GESTO 01 · EXPLORAR',
      orbitTitle: 'Entre na órbita do projeto.',
      orbitInstruction: 'Passe o ponteiro por cada planeta. Apenas aquela órbita pausa e a decisão aparece inteira.',
      orbitActivate: 'Ativar órbitas',
      orbitLabel: 'Órbita interativa das decisões do projeto',
      orbitHint: 'MOVA O PONTEIRO ENTRE OS PLANETAS',
      orbitExplore: 'explorar órbita',
      signalFollow: 'Seguir o sinal até a experiência orbital',
      signalConnectedFollow: 'Sinal conectado · siga o fio',
      connectGesture: 'GESTO 02 · CONECTAR',
      connectTitle: 'Arraste as decisões. Construa o mapa.',
      connectInstruction: 'Leve cada item ao encaixe correspondente. A cor só aparece quando a conexão estiver completa.',
      mapSource: 'FONTE DO MAPA',
      dragDecision: 'ARRASTE',
      releaseTarget: 'SOLTE NO ENCAIXE',
      holdAndDrag: 'ESCOLHA E ARRASTE',
      connectedDecisions: 'decisões conectadas',
      mapConnected: 'Mapa conectado. Continue descendo para ativar o percurso.',
      connectionProgress: [
        { label: 'FONTE DO MAPA', text: 'Aguardando a primeira decisão.' },
        { label: 'PRIMEIRO SINAL', text: 'Uma decisão ganhou direção.' },
        { label: 'CONTEXTO ALINHADO', text: 'Duas decisões compartilham o mapa.' },
        { label: 'MAPA EM MOVIMENTO', text: 'As três decisões avançam juntas.' },
      ],
      connectionPreparing: 'Preparando a próxima etapa...',
      connectionCompleteEyebrow: 'MAPA CONECTADO',
      connectionCompleteTitle: 'Direção pronta para virar plano.',
      connectionCompleteText: 'Clareza, estrutura e evolução agora avançam juntas.',
      storyGesture: 'FABER CODE · DO MAPA À ENTREGA',
      storyTitle: 'Uma direção. Quatro camadas de execução.',
      storyInstruction: 'O Faber Code transforma contexto em decisões, decisões em milestones e milestones em código rastreável.',
      storyActivateLabel: 'Ativar a narrativa do sinal',
      activateStory: 'TOQUE NO PULSO',
      storyMoving: 'SINAL EM MOVIMENTO',
      storyPanels: [
        { number: '01', eyebrow: 'MAPA', title: 'A intenção ganha uma estrutura visível.', text: 'Briefings, referências e regras passam a compartilhar o mesmo contexto antes do desenvolvimento.' },
        { number: '02', eyebrow: 'ANÁLISE', title: 'A IA encontra lacunas antes do código.', text: 'O assistente revisa o mapa, sinaliza informações ausentes e reduz retrabalho na execução.' },
        { number: '03', eyebrow: 'MILESTONES', title: 'O plano se torna executável.', text: 'Cada etapa reúne objetivos, critérios e arquivos de referência para orientar o desenvolvimento.' },
        { number: '∞', eyebrow: 'DESENVOLVIMENTO', title: 'Chat, Git e execução fecham o ciclo.', text: 'Os arquivos evoluem com histórico, commits e uma prévia local pronta para validar.' },
      ],
      steps: [
        { number: '01', label: 'Clareza', title: 'Dê forma à ideia', text: 'Organize intenção, contexto e referências antes de escrever a primeira linha.', prompt: 'Toda boa construção começa quando a intenção ganha contorno.', action: 'Dar forma à ideia', motion: 'rise' },
        { number: '02', label: 'Estrutura', title: 'Conecte as decisões', text: 'Transforme informações dispersas em um mapa que orienta cada etapa do projeto.', prompt: 'Agora conecte contexto e escolhas para enxergar o caminho completo.', action: 'Conectar decisões', motion: 'scan' },
        { number: '03', label: 'Evolução', title: 'Construa com propósito', text: 'Avance por marcos claros, valide o resultado e mantenha o projeto pronto para crescer.', prompt: 'Com direção e estrutura, o próximo movimento já pode começar.', action: 'Concluir percurso', motion: 'turn' },
      ],
      journeyComplete: 'PERCURSO COMPLETO',
      journeyMovement: 'MOVIMENTO',
      journeyReadyTitle: 'Seu ponto de partida está pronto.',
      journeyReadyText: 'Você percorreu clareza, estrutura e evolução. O próximo projeto pode começar com intenção.',
      journeyHint: 'Passe o cursor pelas etapas, escolha um movimento e avance no seu ritmo.',
      journeyRestart: 'Percorrer novamente',
      footerKicker: 'CONTINUE A CONVERSA',
      footerCopy: 'O próximo passo começa com uma boa pergunta.',
      footerSignature: 'Faber Code / ponto de partida 01',
      socialLabel: 'Redes sociais',
      openNewTab: 'abrir em nova aba',
      foundationTitle: 'Fundação do projeto',
      foundationCommit: 'chore: preparar fundação da landing page',
      foundationIntro: 'Vou criar a fundação executável em Next.js, configurar Tailwind CSS e preparar a composição da página.',
      foundationProgress: 'A configuração e o conteúdo localizado estão prontos. Agora estou conectando o layout, os metadados e a estrutura da página.',
      foundationComplete: 'Fundação criada. Vamos versionar essa base antes de continuar o desenvolvimento pelo chat.',
      experienceTitle: 'Experiência completa',
      experienceCommit: 'feat: concluir experiência responsiva e SEO',
      experienceIntro: 'Com a fundação versionada, vou concluir os componentes, o Design System, a responsividade, a acessibilidade e o SEO.',
      experienceProgress: 'A marca e a saudação já estão implementadas. Estou finalizando o percurso visual, os links sociais e os ajustes responsivos.',
      experienceComplete: 'Implementação concluída. Abra Arquivos para revisar as diffs antes do commit final.',
      readmeTitle: 'Boas-vindas Faber Code',
      readmeDescription: 'Landing page responsiva criada durante o tutorial do Faber Code.',
      readmeDevelopment: 'Desenvolvimento',
      readmeInstall: 'Execute',
      readmeOpen: 'Abra',
      readmeName: 'O nome pode ser alterado com',
      readmeLinks: 'Os links sociais apontam para',
    },
    'en-US': {
      locale: 'en-US',
      ogLocale: 'en_US',
      greeting: 'Hello,',
      metaDescription: 'Welcome to Faber Code, where ideas gain clarity, structure, and room to evolve.',
      socialDescription: 'Clear ideas. Well-structured projects. A new starting point.',
      keywords: ['Faber Code', 'welcome', 'development', 'product planning'],
      logoAlt: 'Faber Code logo',
      skipLink: 'Skip to main content',
      brandHomeLabel: 'Faber Code, back to the beginning',
      environmentReady: 'Environment ready',
      welcome: 'WELCOME',
      session: 'SESSION 01',
      heroLead: 'Welcome to Faber Code. A space for turning ideas into projects that are',
      heroStrong: ' clear, organized, and ready to evolve.',
      startNow: 'Start now',
      knowFlow: 'Explore the flow',
      principlesLabel: 'Environment principles',
      clearDirection: 'A clear direction',
      roomToEvolve: 'Room to evolve',
      blueprintLabel: 'Starting point overview',
      signalAction: 'Activate the interactive welcome journey',
      signalPrompt: 'Touch the signal to begin',
      signalConnected: 'Signal connected',
      stepWord: 'step',
      clarity: 'CLARITY',
      structure: 'STRUCTURE',
      evolution: 'EVOLUTION',
      personalizedSession: 'Personalized session for',
      codeConst: 'const',
      codeObject: 'beginning',
      codePerson: 'person',
      codeIdea: 'idea',
      codeIdeaValue: 'in motion',
      codeNextStep: 'nextStep',
      buildEyebrow: 'FROM THOUGHT TO DELIVERY',
      buildTitle: 'Every project starts with a direction.',
      buildSubtitle: 'Three movements, one continuous flow.',
      orbitGesture: 'GESTURE 01 · EXPLORE',
      orbitTitle: 'Enter the project orbit.',
      orbitInstruction: 'Move across each planet. Only that orbit pauses, keeping the full decision in view.',
      orbitActivate: 'Activate orbits',
      orbitLabel: 'Interactive orbit of project decisions',
      orbitHint: 'MOVE BETWEEN THE PLANETS',
      orbitExplore: 'explore orbit',
      signalFollow: 'Follow the signal to the orbital experience',
      signalConnectedFollow: 'Signal connected · follow the thread',
      connectGesture: 'GESTURE 02 · CONNECT',
      connectTitle: 'Drag the decisions. Build the map.',
      connectInstruction: 'Move each item to its matching socket. Color appears only after a connection is complete.',
      mapSource: 'MAP SOURCE',
      dragDecision: 'DRAG',
      releaseTarget: 'DROP IN THE SOCKET',
      holdAndDrag: 'CHOOSE AND DRAG',
      connectedDecisions: 'decisions connected',
      mapConnected: 'Map connected. Keep scrolling to activate the journey.',
      connectionProgress: [
        { label: 'MAP SOURCE', text: 'Waiting for the first decision.' },
        { label: 'FIRST SIGNAL', text: 'One decision has a direction.' },
        { label: 'CONTEXT ALIGNED', text: 'Two decisions share the map.' },
        { label: 'MAP IN MOTION', text: 'All three decisions move together.' },
      ],
      connectionPreparing: 'Preparing the next stage...',
      connectionCompleteEyebrow: 'MAP CONNECTED',
      connectionCompleteTitle: 'Direction ready to become a plan.',
      connectionCompleteText: 'Clarity, structure, and evolution now move together.',
      storyGesture: 'FABER CODE · FROM MAP TO DELIVERY',
      storyTitle: 'One direction. Four layers of execution.',
      storyInstruction: 'Faber Code turns context into decisions, decisions into milestones, and milestones into traceable code.',
      storyActivateLabel: 'Activate the signal story',
      activateStory: 'TOUCH THE PULSE',
      storyMoving: 'SIGNAL IN MOTION',
      storyPanels: [
        { number: '01', eyebrow: 'MAP', title: 'Intent gains a visible structure.', text: 'Briefs, references, and rules begin sharing the same context before development.' },
        { number: '02', eyebrow: 'ANALYSIS', title: 'AI finds gaps before code.', text: 'The assistant reviews the map, flags missing information, and reduces rework during execution.' },
        { number: '03', eyebrow: 'MILESTONES', title: 'The plan becomes executable.', text: 'Each stage brings together goals, criteria, and reference files to guide development.' },
        { number: '∞', eyebrow: 'DEVELOPMENT', title: 'Chat, Git, and execution close the loop.', text: 'Files evolve with history, commits, and a local preview ready for validation.' },
      ],
      steps: [
        { number: '01', label: 'Clarity', title: 'Shape the idea', text: 'Organize intent, context, and references before writing the first line.', prompt: 'Every strong build begins when intent gains a clear shape.', action: 'Shape the idea', motion: 'rise' },
        { number: '02', label: 'Structure', title: 'Connect decisions', text: 'Turn scattered information into a map that guides every stage of the project.', prompt: 'Now connect context and choices to reveal the complete path.', action: 'Connect decisions', motion: 'scan' },
        { number: '03', label: 'Evolution', title: 'Build with purpose', text: 'Move through clear milestones, validate the outcome, and keep the project ready to grow.', prompt: 'With direction and structure, the next movement can begin.', action: 'Complete the journey', motion: 'turn' },
      ],
      journeyComplete: 'JOURNEY COMPLETE',
      journeyMovement: 'MOVEMENT',
      journeyReadyTitle: 'Your starting point is ready.',
      journeyReadyText: 'You moved through clarity, structure, and evolution. The next project can begin with intent.',
      journeyHint: 'Move across the stages, choose a movement, and continue at your own pace.',
      journeyRestart: 'Explore again',
      footerKicker: 'KEEP THE CONVERSATION GOING',
      footerCopy: 'The next step starts with a good question.',
      footerSignature: 'Faber Code / starting point 01',
      socialLabel: 'Social profiles',
      openNewTab: 'open in a new tab',
      foundationTitle: 'Project foundation',
      foundationCommit: 'chore: prepare landing page foundation',
      foundationIntro: 'I will create the executable Next.js foundation, configure Tailwind CSS, and prepare the page composition.',
      foundationProgress: 'Configuration and localized content are ready. I am now connecting the layout, metadata, and page structure.',
      foundationComplete: 'Foundation created. Let us version this base before continuing development in chat.',
      experienceTitle: 'Complete experience',
      experienceCommit: 'feat: complete responsive experience and SEO',
      experienceIntro: 'With the foundation versioned, I will complete the components, Design System, responsiveness, accessibility, and SEO.',
      experienceProgress: 'The brand and greeting are implemented. I am finishing the visual journey, social links, and responsive refinements.',
      experienceComplete: 'Implementation complete. Open Files to review the diffs before the final commit.',
      readmeTitle: 'Faber Code welcome page',
      readmeDescription: 'Responsive landing page created during the Faber Code tutorial.',
      readmeDevelopment: 'Development',
      readmeInstall: 'Run',
      readmeOpen: 'Open',
      readmeName: 'The name can be changed with',
      readmeLinks: 'Social links point to',
    },
    'es-ES': {
      locale: 'es-ES',
      ogLocale: 'es_ES',
      greeting: 'Hola,',
      metaDescription: 'Te damos la bienvenida a Faber Code, donde las ideas ganan claridad, estructura y espacio para evolucionar.',
      socialDescription: 'Ideas claras. Proyectos bien estructurados. Un nuevo punto de partida.',
      keywords: ['Faber Code', 'bienvenida', 'desarrollo', 'planificación de producto'],
      logoAlt: 'Logo de Faber Code',
      skipLink: 'Ir al contenido principal',
      brandHomeLabel: 'Faber Code, volver al inicio',
      environmentReady: 'Entorno preparado',
      welcome: 'BIENVENIDA',
      session: 'SESIÓN 01',
      heroLead: 'Te damos la bienvenida a Faber Code. Un espacio para transformar ideas en proyectos',
      heroStrong: ' claros, organizados y listos para evolucionar.',
      startNow: 'Empezar ahora',
      knowFlow: 'Conocer el flujo',
      principlesLabel: 'Principios del entorno',
      clearDirection: 'Una dirección clara',
      roomToEvolve: 'Espacio para evolucionar',
      blueprintLabel: 'Resumen del punto de partida',
      signalAction: 'Activar el recorrido interactivo de bienvenida',
      signalPrompt: 'Toca la señal para comenzar',
      signalConnected: 'Señal conectada',
      stepWord: 'etapa',
      clarity: 'CLARIDAD',
      structure: 'ESTRUCTURA',
      evolution: 'EVOLUCIÓN',
      personalizedSession: 'Sesión personalizada para',
      codeConst: 'const',
      codeObject: 'comienzo',
      codePerson: 'persona',
      codeIdea: 'idea',
      codeIdeaValue: 'en movimiento',
      codeNextStep: 'siguientePaso',
      buildEyebrow: 'DEL PENSAMIENTO A LA ENTREGA',
      buildTitle: 'Todo proyecto comienza con una dirección.',
      buildSubtitle: 'Tres movimientos, un flujo continuo.',
      orbitGesture: 'GESTO 01 · EXPLORAR',
      orbitTitle: 'Entra en la órbita del proyecto.',
      orbitInstruction: 'Pasa el puntero por cada planeta. Solo esa órbita se pausa y la decisión aparece completa.',
      orbitActivate: 'Activar órbitas',
      orbitLabel: 'Órbita interactiva de las decisiones del proyecto',
      orbitHint: 'MUEVE EL PUNTERO ENTRE LOS PLANETAS',
      orbitExplore: 'explorar órbita',
      signalFollow: 'Seguir la señal hasta la experiencia orbital',
      signalConnectedFollow: 'Señal conectada · sigue el hilo',
      connectGesture: 'GESTO 02 · CONECTAR',
      connectTitle: 'Arrastra las decisiones. Construye el mapa.',
      connectInstruction: 'Lleva cada elemento a su encaje correspondiente. El color aparece solo al completar la conexión.',
      mapSource: 'ORIGEN DEL MAPA',
      dragDecision: 'ARRASTRA',
      releaseTarget: 'SUELTA EN EL ENCAJE',
      holdAndDrag: 'ELIGE Y ARRASTRA',
      connectedDecisions: 'decisiones conectadas',
      mapConnected: 'Mapa conectado. Sigue bajando para activar el recorrido.',
      connectionProgress: [
        { label: 'ORIGEN DEL MAPA', text: 'Esperando la primera decisión.' },
        { label: 'PRIMERA SEÑAL', text: 'Una decisión ya tiene dirección.' },
        { label: 'CONTEXTO ALINEADO', text: 'Dos decisiones comparten el mapa.' },
        { label: 'MAPA EN MOVIMIENTO', text: 'Las tres decisiones avanzan juntas.' },
      ],
      connectionPreparing: 'Preparando la siguiente etapa...',
      connectionCompleteEyebrow: 'MAPA CONECTADO',
      connectionCompleteTitle: 'La dirección está lista para convertirse en plan.',
      connectionCompleteText: 'Claridad, estructura y evolución ahora avanzan juntas.',
      storyGesture: 'FABER CODE · DEL MAPA A LA ENTREGA',
      storyTitle: 'Una dirección. Cuatro capas de ejecución.',
      storyInstruction: 'Faber Code transforma contexto en decisiones, decisiones en hitos e hitos en código trazable.',
      storyActivateLabel: 'Activar la narrativa de la señal',
      activateStory: 'TOCA EL PULSO',
      storyMoving: 'SEÑAL EN MOVIMIENTO',
      storyPanels: [
        { number: '01', eyebrow: 'MAPA', title: 'La intención obtiene una estructura visible.', text: 'Briefings, referencias y reglas comparten el mismo contexto antes del desarrollo.' },
        { number: '02', eyebrow: 'ANÁLISIS', title: 'La IA encuentra vacíos antes del código.', text: 'El asistente revisa el mapa, detecta información faltante y reduce retrabajo durante la ejecución.' },
        { number: '03', eyebrow: 'HITOS', title: 'El plan se vuelve ejecutable.', text: 'Cada etapa reúne objetivos, criterios y archivos de referencia para orientar el desarrollo.' },
        { number: '∞', eyebrow: 'DESARROLLO', title: 'Chat, Git y ejecución cierran el ciclo.', text: 'Los archivos evolucionan con historial, commits y una vista local lista para validar.' },
      ],
      steps: [
        { number: '01', label: 'Claridad', title: 'Da forma a la idea', text: 'Organiza intención, contexto y referencias antes de escribir la primera línea.', prompt: 'Toda buena construcción comienza cuando la intención toma forma.', action: 'Dar forma a la idea', motion: 'rise' },
        { number: '02', label: 'Estructura', title: 'Conecta las decisiones', text: 'Transforma información dispersa en un mapa que orienta cada etapa del proyecto.', prompt: 'Ahora conecta el contexto y las decisiones para revelar el camino completo.', action: 'Conectar decisiones', motion: 'scan' },
        { number: '03', label: 'Evolución', title: 'Construye con propósito', text: 'Avanza por hitos claros, valida el resultado y mantén el proyecto listo para crecer.', prompt: 'Con dirección y estructura, el próximo movimiento ya puede comenzar.', action: 'Completar el recorrido', motion: 'turn' },
      ],
      journeyComplete: 'RECORRIDO COMPLETO',
      journeyMovement: 'MOVIMIENTO',
      journeyReadyTitle: 'Tu punto de partida está listo.',
      journeyReadyText: 'Recorriste claridad, estructura y evolución. El próximo proyecto puede comenzar con intención.',
      journeyHint: 'Pasa el cursor por las etapas, elige un movimiento y avanza a tu ritmo.',
      journeyRestart: 'Recorrer de nuevo',
      footerKicker: 'CONTINÚA LA CONVERSACIÓN',
      footerCopy: 'El siguiente paso comienza con una buena pregunta.',
      footerSignature: 'Faber Code / punto de partida 01',
      socialLabel: 'Redes sociales',
      openNewTab: 'abrir en una pestaña nueva',
      foundationTitle: 'Base del proyecto',
      foundationCommit: 'chore: preparar base de la landing page',
      foundationIntro: 'Crearé la base ejecutable en Next.js, configuraré Tailwind CSS y prepararé la composición de la página.',
      foundationProgress: 'La configuración y el contenido localizado están listos. Ahora estoy conectando el layout, los metadatos y la estructura de la página.',
      foundationComplete: 'Base creada. Vamos a versionarla antes de continuar el desarrollo en el chat.',
      experienceTitle: 'Experiencia completa',
      experienceCommit: 'feat: completar experiencia responsiva y SEO',
      experienceIntro: 'Con la base versionada, completaré los componentes, el Design System, la adaptación responsiva, la accesibilidad y el SEO.',
      experienceProgress: 'La marca y el saludo ya están implementados. Estoy terminando el recorrido visual, los enlaces sociales y los ajustes responsivos.',
      experienceComplete: 'Implementación finalizada. Abre Archivos para revisar los cambios antes del commit final.',
      readmeTitle: 'Bienvenida de Faber Code',
      readmeDescription: 'Landing page responsiva creada durante el tutorial de Faber Code.',
      readmeDevelopment: 'Desarrollo',
      readmeInstall: 'Ejecuta',
      readmeOpen: 'Abre',
      readmeName: 'El nombre se puede cambiar con',
      readmeLinks: 'Los enlaces sociales apuntan a',
    },
  };

  function normalizeWelcomeName(value) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    return normalized.split(' ')[0].slice(0, 24) || 'Eduardo';
  }

  function normalizeWelcomeLocale(value) {
    const locale = String(value || '').trim();
    if (PROJECT_COPY[locale]) return locale;
    if (locale.toLowerCase().startsWith('en')) return 'en-US';
    if (locale.toLowerCase().startsWith('es')) return 'es-ES';
    return 'pt-BR';
  }

  function createWelcomeProjectBatches(options = {}) {
    const name = normalizeWelcomeName(options.name);
    const locale = normalizeWelcomeLocale(options.locale);
    const copy = PROJECT_COPY[locale];
    const serializedName = JSON.stringify(name);
    const serializedCopy = JSON.stringify(copy, null, 2);

    return [
      {
        id: 'foundation',
        title: copy.foundationTitle,
        label: copy.foundationTitle,
        commitMessage: copy.foundationCommit,
        intro: copy.foundationIntro,
        progress: copy.foundationProgress,
        complete: copy.foundationComplete,
        files: [
          {
            path: 'package.json',
            content: `${JSON.stringify({
              name: 'boas-vindas-faber-code',
              version: '1.0.0',
              private: true,
              scripts: {
                dev: 'next dev',
                build: 'next build',
                start: 'serve out',
                lint: 'eslint .',
              },
              dependencies: {
                '@fontsource/ibm-plex-mono': '5.2.7',
                '@fontsource-variable/manrope': '5.2.8',
                next: '16.2.10',
                react: '19.2.7',
                'react-dom': '19.2.7',
              },
              devDependencies: {
                '@tailwindcss/postcss': '4.3.2',
                eslint: '9.39.5',
                'eslint-config-next': '16.2.10',
                serve: '14.2.6',
                tailwindcss: '4.3.2',
              },
              overrides: { postcss: '8.5.19' },
            }, null, 2)}\n`,
          },
          {
            path: '.gitignore',
            content: 'node_modules/\n.next/\nout/\n.env*.local\n.DS_Store\nnpm-debug.log*\n',
          },
          {
            path: 'next.config.mjs',
            content: `import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  turbopack: { root: projectRoot },
};

export default nextConfig;
`,
          },
          {
            path: 'postcss.config.mjs',
            content: `const config = {
  plugins: { "@tailwindcss/postcss": {} },
};

export default config;
`,
          },
          {
            path: 'jsconfig.json',
            content: '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": { "@/*": ["./*"] }\n  }\n}\n',
          },
          {
            path: 'lib/site-content.js',
            content: `export const siteCopy = ${serializedCopy};\n`,
          },
          {
            path: 'app/layout.js',
            content: `import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";
import "./interactive.css";
import { siteCopy } from "@/lib/site-content";

const configuredName = process.env.NEXT_PUBLIC_WELCOME_NAME?.trim() || ${serializedName};
const welcomeName = configuredName.replace(/\\s+/g, " ").split(" ")[0].slice(0, 24) || ${serializedName};
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: \`\${siteCopy.greeting} \${welcomeName} | Faber Code\`,
  description: siteCopy.metaDescription,
  applicationName: "Faber Code",
  keywords: siteCopy.keywords,
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: siteCopy.ogLocale,
    siteName: "Faber Code",
    title: \`\${siteCopy.greeting} \${welcomeName} | Faber Code\`,
    description: siteCopy.socialDescription,
    images: [{ url: "/faber-code-logo.png", width: 4500, height: 1093, alt: siteCopy.logoAlt }],
  },
  twitter: {
    card: "summary_large_image",
    title: \`\${siteCopy.greeting} \${welcomeName} | Faber Code\`,
    description: siteCopy.socialDescription,
    images: ["/faber-code-logo.png"],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050505",
  colorScheme: "dark",
};

export default function RootLayout({ children }) {
  return <html lang={siteCopy.locale} suppressHydrationWarning><body suppressHydrationWarning>{children}</body></html>;
}
`,
          },
          {
            path: 'app/page.js',
            content: `import { BrandHeader } from "@/components/BrandHeader";
import { SocialLinks } from "@/components/SocialLinks";
import { WelcomeExperience } from "@/components/WelcomeExperience";
import { siteCopy } from "@/lib/site-content";

export default function Home() {
  const configuredName = process.env.NEXT_PUBLIC_WELCOME_NAME?.trim() || ${serializedName};
  const welcomeName = configuredName.replace(/\\s+/g, " ").split(" ")[0].slice(0, 24) || ${serializedName};
  const socialLinks = [
    { label: "GitHub", detail: "Eduardo-Frigo", href: "${GITHUB_URL}", kind: "github" },
    { label: "LinkedIn", detail: "eduardo-frigo-b70067174", href: "${LINKEDIN_URL}", kind: "linkedin" },
  ];

  return (
    <div className="site-shell">
      <a className="skip-link" href="#conteudo-principal">{siteCopy.skipLink}</a>
      <div className="ambient-grid" aria-hidden="true" />
      <div className="ambient-glow" aria-hidden="true" />
      <BrandHeader />
      <main id="conteudo-principal">
        <WelcomeExperience name={welcomeName} />
      </main>
      <footer className="site-footer">
        <div>
          <p className="footer-kicker">{siteCopy.footerKicker}</p>
          <p className="footer-copy">{siteCopy.footerCopy}</p>
        </div>
        <SocialLinks links={socialLinks} />
        <p className="footer-signature">{siteCopy.footerSignature}</p>
      </footer>
    </div>
  );
}
`,
          },
          {
            path: 'app/interactive.css',
            content: `/* Interactive welcome journey */
.hero-title { max-width: 9ch; font-size: clamp(4.2rem, 8vw, 7.6rem); }
.signal-core-button { z-index: 3; padding: 0; cursor: pointer; }
.hero-planet { position: absolute; z-index: 4; display: grid; width: 1rem; height: 1rem; padding: 0; place-items: center; border: 1px solid rgba(80,201,133,.7); border-radius: 50%; background: var(--green); box-shadow: 0 0 0 .35rem rgba(80,201,133,.08),0 0 1.5rem rgba(80,201,133,.4); cursor: pointer; transition: transform 220ms ease,box-shadow 220ms ease; }
.hero-planet span { position: absolute; bottom: calc(100% + .7rem); left: 50%; width: max-content; padding: .35rem .55rem; border: 1px solid var(--green-line); border-radius: 999px; background: rgba(5,5,5,.9); color: var(--paper); font-family: "IBM Plex Mono",monospace; font-size: .5rem; letter-spacing: .08em; opacity: 0; pointer-events: none; transform: translate(-50%,.4rem); transition: opacity 180ms ease,transform 180ms ease; }
.hero-planet:hover,.hero-planet:focus-visible { z-index: 6; transform: scale(1.4); box-shadow: 0 0 0 .6rem rgba(80,201,133,.12),0 0 2.2rem rgba(80,201,133,.65); }
.hero-planet:hover span,.hero-planet:focus-visible span { opacity: 1; transform: translate(-50%,0); }
.hero-planet--clarity { top: 28%; left: 27%; }.hero-planet--structure { top: 55%; right: 24%; }.hero-planet--evolution { right: 40%; bottom: 18%; }
.interactive-journey { position: relative; width: min(100%,1600px); margin-inline: auto; }
.interactive-journey::before { position: absolute; z-index: 2; top: -8rem; left: 73%; width: 1px; height: 15rem; background: linear-gradient(transparent,var(--green),transparent); content: ""; opacity: .35; }
.experience-section { position: relative; padding: clamp(6rem,10vw,10rem) var(--page-gutter); border-top: 1px solid var(--line-soft); }
.experience-heading { display: grid; grid-template-columns: minmax(9rem,.35fr) minmax(18rem,1fr) minmax(14rem,.55fr); align-items: end; gap: clamp(1.5rem,4vw,4rem); margin-bottom: clamp(4rem,8vw,8rem); }
.experience-heading>p,.story-header>p { margin: 0; color: var(--green); font-family: "IBM Plex Mono",monospace; font-size: .66rem; font-weight: 600; letter-spacing: .13em; }
.experience-heading h2,.story-header h2 { margin: 0; font-size: clamp(2.8rem,6vw,6.6rem); font-weight: 440; letter-spacing: -.065em; line-height: .94; }
.experience-heading>span,.story-header>span { color: var(--muted); font-size: clamp(.9rem,1.4vw,1.1rem); line-height: 1.6; }
.orbital-lab { min-height: 110svh; background: radial-gradient(circle at 48% 61%,rgba(80,201,133,.09),transparent 28rem),linear-gradient(180deg,rgba(5,5,5,0),rgba(11,14,12,.7)); }
.planetary-stage { display: grid; grid-template-columns: minmax(24rem,1fr) minmax(16rem,.42fr); align-items: center; gap: clamp(2rem,7vw,8rem); min-height: 46rem; }
.planetary-system { position: relative; display: grid; width: min(70vw,48rem); aspect-ratio: 1; place-items: center; justify-self: center; border-radius: 50%; background: radial-gradient(circle,rgba(80,201,133,.08),transparent 59%); isolation: isolate; }
.planetary-system::before,.planetary-system::after,.planetary-axis { position: absolute; inset: 8%; border: 1px dashed rgba(80,201,133,.22); border-radius: 50%; content: ""; }
.planetary-system::after { inset: 24%; border-style: solid; border-color: rgba(80,201,133,.16); }.planetary-axis { inset: 39%; border-style: solid; border-color: rgba(80,201,133,.32); box-shadow: 0 0 4rem rgba(80,201,133,.1); }
.planetary-core { position: relative; z-index: 5; display: grid; width: clamp(4rem,8vw,6.4rem); aspect-ratio: 1; padding: 0; place-items: center; border: 1px solid var(--green-line); border-radius: 50%; background: rgba(5,5,5,.92); cursor: pointer; box-shadow: 0 0 4rem rgba(80,201,133,.18); }
.planetary-core span { width: 24%; aspect-ratio: 1; border-radius: 50%; background: var(--green); box-shadow: 0 0 2.2rem rgba(80,201,133,.95); animation: story-pulse 2.1s ease-in-out infinite; }
.planet-orbit { position: absolute; z-index: 4; display: grid; place-items: start center; border: 1px solid transparent; border-radius: 50%; pointer-events: none; animation: planet-orbit 22s linear infinite; }
.planet-orbit--1 { inset: 7%; animation-duration: 27s; }.planet-orbit--2 { inset: 22%; animation-duration: 20s; animation-direction: reverse; }.planet-orbit--3 { inset: 36%; animation-duration: 14s; }
.planet { position: relative; z-index: 3; display: grid; width: clamp(2.4rem,5vw,4rem); aspect-ratio: 1; padding: 0; place-items: center; border: 1px solid rgba(80,201,133,.55); border-radius: 50%; background: #0a120e; pointer-events: auto; cursor: crosshair; box-shadow: 0 0 0 .65rem rgba(80,201,133,.04),0 0 2rem rgba(80,201,133,.14); animation: planet-counter-orbit 22s linear infinite; transition: box-shadow 240ms ease,transform 240ms ease; }
.planet-orbit--1 .planet { animation-duration: 27s; }.planet-orbit--2 .planet { animation-duration: 20s; animation-direction: reverse; }.planet-orbit--3 .planet { animation-duration: 14s; }
.planet-surface { width: 36%; aspect-ratio: 1; border-radius: 50%; background: var(--green); box-shadow: 0 0 1.5rem rgba(80,201,133,.85); }
.planet::before { position:absolute; inset:-.7rem; border-radius:50%; content:""; }
.planet:hover,.planet:focus-visible,.planet[aria-pressed="true"] { z-index: 10; transform: scale(1.18); box-shadow: 0 0 0 1rem rgba(80,201,133,.08),0 0 3rem rgba(80,201,133,.36); }
.planetary-system:has(.planet:hover) .planet-orbit,.planetary-system:has(.planet:focus-visible) .planet-orbit,.planetary-system:has(.planet:hover) .planet,.planetary-system:has(.planet:focus-visible) .planet { animation-play-state: paused; }
.orbit-readout { position: relative; min-height: 24rem; padding: clamp(1.5rem,3vw,2.7rem); border-top: 1px solid var(--green-line); border-bottom: 1px solid var(--line-soft); }
.orbit-readout>span:first-child,.orbit-readout>p:first-of-type,.orbit-readout-hint { color: var(--green); font-family: "IBM Plex Mono",monospace; font-size: .62rem; letter-spacing: .12em; }.orbit-readout>p:first-of-type { margin-top: 5rem; }
.orbit-readout h3 { max-width: 10ch; margin: .8rem 0 1.2rem; font-size: clamp(2rem,4vw,4rem); font-weight: 470; letter-spacing: -.055em; line-height: 1; }.orbit-readout h3+p { max-width: 25rem; color: var(--muted); line-height: 1.7; }.orbit-readout-hint { position: absolute; right: 0; bottom: 1.2rem; color: #727572; }
.connection-lab { min-height: 110svh; background: #070807; }.connection-surface { --connection-x: 17%; --connection-y: 50%; position: relative; min-height: min(72svh,48rem); overflow: hidden; border: 1px solid var(--line-soft); border-radius: 1.4rem; background: radial-gradient(circle at 17% 50%,rgba(80,201,133,.12),transparent 15rem),linear-gradient(rgba(232,228,223,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(232,228,223,.025) 1px,transparent 1px),#090b0a; background-size: auto,4rem 4rem,4rem 4rem,auto; cursor: none; touch-action: none; }
.connection-surface::before { position: absolute; top: 50%; left: 17%; width: 58%; height: 1px; background: linear-gradient(90deg,var(--green-line),transparent); content: ""; opacity: .25; }.connection-lines { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }.connection-line { stroke: var(--green); stroke-width: .32; stroke-dasharray: 1.2 1.4; vector-effect: non-scaling-stroke; }.connection-line.is-fixed { opacity: .72; animation: connection-draw 600ms ease both; }.connection-line.is-live { opacity: .5; }
.connection-origin,.connection-target { position: absolute; z-index: 4; display: grid; place-items: center; border-radius: 50%; cursor: none; }.connection-origin { top: 50%; left: 17%; width: clamp(5rem,10vw,8rem); aspect-ratio: 1; padding: 0; border: 1px solid var(--green-line); background: rgba(5,5,5,.92); transform: translate(-50%,-50%); box-shadow: 0 0 4rem rgba(80,201,133,.16); }.connection-origin>.connection-origin-core { width: 1.25rem; aspect-ratio: 1; border-radius: 50%; background: var(--green); box-shadow: 0 0 2rem rgba(80,201,133,.9); }.connection-surface.is-dragging .connection-origin>.connection-origin-core { animation: guide-pulse 800ms ease-in-out infinite; }
.connection-target { width: clamp(5.2rem,10vw,8.2rem); aspect-ratio: 1; padding: .7rem; border: 1px solid var(--line); background: rgba(15,17,16,.9); color: var(--muted); transform: translate(-50%,-50%); transition: border-color 220ms ease,background 220ms ease,color 220ms ease,transform 220ms ease; }.connection-target span { color: var(--green); font-family: "IBM Plex Mono",monospace; font-size: .58rem; }.connection-target strong { font-size: clamp(.72rem,1.2vw,.92rem); }.connection-target:hover,.connection-target:focus-visible,.connection-target.is-connected { border-color: var(--green); background: rgba(80,201,133,.1); color: var(--paper); transform: translate(-50%,-50%) scale(1.08); }.connection-target.is-connected::after { position: absolute; inset: -.45rem; border: 1px solid var(--green-line); border-radius: inherit; content: ""; animation: target-confirm 800ms ease both; }
.connection-cursor { position: absolute; z-index: 20; top: var(--connection-y); left: var(--connection-x); display: flex; align-items: center; gap: .55rem; pointer-events: none; opacity: 0; transform: translate(.8rem,.8rem); transition: opacity 100ms ease; }.connection-cursor::before { width: .8rem; height: .8rem; border: 1px solid var(--green); border-radius: 50% 50% 50% 0; background: rgba(80,201,133,.16); content: ""; transform: rotate(-45deg); }.connection-cursor span { padding: .35rem .5rem; border: 1px solid var(--line-soft); border-radius: 999px; background: rgba(5,5,5,.8); color: var(--paper); font-family: "IBM Plex Mono",monospace; font-size: .48rem; letter-spacing: .08em; }.connection-cursor.is-visible { opacity: 1; }
.connection-complete-message{position:absolute;z-index:7;top:50%;right:6%;display:grid;width:min(26rem,31vw);gap:.65rem;padding:1.4rem;border:1px solid var(--green-line);border-radius:1rem;background:rgba(7,11,9,.94);opacity:0;pointer-events:none;transform:translate(1.5rem,-50%);transition:opacity 450ms ease,transform 600ms cubic-bezier(.2,.8,.2,1);backdrop-filter:blur(.8rem)}
.connection-complete-message.is-visible{opacity:1;transform:translate(0,-50%)}
.connection-complete-message small{color:var(--green);font-family:"IBM Plex Mono",monospace;font-size:.58rem;letter-spacing:.13em}.connection-complete-message strong{max-width:15ch;font-size:clamp(1.3rem,2.3vw,2.3rem);font-weight:480;letter-spacing:-.045em;line-height:1}.connection-complete-message>span{color:var(--muted);font-size:.82rem;line-height:1.55}
.connection-status { position: absolute; right: 1.5rem; bottom: 1.25rem; margin: 0; color: var(--muted); font-family: "IBM Plex Mono",monospace; font-size: .58rem; letter-spacing: .08em; }.connection-surface.is-complete .connection-status { color: var(--green); }
.signal-story { position: relative; height: 430svh; border-top: 1px solid var(--line-soft); background: #050505; }.signal-story-sticky { position: sticky; top: 0; height: 100svh; overflow: hidden; }.story-header { position: absolute; z-index: 5; top: clamp(2rem,6vh,5rem); left: var(--page-gutter); display: grid; grid-template-columns: minmax(8rem,.3fr) minmax(18rem,.9fr) minmax(13rem,.42fr); align-items: end; gap: clamp(1.2rem,4vw,4rem); width: calc(100% - (var(--page-gutter) * 2)); }.story-header h2 { font-size: clamp(2.2rem,4.5vw,5.2rem); }
.story-pulse { position: absolute; z-index: 8; top: 47%; left: var(--page-gutter); display: grid; width: 3.2rem; aspect-ratio: 1; padding: 0; place-items: center; border: 0; border-radius: 50%; background: transparent; cursor: pointer; }.story-pulse-core { position: relative; z-index: 2; width: .75rem; aspect-ratio: 1; border-radius: 50%; background: var(--green); box-shadow: 0 0 1.8rem rgba(80,201,133,.9); animation: story-pulse 1.9s ease-in-out infinite; }.story-pulse-ring { position: absolute; inset: 0; border: 1px solid var(--green-line); border-radius: 50%; opacity: 0; }.story-pulse strong { position: absolute; left: calc(100% + .7rem); width: max-content; color: #747774; font-family: "IBM Plex Mono",monospace; font-size: .52rem; letter-spacing: .1em; transition: color 180ms ease; }
.story-pulse:hover strong,.story-pulse:focus-visible strong,.signal-story.is-awake .story-pulse strong { color: var(--green); }.story-pulse:hover .story-pulse-ring--one,.story-pulse:focus-visible .story-pulse-ring--one,.signal-story.is-awake .story-pulse-ring--one { animation: pulse-wave 2s ease-out infinite; }.story-pulse:hover .story-pulse-ring--two,.story-pulse:focus-visible .story-pulse-ring--two,.signal-story.is-awake .story-pulse-ring--two { animation: pulse-wave 2s 800ms ease-out infinite; }
.story-viewport { position: absolute; inset: 0; overflow: hidden; }.story-track { display: flex; align-items: center; width: 400vw; height: 100%; padding-top: 14rem; will-change: transform; transition: transform 80ms linear; }.story-panel { display: grid; flex: 0 0 88vw; grid-template-columns: auto minmax(0,1fr); align-items: end; gap: clamp(2rem,7vw,8rem); min-height: 48vh; margin-right: 12vw; padding: 3rem var(--page-gutter) 4rem clamp(10rem,16vw,18rem); border-top: 1px solid var(--line-soft); border-bottom: 1px solid var(--line-soft); opacity: .16; transform: translateX(4rem); transition: opacity 500ms ease,transform 650ms cubic-bezier(.2,.8,.2,1); }.story-panel.is-current { opacity: 1; transform: translateX(0); }.story-panel-number { color: var(--green); font-family: "IBM Plex Mono",monospace; font-size: clamp(4rem,12vw,12rem); font-weight: 300; letter-spacing: -.08em; line-height: .72; opacity: .36; }.story-panel>div { max-width: 58rem; }.story-panel p { margin: 0 0 1.2rem; color: var(--green); font-family: "IBM Plex Mono",monospace; font-size: .63rem; letter-spacing: .13em; }.story-panel h3 { max-width: 13ch; margin: 0 0 1.5rem; font-size: clamp(3rem,7vw,7.2rem); font-weight: 440; letter-spacing: -.07em; line-height: .92; }.story-panel>div>span { display: block; max-width: 42rem; color: var(--muted); font-size: clamp(1rem,1.8vw,1.3rem); line-height: 1.7; }.story-progress { position: absolute; z-index: 7; right: var(--page-gutter); bottom: 2.2rem; left: var(--page-gutter); height: 1px; background: var(--line); }.story-progress span { display: block; height: 100%; background: var(--green); box-shadow: 0 0 1rem rgba(80,201,133,.55); transition: width 80ms linear; }
@keyframes planet-orbit { to { transform: rotate(360deg); } }@keyframes planet-counter-orbit { to { transform: rotate(-360deg); } }@keyframes connection-draw { from { stroke-dashoffset: 22; opacity: 0; } to { stroke-dashoffset: 0; opacity: .72; } }@keyframes target-confirm { from { opacity: 1; transform: scale(.75); } to { opacity: 0; transform: scale(1.45); } }@keyframes story-pulse { 0%,100% { transform: scale(.72); opacity: .62; } 50% { transform: scale(1); opacity: 1; } }@keyframes pulse-wave { 0% { opacity: .75; transform: scale(.25); } 100% { opacity: 0; transform: scale(2.8); } }
@media(max-width:980px){.experience-heading,.story-header{grid-template-columns:1fr;align-items:start}.experience-heading h2,.experience-heading>span,.story-header h2,.story-header>span{max-width:46rem}.planetary-stage{grid-template-columns:1fr}.planetary-system{width:min(88vw,44rem)}.orbit-readout{min-height:19rem}.orbit-readout>p:first-of-type{margin-top:2.5rem}.story-header{top:2rem}.story-header>span{display:none}.story-track{padding-top:12rem}.story-panel{padding-left:clamp(7rem,13vw,10rem)}}
@media(max-width:640px){.ambient-glow{top:-5rem;right:0;width:100vw;height:100vw}.hero-title{font-size:clamp(3.1rem,16vw,4.65rem);line-height:.88}.interactive-journey::before{left:50%}.experience-section{padding-block:5rem}.experience-heading{margin-bottom:3rem}.experience-heading h2{font-size:clamp(2.5rem,13vw,4.2rem)}.planetary-stage{min-height:38rem}.planetary-system{width:94vw}.orbit-readout-hint{position:static;display:block;margin-top:2rem}.connection-surface{min-height:40rem}.connection-origin{top:18%;left:50%}.connection-surface::before{display:none}.connection-target{width:6rem}.connection-status{right:1rem;left:1rem;text-align:center}.story-header h2{font-size:2.5rem}.story-pulse{top:13rem;left:1.25rem;width:2.7rem}.story-panel{grid-template-columns:1fr;gap:1.4rem;min-height:55vh;padding:2.5rem 1.25rem 3.5rem}.story-panel-number{font-size:4.5rem}.story-panel h3{font-size:clamp(2.6rem,14vw,4.2rem)}}
@media(prefers-reduced-motion:reduce){.planet-orbit,.planet,.planetary-core span,.story-pulse-core,.story-pulse-ring{animation:none!important}.story-track{transition:none}}

/* Refined interaction model */
.hero-title{max-width:10ch;font-size:clamp(3.7rem,6.8vw,6.35rem)}
.interactive-journey::before{content:none}
.orbit-entry-thread{position:absolute;z-index:1;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.orbit-entry-thread path{fill:none;stroke:rgba(80,201,133,.4);stroke-dasharray:8 13;stroke-width:1.25;vector-effect:non-scaling-stroke}
.orbit-entry-thread circle{fill:var(--green);filter:drop-shadow(0 0 .7rem rgba(80,201,133,.9))}
.orbit-entry-thread .orbit-thread-terminal{fill:#050505;stroke:var(--green);stroke-width:1.5;vector-effect:non-scaling-stroke}
.experience-heading{position:relative;z-index:2}
.experience-heading h2,.story-header h2{font-size:clamp(2.6rem,5vw,5.3rem)}
.orbital-lab{min-height:104svh;overflow-x:clip}
.planetary-stage{position:relative;z-index:2;gap:clamp(2rem,6vw,6rem);min-height:40rem;overflow:visible}
.planetary-system{width:min(50vw,38rem);overflow:visible}
.planetary-system::before{inset:2%}
.planetary-system::after{inset:13%}
.planetary-axis{inset:24%}
.planetary-core{width:clamp(3rem,5vw,4.2rem)}
.planet-orbit--1{inset:2%;animation-duration:28s;animation-delay:-4s}
.planet-orbit--2{inset:13%;animation-duration:21s;animation-delay:-11s;animation-direction:reverse}
.planet-orbit--3{inset:24%;animation-duration:15s;animation-delay:-7s}
.planet{width:clamp(1.35rem,2.2vw,1.9rem)}
.planet-orbit--1 .planet{animation-duration:28s;animation-delay:-4s}
.planet-orbit--2 .planet{animation-duration:21s;animation-delay:-11s;animation-direction:reverse}
.planet-orbit--3 .planet{animation-duration:15s;animation-delay:-7s}
.planet[aria-pressed="true"]:not(:hover):not(:focus-visible){transform:none;box-shadow:0 0 0 .65rem rgba(80,201,133,.04),0 0 2rem rgba(80,201,133,.14)}
.planetary-system:has(.planet:hover) .planet-orbit:not(.is-paused),.planetary-system:has(.planet:focus-visible) .planet-orbit:not(.is-paused),.planetary-system:has(.planet:hover) .planet-orbit:not(.is-paused) .planet,.planetary-system:has(.planet:focus-visible) .planet-orbit:not(.is-paused) .planet{animation-play-state:running}
.planet-orbit.is-paused,.planet-orbit.is-paused .planet{animation-play-state:paused}
.planet-hover-card{--planet-card-enter:.35rem;--planet-card-connector:50%;position:fixed;z-index:1000;top:0;left:0;display:grid;width:clamp(10rem,14vw,13rem);max-width:calc(100vw - 1.5rem);max-height:calc(100dvh - 1.25rem);gap:.45rem;padding:.85rem .95rem;border:1px solid var(--green-line);border-radius:.95rem;background:linear-gradient(145deg,rgba(80,201,133,.08),transparent 52%),rgba(7,9,8,.97);box-shadow:0 1.25rem 3rem rgba(0,0,0,.28);opacity:0;text-align:left;visibility:hidden;pointer-events:none;transform:none;backdrop-filter:blur(.8rem)}
.planet-hover-card.is-positioned{visibility:visible;animation:planet-card-in 260ms cubic-bezier(.2,.8,.2,1) both}
.planet-hover-card::after{position:absolute;bottom:-.8rem;left:var(--planet-card-connector);width:1px;height:.8rem;background:var(--green-line);content:"";transform:translateX(-50%)}
.planet-hover-card--below{--planet-card-enter:-.35rem}
.planet-hover-card--below::after{top:-.8rem;bottom:auto}
.planet-hover-card small{color:var(--green);font-family:"IBM Plex Mono",monospace;font-size:.56rem;letter-spacing:.1em}
.planet-hover-card strong{font-size:.92rem}.planet-hover-card>span{color:var(--muted);font-size:.7rem;line-height:1.5}
.orbit-readout{min-height:20rem}.orbit-readout h3{font-size:clamp(1.8rem,3.2vw,3.25rem)}
.connection-surface{--connection-x:14%;--connection-y:50%;min-height:min(70svh,44rem);background:radial-gradient(circle at 14% 50%,rgba(232,228,223,.035),transparent 13rem),linear-gradient(rgba(232,228,223,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(232,228,223,.025) 1px,transparent 1px),#090b0a;background-size:auto,4rem 4rem,4rem 4rem,auto}
.connection-surface::before{content:none}
.connection-surface.has-connections{background:radial-gradient(circle at 14% 50%,rgba(80,201,133,.1),transparent 13rem),linear-gradient(rgba(232,228,223,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(232,228,223,.025) 1px,transparent 1px),#090b0a;background-size:auto,4rem 4rem,4rem 4rem,auto}
.connection-line{stroke:rgba(232,228,223,.18)}.connection-line.is-guide{opacity:.42}.connection-line.is-fixed{stroke:var(--green)}.connection-line.is-live{stroke:rgba(232,228,223,.68);opacity:.65}
.connection-origin,.connection-target,.connection-dock{position:absolute;z-index:4;display:grid;place-items:center;border-radius:50%;cursor:none}
.connection-origin{isolation:isolate;width:clamp(4.6rem,8vw,6.5rem);border-color:var(--line);box-shadow:0 0 3rem rgba(232,228,223,.04);transition:border-color 300ms ease,box-shadow 300ms ease}
.connection-origin-core{position:relative;z-index:3;width:.9rem;aspect-ratio:1;border-radius:50%;background:#8b8d8b;box-shadow:0 0 1.2rem rgba(232,228,223,.25)}
.connection-origin-ring{position:absolute;z-index:1;inset:-.35rem;border:1px solid var(--green-line);border-radius:50%;opacity:0;pointer-events:none}.connection-origin-ring--two{inset:-1rem}
.connection-origin-copy{position:absolute;top:calc(100% + .9rem);left:50%;display:grid;width:clamp(9.5rem,15vw,13rem);gap:.25rem;text-align:center;transform:translateX(-50%)}
.connection-origin-copy strong{color:#858885;font-family:"IBM Plex Mono",monospace;font-size:.56rem;letter-spacing:.11em}.connection-origin-copy small{color:#666966;font-size:.6rem;line-height:1.45}
.connection-origin-progress{position:absolute;z-index:4;bottom:.65rem;left:50%;display:flex;gap:.28rem;transform:translateX(-50%)}
.connection-origin-progress i{width:.28rem;aspect-ratio:1;border:1px solid #555855;border-radius:50%;background:#050505;transition:border-color 240ms ease,background 240ms ease,box-shadow 240ms ease}.connection-origin-progress i.is-active{border-color:var(--green);background:var(--green);box-shadow:0 0 .55rem rgba(80,201,133,.8)}
.connection-origin.has-connections{border-color:var(--green-line);box-shadow:0 0 3.2rem rgba(80,201,133,.14)}
.connection-origin.has-connections .connection-origin-core{background:var(--green);box-shadow:0 0 1.8rem rgba(80,201,133,.8)}.connection-origin.has-connections .connection-origin-copy strong{color:var(--green)}
.connection-origin--1 .connection-origin-core{animation:origin-lock 720ms ease both}.connection-origin--1 .connection-origin-ring--one{animation:origin-radar 1.25s ease-out both}
.connection-origin--2 .connection-origin-core{animation:origin-double-pulse 900ms ease both}.connection-origin--2 .connection-origin-ring--one{animation:origin-orbit-scan 1.4s ease-out both}.connection-origin--2 .connection-origin-ring--two{animation:origin-orbit-scan 1.4s 160ms ease-out both}
.connection-origin--3 .connection-origin-core{animation:origin-complete 1.2s ease both}.connection-origin--3 .connection-origin-ring--one{animation:origin-burst 1.7s ease-out both}.connection-origin--3 .connection-origin-ring--two{animation:origin-burst 1.7s 180ms ease-out both}
.connection-origin.is-complete{border-color:var(--green);box-shadow:0 0 0 .65rem rgba(80,201,133,.08),0 0 4.5rem rgba(80,201,133,.26)}
.connection-origin.is-complete .connection-origin-core{animation:story-pulse 1.4s ease-in-out infinite}.connection-origin.is-complete .connection-origin-ring--one{opacity:.3;transform:scale(1.15)}.connection-origin.is-complete .connection-origin-ring--two{opacity:.14;transform:scale(1.25)}
.connection-dock{z-index:3;width:clamp(2.6rem,4.8vw,3.8rem);aspect-ratio:1;border:1px dashed rgba(232,228,223,.28);color:#777a77;font-family:"IBM Plex Mono",monospace;font-size:.5rem;transform:translate(-50%,-50%);transition:border-color 250ms ease,color 250ms ease,box-shadow 250ms ease}
.connection-dock.is-connected{border-color:var(--green);color:var(--green);box-shadow:0 0 1.8rem rgba(80,201,133,.17)}
.connection-target{width:clamp(4.8rem,8.5vw,6.8rem);gap:.15rem;padding:.6rem;color:var(--muted)}
.connection-target span{color:#777a77}.connection-target strong{font-size:clamp(.68rem,1vw,.84rem)}.connection-target small{color:#777a77;font-family:"IBM Plex Mono",monospace;font-size:.42rem;letter-spacing:.09em}
.connection-target:hover,.connection-target:focus-visible{border-color:rgba(232,228,223,.66);background:rgba(232,228,223,.06);color:var(--paper);transform:translate(-50%,-50%) scale(1.06)}
.connection-target.is-dragging{z-index:9;border-color:rgba(232,228,223,.78);color:var(--paper);transform:translate(-50%,-50%) scale(1.08)}
.connection-target.is-connected{transform:translate(-50%,-50%) scale(.76);pointer-events:none}.connection-target.is-connected span{color:var(--green)}
.connection-cursor::before{border-color:rgba(232,228,223,.72);background:rgba(232,228,223,.1)}
.signal-story{height:460svh}.story-track{width:400vw;transition:transform 680ms cubic-bezier(.22,.75,.2,1)}
.story-panel{flex:0 0 100vw;margin-right:0;padding-left:clamp(9rem,14vw,15rem)}
.story-panel h3{font-size:clamp(2.7rem,5.5vw,5.8rem)}
.story-progress span{transition:width 620ms cubic-bezier(.22,.75,.2,1)}
.story-progress-stops{position:absolute;inset:50% 0 auto;display:flex;justify-content:space-between;transform:translateY(-50%)}
.story-progress-stops i{width:.42rem;aspect-ratio:1;border:1px solid #505350;border-radius:50%;background:#050505;transition:border-color 300ms ease,background 300ms ease,box-shadow 300ms ease}
.story-progress-stops i.is-active{border-color:var(--green);background:var(--green);box-shadow:0 0 .8rem rgba(80,201,133,.6)}
@keyframes planet-card-in{from{opacity:0;transform:translateY(var(--planet-card-enter)) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes origin-lock{0%{transform:scale(.65);opacity:.3}45%{transform:scale(1.45);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes origin-radar{0%{opacity:.9;transform:scale(.35)}100%{opacity:0;transform:scale(1.55)}}
@keyframes origin-double-pulse{0%,100%{transform:scale(1)}28%{transform:scale(1.55)}52%{transform:scale(.78)}78%{transform:scale(1.3)}}
@keyframes origin-orbit-scan{0%{opacity:.8;transform:scale(.45) rotate(0deg)}60%{opacity:.45}100%{opacity:0;transform:scale(1.7) rotate(135deg)}}
@keyframes origin-complete{0%{transform:scale(.75)}35%{transform:scale(1.8)}55%{transform:scale(1)}76%{transform:scale(1.4)}100%{transform:scale(1)}}
@keyframes origin-burst{0%{opacity:.9;transform:scale(.25)}45%{opacity:.6}100%{opacity:0;transform:scale(2.25)}}
@media(max-width:980px){.planetary-system{width:min(72vw,34rem)}}
@media(max-width:640px){.hero-title{max-width:9ch;font-size:clamp(2.85rem,14vw,4.15rem)}.orbit-entry-thread{inset:0;width:100%;height:100%}.experience-heading h2{font-size:clamp(2.25rem,11vw,3.65rem)}.planetary-stage{gap:3rem;min-height:36rem}.planetary-system{width:min(82vw,25rem)}.planet-hover-card{width:min(12rem,62vw);padding:.76rem .82rem}.connection-surface{min-height:35rem}.connection-origin{width:4.6rem}.connection-origin-copy{width:9rem}.connection-origin-copy small{display:none}.connection-dock{width:2.5rem}.connection-target{width:4.6rem;padding:.4rem}.connection-target strong{font-size:.64rem}.connection-cursor span{display:none}.connection-complete-message{top:auto;right:1rem;bottom:3.7rem;left:1rem;width:auto;transform:translateY(1rem)}.connection-complete-message.is-visible{transform:translateY(0)}.story-header h2{font-size:2.2rem}.story-panel{padding:2.5rem 1.25rem 3.5rem}.story-panel h3{font-size:clamp(2.25rem,12vw,3.65rem)}}
@media(prefers-reduced-motion:reduce){.orbit-entry-thread circle,.connection-origin-core,.connection-origin-ring{animation:none!important}}
`,
          },
        ],
      },
      {
        id: 'experience',
        title: copy.experienceTitle,
        label: copy.experienceTitle,
        commitMessage: copy.experienceCommit,
        intro: copy.experienceIntro,
        progress: copy.experienceProgress,
        complete: copy.experienceComplete,
        files: [
          {
            path: 'components/WelcomeExperience.js',
            content: `"use client";

import { useEffect, useRef, useState } from "react";
import { BuildBlueprint } from "@/components/BuildBlueprint";
import { BuildPath } from "@/components/BuildPath";
import { WelcomeHero } from "@/components/WelcomeHero";

function updatePointerGlow(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - bounds.left) / bounds.width) * 100;
  const y = ((event.clientY - bounds.top) / bounds.height) * 100;
  event.currentTarget.style.setProperty("--pointer-x", x + "%");
  event.currentTarget.style.setProperty("--pointer-y", y + "%");
}

export function WelcomeExperience({ name }) {
  const rootRef = useRef(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const elements = root?.querySelectorAll("[data-enter]") || [];

    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.setAttribute("data-enter-visible", "true"));
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.setAttribute("data-enter-visible", "true");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8%" });

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  function startJourney() {
    setStarted(true);
    window.requestAnimationFrame(() => {
      document.getElementById("orbital-lab")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div ref={rootRef} className={"welcome-experience" + (started ? " is-started" : "")}>
      <section id="inicio" className="hero-layout" aria-labelledby="welcome-title">
        <WelcomeHero name={name} onStart={startJourney} />
        <BuildBlueprint name={name} started={started} onActivate={startJourney} onPointerMove={updatePointerGlow} />
      </section>
      <BuildPath started={started} onStart={startJourney} />
    </div>
  );
}
`,
          },
          {
            path: 'components/BrandHeader.js',
            content: `import Image from "next/image";
import { siteCopy } from "@/lib/site-content";

export function BrandHeader() {
  return (
    <header className="brand-header">
      <a className="brand-link" href="#inicio" aria-label={siteCopy.brandHomeLabel}>
        <Image
          className="brand-logo"
          src="/faber-code-logo.png"
          alt="Faber Code"
          width={4500}
          height={1093}
          priority
        />
      </a>
      <div className="session-status" aria-label={siteCopy.environmentReady}>
        <span className="status-dot" aria-hidden="true" />
        <span>{siteCopy.environmentReady}</span>
        <span className="status-code">01</span>
      </div>
    </header>
  );
}
`,
          },
          {
            path: 'components/WelcomeHero.js',
            content: `import { siteCopy } from "@/lib/site-content";

function ArrowIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M5 12h13M13 6l6 6-6 6" /></svg>;
}

export function WelcomeHero({ name, onStart }) {
  const firstName = String(name || "").replace(/\\s+/g, " ").trim().split(" ")[0].slice(0, 24);
  return (
    <div className="hero-copy">
      <p className="eyebrow reveal reveal-1"><span>{siteCopy.welcome}</span><span className="eyebrow-line" aria-hidden="true" /><span>{siteCopy.session}</span></p>
      <h1 id="welcome-title" className="hero-title reveal reveal-2">{siteCopy.greeting}<span>{firstName}.</span></h1>
      <p className="hero-lead reveal reveal-3">
        {siteCopy.heroLead}
        <strong>{siteCopy.heroStrong}</strong>
      </p>
      <div className="hero-actions reveal reveal-4">
        <button className="primary-action" type="button" onClick={onStart}><span>{siteCopy.startNow}</span><span className="action-icon"><ArrowIcon /></span></button>
        <button className="secondary-action" type="button" onClick={onStart}>{siteCopy.knowFlow} <span aria-hidden="true">↘</span></button>
      </div>
      <dl className="hero-metrics reveal reveal-5" aria-label={siteCopy.principlesLabel}>
        <div><dt>01</dt><dd>{siteCopy.clearDirection}</dd></div>
        <div><dt>∞</dt><dd>{siteCopy.roomToEvolve}</dd></div>
      </dl>
    </div>
  );
}
`,
          },
          {
            path: 'components/BuildBlueprint.js',
            content: `import { siteCopy } from "@/lib/site-content";

const previewPlanets = [
  { key: "clarity", className: "hero-planet--clarity" },
  { key: "structure", className: "hero-planet--structure" },
  { key: "evolution", className: "hero-planet--evolution" },
];

export function BuildBlueprint({ name, started, onActivate, onPointerMove }) {
  return (
    <div className={"blueprint-wrap reveal reveal-3" + (started ? " is-awake" : "")}>
      <aside className="blueprint" aria-label={siteCopy.blueprintLabel}>
        <div className="blueprint-topline"><span>WELCOME_PROTOCOL</span><span>FABER / 01</span></div>
        <div className="signal-field" onPointerMove={onPointerMove}>
          <span className="signal-orbit signal-orbit-outer" aria-hidden="true" /><span className="signal-orbit signal-orbit-inner" aria-hidden="true" />
          <button className="signal-core signal-core-button" type="button" onClick={onActivate} aria-label={siteCopy.signalFollow} aria-pressed={started}><span /></button>
          {previewPlanets.map((planet) => <button key={planet.key} className={"hero-planet " + planet.className} type="button" onClick={onActivate} onPointerEnter={onActivate} aria-label={siteCopy[planet.key] + ": " + siteCopy.orbitExplore}><span>{siteCopy[planet.key]}</span></button>)}
          <span className="signal-coordinate coordinate-a" aria-hidden="true">{siteCopy.clarity}</span>
          <span className="signal-coordinate coordinate-b" aria-hidden="true">{siteCopy.structure}</span>
          <span className="signal-coordinate coordinate-c" aria-hidden="true">{siteCopy.evolution}</span>
          <span className="signal-callout"><span className="signal-callout-dot" aria-hidden="true" />{started ? siteCopy.signalConnectedFollow : siteCopy.signalPrompt}</span>
          <svg className="signal-thread" viewBox="0 0 420 320" preserveAspectRatio="none" aria-hidden="true"><path className="signal-thread-shadow" d="M210 156 C278 164 254 236 406 274" /><path className="signal-thread-line" d="M210 156 C278 164 254 236 406 274" /><circle className="signal-thread-dot" r="5"><animateMotion dur="4.8s" repeatCount="indefinite" path="M210 156 C278 164 254 236 406 274" /></circle></svg>
        </div>
        <div className="blueprint-code" aria-label={siteCopy.personalizedSession + ' ' + name}>
          <div className="code-toolbar"><span className="code-light" aria-hidden="true" /><span>session/welcome.js</span></div>
          <pre><code><span className="code-muted">{siteCopy.codeConst}</span> {siteCopy.codeObject} = {"{"}\n  {siteCopy.codePerson}: <span className="code-value">&quot;{name}&quot;</span>,\n  {siteCopy.codeIdea}: <span className="code-value">&quot;{siteCopy.codeIdeaValue}&quot;</span>,\n  {siteCopy.codeNextStep}: <span className="code-accent">true</span>\n{"}"};</code></pre>
        </div>
      </aside>
    </div>
  );
}
`,
          },
          {
            path: 'components/BuildPath.js',
            content: `"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { siteCopy } from "@/lib/site-content";

const planetIds = ["clarity", "structure", "evolution"];
const planets = siteCopy.steps.map((step, index) => ({ ...step, id: planetIds[index] }));
const connectionOrigin = { x: 14, y: 50 };
const connectionStartPoints = {
  clarity: { x: 84, y: 20 },
  structure: { x: 88, y: 50 },
  evolution: { x: 84, y: 80 },
};
const connectionDockPoints = {
  clarity: { x: 43, y: 24 },
  structure: { x: 50, y: 50 },
  evolution: { x: 43, y: 76 },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function initialTargetPositions() {
  return Object.fromEntries(
    Object.entries(connectionStartPoints).map(([id, point]) => [id, { ...point }]),
  );
}

function ConnectionLab() {
  const surfaceRef = useRef(null);
  const dragStateRef = useRef(null);
  const [targetPositions, setTargetPositions] = useState(initialTargetPositions);
  const [draggingId, setDraggingId] = useState(null);
  const [pointerVisible, setPointerVisible] = useState(false);
  const [connected, setConnected] = useState([]);
  const isComplete = connected.length === planets.length;
  const originStep = siteCopy.connectionProgress[connected.length] || siteCopy.connectionProgress[0];

  useEffect(() => {
    if (!isComplete) return undefined;
    const transition = window.setTimeout(() => {
      document.getElementById("signal-story")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 3200);
    return () => window.clearTimeout(transition);
  }, [isComplete]);

  function readPoint(event) {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds) return connectionOrigin;
    return {
      x: clamp(((event.clientX - bounds.left) / bounds.width) * 100, 3, 97),
      y: clamp(((event.clientY - bounds.top) / bounds.height) * 100, 5, 95),
    };
  }

  function setCursorPosition(point) {
    surfaceRef.current?.style.setProperty("--connection-x", point.x + "%");
    surfaceRef.current?.style.setProperty("--connection-y", point.y + "%");
  }

  function connect(id) {
    setConnected((current) => (current.includes(id) ? current : [...current, id]));
    setTargetPositions((current) => ({
      ...current,
      [id]: { ...connectionDockPoints[id] },
    }));
    dragStateRef.current = null;
    setDraggingId(null);
  }

  function beginTargetDrag(event, id) {
    if (connected.includes(id)) return;
    event.preventDefault();
    const pointer = readPoint(event);
    const current = targetPositions[id];
    dragStateRef.current = {
      id,
      offsetX: current.x - pointer.x,
      offsetY: current.y - pointer.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setCursorPosition(pointer);
    setPointerVisible(true);
    setDraggingId(id);
  }

  function movePointer(event) {
    const pointer = readPoint(event);
    setCursorPosition(pointer);
    setPointerVisible(true);

    const dragState = dragStateRef.current;
    if (!dragState) return;
    const next = {
      x: clamp(pointer.x + dragState.offsetX, 5, 95),
      y: clamp(pointer.y + dragState.offsetY, 7, 93),
    };
    setTargetPositions((current) => ({ ...current, [dragState.id]: next }));
  }

  function finishDrag(event) {
    const dragState = dragStateRef.current;
    if (!dragState) return;

    const pointer = readPoint(event);
    const dropped = {
      x: clamp(pointer.x + dragState.offsetX, 5, 95),
      y: clamp(pointer.y + dragState.offsetY, 7, 93),
    };
    const dock = connectionDockPoints[dragState.id];
    const distance = Math.hypot(dropped.x - dock.x, dropped.y - dock.y);

    if (distance <= 12) connect(dragState.id);
    else {
      setTargetPositions((current) => ({
        ...current,
        [dragState.id]: { ...connectionStartPoints[dragState.id] },
      }));
      dragStateRef.current = null;
      setDraggingId(null);
    }
  }

  return (
    <section className="experience-section connection-lab" aria-labelledby="connection-title">
      <div className="experience-heading" data-enter>
        <p>{siteCopy.connectGesture}</p>
        <h2 id="connection-title">{siteCopy.connectTitle}</h2>
        <span>{siteCopy.connectInstruction}</span>
      </div>
      <div
        ref={surfaceRef}
        className={"connection-surface" + (draggingId ? " is-dragging" : "") + (connected.length ? " has-connections" : "") + (isComplete ? " is-complete" : "")}
        onPointerMove={movePointer}
        onPointerLeave={() => !dragStateRef.current && setPointerVisible(false)}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        data-enter
      >
        <svg className="connection-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {planets.map((planet) => {
            const dock = connectionDockPoints[planet.id];
            return <line key={"guide-" + planet.id} className="connection-line is-guide" x1={connectionOrigin.x} y1={connectionOrigin.y} x2={dock.x} y2={dock.y} />;
          })}
          {connected.map((id) => <line key={id} className="connection-line is-fixed" x1={connectionOrigin.x} y1={connectionOrigin.y} x2={connectionDockPoints[id].x} y2={connectionDockPoints[id].y} />)}
          {draggingId && <line className="connection-line is-live" x1={connectionOrigin.x} y1={connectionOrigin.y} x2={targetPositions[draggingId].x} y2={targetPositions[draggingId].y} />}
        </svg>

        <div
          key={"origin-" + connected.length}
          className={"connection-origin connection-origin--" + connected.length + (connected.length ? " has-connections" : "") + (isComplete ? " is-complete" : "")}
          style={{ left: connectionOrigin.x + "%", top: connectionOrigin.y + "%" }}
          aria-label={siteCopy.mapSource}
        >
          <span className="connection-origin-core" />
          <span className="connection-origin-ring connection-origin-ring--one" />
          <span className="connection-origin-ring connection-origin-ring--two" />
          <span className="connection-origin-copy">
            <strong>{originStep.label}</strong>
            <small>{originStep.text}</small>
          </span>
          <span className="connection-origin-progress" aria-hidden="true">
            {planets.map((planet, index) => <i key={planet.id} className={index < connected.length ? "is-active" : ""} />)}
          </span>
        </div>

        {planets.map((planet) => {
          const dock = connectionDockPoints[planet.id];
          const isConnected = connected.includes(planet.id);
          return <span key={"dock-" + planet.id} className={"connection-dock" + (isConnected ? " is-connected" : "")} style={{ left: dock.x + "%", top: dock.y + "%" }} aria-hidden="true">{planet.number}</span>;
        })}

        {planets.map((planet) => {
          const point = targetPositions[planet.id];
          const isConnected = connected.includes(planet.id);
          const isDragging = draggingId === planet.id;
          return (
            <button
              key={planet.id}
              className={"connection-target" + (isConnected ? " is-connected" : "") + (isDragging ? " is-dragging" : "")}
              type="button"
              style={{ left: point.x + "%", top: point.y + "%" }}
              onPointerDown={(event) => beginTargetDrag(event, planet.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  connect(planet.id);
                }
              }}
              aria-label={siteCopy.dragDecision + " " + planet.label + ": " + siteCopy.releaseTarget + " " + planet.number}
              aria-pressed={isConnected}
            >
              <span>{planet.number}</span>
              <strong>{planet.label}</strong>
              {!isConnected && <small>{siteCopy.dragDecision}</small>}
            </button>
          );
        })}

        <div className={"connection-cursor" + (pointerVisible ? " is-visible" : "")} aria-hidden="true">
          <span>{draggingId ? siteCopy.releaseTarget : siteCopy.holdAndDrag}</span>
        </div>

        <p className="connection-status" aria-live="polite">
          {isComplete ? siteCopy.connectionPreparing : connected.length + " / " + planets.length + " " + siteCopy.connectedDecisions}
        </p>
        <div className={"connection-complete-message" + (isComplete ? " is-visible" : "")} aria-live="polite">
          <small>{siteCopy.connectionCompleteEyebrow}</small>
          <strong>{siteCopy.connectionCompleteTitle}</strong>
          <span>{siteCopy.connectionCompleteText}</span>
        </div>
      </div>
    </section>
  );
}

function SignalStory() {
  const sectionRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [awake, setAwake] = useState(false);

  useEffect(() => {
    let frame = 0;
    function updateProgress() {
      frame = 0;
      const section = sectionRef.current;
      if (!section) return;
      const bounds = section.getBoundingClientRect();
      const travel = Math.max(section.offsetHeight - window.innerHeight, 1);
      const progress = clamp(-bounds.top / travel, 0, 1);
      const nextIndex = Math.min(
        siteCopy.storyPanels.length - 1,
        Math.round(progress * (siteCopy.storyPanels.length - 1)),
      );
      setActiveIndex(nextIndex);
      if (progress > 0.025) setAwake(true);
    }
    function onScroll() {
      if (frame) return;
      frame = window.requestAnimationFrame(updateProgress);
    }
    updateProgress();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  function awakenStory() {
    setAwake(true);
    const section = sectionRef.current;
    if (!section) return;
    window.scrollTo({ top: section.offsetTop + window.innerHeight * 0.7, behavior: "smooth" });
  }

  const settledProgress = activeIndex / (siteCopy.storyPanels.length - 1);

  return (
    <section ref={sectionRef} id="signal-story" className={"signal-story" + (awake ? " is-awake" : "")} aria-labelledby="story-title">
      <div className="signal-story-sticky">
        <header className="story-header">
          <p>{siteCopy.storyGesture}</p>
          <h2 id="story-title">{siteCopy.storyTitle}</h2>
          <span>{siteCopy.storyInstruction}</span>
        </header>
        <button className="story-pulse" type="button" onClick={awakenStory} aria-label={siteCopy.storyActivateLabel} aria-pressed={awake}>
          <span className="story-pulse-core" />
          <span className="story-pulse-ring story-pulse-ring--one" />
          <span className="story-pulse-ring story-pulse-ring--two" />
          <strong>{awake ? siteCopy.storyMoving : siteCopy.activateStory}</strong>
        </button>
        <div className="story-viewport">
          <div className="story-track" style={{ transform: "translate3d(-" + activeIndex * 25 + "%, 0, 0)" }}>
            {siteCopy.storyPanels.map((panel, index) => (
              <article key={panel.number} className={"story-panel" + (index === activeIndex ? " is-current" : "")} aria-hidden={index !== activeIndex}>
                <span className="story-panel-number">{panel.number}</span>
                <div><p>{panel.eyebrow}</p><h3>{panel.title}</h3><span>{panel.text}</span></div>
              </article>
            ))}
          </div>
        </div>
        <div className="story-progress" aria-hidden="true">
          <span style={{ width: Math.max(settledProgress * 100, awake ? 4 : 0) + "%" }} />
          <div className="story-progress-stops">
            {siteCopy.storyPanels.map((panel, index) => <i key={panel.number} className={index <= activeIndex ? "is-active" : ""} />)}
          </div>
        </div>
      </div>
    </section>
  );
}

export function BuildPath({ started, onStart }) {
  const orbitalSectionRef = useRef(null);
  const coreRef = useRef(null);
  const hoveredTargetRef = useRef(null);
  const hoverCardRef = useRef(null);
  const [focusedPlanet, setFocusedPlanet] = useState("clarity");
  const [hoveredPlanet, setHoveredPlanet] = useState(null);
  const [hoverCard, setHoverCard] = useState(null);
  const [orbitThread, setOrbitThread] = useState(null);
  const currentPlanet = planets.find((planet) => planet.id === focusedPlanet) || planets[0];
  const hoverPlanetId = hoverCard?.planet.id;

  useEffect(() => {
    let frame = 0;

    function updateOrbitThread() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const section = orbitalSectionRef.current;
        const core = coreRef.current;
        if (!section || !core) return;

        const sectionBounds = section.getBoundingClientRect();
        const coreBounds = core.getBoundingClientRect();
        const width = Math.max(sectionBounds.width, 1);
        const height = Math.max(sectionBounds.height, 1);
        const endX = coreBounds.left + coreBounds.width / 2 - sectionBounds.left;
        const endY = coreBounds.top + coreBounds.height / 2 - sectionBounds.top;
        const startX = width + clamp(width * 0.025, 24, 42);
        const startY = clamp(endY * 0.16, 72, 156);
        const verticalDistance = Math.max(endY - startY, 1);
        const firstControlX = width - clamp(width * 0.055, 48, 88);
        const firstControlY = startY + clamp(verticalDistance * 0.035, 16, 38);
        const secondControlX = endX + Math.max((width - endX) * 0.34, 96);
        const secondControlY = endY - Math.max(verticalDistance * 0.46, 88);
        const path = [
          "M " + startX.toFixed(1) + " " + startY.toFixed(1),
          "C " + firstControlX.toFixed(1) + " " + firstControlY.toFixed(1),
          secondControlX.toFixed(1) + " " + secondControlY.toFixed(1),
          endX.toFixed(1) + " " + endY.toFixed(1),
        ].join(" ");

        const nextThread = {
          width: Number(width.toFixed(1)),
          height: Number(height.toFixed(1)),
          endX: Number(endX.toFixed(1)),
          endY: Number(endY.toFixed(1)),
          path,
        };
        setOrbitThread((current) => (current?.path === path ? current : nextThread));
      });
    }

    updateOrbitThread();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateOrbitThread);
    if (orbitalSectionRef.current) resizeObserver?.observe(orbitalSectionRef.current);
    if (coreRef.current) resizeObserver?.observe(coreRef.current);
    window.addEventListener("resize", updateOrbitThread);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateOrbitThread);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const target = hoveredTargetRef.current;
    const card = hoverCardRef.current;
    if (!hoverPlanetId || !target || !card) return undefined;

    function updateHoverCard() {
      frame = 0;
      const targetBounds = target.getBoundingClientRect();
      const cardBounds = card.getBoundingClientRect();
      if (!cardBounds.width || !cardBounds.height) {
        frame = window.requestAnimationFrame(updateHoverCard);
        return;
      }

      const inlineMargin = window.innerWidth <= 640 ? 12 : 18;
      const blockMargin = window.innerWidth <= 640 ? 10 : 16;
      const gap = window.innerWidth <= 640 ? 10 : 14;
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportRight = viewportLeft + (viewport?.width || window.innerWidth);
      const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
      const visibleLeft = viewportLeft + inlineMargin;
      const visibleRight = viewportRight - inlineMargin;
      const visibleTop = viewportTop + blockMargin;
      const visibleBottom = viewportBottom - blockMargin;
      const anchorX = targetBounds.left + targetBounds.width / 2;
      const maxLeft = Math.max(visibleLeft, visibleRight - cardBounds.width);
      const left = clamp(anchorX - cardBounds.width / 2, visibleLeft, maxLeft);
      const spaceAbove = targetBounds.top - gap - visibleTop;
      const spaceBelow = visibleBottom - targetBounds.bottom - gap;
      const placement = spaceBelow >= cardBounds.height || spaceBelow > spaceAbove
        ? "below"
        : "above";
      const proposedTop = placement === "above"
        ? targetBounds.top - cardBounds.height - gap
        : targetBounds.bottom + gap;
      const maxTop = Math.max(visibleTop, visibleBottom - cardBounds.height);
      const top = clamp(proposedTop, visibleTop, maxTop);
      const connectorX = clamp(anchorX - left, 12, cardBounds.width - 12);
      const nextPosition = {
        left: Number(left.toFixed(1)),
        top: Number(top.toFixed(1)),
        connectorX: Number(connectorX.toFixed(1)),
        placement,
        positioned: true,
      };

      setHoverCard((current) => {
        if (!current || current.planet.id !== hoverPlanetId) return current;
        if (
          current.left === nextPosition.left
          && current.top === nextPosition.top
          && current.connectorX === nextPosition.connectorX
          && current.placement === nextPosition.placement
          && current.positioned
        ) return current;
        return { ...current, ...nextPosition };
      });

      frame = window.requestAnimationFrame(updateHoverCard);
    }

    frame = window.requestAnimationFrame(updateHoverCard);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [hoverPlanetId]);

  function revealPlanet(event, planet) {
    hoveredTargetRef.current = event.currentTarget;
    setFocusedPlanet(planet.id);
    setHoveredPlanet(planet.id);
    setHoverCard({ planet, positioned: false });
  }

  function hidePlanet() {
    hoveredTargetRef.current = null;
    setHoveredPlanet(null);
    setHoverCard(null);
  }

  return (
    <div className={"interactive-journey" + (started ? " is-active" : "")}>
      <section ref={orbitalSectionRef} id="orbital-lab" className="experience-section orbital-lab" aria-labelledby="orbit-title">
        {orbitThread && (
          <svg className="orbit-entry-thread" viewBox={"0 0 " + orbitThread.width + " " + orbitThread.height} preserveAspectRatio="none" aria-hidden="true">
            <path d={orbitThread.path} />
            <circle key={orbitThread.path} className="orbit-thread-signal" r="5">
              <animateMotion dur="6.4s" repeatCount="indefinite" path={orbitThread.path} />
            </circle>
            <circle className="orbit-thread-terminal" cx={orbitThread.endX} cy={orbitThread.endY} r="7" />
          </svg>
        )}
        <div className="experience-heading" data-enter>
          <p>{siteCopy.orbitGesture}</p>
          <h2 id="orbit-title">{siteCopy.orbitTitle}</h2>
          <span>{siteCopy.orbitInstruction}</span>
        </div>
        <div className="planetary-stage" data-enter>
          <div className="planetary-system" aria-label={siteCopy.orbitLabel}>
            <span className="planetary-axis" aria-hidden="true" />
            <button ref={coreRef} className="planetary-core" type="button" onClick={onStart} aria-label={siteCopy.orbitActivate}><span /></button>
            {planets.map((planet, index) => (
              <div key={planet.id} className={"planet-orbit planet-orbit--" + (index + 1) + (hoveredPlanet === planet.id ? " is-paused" : "")}>
                <button
                  className={"planet planet--" + planet.id}
                  type="button"
                  onPointerEnter={(event) => revealPlanet(event, planet)}
                  onPointerLeave={hidePlanet}
                  onFocus={(event) => revealPlanet(event, planet)}
                  onBlur={hidePlanet}
                  onClick={() => setFocusedPlanet(planet.id)}
                  aria-pressed={focusedPlanet === planet.id}
                  aria-label={planet.number + ", " + planet.label + ": " + planet.title}
                >
                  <span className="planet-surface" />
                </button>
              </div>
            ))}
          </div>
          {hoverCard && typeof document !== "undefined" && createPortal(
            <div
              ref={hoverCardRef}
              className={"planet-hover-card planet-hover-card--" + (hoverCard.placement || "above") + (hoverCard.positioned ? " is-positioned" : "")}
              style={{
                left: (hoverCard.left || 0) + "px",
                top: (hoverCard.top || 0) + "px",
                "--planet-card-connector": (hoverCard.connectorX || 24) + "px",
              }}
              role="status"
            >
              <small>{hoverCard.planet.number} · {hoverCard.planet.label}</small>
              <strong>{hoverCard.planet.title}</strong>
              <span>{hoverCard.planet.text}</span>
            </div>,
            document.body,
          )}
          <aside className="orbit-readout" aria-live="polite">
            <span>{currentPlanet.number} / 03</span>
            <p>{currentPlanet.label.toUpperCase()}</p>
            <h3>{currentPlanet.title}</h3>
            <p>{currentPlanet.text}</p>
            <span className="orbit-readout-hint">{siteCopy.orbitHint}</span>
          </aside>
        </div>
      </section>
      <ConnectionLab />
      <SignalStory />
    </div>
  );
}
`,
          },
          {
            path: 'components/SocialLinks.js',
            content: `import { siteCopy } from "@/lib/site-content";

function SocialIcon({ kind }) {
  if (kind === "github") return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M15 22v-4.2c.1-1-.4-1.8-.9-2.3 3 0 6.1-1.5 6.1-6.5 0-1.5-.5-2.7-1.4-3.7.1-.4.6-1.8-.2-3.7 0 0-1.1-.4-3.8 1.4a13 13 0 0 0-6.8 0C5.4 1.2 4.2 1.6 4.2 1.6c-.7 1.9-.3 3.3-.1 3.7A5.3 5.3 0 0 0 2.7 9c0 5 3 6.5 6 6.5-.4.4-.8 1.1-.8 2.1V22" /><path d="M7.9 19c-3 .9-3-1.5-4.2-2" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4V8h4v2a5 5 0 0 1 2-2Z" /><path d="M2 9h4v12H2z" /><path d="M4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></svg>;
}

export function SocialLinks({ links }) {
  return <nav className="social-links" aria-label={siteCopy.socialLabel}>{links.map((link) => <a key={link.label} href={link.href} target="_blank" rel="noreferrer noopener" aria-label={link.label + ', ' + siteCopy.openNewTab}><span className="social-icon"><SocialIcon kind={link.kind} /></span><span><strong>{link.label}</strong><small>{link.detail}</small></span><span className="social-arrow" aria-hidden="true">↗</span></a>)}</nav>;
}
`,
          },
          {
            path: 'app/globals.css',
            content: `@import "tailwindcss";

@theme inline {
  --color-faber-green: #50c985;
  --color-faber-ink: #050505;
  --color-faber-paper: #e8e4df;
  --font-sans: "Manrope Variable", sans-serif;
  --font-mono: "IBM Plex Mono", monospace;
}

:root {
  --ink: #050505;
  --surface: #121212;
  --paper: #e8e4df;
  --muted: #a8aaa8;
  --line: #2b2b2b;
  --line-soft: rgba(232, 228, 223, 0.12);
  --green: #50c985;
  --green-dim: rgba(80, 201, 133, 0.12);
  --green-line: rgba(80, 201, 133, 0.34);
  --page-gutter: clamp(1.25rem, 4vw, 4.5rem);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; overflow-x: clip; background: var(--ink); }
body {
  min-width: 320px;
  margin: 0;
  background: radial-gradient(circle at 76% 19%, rgba(80, 201, 133, 0.11), transparent 28rem), linear-gradient(145deg, #050505, #080a09 58%, #050505);
  color: var(--paper);
  font-family: "Manrope Variable", sans-serif;
  text-rendering: optimizeLegibility;
}
a { color: inherit; text-decoration: none; }
button { color: inherit; font: inherit; }
:focus-visible { outline: 2px solid var(--green); outline-offset: 4px; }
::selection { background: var(--green); color: var(--ink); }
.site-shell { position: relative; isolation: isolate; min-height: 100svh; overflow-x: clip; }
.ambient-grid { position: absolute; z-index: -2; inset: 0; opacity: .36; background-image: linear-gradient(rgba(232,228,223,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(232,228,223,.035) 1px,transparent 1px); background-size: 4.5rem 4.5rem; mask-image: linear-gradient(to bottom,black,transparent 72%); }
.ambient-glow { position: absolute; z-index: -1; top: -13rem; right: 0; width: 42rem; height: 42rem; border: 1px solid rgba(80,201,133,.08); border-radius: 50%; box-shadow: 0 0 0 6rem rgba(80,201,133,.018),0 0 0 12rem rgba(80,201,133,.012); }
.skip-link { position: fixed; z-index: 100; top: .75rem; left: .75rem; padding: .75rem 1rem; border-radius: .35rem; background: var(--green); color: var(--ink); font-weight: 800; transform: translateY(-160%); transition: transform 160ms ease; }
.skip-link:focus { transform: translateY(0); }
.brand-header { display: flex; align-items: center; justify-content: space-between; width: min(100%,1600px); min-height: 6.5rem; margin-inline: auto; padding: 1.5rem var(--page-gutter); border-bottom: 1px solid var(--line-soft); }
.brand-link { display: inline-flex; align-items: center; width: clamp(10rem, 15vw, 13.5rem); }
.brand-logo { display: block; width: 100%; height: auto; }
.session-status { display: flex; align-items: center; gap: .65rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; font-size: .68rem; letter-spacing: .07em; text-transform: uppercase; }
.status-dot { width: .5rem; height: .5rem; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 .28rem var(--green-dim); animation: status-pulse 2.6s ease-in-out infinite; }
.status-code { display: grid; width: 1.7rem; height: 1.7rem; margin-left: .25rem; place-items: center; border: 1px solid var(--line); border-radius: 50%; color: var(--paper); }
.hero-layout { display: grid; grid-template-columns: minmax(0,1.08fr) minmax(23rem,.72fr); align-items: center; gap: clamp(3rem,7vw,8rem); width: min(100%,1600px); min-height: calc(100svh - 6.5rem); margin-inline: auto; padding: clamp(4rem,8vh,7.5rem) var(--page-gutter) clamp(5rem,10vh,8rem); }
.hero-copy { min-width: 0; max-width: 54rem; }
.eyebrow { display: flex; align-items: center; gap: .9rem; width: min(100%,32rem); margin: 0 0 2.2rem; color: var(--green); font-family: "IBM Plex Mono", monospace; font-size: .7rem; font-weight: 600; letter-spacing: .11em; }
.eyebrow-line { flex: 1; height: 1px; background: linear-gradient(90deg,var(--green-line),transparent); }
.hero-title { margin: 0; font-size: clamp(4.5rem,10vw,9.5rem); font-weight: 430; letter-spacing: -.075em; line-height: .82; }
.hero-title span { display: block; color: var(--green); font-weight: 720; }
.hero-lead { max-width: 42rem; margin: clamp(2.4rem,5vw,4rem) 0 0; color: var(--muted); font-size: clamp(1.1rem,2vw,1.5rem); line-height: 1.6; }
.hero-lead strong { color: var(--paper); font-weight: 580; }
.hero-actions { display: flex; align-items: center; gap: 1.15rem; margin-top: 2.5rem; }
.primary-action { display: inline-flex; align-items: center; justify-content: space-between; min-width: 13.5rem; min-height: 3.75rem; padding: .35rem .35rem .35rem 1.25rem; border: 1px solid var(--green); border-radius: 999px; background: var(--green); color: #06110b; font-size: .9rem; font-weight: 800; transition: transform 200ms ease,box-shadow 200ms ease; }
.primary-action:hover { transform: translateY(-2px); box-shadow: 0 1rem 2.8rem rgba(80,201,133,.2); }
.action-icon { display: grid; width: 3rem; height: 3rem; place-items: center; border-radius: 50%; background: #07130c; color: var(--green); }
.action-icon svg { width: 1.25rem; stroke: currentColor; stroke-width: 1.6; }
.secondary-action { display: inline-flex; gap: .55rem; min-height: 3rem; align-items: center; border-bottom: 1px solid var(--line); color: var(--muted); font-size: .82rem; font-weight: 650; }
.hero-metrics { display: flex; gap: 2.5rem; margin: clamp(3.5rem,7vw,6rem) 0 0; }
.hero-metrics div { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: .7rem; }
.hero-metrics dt { color: var(--green); font-family: "IBM Plex Mono",monospace; font-size: .72rem; }
.hero-metrics dd { margin: 0; color: var(--muted); font-size: .75rem; }
.blueprint { position: relative; min-height: 36rem; overflow: hidden; border: 1px solid var(--line-soft); border-radius: 1.5rem; background: linear-gradient(rgba(80,201,133,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(80,201,133,.035) 1px,transparent 1px),linear-gradient(145deg,rgba(23,25,24,.96),rgba(10,11,10,.96)); background-size: 2.5rem 2.5rem,2.5rem 2.5rem,auto; box-shadow: 0 2.2rem 6rem rgba(0,0,0,.28); }
.blueprint-topline { display: flex; justify-content: space-between; padding: 1.25rem 1.4rem; border-bottom: 1px solid var(--line-soft); color: var(--muted); font-family: "IBM Plex Mono",monospace; font-size: .64rem; letter-spacing: .1em; }
.signal-field { position: relative; display: grid; min-height: 21rem; place-items: center; }
.signal-orbit { position: absolute; border: 1px solid var(--green-line); border-radius: 50%; }
.signal-orbit::before,.signal-orbit::after { position: absolute; width: .45rem; height: .45rem; border-radius: 50%; background: var(--green); box-shadow: 0 0 1rem rgba(80,201,133,.55); content: ""; }
.signal-orbit-outer { width: 15.5rem; height: 15.5rem; border-style: dashed; animation: orbit-spin 30s linear infinite; }
.signal-orbit-inner { width: 10rem; height: 10rem; opacity: .5; animation: orbit-spin 20s linear infinite reverse; }
.signal-orbit-outer::before { top: 1.6rem; right: 2rem; }.signal-orbit-outer::after { bottom: 1.2rem; left: 2.4rem; }.signal-orbit-inner::before { top: 50%; right: -.25rem; }.signal-orbit-inner::after { top: 50%; left: -.25rem; }
.signal-core { display: grid; width: 5.7rem; height: 5.7rem; place-items: center; border: 1px solid rgba(80,201,133,.45); border-radius: 50%; background: radial-gradient(circle,rgba(80,201,133,.22),rgba(80,201,133,.04) 62%,transparent 63%); box-shadow: 0 0 3.4rem rgba(80,201,133,.11); }
.signal-core span { width: 1.1rem; height: 1.1rem; border-radius: 50%; background: var(--green); box-shadow: 0 0 1.6rem rgba(80,201,133,.75); }
.signal-coordinate { position: absolute; color: rgba(232,228,223,.38); font-family: "IBM Plex Mono",monospace; font-size: .55rem; letter-spacing: .1em; }.coordinate-a{top:3.2rem;left:2rem}.coordinate-b{right:1.8rem;bottom:4.5rem}.coordinate-c{bottom:2.2rem;left:2.2rem}
.blueprint-code { position: absolute; right: 1.2rem; bottom: 1.2rem; left: 1.2rem; overflow: hidden; border: 1px solid var(--line-soft); border-radius: .8rem; background: rgba(5,5,5,.82); backdrop-filter: blur(.8rem); }
.code-toolbar { display: flex; align-items: center; gap: .55rem; padding: .7rem .9rem; border-bottom: 1px solid var(--line-soft); color: #777b78; font-family: "IBM Plex Mono",monospace; font-size: .6rem; }
.code-light { width: .45rem; height: .45rem; border-radius: 50%; background: var(--green); }.blueprint-code pre{margin:0;padding:1rem;overflow:auto;color:#c5c7c5;font-family:"IBM Plex Mono",monospace;font-size:clamp(.66rem,1.2vw,.76rem);line-height:1.65}.code-muted{color:#777b78}.code-value{color:#d8e0da}.code-accent{color:var(--green)}
.build-path { width: min(100%,1600px); margin-inline: auto; padding: clamp(6rem,10vw,10rem) var(--page-gutter); border-top: 1px solid var(--line-soft); }
.section-heading { display: grid; grid-template-columns: minmax(10rem,.45fr) minmax(20rem,1.2fr) minmax(10rem,.45fr); align-items: end; gap: 2rem; margin-bottom: 3rem; }
.section-heading>p,.footer-kicker{margin:0;color:var(--green);font-family:"IBM Plex Mono",monospace;font-size:.66rem;letter-spacing:.1em}.section-heading h2{max-width:46rem;margin:0;font-size:clamp(2.4rem,5vw,5rem);font-weight:500;letter-spacing:-.055em;line-height:1}.section-heading>span{justify-self:end;color:var(--muted);font-size:.76rem;line-height:1.5}
.path-list { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); margin: 0; padding: 0; list-style: none; border-block: 1px solid var(--line); }
.path-card { position: relative; display: flex; min-height: 21rem; flex-direction: column; justify-content: space-between; gap: 3rem; padding: 1.5rem; border-right: 1px solid var(--line); background: rgba(10,11,10,.36); transition: background 220ms ease,transform 220ms ease; }.path-card:last-child{border-right:0}.path-card:hover{background:var(--green-dim);transform:translateY(-.35rem)}
.path-card-index{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-family:"IBM Plex Mono",monospace;font-size:.62rem;letter-spacing:.08em;text-transform:uppercase}.path-card-index span:first-child{color:var(--green)}.path-card h3{max-width:16rem;margin:0 0 1rem;font-size:clamp(1.35rem,2vw,1.8rem);font-weight:620;letter-spacing:-.035em}.path-card p{max-width:22rem;margin:0;color:var(--muted);font-size:.88rem;line-height:1.65}.path-arrow{position:absolute;right:1.5rem;bottom:1.5rem;color:var(--green)}
.blueprint-wrap{position:relative;z-index:2;min-width:0;width:100%}.blueprint-wrap .blueprint{width:100%}
.signal-field{width:100%;padding:0;overflow:hidden;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;isolation:isolate}.signal-field::before{position:absolute;z-index:-1;inset:0;background:radial-gradient(circle 9rem at var(--pointer-x,50%) var(--pointer-y,48%),rgba(80,201,133,.15),transparent 72%);content:"";opacity:0;transition:opacity 280ms ease}.signal-field:hover::before,.signal-field:focus-visible::before,.blueprint-wrap.is-awake .signal-field::before{opacity:1}
.signal-field:hover .signal-orbit-outer{border-color:rgba(80,201,133,.62);animation-duration:18s}.signal-field:hover .signal-orbit-inner{opacity:.78;animation-duration:12s}.signal-core{transition:transform 320ms cubic-bezier(.2,.8,.2,1),box-shadow 320ms ease}.signal-field:hover .signal-core,.signal-field:focus-visible .signal-core,.blueprint-wrap.is-awake .signal-core{transform:scale(1.13);box-shadow:0 0 5rem rgba(80,201,133,.24)}.blueprint-wrap.is-awake .signal-core span{animation:guide-pulse 1.8s ease-in-out infinite}
.signal-callout{position:absolute;z-index:3;right:1.2rem;bottom:1.1rem;display:inline-flex;align-items:center;gap:.5rem;padding:.5rem .7rem;border:1px solid var(--line-soft);border-radius:999px;background:rgba(5,5,5,.72);color:var(--muted);font-family:"IBM Plex Mono",monospace;font-size:.52rem;letter-spacing:.06em;backdrop-filter:blur(.6rem);transition:border-color 220ms ease,color 220ms ease,transform 220ms ease}.signal-field:hover .signal-callout,.blueprint-wrap.is-awake .signal-callout{border-color:var(--green-line);color:var(--paper);transform:translateY(-.15rem)}.signal-callout-dot{width:.38rem;height:.38rem;border-radius:50%;background:var(--green);box-shadow:0 0 .8rem rgba(80,201,133,.75)}
.signal-thread{position:absolute;z-index:1;inset:0;width:100%;height:100%;pointer-events:none;opacity:.24;transition:opacity 300ms ease}.signal-thread path{fill:none}.signal-thread-shadow{stroke:rgba(80,201,133,.14);stroke-width:7;filter:blur(4px)}.signal-thread-line{stroke:var(--green);stroke-width:1.2;stroke-dasharray:4 10;vector-effect:non-scaling-stroke}.signal-thread-dot{fill:var(--green);filter:drop-shadow(0 0 7px rgba(80,201,133,.95))}.signal-field:hover .signal-thread,.blueprint-wrap.is-awake .signal-thread{opacity:.9}
.journey-track{--journey-progress:0%;position:relative;height:2.5rem;margin:0 1.5rem 1rem}.journey-track-base,.journey-track-progress{position:absolute;top:50%;left:0;height:1px;transform:translateY(-50%)}.journey-track-base{width:100%;background:var(--line)}.journey-track-progress{width:var(--journey-progress);background:var(--green);box-shadow:0 0 1.2rem rgba(80,201,133,.38);transition:width 600ms cubic-bezier(.2,.8,.2,1)}
.journey-node,.journey-beacon{position:absolute;top:50%;border-radius:50%;transform:translate(-50%,-50%)}.journey-node{width:.52rem;height:.52rem;border:1px solid #505350;background:var(--ink);transition:border-color 280ms ease,background 280ms ease,box-shadow 280ms ease}.journey-node:nth-child(4){left:0}.journey-node:nth-child(5){left:50%}.journey-node:nth-child(6){left:100%}.journey-node.is-reached{border-color:var(--green);background:var(--green);box-shadow:0 0 1rem rgba(80,201,133,.55)}.journey-beacon{z-index:2;left:var(--journey-progress);width:.8rem;height:.8rem;background:var(--green);box-shadow:0 0 0 .3rem rgba(80,201,133,.12),0 0 1.4rem rgba(80,201,133,.72);transition:left 600ms cubic-bezier(.2,.8,.2,1);animation:guide-pulse 1.8s ease-in-out infinite}
.path-item{min-width:0;border-right:1px solid var(--line);list-style:none}.path-item:last-child{border-right:0}.path-card{width:100%;height:100%;overflow:hidden;border:0;border-radius:0;color:var(--paper);text-align:left;cursor:pointer;isolation:isolate}.path-card::before{position:absolute;z-index:-1;inset:0;background:radial-gradient(circle 12rem at var(--pointer-x,80%) var(--pointer-y,20%),rgba(80,201,133,.19),transparent 72%),linear-gradient(145deg,rgba(80,201,133,.08),transparent 52%);content:"";opacity:0;transition:opacity 280ms ease}.path-card:hover::before,.path-card:focus-visible::before,.path-item.is-current .path-card::before{opacity:1}.path-item.is-current .path-card{background:rgba(80,201,133,.1);box-shadow:inset 0 0 0 1px rgba(80,201,133,.38),0 1.5rem 4rem rgba(0,0,0,.22);transform:translateY(-.55rem)}.path-item.is-passed .path-card-index span:first-child::after{margin-left:.45rem;content:"✓"}
.path-card-copy,.path-card-copy strong,.path-card-copy>span{display:block}.path-card-copy strong{max-width:16rem;margin:0 0 1rem;font-size:clamp(1.35rem,2vw,1.8rem);font-weight:620;letter-spacing:-.035em;transition:color 220ms ease,transform 220ms ease}.path-card-copy>span{max-width:22rem;color:var(--muted);font-size:.88rem;line-height:1.65;transition:color 220ms ease}.path-card:hover .path-card-copy strong,.path-item.is-current .path-card-copy strong{color:var(--green);transform:translateX(.2rem)}.path-card:hover .path-card-copy>span,.path-item.is-current .path-card-copy>span{color:var(--paper)}.path-arrow{transition:transform 220ms ease}.path-card:hover .path-arrow,.path-item.is-current .path-arrow{transform:translate(.25rem,-.25rem) rotate(8deg)}
.journey-console{display:grid;grid-template-columns:minmax(10rem,.42fr) minmax(20rem,1fr) auto;align-items:center;gap:clamp(1.5rem,4vw,4rem);margin-top:2rem;padding:clamp(1.35rem,3vw,2.25rem);overflow:hidden;border:1px solid var(--line);border-radius:1rem;background:linear-gradient(90deg,rgba(80,201,133,.08),transparent 42%),rgba(12,13,12,.86);box-shadow:0 2rem 5rem rgba(0,0,0,.2);transition:border-color 300ms ease,background 300ms ease}.build-path.is-active .journey-console{border-color:var(--green-line)}.build-path.is-complete .journey-console{background:radial-gradient(circle at 18% 50%,rgba(80,201,133,.16),transparent 30%),rgba(12,13,12,.9)}
.journey-console-index{display:flex;flex-direction:column;gap:.5rem;color:var(--muted);font-family:"IBM Plex Mono",monospace;font-size:.58rem;letter-spacing:.09em}.journey-console-index span:first-child,.journey-console-copy>p{color:var(--green)}.journey-console-copy>p{margin:0 0 .6rem;font-family:"IBM Plex Mono",monospace;font-size:.58rem;letter-spacing:.1em}.journey-console-copy h3{max-width:42rem;margin:0;font-size:clamp(1.2rem,2.5vw,2rem);font-weight:560;letter-spacing:-.035em}.journey-console-copy>span{display:block;max-width:40rem;margin-top:.65rem;color:var(--muted);font-size:.78rem;line-height:1.55}
.journey-action{display:inline-flex;align-items:center;justify-content:space-between;gap:1rem;min-width:13rem;min-height:3.4rem;padding:.75rem .8rem .75rem 1rem;border:1px solid var(--green-line);border-radius:999px;background:transparent;color:var(--paper);font-size:.72rem;font-weight:700;cursor:pointer;transition:color 220ms ease,background 220ms ease,transform 220ms ease,box-shadow 220ms ease}.journey-action span:last-child{display:grid;width:2rem;height:2rem;place-items:center;border-radius:50%;background:var(--green);color:var(--ink);font-size:1rem}.journey-action:hover{background:var(--green);color:var(--ink);box-shadow:0 1rem 2.6rem rgba(80,201,133,.18);transform:translateY(-.2rem)}.journey-action:hover span:last-child{background:var(--ink);color:var(--green)}
[data-enter]{opacity:0;transition:opacity 750ms cubic-bezier(.2,.8,.2,1),transform 750ms cubic-bezier(.2,.8,.2,1),clip-path 850ms cubic-bezier(.2,.8,.2,1)}[data-motion="heading"]{transform:translateY(3rem)}[data-motion="line"]{transform:scaleX(.25);transform-origin:left}[data-motion="rise"]{transform:translateY(4rem) rotate(-1.5deg)}[data-motion="scan"]{clip-path:inset(0 100% 0 0);transform:translateX(-1.5rem)}[data-motion="turn"]{transform:perspective(900px) rotateY(-15deg) translateX(2rem);transform-origin:right}[data-motion="console"]{transform:translateY(2rem) scale(.98)}[data-enter].is-visible,[data-enter][data-enter-visible="true"]{opacity:1;clip-path:inset(0);transform:none}.path-item:nth-child(2){transition-delay:120ms}.path-item:nth-child(3){transition-delay:240ms}
.site-footer { display: grid; grid-template-columns: .7fr 1.3fr auto; align-items: end; gap: 3rem; width: min(100%,1600px); margin-inline: auto; padding: 3rem var(--page-gutter) 4rem; border-top: 1px solid var(--line-soft); }
.footer-copy{max-width:17rem;margin:.75rem 0 0;color:var(--muted);font-size:.9rem;line-height:1.5}.footer-signature{margin:0;color:#696c69;font-family:"IBM Plex Mono",monospace;font-size:.6rem;letter-spacing:.06em;writing-mode:vertical-rl}
.social-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}.social-links a{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:.8rem;padding:1rem;border:1px solid var(--line);border-radius:.7rem;transition:border-color 180ms ease,background 180ms ease}.social-links a:hover{border-color:var(--green-line);background:var(--green-dim)}.social-icon{display:grid;width:2.5rem;height:2.5rem;place-items:center;border:1px solid var(--line);border-radius:50%}.social-icon svg{width:1.1rem;stroke:currentColor;stroke-width:1.6}.social-links strong,.social-links small{display:block}.social-links strong{font-size:.78rem}.social-links small{margin-top:.2rem;color:var(--muted);font-family:"IBM Plex Mono",monospace;font-size:.58rem}.social-arrow{color:var(--green)}
.reveal{opacity:0;animation:reveal-up 720ms cubic-bezier(.2,.8,.2,1) forwards}.reveal-1{animation-delay:80ms}.reveal-2{animation-delay:160ms}.reveal-3{animation-delay:240ms}.reveal-4{animation-delay:320ms}.reveal-5{animation-delay:400ms}
@keyframes reveal-up{from{opacity:0;transform:translateY(1.3rem)}to{opacity:1;transform:translateY(0)}}@keyframes orbit-spin{to{transform:rotate(360deg)}}@keyframes status-pulse{50%{box-shadow:0 0 0 .45rem rgba(80,201,133,.04)}}@keyframes guide-pulse{0%,100%{opacity:.72;transform:scale(.86)}50%{opacity:1;transform:scale(1.12)}}
@media(max-width:1050px){.hero-layout{grid-template-columns:1fr;min-height:auto}.blueprint-wrap{max-width:42rem}.blueprint{min-height:34rem}.section-heading{grid-template-columns:1fr}.section-heading>span{justify-self:start}.journey-console{grid-template-columns:minmax(8rem,.35fr) 1fr}.journey-action{grid-column:2;justify-self:start}.site-footer{grid-template-columns:1fr 1.5fr}.footer-signature{display:none}}
@media(max-width:720px){.brand-header{min-height:5rem}.session-status>span:not(.status-dot){display:none}.hero-layout{padding-top:3rem}.hero-title{font-size:clamp(4.2rem,24vw,7rem)}.hero-actions{align-items:flex-start;flex-direction:column}.hero-metrics{gap:1.25rem}.blueprint{min-height:31rem;border-radius:1rem}.path-list{grid-template-columns:1fr}.path-item{border-right:0;border-bottom:1px solid var(--line)}.path-item:last-child{border-bottom:0}.path-card{min-height:15rem;border:0}.path-item.is-current .path-card{transform:translateX(.4rem)}.journey-console{grid-template-columns:1fr}.journey-action{grid-column:1}.site-footer{grid-template-columns:1fr}.social-links{grid-template-columns:1fr}}
@media(max-width:420px){.hero-title{font-size:4rem}.hero-metrics{align-items:flex-start;flex-direction:column}.signal-orbit-outer{width:13rem;height:13rem}.signal-orbit-inner{width:8.2rem;height:8.2rem}.blueprint-code{right:.7rem;bottom:.7rem;left:.7rem}.brand-link{width:9.5rem}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.reveal,.signal-orbit,.status-dot,.signal-core span,.journey-beacon{animation:none!important}.reveal,[data-enter]{opacity:1;clip-path:none;transform:none}.signal-thread-dot,.journey-beacon{display:none}.primary-action,.path-card,[data-enter]{transition:none}}
`,
          },
          {
            path: 'public/faber-code-logo.png',
            assetKey: 'faber-code-logo',
          },
          {
            path: 'public/og-card.svg',
            content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#050505"/><circle cx="970" cy="70" r="330" fill="#50c985" opacity=".12"/><g fill="none" stroke="#50c985" opacity=".15"><path d="M0 105h1200M0 210h1200M0 315h1200M0 420h1200M0 525h1200"/><path d="M200 0v630M400 0v630M600 0v630M800 0v630M1000 0v630"/></g><text x="96" y="250" fill="#50c985" font-family="monospace" font-size="28" letter-spacing="6">${copy.welcome} / 01</text><text x="96" y="365" fill="#e8e4df" font-family="sans-serif" font-size="96" font-weight="600">FaberCode</text><text x="96" y="445" fill="#a8aaa8" font-family="sans-serif" font-size="34">${copy.socialDescription}</text></svg>\n`,
          },
          {
            path: 'eslint.config.mjs',
            content: `import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "out/**"]),
]);
`,
          },
          {
            path: '.env.example',
            content: `NEXT_PUBLIC_WELCOME_NAME=${name}\nNEXT_PUBLIC_SITE_URL=http://localhost:3000\n`,
          },
          {
            path: 'README.md',
            content: `# ${copy.readmeTitle}

${copy.readmeDescription}

## ${copy.readmeDevelopment}

1. ${copy.readmeInstall} \`npm install\`.
2. ${copy.readmeInstall} \`npm run dev\`.
3. ${copy.readmeOpen} \`http://localhost:3000\`.

${copy.readmeName} \`NEXT_PUBLIC_WELCOME_NAME\`. ${copy.readmeLinks} [GitHub](${GITHUB_URL}) / [LinkedIn](${LINKEDIN_URL}).
`,
          },
        ],
      },
    ];
  }

  window.FaberTutorialWelcomeProject = {
    createWelcomeProjectBatches,
    normalizeWelcomeLocale,
    normalizeWelcomeName,
  };
})();

# Status do Tutorial do Mapa (Etapas 8 a 13)

**Status atual:** CONCLUÍDO E VALIDADO
**Última atualização:** 2 de agosto de 2026

## Escopo concluído

O tutorial já conduz o usuário desde a documentação do mapa até o início da primeira conversa de desenvolvimento. Os trechos demonstrativos de IA são executados localmente, sem provedor ou consumo de créditos, mas os históricos e as milestones continuam persistidos no projeto.

## Contrato final de navegação

1. O botão **Próximo** permanece funcional nas 13 etapas, independentemente do estado das demonstrações e checklists.
2. Os checklists continuam registrando o progresso e o autoavanço continua disponível para quem segue o percurso guiado.
3. Ao usar **Próximo**, o tutorial fecha modais e painéis contextuais que poderiam bloquear a etapa seguinte.
4. A única entrada obrigatória é o nome do usuário. Ao chegar à etapa de construção sem um nome salvo, **Próximo** abre a pergunta, valida o campo e mantém o foco até receber um valor válido.
5. Todas as demais demonstrações podem ser puladas sem bloquear a navegação do tutorial.

## Etapa 8: construção do mapa

1. Cria e preenche o briefing da página de boas-vindas.
2. Cria e revisa o Markdown do Design System Faber Code.
3. Aplica automaticamente zoom de 60% e organiza os Markdowns sem sobreposição.
4. Insere o logo e organiza os grupos Frontend e Regras.
5. Cria regras de interface e critérios de aceite.
6. Solicita o nome do usuário e personaliza a saudação.
7. Cria e revisa Arquitetura Frontend, Componentes da Página e Conteúdo e Links.
8. Registra Next.js, JavaScript e Tailwind CSS como stack do demonstrativo.
9. Mantém placeholders para GitHub (`https://github.com/SEU_USUARIO`) e LinkedIn (`https://www.linkedin.com/in/SEU_PERFIL`).

## Etapa 9: Assistente do Mapa

1. Expande o painel direito e apresenta por hover Arquivos, IA do Mapa, Git, Terminal, Milestones e Executar.
2. Abre a IA do Mapa e prepara uma pergunta de validação.
3. Emula e persiste localmente a pergunta e a resposta, sem chamar um provedor de IA.
4. Identifica a ausência de SEO, metadados e estados essenciais da interface.
5. Guia o usuário pela ação **Adicionar documento de SEO ao mapa**.
6. Volta ao canvas e insere `SEO e Estados da Interface` no grupo Regras.
7. Registra a correção no histórico da conversa do mapa.

## Etapa 10: planejamento e início do desenvolvimento

1. Mostra o histórico corrigido e guia o usuário a clicar em **Renderizar o Mapa**.
2. Executa uma análise local determinística e gera cinco milestones, sem chamar `sendAssistantMessage`.
3. Exibe em cada milestone tarefas, critérios e os Markdowns relevantes para a implementação.
4. Guia o usuário por **Salvar em Milestones** e pela confirmação **Continuar**.
5. Aguarda o evento real de persistência antes de liberar a ferramenta Milestones.
6. Abre a Milestone 1 e mostra seu planejamento e referências.
7. Revela a lista de projetos e guia o usuário ao botão `+` real, à direita do ícone do Mapa da Aplicação, para abrir o chat de desenvolvimento.
8. Prepara a mensagem `Vamos iniciar o desenvolvimento do projeto começando pela milestone 1`.
9. Intercepta apenas o envio desta demonstração e emula a continuação da IA sem consumir créditos.
10. Persiste a mensagem e as respostas como uma conversa comum do projeto.

O painel de Milestones não recebe botões exclusivos do tutorial. O mesmo componente é exibido para usuários comuns; a entrada no chat sempre reutiliza a ação de nova conversa já existente no projeto.

## Planejamento gerado

O plano local contém cinco etapas:

1. Fundação em Next.js com JavaScript e Tailwind CSS.
2. Design System e identidade Faber Code.
3. Componentes, conteúdo e links sociais placeholders.
4. SEO, acessibilidade e estados da interface.
5. Validação técnica, visual e build.

As etapas referenciam os documentos exportados em `docs/application-map/`, incluindo `frontend.md`, `regras.md`, `README.md`, `decisions.md` e `open-questions.md`.

## Etapa 11: conversa e fundação real

1. A conversa emulada contextualiza a Milestone 1 sem chamar uma API de IA.
2. Cria progressivamente a fundação Next.js dentro da pasta escolhida pelo usuário.
3. Registra no chat os arquivos criados e mantém a conversa salva no projeto.
4. Libera a ferramenta Git somente após a escrita real do primeiro lote.

## Etapa 12: desenvolvimento e commits

1. Guia o usuário pelo Git local real: inicialização, seleção, stage, mensagem e commit.
2. Cria três lotes: fundação, interface responsiva e acabamento com SEO e acessibilidade.
3. Usa uma mensagem de commit específica para cada lote.
4. Antes do último commit, abre Arquivos e orienta a inspeção de uma diff pendente.
5. Mantém o cursor preso ao alvo mesmo quando o painel rola ou é atualizado.

## Etapa 13: execução local

1. Aponta o botão **Executar** somente depois dos três commits.
2. Instala dependências quando necessário, inicia o servidor local e abre o navegador.
3. Só conclui o tutorial depois do evento real de inicialização do preview.
4. Em caso de falha, volta ao estado clicável para permitir uma nova tentativa.

## Projeto demonstrativo

Os arquivos gerados formam uma landing page responsiva em Next.js e Tailwind CSS, personalizada com o nome informado no tutorial. O resultado inclui metadados, estados acessíveis, identidade Faber Code e os links reais de GitHub e LinkedIn fornecidos para a demonstração.

## Encerramento da landing page

1. A conexão entre hero e órbita usa uma curva Bézier única, responsiva e sem quebras.
2. A linha residual que aparecia abaixo do blueprint após o clique foi removida integralmente.
3. Os cards orbitais usam portal e limites de viewport para não cortar título ou conteúdo no topo e na base da animação.
4. A trajetória, os cards e o overflow foram validados em desktop (`1600x900`), tablet (`768x900`) e mobile (`390x844`).
5. O protótipo, as LPs geradas `Apollo` e `Salem` e o gerador de futuros projetos compartilham a mesma correção.

## Validação final

- `node --check renderer/progressive_disclosure.js`
- `npm run test:renderer-module-contract`
- `npm run test:renderer-tutorial-project`
- lint das LPs geradas
- build de produção da LP ativa
- inspeção visual dos estados críticos de hover, conexão entre sessões e responsividade

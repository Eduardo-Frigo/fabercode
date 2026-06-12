# Faber Code - Indice de Documentacao Modular 2026-05-25 a 2026-06-02

Este indice organiza a documentacao das atualizacoes feitas no Faber Code durante o ciclo de 2026-05-25 a 2026-06-02.

A fonte de verdade deste registro e o projeto local em `<repo-root>`, a documentacao interna do Faber Code e as decisoes tomadas na conversa. Imagens e prints de teste nao foram usados como referencia principal neste documento.

Para uma navegacao publica mais curta, use tambem `docs/README.md`.

## Estado do ciclo

- As mudancas locais foram mantidas sem commit durante a rodada de ajustes, smoke manual e diagnostico.
- Depois do commit `30e163c Fortalece contratos e workspace apos smoke tests`, novos avancos locais foram adicionados para smoke tests 34 a 46, MCP-compatible capability layer, blueprints/gramaticas, validacao visual real e context frame do orquestrador.
- Em 2026-05-26, o usuario pediu commit explicito para limpar o repositorio antes da proxima etapa.
- Em 2026-05-27, a frente MCP/contratos foi fechada no commit `ed2fd77 Fortalece MCP como guardiao de contratos`, com `blueprint_contract`, ledger de evidencias, promocao Automata e matriz visual real desktop/tablet/mobile.
- Em 2026-05-27, a rodada `d4a2d91 Amplia diversidade e validacao das blueprints` fortaleceu versatilidade visual, headers, icones, testimonials, footers, inferencia de marca, matriz de 18 briefings, MCP briefing matrix com 9 casos e smoke visual real em 6 finalidades.
- Em 2026-05-27, a rodada MCP externo criou a capability `external_mcp`, bridge governada para servidores externos aprovados, registry persistente, cache visual de discovery, UI avancada de configuracao com `env`/`headers`/secrets, discovery de tools, bloqueio por politica granular de risco/escopo/diretorio/rede, transportes `stdio`/HTTP/SSE, ledger, smoke visual com PNG real, smoke HTTP/SSE contra endpoint local real, smoke HTTP/SSE contra endpoint publico DeepWiki sem credencial e smoke contra servidor oficial de terceiro via `@modelcontextprotocol/server-filesystem`.
- Em 2026-05-28, a rodada de Memoria ativa/RAG/MemPalace criou ranking semantico vetorial local, provenance enriquecida, ledger `.faber/memory`, lifecycle de memoria, UI operavel no Cortex, politica de ambiguidade, smoke privado/autenticado de RAG e smoke visual desktop/mobile do Context Frame.
- Em 2026-05-28, apos `4f7e828`, a rodada complementar local adicionou provider plugavel de embeddings neurais/remotos, artifact store permanente em `.faber/artifacts`, auditoria visual de memoria com filtros, presets/registry MCP externo, nova reducao de `main.js`, smokes visuais em loop para Cortex/MCP settings, `smoke:full-tool-loop` e `smoke:briefing-loop-matrix` com 21 briefings A-I, ferramentas simples/complexas, sites institucionais, landing pages, SaaS, calculadoras, contratos temporarios, memoria/RAG, MCP/capability layer, regressao proposital, edicoes deterministicas/estruturadas e capturas desktop/tablet/mobile.
- Em 2026-05-29, os primeiros testes reais no app com API OpenAI mostraram que os percentuais globais anteriores estavam superestimados para o fluxo real. A rodada seguinte criou intake canonico robusto, corrigiu projeto vazio/metadados, rota de `new_project_area`, revisao visual com screenshots, preloader animado e smoke real Tremn com screenshots desktop/tablet/mobile/menu mobile.
- Em 2026-05-29, apos o primeiro site Tremn ser criado no app, a rodada V1 corrigiu a cadeia de alteracao incremental real: pedido "video de X" no hero agora aciona media provider/Pexels, injeta `<video>` com `src` real, bloqueia conclusao sem fonte renderizavel, valida `<video>` vazio como falha, aplica grayscale/overlay leve e foi confirmada por smoke manual no app com preview real.
- Em 2026-05-30, a rodada de UX operacional consolidou a barra esquerda recolhida com mini menu de projetos, a barra direita como rail de ferramentas, Git local com status/stage/commit/diffs descritivos, clique em arquivo abrindo na linha alterada, Terminal mais usavel, Cortex simplificado para markdowns/referencias, conversas abrindo nas mensagens recentes, preloader com animacao obrigatoria e cobertura de preview Next.js-like por testes.
- Em 2026-05-30, uma nova rodada de UX revisou configuracoes, Terminal em lightbox, home com frase filosofica trilingue, icone/loader de Executar, tooltips globais, fluxo de iniciar conversa no projeto selecionado e contrastes do modo claro; a rodada complementar removeu a configuracao livre de layout, tirou os botoes da home, corrigiu overrides do modo claro, adicionou o titulo da conversa ativa no topo central e tornou esse titulo editavel inline. A home tambem ganhou animacao de escrita na frase, aumento de 25% no texto, remocao definitiva da frase bloqueada "A vida nao examinada..." em todos os idiomas e persistencia do ultimo autor para evitar repeticao entre aberturas. Apos autorizacao do usuario, o login Google foi concluido e o smoke manual final passou por home, projetos, Terminal, Executar, configuracoes, edicao de titulo e reinicio do Electron com autor diferente.
- Em 2026-05-30, apos a rodada Git/GitHub, foi executada uma bateria adversaria de QA baseada no plano exaustivo anexado. A rodada corrigiu Git com etapas recolhidas ate clique, selecao explicita entre `Untracked`/`Modified`/`Staged`/commit, estado visual correto de botoes desabilitados, arquivos binarios/Unicode no Git, scanner de 50.001 arquivos, preview com porta ocupada, retry do backend OAuth em `EADDRINUSE` e contrato de smoke de blueprint. O smoke manual passou por login Google real, abertura de projeto e Git com screenshots. As suites `test:architecture`, `test:smoke-scenarios`, `test:product-orchestration`, `test:mcp-capabilities` e `test:memory-rag-mempalace` passaram.
- Em 2026-06-01, a rodada de documentacao publica consolidou README, `docs/README.md`, checklist de release, ordem correta do fluxo Git/GitHub, IA configuravel por API/conector, RWKV como projeto separado futuro, `.env.example` com `mock` como default publico, `.gitignore` reforcado, arquitetura modular validada por `test:architecture` e push publico para `origin/main` no commit `5442e1b`.
- Em 2026-06-01, a rodada de refatoracao segura e pentest dividiu `renderer/project_tools.js` entre suporte, Git steps e GitHub/Deploy, reforcou URL policy, preview local, command runner com `shell: false`, Git/GitHub path/option hardening, MCP externo com secrets protegidos e symlink realpath, editor de imagem com URL codificada, barreira de prompt injection em `cortex/security/ai_trust_boundary.js`, wrapping de contexto nao confiavel no render pass/main, bloqueio no capability gateway e teste E2E real com OpenAI. Foram encontradas e corrigidas duas falhas reais: URL de exfiltracao em linha separada e `reveal prompt` generico. `test:architecture`, `audit:release`, `npm audit --omit=dev --audit-level=moderate`, `test:real-openai-prompt-injection` e smoke visual passaram.
- Em 2026-06-01, a rodada de stresstest Forge MRP mostrou que pedidos complexos nao podem depender de scaffold visual rigido. A correcao fortaleceu intake, contratos de produto, build mode, policy gate, preview/runtime, diagnostico de preview, validacao visual para apps operacionais, patches deterministicos para `structuredClone`/browser globals, tratamento de falhas de provider e separacao entre arquitetura de software/MCP e site legitimo de arquitetura. O Forge MRP gerado foi validado com `npm test`, `npm run build`, smoke manual no Chrome, ordem `ASM-900` liberada, MRP executado e audit log com `MRP_RUN`. `test:architecture`, `audit:release`, `npm audit --omit=dev --audit-level=moderate`, `test:ai-trust-boundary`, `test:render-pass-service` e `git diff --check` passaram.
- Em 2026-06-02, a rodada Forge MRP passou a tratar contratos de blueprint/Automata como advisory por padrao, reservando bloqueio para intencao explicita ou risco real. Tambem adicionou painel de fases com resumo expansivel, guard contra conteudo instrucional em arquivos de codigo, read-only routing sem artefatos, tratamento de edicao visual estreita, blueprint local Forge MRP mais completo e retry compacto para `diagnostic_repair` apos `max_output_tokens`. O smoke real comprovou que o Faber nao criou contrato e mostrou fases, mas o reparo do THE FORGE ficou bloqueado por limite da OpenAI antes de gerar JSON.
- A arquitetura modular continua sendo uma regra permanente do projeto.

## Nota pos-smoke 32/33

Os testes manuais 32 e 33 mostraram que parte das garantias descritas neste ciclo ainda era aspiracional na pratica:

- o fluxo ainda podia cair em blueprint generico;
- o teste 33 reutilizou memoria antiga com `Studio Habitat` / `Helena Duarte Arquitetura`;
- a validacao visual ainda podia reportar aderencia estatica alta sem resolver captura real;
- sites completos ainda podiam gerar paginas rasas ou com baixa aderencia ao briefing.

As correcoes deste ciclo devem ser lidas como reforcos e regressions tests para esses pontos, nao como prova final de maturidade do produto. O proximo smoke manual continua obrigatorio.

## Documentos deste ciclo

- `docs/FABER_CODE_FORGE_MRP_LOOP_AVANCOS_2026-06-02.md`: registro da rodada Forge MRP com liberdade governada, contrato advisory, fases visiveis, guard contra instrucoes em arquivos de codigo, evidencias de smoke real e limite atual da API.
- `docs/FABER_CODE_HANDOFF_2026-06-02_API_LIMIT.md`: handoff operacional para retomar o reparo do Forge MRP quando a API voltar, incluindo prompt usado, checklist e comandos de validacao.
- `docs/FABER_CODE_UX_FERRAMENTAS_GIT_TERMINAL_AVANCOS_2026-05-30.md`: registro da rodada de UX operacional no app, cobrindo menu esquerdo recolhido, ferramentas da direita, Git local com diffs e linha alterada, Terminal, Cortex simplificado, conversas recentes, preloader, Executar/Next.js-like, testes e screenshots de smoke.
- `docs/FABER_CODE_UX_CONFIG_TERMINAL_HOME_LIGHTMODE_2026-05-30.md`: registro da rodada de UX de configuracoes, Terminal em lightbox, home com frases trilingues, Executar com play/loader minimalista, tooltips globais, inicio de conversa no projeto selecionado, remocao da configuracao livre de layout, titulo da conversa ativa/editavel, frase bloqueada removida, RNG com autor diferente entre aberturas e modo claro.
- `docs/FABER_CODE_PENTEST_PROMPT_INJECTION_SEGURANCA_2026-06-01.md`: registro do pentest defensivo, barreira contra prompt injection, hardening de filesystem/Git/GitHub/MCP/preview, teste E2E real com OpenAI, falhas encontradas e limites restantes.
- `docs/FABER_CODE_ARQUITETURA_REFATORACAO_SEGURA_2026-06-01.md`: registro da refatoracao protegida por testes, separacao de `project_tools`, contratos renderer, smoke visual, validacoes e limites de arquitetura.
- `docs/FABER_CODE_STRESSTEST_FORGE_MRP_CORRECOES_2026-06-01.md`: registro do stresstest Forge MRP, correcoes de intake/contratos/preview/runtime, liberdade governada para pedidos complexos, validacao operacional do app gerado, testes e limites restantes.
- `docs/FABER_CODE_PUBLIC_RELEASE_PREP_AVANCOS_2026-06-01.md`: registro da rodada de documentacao publica, sanitizacao, organizacao de docs, arquitetura modular, defaults seguros de IA, RWKV como projeto separado futuro, validacoes e push publico.
- `docs/FABER_CODE_QA_EXAUSTIVO_CORRECOES_2026-05-30.md`: relatorio completo da bateria adversaria de QA, bugs encontrados, correcoes, smoke visual, screenshots, testes focados, suites amplas e limites fisicos/longa duracao ainda pendentes.
- `docs/FABER_CODE_QA_HANDOFF_TECNICO_2026-05-30.md`: handoff tecnico da rodada QA/Git/Preview/OAuth, com contratos de comportamento, arquivos alterados, testes reforcados, comandos de validacao e cuidados para proximas alteracoes.
- `docs/FABER_CODE_V1_PRIMEIRO_SITE_ALTERACAO_REAL_2026-05-29.md`: marco operacional V1 local do Faber Code, registrando o primeiro site real multipagina criado pelo app, a primeira alteracao incremental real aplicada sobre esse site, a correcao da cadeia Pexels/video/hero/validacao, smokes manuais e evidencias visuais.
- `docs/FABER_CODE_AVANCOS_COMPLETOS_2026-05-29.md`: consolidado da rodada de intake robusto apos testes reais no app, com recalibracao honesta dos percentuais, arquivos alterados, validacoes, smoke Tremn e limites restantes.
- `docs/FABER_CODE_INTAKE_ROBUSTO_AVANCOS_2026-05-29.md`: registro tecnico do novo `product_intake_service`, integracoes no roteador/working brief/main, regras de seguranca, testes e criterios de maturidade.
- `docs/FABER_CODE_SMOKE_REAL_TREMN_2026-05-29.md`: evidencia do smoke real do briefing Tremn, incluindo artefatos, screenshots, falha detectada no menu mobile, correcao, refinamento visual e validacao final.
- `docs/FABER_CODE_FERRAMENTAS_100_AVANCOS_2026-05-28.md`: registro da rodada complementar rumo a 100%, cobrindo embeddings remotos plugaveis, artifact store permanente, auditoria de memoria, presets/registry MCP externo, reducao de `main.js`, smokes visuais em loop, `smoke:full-tool-loop`, `smoke:briefing-loop-matrix` com 21 briefings A-I, validacoes e percentuais atualizados.
- `docs/FABER_CODE_AVANCOS_COMPLETOS_2026-05-28.md`: consolidado atualizado apos a rodada de memoria e a rodada complementar de ferramentas, com estado do repositorio, percentuais, validacoes finais, screenshots de evidencia e proximos limites contra o criterio interno "Codex = 100%".
- `docs/FABER_CODE_MEMORIA_RAG_MEMPALACE_AVANCOS_2026-05-28.md`: registro completo da rodada de memoria, cobrindo ranking semantico vetorial local, provenance, ledger `.faber/memory`, lifecycle, UI de gestao no Cortex, RAG privado/autenticado, tombstone MemPalace, smokes e limites restantes.
- `docs/FABER_CODE_MCP_CONTRATOS_BLUEPRINTS_2026-05-27.md`: registro completo da rodada `ed2fd77`, cobrindo MCP como guardiao de contratos de blueprint, `blueprint_contract`, reparo automatico, source policy, DOM metrics, matriz visual real e promocao no Automata Contract Ledger.
- `docs/FABER_CODE_BLUEPRINTS_DIVERSIDADE_VALIDACAO_2026-05-27.md`: registro da rodada `d4a2d91`, cobrindo diversidade de composicao, primitivas de header/icones/testimonials/footer, matriz de 18 briefings, smoke MCP com 9 casos e smoke visual real em producao para 6 finalidades.
- `docs/FABER_CODE_MCP_EXTERNO_BRIDGE_2026-05-27.md`: registro da rodada de MCP externo, cobrindo `external_mcp`, bridge de servidor aprovado, registry persistente, cache visual de discovery, UI avancada de configuracao, transportes `stdio`/HTTP/SSE, discovery, chamada `tools/call`, politica de allow/block/risco/escopo/diretorio/rede, ledger, smoke visual externo, smoke HTTP/SSE local real, smoke HTTP/SSE publico DeepWiki sem credencial e smoke contra servidor MCP oficial de terceiro.
- `docs/FABER_CODE_AVANCOS_COMPLETOS_2026-05-27.md`: consolidado atualizado dos avancos ate o commit `ed2fd77`, cobrindo MCP `structured_edit`, `blueprint_contract`, patch deterministico estrutural, memoria ativa/RAG/MemPalace, produto/orquestracao, auditoria de release e limites restantes.
- `docs/FABER_CODE_AVANCOS_COMPLETOS_2026-05-25.md`: consolidado completo do estado atual, incluindo smoke tests 34 a 42, MCP-compatible capability layer, Lumen Lab, percentuais atualizados, riscos e proximo smoke.
- `docs/FABER_CODE_AVANCOS_CONSOLIDADOS_2026-05-25.md`: consolidado pos-commit dos avancos reais, testes, percentuais revisados e riscos abertos.
- `docs/FABER_CODE_MAPA_MODULAR_POS_SMOKE_2026-05-25.md`: mapa tecnico por camada e modulo alterado.
- `docs/FABER_CODE_PROXIMO_SMOKE_E_RISCOS_2026-05-25.md`: plano do proximo smoke manual, criterios de aceite e riscos.
- `docs/FABER_CODE_ATUALIZACOES_PROJETO_2026-05-25.md`: consolidado geral das atualizacoes.
- `docs/FABER_CODE_BRIEFING_BLUEPRINTS_2026-05-25.md`: contratos de briefing, dominios, receitas e bloqueio de placeholder.
- `docs/FABER_CODE_PREVIEW_VISUAL_AUTH_2026-05-25.md`: preview, captura visual real, validacao por viewport e callback de login.
- `docs/FABER_CODE_WORKSPACE_IDE_UX_2026-05-25.md`: ajustes de UX/UI para workspace configuravel, paineis e terminal.
- `docs/FABER_CODE_MCP_CAPABILITY_LAYER_2026-05-25.md`: camada MCP-compatible de capacidades operacionais para filesystem, terminal, browser preview e git.
- `docs/FABER_CODE_ORQUESTRADOR_CONTEXT_FRAME_2026-05-26.md`: separacao entre mensagem atual, briefing da conversa e memoria ativa/RAG/MemPalace no fluxo principal do orquestrador.
- `docs/FABER_CODE_SMOKE_TESTS_2026-05-25.md`: checklist tecnico e manual para o proximo smoke test.

## Principios permanentes

1. O briefing atual do usuario tem prioridade sobre memoria, historico e modelos antigos.
2. Memoria ativa, Cortex, RAG ou qualquer contexto anterior nao pode sobrescrever uma solicitacao nova e explicita.
3. Conteudo placeholder nao pode ser aceito como entrega final quando o usuario pediu conteudo pronto.
4. Validacao visual so pode ser marcada como aprovada quando houver captura real de preview.
5. Pedido de site completo deve gerar rotas reais quando a receita exigir multiplas paginas.
6. Toda evolucao deve respeitar a arquitetura modular, mantendo responsabilidades separadas.
7. Deploy publico e publicacao externa so acontecem por pedido explicito.
8. Commit no git so deve ser feito quando o usuario pedir.
9. Percentuais globais de maturidade nao devem ser repetidos sem smoke real manual ou automatizado equivalente.
10. Mensagem humana deve passar por intake canonico antes de qualquer decisao de rota.

## Ordem recomendada de leitura

1. `FABER_CODE_QA_EXAUSTIVO_CORRECOES_2026-05-30.md`
2. `FABER_CODE_FORGE_MRP_LOOP_AVANCOS_2026-06-02.md`
3. `FABER_CODE_HANDOFF_2026-06-02_API_LIMIT.md`
4. `FABER_CODE_STRESSTEST_FORGE_MRP_CORRECOES_2026-06-01.md`
5. `FABER_CODE_QA_HANDOFF_TECNICO_2026-05-30.md`
6. `FABER_CODE_GITHUB_DEPLOY_UX_QA_2026-05-30.md`
7. `FABER_CODE_UX_FERRAMENTAS_GIT_TERMINAL_AVANCOS_2026-05-30.md`
8. `FABER_CODE_UX_CONFIG_TERMINAL_HOME_LIGHTMODE_2026-05-30.md`
9. `FABER_CODE_V1_PRIMEIRO_SITE_ALTERACAO_REAL_2026-05-29.md`
10. `FABER_CODE_AVANCOS_COMPLETOS_2026-05-29.md`
11. `FABER_CODE_INTAKE_ROBUSTO_AVANCOS_2026-05-29.md`
12. `FABER_CODE_SMOKE_REAL_TREMN_2026-05-29.md`
13. `FABER_CODE_FERRAMENTAS_100_AVANCOS_2026-05-28.md`
14. `FABER_CODE_AVANCOS_COMPLETOS_2026-05-28.md`
15. `FABER_CODE_MEMORIA_RAG_MEMPALACE_AVANCOS_2026-05-28.md`
16. `FABER_CODE_MCP_EXTERNO_AVANCOS_COMPLETOS_2026-05-27.md`
17. `FABER_CODE_MCP_EXTERNO_BRIDGE_2026-05-27.md`
18. `FABER_CODE_BLUEPRINTS_DIVERSIDADE_VALIDACAO_2026-05-27.md`
19. `FABER_CODE_MCP_CONTRATOS_BLUEPRINTS_2026-05-27.md`
20. `FABER_CODE_AVANCOS_COMPLETOS_2026-05-27.md`
21. `FABER_CODE_AVANCOS_COMPLETOS_2026-05-25.md`
22. `FABER_CODE_AVANCOS_CONSOLIDADOS_2026-05-25.md`
23. `FABER_CODE_MAPA_MODULAR_POS_SMOKE_2026-05-25.md`
24. `FABER_CODE_PROXIMO_SMOKE_E_RISCOS_2026-05-25.md`
25. `FABER_CODE_ATUALIZACOES_PROJETO_2026-05-25.md`
26. `FABER_CODE_BRIEFING_BLUEPRINTS_2026-05-25.md`
27. `FABER_CODE_PREVIEW_VISUAL_AUTH_2026-05-25.md`
28. `FABER_CODE_WORKSPACE_IDE_UX_2026-05-25.md`
29. `FABER_CODE_MCP_CAPABILITY_LAYER_2026-05-25.md`
30. `FABER_CODE_ORQUESTRADOR_CONTEXT_FRAME_2026-05-26.md`
31. `FABER_CODE_SMOKE_TESTS_2026-05-25.md`

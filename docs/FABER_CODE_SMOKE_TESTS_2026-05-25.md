# Faber Code - Checklist de Smoke Tests 2026-05-25

Este documento registra os testes automatizados e os criterios manuais recomendados para o proximo pre-smoke/smoke test do Faber Code.

## Estado de commit

O commit deve acontecer apenas quando o usuario pedir. O ultimo commit confirmado e `30e163c Fortalece contratos e workspace apos smoke tests`.

Depois desse commit, existem mudancas locais sem commit para smoke tests 34 a 42, MCP-compatible capability layer, novas recipes/gramaticas e correcao pos-briefing Lumen Lab. O proximo commit deve acontecer apenas depois de novo smoke manual real.

## Resultado real do smoke manual 32/33

### Teste 32 - Aurea IP & Patentes

Falhou primeiro sem criar nada. Na insistencia, criou artefato com baixa identidade propria e sinais de blueprint generico, distante do briefing de propriedade intelectual.

### Teste 33 - Linea Bosco Revestimentos

Travou, gerou erros/timeout de preview e reutilizou memoria de smoke antigo (`Studio Habitat` / `Helena Duarte Arquitetura`). O resultado final ficou semanticamente errado para o briefing de revestimentos de madeira e paginas internas ficaram rasas.

### Implicacao

Os gates e contratos deste ciclo precisam ser tratados como mecanismos em evolucao. O proximo smoke deve verificar especificamente:

- ausencia de memoria antiga em briefings novos e completos;
- marca e dominio corretos;
- rotas reais para site completo;
- captura real ou falha honesta de preview;
- bloqueio de blueprint generico quando o briefing pede conteudo final.

## Comandos automatizados

Rodar na raiz do projeto:

```bash
cd "<repo-root>"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 24.15.0
npm run test:briefing-spec
npm run test:project-blueprint
npm run test:project-preview
npm run test:project-preview-runtime
npm run test:project-visual-validation-runtime
npm run test:platform-backend
npm run test:smoke-scenarios
npm run test:renderer-workspace-layout
npm run test:renderer-module-contract
npm run test:renderer-ai-settings
npm run test:renderer-terminal
npm run test:window-chrome-css
npm run test:renderer-panel-layout
```

## Rodar o app

```bash
cd "<repo-root>"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 24.15.0
npm install
npm run dev
```

## Smoke scenarios obrigatorios

### Smoke automatizado atual

O smoke automatizado atual passou com 27 cenarios:

- `greenhouse_create_preview`
- `gardening_overrides_stale_greenhouse`
- `long_briefing_create_not_search`
- `teste_30_import_services_landing`
- `teste_31_helena_architecture_site`
- `teste_32_aurea_ip_patentes`
- `teste_33_linea_bosco_revestimentos`
- `teste_34_vitrapure_garrafas_vidro`
- `teste_35_alumivance_esquadrias_fachadas`
- `teste_36_aurora_di_vento_vinhos`
- `teste_37_materiais_construcao`
- `teste_38_nexaflow_desk_saas`
- `teste_39_voxlumen_revista_editorial`
- `teste_40_cacau_nobre_chocolate`
- `teste_41_atlasport_import_services`
- `teste_42_lumen_lab_photo_lab`
- `wood_sculpture_video_hero`
- `empty_project_briefing_continuation`
- `deterministic_patch_existing_project`
- `visual_review_no_file_changes`
- `active_memory_continuation`
- `provider_failure_controlled`
- `preview_capture_unavailable`
- `harmful_request_blocked`
- `current_briefing_contract_escalation`
- `route_contract_conflict`
- `search_project_local`

O cenario `teste_42_lumen_lab_photo_lab` valida dominio `photo-lab`, recipe `photographic-lab-site`, gramatica `sensory-immersive-story`, preservacao de marca e ausencia de fallback de madeira/placeholder.

### Briefing Aurea IP & Patentes

O briefing de propriedade intelectual deve gerar landing page especifica, com:

- marca `Aurea IP & Patentes`;
- hero de protecao estrategica de ideias/patentes;
- video ou midia full width quando solicitado;
- busca de anterioridade;
- redacao e deposito de pedido de patente;
- registro de marcas;
- protecao internacional;
- especialista/institucional;
- processo;
- formulario ou CTA de consultoria.

Nao pode reutilizar `Escritorio Faber Advocacia`, `Studio Habitat`, `Helena Duarte Arquitetura` ou copy generica de atendimento placeholder.

### Briefing Linea Bosco Revestimentos

O briefing de revestimentos de madeira deve gerar site completo especifico, com:

- marca `Linea Bosco Revestimentos`;
- home com madeira natural, pisos, paineis ripados, decks e acabamentos;
- rotas reais para produtos, pisos, paineis, decks, projetos, inspiracoes e contato;
- carrossel/texturas de madeira quando solicitado;
- formulario de orcamento qualificado;
- tom visual premium/minimalista coerente com arquitetura de interiores e madeira.

Nao pode cair no dominio de arquitetura generica nem reutilizar `Studio Habitat` ou `Helena Duarte Arquitetura`.

### Briefing de importacao

O briefing de importacao deve gerar uma landing page especifica, sem placeholder, com:

- promessa clara no hero;
- CTA para cotacao ou especialista;
- dores de importacao;
- solucao;
- servicos;
- processo;
- tipos de importacao;
- diferenciais;
- prova social;
- formulario qualificado;
- FAQ;
- WhatsApp;
- footer.

### Briefing Helena Duarte Arquitetura

O briefing de arquitetura deve gerar site completo com:

- marca correta quando especificada;
- hero aderente;
- midia ou video quando solicitado;
- sobre;
- manifesto;
- servicos;
- projetos/cases;
- processo;
- insights/blog;
- contato;
- depoimentos;
- rotas reais quando o pedido for site completo.

### Briefing Lumen Lab Fotografico

O briefing de laboratorio fotografico deve gerar site institucional/landing premium com:

- marca `Lumen Lab Fotografico` ou a marca informada no briefing;
- dominio `photo-lab`;
- hero full-bleed com video/foto de laboratorio, darkroom, negativos ou impressao fine art;
- header com CTA `Enviar arquivos`;
- servicos de revelacao, digitalizacao, impressao fine art, restauracao, ampliacoes e atendimento para fotografos;
- sobre do laboratorio;
- processo de envio, analise, producao e entrega;
- galeria/portfolio;
- depoimentos;
- FAQ;
- formulario de orcamento;
- footer contextual.

Nao pode cair em:

- `Faber Projeto`;
- `Atendimento placeholder premium`;
- texto placeholder de hierarquia;
- dominio de arquitetura, madeira, construcao ou atendimento digital generico;
- menu mobile sem hamburger funcional.

### Preview manual

Quando o usuario ja rodar o projeto manualmente em `127.0.0.1:3000`, a validacao deve conseguir adotar esse preview ou explicar claramente por que nao conseguiu.

### Captura real

Sem captura real de preview, o resultado nao pode ser marcado como visualmente aprovado.

### Placeholder

Se o usuario pediu conteudo final, a presenca de placeholder deve bloquear antes de aplicar ou concluir.

### Reparo grande

Quando a falha for baixa aderencia ao briefing ou placeholder estrutural, o sistema deve regenerar a partir do checkpoint de briefing e nao tentar aplicar um patch incremental gigante.

### Workspace IDE

Conferir manualmente:

- recolher painel esquerdo;
- recolher painel direito;
- recolher os dois paineis;
- restaurar paineis;
- abrir configuracoes;
- alterar modo de uso;
- verificar que preferencias refletem no layout;
- conferir fallback central sem projeto;
- abrir terminal;
- verificar que a area central nao some.

### Login

Conferir manualmente:

- abrir login com Google;
- concluir callback;
- verificar pagina externa com marca FaberCode;
- confirmar texto simples de sucesso;
- confirmar que a aba pode ser fechada sem deixar tela branca confusa;
- confirmar que o app recebe a sessao.

## Riscos a observar

- Captura visual ainda depende de runtime de preview e pode falhar por timeout.
- Ajustes de workspace ainda precisam amadurecer para drag and drop real.
- Geracao de dominios novos ainda depende de contratos/recipes novos.
- O gate de placeholder precisa continuar evoluindo para detectar textos genericos em dominios variados.

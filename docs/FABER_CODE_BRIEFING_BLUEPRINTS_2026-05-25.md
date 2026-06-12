# Faber Code - Briefing, Contratos e Blueprints 2026-05-25

Este documento registra a evolucao feita na camada de compreensao de briefing, contratos de produto e geracao de blueprints.

## Problema diagnosticado

Os smoke tests anteriores mostraram que o Faber Code ainda podia gerar uma composicao generica quando recebia briefings longos, mesmo quando o usuario entregava marca, tom, estrutura, secoes, copy, tipografia, cores e requisitos tecnicos.

A falha principal nao era apenas visual. O problema estava na cadeia de decisao:

- O briefing atual nem sempre vencia memorias antigas ou receitas genericas.
- Dominios sem receita forte caiam em fallback silencioso.
- Conteudo placeholder podia passar como entrega aceitavel.
- Pedido de site completo podia virar uma unica pagina simplificada.
- Reparos grandes eram tratados como patch incremental, causando bloqueios como `safe_patch_rewrite_ratio_too_large`.

## Objetivo da correcao

Ajustar o sistema para que ele trate o briefing atual como contrato de produto, gere uma composicao aderente ao dominio e bloqueie resultado generico quando o usuario pediu conteudo final.

## Modulos envolvidos

- `cortex/orchestration/briefing_spec_service.js`
- `cortex/orchestration/briefing_contract_service.js`
- `cortex/orchestration/working_brief_service.js`
- `cortex/orchestration/briefing_service.js`
- `cortex/orchestration/project_blueprint_manifest_service.js`
- `cortex/orchestration/project_blueprint_service.js`
- `cortex/orchestration/project_blueprint_request.js`
- `cortex/orchestration/project_blueprint_copy.js`
- `cortex/orchestration/project_blueprint_layout.js`
- `cortex/orchestration/project_blueprint_next_templates.js`
- `cortex/orchestration/project_blueprint_coverage_contract.js`
- `cortex/orchestration/blueprint_icon_registry.js`
- `cortex/orchestration/artifact_quality_service.js`
- `cortex/orchestration/product_contract_service.js`
- `cortex/orchestration/product_orchestrator_service.js`
- `cortex/orchestration/product_policy_gate_service.js`
- `cortex/orchestration/render_pass_service.js`

## Decisoes implementadas

### Prioridade do briefing atual

O pedido atual do usuario deve ter precedencia sobre:

- historico de conversa;
- memorias ativas;
- exemplos antigos;
- receitas genericas;
- composicoes placeholder.

Memoria ativa deve ser usada como apoio contextual, nao como fonte dominante quando o usuario fornece um briefing completo.

### Escalacao de contrato

Quando o dominio ou a estrutura pedida nao estiverem cobertos por contrato/recipe suficiente, o fluxo deve escalar para proposta de contrato ou bloquear a geracao inadequada.

Isso evita o comportamento anterior de responder com um site visualmente montado, mas semanticamente errado.

### Fixtures de smoke nao viram contrato

Nomes ficticios usados em testes, marcas temporarias e empresas criadas para validar prompts nao devem ser copiados para contratos, fallbacks, detectores, recipes ou copy builders permanentes.

Quando um smoke test expuser uma lacuna, a correcao deve virar uma capacidade generica reutilizavel. O nome do teste fica restrito ao arquivo de teste/fixture, enquanto o runtime recebe apenas categorias como produto sustentavel com catalogo, servico tecnico B2B multipagina, portfolio editorial, SaaS operacional ou outra capacidade modular real.

### Gramaticas visuais modulares

Cada recipe de blueprint deve declarar tambem uma gramatica visual. A recipe define cobertura e ordem funcional; a gramatica visual define espinha dorsal, ritmo, densidade, hero, navegacao, familia de secoes e intencao visual.

O objetivo e impedir que dominios diferentes usem a mesma estrutura com textos trocados. Contratos validos devem escolher entre espinhas dorsais reutilizaveis como:

- produto premium com mosaico comercial;
- servico tecnico B2B com matriz operacional;
- portfolio editorial de autoridade;
- atelier catalogo artesanal;
- historia sensorial imersiva;
- sistema agro/jardinagem comercial;
- comando de importacao e logistica;
- workspace SaaS operacional;
- hub editorial de conteudo;
- editorial modular padrao.

Dois smokes de dominios diferentes devem poder provar, por contrato e por artefato renderizado, que receberam gramaticas visuais diferentes.

### Blueprint inicial completa

Quando o usuario pedir um projeto, site ou pagina completa, a primeira etapa do Faber Code nao deve entregar um rascunho raso. O correto e montar uma composicao inicial completa e ajustavel: contrato de briefing, gramatica visual, recipe funcional, modulos de hero/secoes/rotas/formularios/prova/FAQ/footer e validacao de cobertura.

O objetivo desta fase do produto e que o usuario receba um projeto coerente para ajustar depois, trocando fotos, textos, precos, depoimentos e integracoes. A ausencia de conteudo final nao autoriza fallback generico; deve haver estrutura completa, copy contextual e placeholders editaveis quando o briefing permitir.

### Recipes de dominio

Foram adicionados ou aprofundados dominios de blueprint:

- `import-services`
- `architecture`
- `gardening`
- `greenhouses`
- `sustainable-product-landing`
- `technical-b2b-services-site`
- `premium-wine-landing`
- `construction-materials-site`
- `chocolate`
- `saas-tool`
- `editorial-content`
- `photo-lab`

Relacao com smoke tests recentes:

- Teste 34: produto sustentavel com catalogo, fixture `VitraPure`, categoria runtime `sustainable-product-landing`.
- Teste 35: servicos tecnicos B2B multipagina, fixture `Alumivance`, categoria runtime `technical-b2b-services-site`.
- Teste 36: vinhos premium sensoriais, fixture `Aurora di Vento`, categoria runtime `premium-wine-landing`.
- Teste 37: materiais de construcao multipagina, fixture `Constrular Prime`, categoria runtime `construction-materials-site`.
- Teste 38: SaaS/ferramenta operacional, fixture `NexaFlow Desk`, categoria runtime `saas-tool`.
- Teste 39: conteudo editorial, fixture `VoxLumen Revista`, categoria runtime `editorial-content`.
- Teste 40: food/sensorial, fixture `Cacau Nobre Atelier`, categoria runtime `chocolate`.
- Teste 41: importacao/servicos, fixture `AtlasPort Importacoes`, categoria runtime `import-services`.
- Teste 42: laboratorio fotografico, fixture `Lumen Lab Fotografico`, categoria runtime `photo-lab`.

Esses nomes de fixture nao devem ser usados como fallback permanente. O runtime deve preservar apenas a capacidade generica.

A receita de importacao cobre landing page com:

- hero;
- dores do cliente;
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

A receita de arquitetura cobre site completo com:

- marca do escritorio;
- hero;
- video ou midia equivalente;
- sobre;
- manifesto;
- servicos;
- cases/projetos;
- processo;
- diferenciais;
- depoimentos;
- insights/blog;
- contato;
- rotas internas.

A receita de laboratorio fotografico cobre site institucional/landing premium com:

- hero full-bleed com video ou foto de laboratorio/darkroom;
- header com CTA `Enviar arquivos`;
- servicos de revelacao, digitalizacao, impressao fine art, restauracao, ampliacoes e atendimento profissional;
- sobre do laboratorio;
- processo de envio, analise, producao e entrega;
- galeria/portfolio de resultados;
- depoimentos;
- FAQ;
- formulario de orcamento;
- footer contextual.

Briefings autocontidos que comecam como `Briefing completo - Site...` devem ser roteados como criacao inicial quando houver dominio, estrutura visual e secoes suficientes, mesmo que o verbo `crie/criar` nao apareca no primeiro paragrafo.

### Site completo e rotas

Quando o pedido for site completo e a recipe exigir multiplas paginas, o blueprint deve gerar rotas reais, como:

- `app/sobre`
- `app/servicos`
- `app/projetos`
- `app/processo`
- `app/insights`
- `app/contato`

Landing pages continuam podendo ser pagina unica, desde que entreguem as secoes prometidas.

## Gate de placeholder

A entrega deve ser bloqueada quando o usuario pedir conteudo final e o artefato ainda contiver sinais de placeholder, como:

- `placeholder`;
- `conteudo provisorio`;
- `pronta para evoluir`;
- `Faber Projeto`;
- FAQ generico;
- formulario raso;
- marca errada;
- dominio errado;
- copy sem relacao com o briefing.

## Reparo correto

Quando a falha for baixa aderencia ou placeholder, o caminho correto e regenerar a partir do checkpoint de briefing, nao tentar transformar a troca inteira em patch incremental deterministico.

O patch seguro continua importante para edicoes pequenas. Para mudancas estruturais grandes, a rota deve ser regeneracao controlada.

## Criterios de aceite

- Briefings longos precisam virar especificacoes utilizaveis.
- O dominio detectado precisa aparecer no produto gerado.
- A marca solicitada pelo usuario precisa ser preservada.
- Secoes prometidas precisam aparecer no artefato.
- Conteudo final nao pode conter placeholder.
- Site completo precisa gerar rotas quando aplicavel.
- Fallback generico deve ser excecao controlada, nao caminho padrao.

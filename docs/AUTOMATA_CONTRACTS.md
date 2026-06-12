# Automata Contracts

Automata Contracts é o nome oficial da camada de micro-contratos do Faber Code.

Ela reaproveita o nome legado `automata` para representar contratos pequenos, previsíveis e testáveis entre a intenção interpretada pela IA e o executor local.

## Função

Os contratos existem para evitar que pedidos pequenos caiam no fluxo gerativo inteiro quando já podem ser traduzidos para uma operação técnica segura.

Exemplos:

- trocar `#257066` por `#4293c2`;
- trocar textos verdes para vermelho;
- alterar CTA principal;
- sincronizar navegação depois de inserir seção;
- recuperar preview quando `next` não existe ou o Node está incompatível.

## Grupos

### `core_contract`

Contratos aprovados como parte do produto.

O registry inicial contém 25 contratos aprovados. Alguns já podem estar ativos no runtime, outros ficam como `planned` até receberem resolver determinístico e testes.

### `suggest_blueprint`

Contratos sugeridos pela IA durante o uso real.

Esse grupo é local por usuário e deve ser tratado como dados, nunca como código executável. A IA pode sugerir um contrato quando encontrar uma demanda recorrente ou uma intenção que ainda não tem contrato core.

Regras:

- não pode conter `code`, `commands`, `script`, `resolverPath` ou campos executáveis;
- não pode escrever arquivos nem rodar comandos;
- precisa de promoção explícita para virar contrato core;
- precisa de testes antes de ficar ativo.

## Promoção

Um contrato sugerido agora passa pelo **Automata Contract Ledger**, uma trilha local parecida com Git:

1. `suggest_blueprint`: observado e salvo localmente.
2. `staged`: aprovado pelo usuário para teste, ainda sem virar comportamento fixo.
3. `trial_running`: em teste prático dentro de um projeto.
4. `trial_passed` ou `trial_failed`: resultado marcado pelo usuário depois do smoke test.
5. `local_active`: promovido pelo usuário para integrar os contratos locais da instalação.
6. `local_disabled` ou `rejected`: removido do uso ativo sem apagar o histórico.

Na UI, a IA explica a proposta em linguagem natural e mostra um mini expansor com o JSON do contrato. O botão `Contratos`, ao lado de `Executar`, lista itens staged para marcar se funcionaram e fazer push local.

## Princípio

A IA pode criar propostas de contrato, mas não pode instalar comportamento executável invisível.

O produto aprende com o usuário, mas o runtime continua determinístico, auditável e seguro.

## Regra anti-fixture

Nomes, marcas, empresas, pessoas, endereços e copies criados apenas para smoke tests são fixtures de regressão, não contratos permanentes.

Um smoke test pode usar nomes fictícios para provar aderência ao briefing, mas esses nomes não podem ser promovidos diretamente para:

- `DOMAIN_PROFILES`;
- `DOMAIN_OVERRIDES`;
- `brandFallback`;
- detectores de domínio;
- recipes/blueprints de runtime;
- copy builders;
- documentação de estado do produto como se fossem capacidades estáveis.

Quando um smoke revelar uma lacuna, a correção deve extrair a capacidade genérica por trás do teste. Exemplo: em vez de criar um contrato permanente para uma marca fictícia específica, criar uma categoria reutilizável como produto sustentável com catálogo, serviço técnico B2B multipágina, marketplace, SaaS operacional, portfólio editorial ou landing de captação.

A promoção correta é: observar o comportamento, nomear a capacidade genérica, criar contrato ou recipe modular reutilizável, cobrir com teste e só então manter no runtime. O nome fictício do smoke deve permanecer apenas em testes, fixtures ou anexos de diagnóstico.

### Regra de blueprint inicial completa

Pedidos de projeto, site ou página completa devem ser tratados como montagem modular completa pelo Faber Code. O fluxo deve selecionar contrato de briefing, gramática visual, recipe funcional e módulos suficientes para entregar uma primeira versão ajustável, com hero, seções profundas, CTAs, prova, FAQ, formulário, footer e rotas quando fizer sentido.

O usuário deve ajustar depois textos, fotos, preços, depoimentos e integrações. Ele não deve receber uma estrutura rasa que ainda dependa dele para virar site.

### Regra MCP-compatible

MCP e adapters equivalentes devem ser tratados como camada de capacidades operacionais, não como substitutos dos contratos Automata.

Automata continua responsável por intenção, permissão, risco, confirmação, domínio, recipe, blueprint, memória permitida e critérios de aceite. A camada de capacidades executa operações como filesystem, terminal, browser preview, captura visual, Git e futuras integrações, sempre com `projectSession` explícito e evidência estruturada.

Nenhuma capability pode executar sem raiz de projeto autorizada. Nenhuma resposta de ferramenta pode ser considerada conclusão de produto sem passar pelos gates de contrato, qualidade e validação visual.

### Regra MCP como guardiao de contrato

Quando uma capability MCP validar ou promover contratos, ela deve operar como guardiao auditavel, nao como origem soberana de decisao.

Fluxo permitido:

1. Cortex/Automata monta ou resolve o contrato de produto/blueprint.
2. MCP executa `validate` contra contrato, source policy, rotas, DOM metrics e artefatos.
3. MCP registra evidencia em `.faber/capabilities/<capability>.jsonl`.
4. Se houver violacao objetiva conhecida, MCP pode gerar `repair` e revalidar.
5. Se validado, MCP pode sugerir contrato ao Automata Contract Ledger.
6. Promocao exige passagem por `suggest_blueprint`, `staged`, `trial_running`, `trial_passed` e `local_active`.

O MCP nao pode promover contrato invalido, nao pode usar memoria antiga para completar briefing autocontido e nao pode instalar comportamento executavel invisivel.

Capability atual:

```text
blueprint_contract
```

Acoes atuais:

```text
validate
repair
suggest
stage
trial
promote
```

### Regra de diversidade e adaptabilidade de blueprint

Blueprints nao devem ser promovidas apenas por passar em um caso feliz ou por gerar uma pagina visualmente aceitavel em desktop.

Para uma familia de blueprint ser considerada madura, ela deve demonstrar:

- preservacao da marca e do dominio do briefing atual;
- ausencia de contaminacao por memoria antiga;
- recipe e gramatica visual coerentes com a finalidade;
- header responsivo com tablet/mobile seguros;
- icones, prova social/testimonials e footer modular quando a pagina completa exigir;
- cobertura de contrato sem lacunas obrigatorias;
- source policy aprovada;
- smoke visual representativo em desktop, tablet e mobile.

A rodada `d4a2d91` adicionou uma matriz permanente de 18 briefings, 14 recipes e 12 gramaticas visuais em `test:project-blueprint`, alem de ampliar `mcp_blueprint_contract_briefing_matrix` para 9 casos.

Mesmo assim, a promocao de uma nova familia visual deve continuar exigindo evidencia proporcional ao risco. Uma amostra visual representativa nao substitui artifact store permanente para todas as combinacoes criticas.

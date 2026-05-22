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

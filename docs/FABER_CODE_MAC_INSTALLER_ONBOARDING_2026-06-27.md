# Faber Code - instalador Mac e onboarding inicial

Data: 2026-06-27

## Decisao

O artefato de distribuicao para usuarios Mac deve ser um `.dmg`, nao apenas a pasta `release/mac-arm64/Faber Code.app`.

O `.dmg` mostra o app e o atalho para `/Applications`, permitindo que o usuario arraste o Faber Code para a pasta Aplicativos. Depois disso, o icone aparece no Launchpad/Finder como qualquer app instalado.

## Comandos

Build de desenvolvimento em pasta:

```bash
npm run pack:mac
```

Instalador para distribuicao:

```bash
npm run dist:mac
```

O instalador sera gerado em:

```text
release/Faber Code-0.1.0-arm64.dmg
```

## Onboarding

As escolhas de produto ficam dentro do app, na primeira tela antes do login:

- idioma
- tema claro ou escuro
- sou um novo usuario
- ja sou um usuario

Essa abordagem evita gravar estado de produto no instalador e permite progressive disclosure:

- novo usuario abre diretamente o cadastro por e-mail com preferencias iniciais
- usuario existente abre as opcoes de login por e-mail, Google ou GitHub

## Configuracao externa

A configuracao externa em `~/Library/Application Support/Faber Code/.env` continua necessaria para o app instalado encontrar segredos e endpoints sem depender da pasta do projeto ou de variaveis do terminal.

Nao coloque segredos diretamente dentro do `.dmg` ou do `.app` distribuido.

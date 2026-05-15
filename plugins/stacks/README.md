# Faber Code Stack Profiles

Esta pasta recebe perfis declarativos de stack em JSON. Eles permitem que o Faber Code reconheca arquiteturas adicionais sem executar codigo de terceiros.

Exemplo minimo:

```json
{
  "id": "astro",
  "label": "Astro",
  "category": "web",
  "detect": {
    "packageDependencies": ["astro"],
    "fileExtensions": [".astro"]
  },
  "preview": {
    "mode": "server",
    "script": "dev",
    "defaultPort": 4321
  },
  "blueprint": {
    "targetFile": "src/pages/index.astro",
    "requiredFiles": ["package.json", "src/pages/index.astro"],
    "promptGuidance": [
      "Para Astro, gerar package.json e src/pages/index.astro como baseline inicial."
    ],
    "operations": [
      {
        "op": "write_file",
        "path": "package.json",
        "content": "{\n  \"private\": true,\n  \"name\": \"{{brandSlug}}\"\n}\n"
      },
      {
        "op": "write_file",
        "path": "src/pages/index.astro",
        "content": "<main><h1>{{brandHtml}}</h1></main>\n"
      }
    ]
  }
}
```

Tambem e possivel adicionar perfis por projeto em `.faber/stacks/*.json`. O registry le apenas JSON, limita quantidade/tamanho dos arquivos e ignora perfis invalidos ou que tentem sobrescrever IDs built-in.

Campos de blueprint aceitos nesta etapa:

- `operations`: lista declarativa com `write_file`, `append_file` ou `mkdir`.
- `targetFile`: arquivo principal exibido na acao.
- `requiredFiles`: arquivos esperados para validar cobertura minima do blueprint.
- `promptGuidance`: orientacao textual adicional para a IA.

Templates simples em `content`: `{{brand}}`, `{{brandHtml}}`, `{{brandJson}}` e `{{brandSlug}}`.

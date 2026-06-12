# Faber Code Stack Profiles

This folder contains declarative stack profiles in JSON. Stack profiles let Faber Code recognize additional project architectures without executing third-party code.

Minimal example:

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

Project-level profiles can also be added in `.faber/stacks/*.json`. The registry reads JSON only, limits file count and file size, and ignores invalid profiles or profiles that try to override built-in IDs.

Supported blueprint fields at this stage:

- `operations`: declarative list using `write_file`, `append_file` or `mkdir`.
- `targetFile`: main file displayed for the action.
- `requiredFiles`: expected files used to validate minimum blueprint coverage.
- `promptGuidance`: additional text guidance for the AI.

Simple templates supported in `content`: `{{brand}}`, `{{brandHtml}}`, `{{brandJson}}` and `{{brandSlug}}`.

Stack profiles are intentionally constrained. They describe detection, preview and baseline generation behavior; they must not contain arbitrary shell commands, API keys or environment-specific secrets.

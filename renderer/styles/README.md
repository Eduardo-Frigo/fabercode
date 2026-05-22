# Renderer UI Styles

`renderer/styles.css` is the stylesheet entrypoint and must stay import-only.
Keep module order stable because later files intentionally override earlier
tokens and component defaults.

- `core.css`: base tokens, shell layout, shared panels, composer, welcome state, and responsive shell rules.
- `project-shell.css`: project list, conversation tree, archived/trash project modals, and related sidebar states.
- `account-gate.css`: startup preloader, forced login gate, and platform account access screens.
- `workspace-tools.css`: file tree, file editor, terminal panel, and local project tool surfaces.
- `legacy-overrides.css`: import-only compatibility layer for the split legacy chunks in `styles/legacy/`.
- `settings.css`: AI/API/settings modal surfaces.
- `ui-overrides.css`: compact typography, rename/input dialogs, and late-stage UI polish.
- `cortex.css`: Cortex memory/rules modal.
- `system-shell.css`: native window drag region, resizable panels, theme switching, light/dark logos, and appearance settings.

When adding a new UI surface, prefer the closest module above. Create a new
module only when the surface has a clear ownership boundary and update
`tests/window-chrome-css.test.js` with the expected import order.

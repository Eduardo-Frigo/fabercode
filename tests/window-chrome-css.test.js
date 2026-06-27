const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rendererDir = path.join(__dirname, '..', 'renderer');
const styleEntrypoint = 'styles.css';
const expectedStyleModules = [
  './styles/core.css',
  './styles/state-surfaces.css',
  './styles/project-shell.css',
  './styles/account-gate.css',
  './styles/workspace-tools.css',
  './styles/workspace-layout.css',
  './styles/legacy-overrides.css',
  './styles/settings.css',
  './styles/ui-overrides.css',
  './styles/cortex.css',
  './styles/automata-contracts.css',
  './styles/system-shell.css',
];

function readRendererFile(relativePath) {
  return fs.readFileSync(path.join(rendererDir, relativePath), 'utf8');
}

function normalizeImportPath(relativePath, importPath) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), importPath));
}

function readCssWithImports(relativePath, seen = new Set()) {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  assert.ok(!seen.has(normalizedPath), `CSS import cycle detected at ${normalizedPath}`);
  seen.add(normalizedPath);

  const source = readRendererFile(normalizedPath);
  return source.replace(/@import\s+url\(["']?(.+?)["']?\)\s*;/g, (_match, importPath) =>
    readCssWithImports(normalizeImportPath(normalizedPath, importPath), seen)
  );
}

const styleEntrypointSource = readRendererFile(styleEntrypoint);
const indexHtml = readRendererFile('index.html');
const appSource = readRendererFile('app.js');
const welcomeQuotesSource = readRendererFile('welcome_quotes.js');
const criticalPreloader = readRendererFile('styles/preloader-critical.css');
const blockedWelcomeQuotePattern = new RegExp(['\\u0075nexamined', '\\u0065xaminad[ao]\\b'].join('|'), 'i');
const importedModules = [...styleEntrypointSource.matchAll(/@import\s+url\(["']?(.+?)["']?\)\s*;/g)].map(
  (match) => match[1]
);

assert.ok(
  indexHtml.indexOf('./styles/preloader-critical.css') >= 0 &&
    indexHtml.indexOf('./styles/preloader-critical.css') < indexHtml.indexOf('./styles.css'),
  'critical preloader stylesheet must load before the main renderer stylesheet'
);
assert.match(
  criticalPreloader,
  /\.startup-preloader\s*\{[^}]*position\s*:\s*fixed\s*!important\s*;[^}]*inset\s*:\s*0\s*!important\s*;[^}]*place-items\s*:\s*center\s*!important\s*;/s,
  'critical preloader CSS must center the startup loader before modular CSS finishes loading'
);
assert.match(
  criticalPreloader,
  /\.startup-preloader__bar\s+span\s*\{[^}]*animation\s*:\s*faber-preloader-critical\s+1\.1s\s+ease-in-out\s+infinite\s*;/s,
  'critical preloader bar must animate before the main renderer stylesheet finishes loading'
);
assert.match(
  criticalPreloader,
  /@keyframes\s+faber-preloader-critical\b/s,
  'critical preloader animation keyframes must be available in the critical stylesheet'
);
assert.match(
  criticalPreloader,
  /\.startup-preloader__logo-img\.is-animating\s*\{[^}]*animation\s*:\s*faber-preloader-logo-once/s,
  'critical preloader logo should animate at least once from the runtime animation class before the app opens'
);
assert.match(
  criticalPreloader,
  /@keyframes\s+faber-preloader-logo-once\b/s,
  'critical preloader logo animation keyframes must be available in the critical stylesheet'
);
const startupPreloaderSource = readRendererFile('startup_preloader.js');
assert.match(
  startupPreloaderSource,
  /waitForLogoAnimation/,
  'startup preloader controller must wait for the one-shot logo animation before hiding'
);
assert.match(
  startupPreloaderSource,
  /logoAnimationClass\s*=\s*options\.logoAnimationClass\s*\|\|\s*'is-animating'[\s\S]*classList\.add\(logoAnimationClass\)/,
  'startup preloader controller must start the logo animation at runtime'
);

assert.deepStrictEqual(
  importedModules,
  expectedStyleModules,
  'renderer/styles.css must load UI CSS modules in the agreed architecture order'
);
assert.doesNotMatch(
  styleEntrypointSource.replace(/@import\s+url\(["']?.+?["']?\)\s*;/g, '').trim(),
  /[{}]/,
  'renderer/styles.css should remain an import-only stylesheet entrypoint'
);

for (const modulePath of expectedStyleModules) {
  assert.ok(
    fs.existsSync(path.join(rendererDir, modulePath.replace('./', ''))),
    `${modulePath} must exist as a renderer CSS module`
  );
}

const styles = readCssWithImports(styleEntrypoint);

function getRuleBlocks(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...styles.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g'))].map((match) => match[1]);
}

const dragRegionBlocks = getRuleBlocks('.app-drag-region');
assert.ok(dragRegionBlocks.length > 0, 'app-drag-region CSS rule should exist');

const finalDragRegionBlock = dragRegionBlocks[dragRegionBlocks.length - 1];
assert.match(
  finalDragRegionBlock,
  /-webkit-app-region\s*:\s*drag\s*!important\s*;/,
  'app drag region should own the native drag hitbox'
);
assert.match(
  finalDragRegionBlock,
  /pointer-events\s*:\s*auto\s*;/,
  'app drag region must receive pointer hit-testing'
);
assert.doesNotMatch(
  finalDragRegionBlock,
  /pointer-events\s*:\s*none\s*;/,
  'app drag region cannot opt out of pointer hit-testing'
);

for (const block of dragRegionBlocks) {
  assert.doesNotMatch(block, /-webkit-app-region\s*:\s*no-drag/, 'app drag region cannot be marked no-drag');
}

assert.match(
  styles,
  /--panel-font-scale\s*:\s*1\s*;/,
  'panel font scale token should exist for appearance settings'
);
assert.match(
  styles,
  /body\[data-theme='dark'\][^{]*\{[^}]*color\s*:\s*#e8e4df\s*!important\s*;/s,
  'dark theme should use the requested Faber typography color'
);
assert.match(
  styles,
  /body\[data-theme='light'\][^{]*\{[^}]*--text\s*:\s*#212121\s*!important\s*;/s,
  'light theme should use the requested typography color token'
);
assert.match(
  styles,
  /body\[data-theme='light'\]\s+\.app-shell\s*\{[^}]*radial-gradient/s,
  'light theme should override the app background after dark legacy overrides'
);
assert.match(
  styles,
  /body\[data-theme='light'\]\s+\.left-action-btn\s+\.action-icon::before\s*\{[^}]*color\s*:\s*#212121\s*!important\s*;/s,
  'light theme should keep the new-project add icon visible'
);
assert.match(
  styles,
  /body\[data-theme='light'\]\s+\.startup-preloader/s,
  'light theme should explicitly restyle the preloader surface for swapped logos'
);
assert.match(
  styles,
  /#center-title\s*\{[^}]*text-transform\s*:\s*none\s*;/s,
  'center session header should render the active conversation title instead of an uppercase placeholder'
);
assert.match(
  styles,
  /#center-title\.center-title--editable\s*\{[^}]*cursor\s*:\s*text\s*;/s,
  'center session title should signal inline editing when a conversation is active'
);
assert.match(
  styles,
  /\.center-title-input\s*\{[^}]*font\s*:\s*inherit\s*;/s,
  'center session title should become an inline input when clicked'
);
assert.match(
  styles,
  /\.panel-center\.panel-center--has-title\s*>\s*\.panel-header\s*\{[^}]*display\s*:\s*flex\s*;/s,
  'center header should become visible when the renderer has an active title'
);
assert.match(
  appSource,
  /function\s+getActiveConversation\(\)[\s\S]*state\.projectConversations\[projectId\][\s\S]*function\s+renderCenterTitle\(\)[\s\S]*center-title--editable/,
  'renderer should derive and expose the center header from the active conversation title'
);
assert.match(
  appSource,
  /function\s+editActiveConversationTitle\(\)[\s\S]*document\.createElement\('input'\)[\s\S]*saveConversationTitle/,
  'clicking the center title should edit the conversation title in place'
);
assert.match(
  appSource,
  /hydrateWelcomeQuoteHistoryFromSettings[\s\S]*welcomeQuoteLastAuthor[\s\S]*persistWelcomeQuoteHistory/,
  'welcome quotes should persist the last author through runtime settings across app launches'
);
assert.match(
  styles,
  /\.welcome-panel\s*\{[^}]*place-items\s*:\s*center\s*;/s,
  'welcome panel should keep the start logo centered without action cards pulling focus'
);
assert.doesNotMatch(
  indexHtml,
  /id="welcome-start-conversation"|id="welcome-new-project"/,
  'welcome screen should not show action buttons below the Faber Code logo'
);
assert.match(
  styles,
  /\.welcome-panel--animate\s+\.welcome-panel__quote\s*\{[^}]*animation\s*:\s*welcome-fade-up/s,
  'welcome panel should show a delayed quote below the centered logo'
);
assert.match(
  styles,
  /\.welcome-panel__quote\s+blockquote\s*\{[^}]*font-size\s*:\s*1\.15rem\s*;/s,
  'welcome quote text should be 25 percent larger than the earlier compact size'
);
assert.match(
  styles,
  /\.welcome-panel__quote\s+blockquote\.is-typing::after/s,
  'welcome quote should include a writing cursor during the typewriter animation'
);
assert.doesNotMatch(
  welcomeQuotesSource,
  blockedWelcomeQuotePattern,
  'blocked Socrates quote must be absent from the welcome quote pool'
);
assert.doesNotMatch(
  indexHtml,
  /id="ai-settings-open-workspace"|id="ai-settings-workspace-panel"|id="workspace-onboarding-modal"/,
  'free workspace layout configuration should be removed from visible settings and onboarding'
);
assert.match(
  styles,
  /\.app-shell\s*>\s*\.panel-center\s*\{[^}]*grid-column\s*:\s*3\s*;/s,
  'center panel must stay pinned to the main grid column when side panels are collapsed'
);
assert.match(
  styles,
  /\.app-shell\s*>\s*#splitter-right\s*\{[^}]*grid-column\s*:\s*4\s*;/s,
  'right splitter must stay pinned to its grid column instead of shifting after left collapse'
);
assert.match(
  styles,
  /body\.workspace-left-collapsed\s+\.app-shell\s*\{[^}]*--faber-left-panel-width\s*:\s*var\(--faber-left-rail-width\)/s,
  'collapsed left panel should keep a narrow icon rail instead of disappearing'
);
assert.match(
  styles,
  /body\.workspace-left-collapsed\s+\.folder-icon,[^{]*\{[^}]*display\s*:\s*none\s*;/s,
  'collapsed left rail should hide repeated folder icons'
);
assert.match(
  styles,
  /body\.workspace-left-collapsed\s+\.project-rail-menu-toggle\s*\{[^}]*display\s*:\s*grid\s*;/s,
  'collapsed left rail should show a single project menu button instead of one icon per project'
);
assert.match(
  styles,
  /\.project-rail-lightbox__panel\s*\{[^}]*position\s*:\s*fixed\s*;[\s\S]*\.project-rail-lightbox-list\s*\{[^}]*display\s*:\s*flex\s*;/s,
  'collapsed project menu should expand as a lightbox mini menu next to the rail'
);
assert.match(
  indexHtml,
  /id="project-rail-menu-toggle"/,
  'collapsed project rail should have one explicit menu toggle'
);
assert.match(
  indexHtml,
  /id="project-rail-lightbox"[\s\S]*id="project-rail-lightbox-list"/,
  'collapsed project rail should render projects into a dedicated lightbox list'
);
assert.match(
  styles,
  /body\.workspace-right-collapsed\s+\.app-shell\s*\{[^}]*--faber-right-panel-width\s*:\s*var\(--faber-left-rail-width\)/s,
  'collapsed right panel should keep a narrow tool rail instead of disappearing'
);
assert.match(
  styles,
  /body\.workspace-right-collapsed\s+\.panel-right\s*\{[^}]*display\s*:\s*flex\s*!important/s,
  'collapsed right panel should remain visible as an icon rail'
);
assert.match(
  styles,
  /body\.workspace-right-collapsed\s+\.project-panel-btn\s*\{[^}]*width\s*:\s*38px\s*!important;[\s\S]*height\s*:\s*38px\s*!important/s,
  'collapsed right rail should use compact icon buttons matching the left rail'
);
assert.match(
  indexHtml,
  /id="btn-project-git"[\s\S]*id="btn-project-terminal"[\s\S]*id="btn-project-deploy"/,
  'right tools should be ordered Git, Terminal, Executar'
);
assert.match(
  indexHtml,
  /id="btn-project-deploy"[\s\S]*M8 5\.5v13l10\.5-6\.5L8 5\.5Z/s,
  'run tool should use a play icon instead of a download-style icon'
);
assert.match(
  styles,
  /\.right-tool-lightbox__panel\s*\{[^}]*position\s*:\s*fixed\s*;[\s\S]*\.right-tool-file-link\s*\{/s,
  'right tools should open a lightbox-style utility surface with file links'
);
assert.match(
  styles,
  /\.right-tool-diff-preview\s*\{[^}]*border-left\s*:\s*2px\s+solid/s,
  'Git status should expose a readable diff preview for changed lines'
);
assert.match(
  styles,
  /\.right-tool-section--repo-setup\s+\.right-tool-actions-row\s*\{[^}]*justify-content\s*:\s*flex-start\s*;/s,
  'Git repository activation should stay compact instead of stretching into a giant action'
);
assert.match(
  styles,
  /\.project-terminal-panel\s*\{[^}]*min-height\s*:\s*320px\s*;/s,
  'terminal should open as a roomier interactive tool surface'
);
assert.match(
  styles,
  /\.project-terminal-lightbox\s*\{[^}]*position\s*:\s*fixed\s*;[\s\S]*\.project-terminal-lightbox\s+\.project-terminal-output/s,
  'terminal should have a dedicated lightbox CLI surface'
);
assert.match(
  styles,
  /\.faber-hover-tooltip\s*\{[^}]*position\s*:\s*fixed\s*;/s,
  'icon hover tooltips should render through a shared delayed tooltip surface'
);
assert.match(
  styles,
  /\.cortex-modal__body\s*\{[^}]*grid-template-columns\s*:\s*minmax\(320px,\s*0\.82fr\)\s*minmax\(440px,\s*1\.18fr\)\s*;/s,
  'Cortex modal should use a simplified two-column add-and-library layout'
);
assert.match(
  styles,
  /\.cortex-technical-card\s*\{[^}]*display\s*:\s*none\s*!important\s*;/s,
  'Cortex technical diagnostics should be hidden from the primary modal UX'
);
assert.match(
  styles,
  /\.cortex-chat-log:empty\s*\{[^}]*display\s*:\s*none\s*;/s,
  'Cortex chat log should stay hidden until there is a real action to report'
);
assert.match(
  indexHtml,
  /cortex-rules-card cortex-technical-card hidden/,
  'Cortex active-rules card should remain available to code but hidden from the simplified UX'
);
assert.match(
  indexHtml,
  /cortex-context-card cortex-technical-card hidden/,
  'Cortex context-frame card should remain available to code but hidden from the simplified UX'
);

console.log('window-chrome-css.test.js: ok');

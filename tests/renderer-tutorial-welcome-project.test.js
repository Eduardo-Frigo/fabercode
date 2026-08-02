const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'tutorial_welcome_project.js'),
  'utf8'
);
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'tutorial_welcome_project.js' });

const generator = sandbox.window.FaberTutorialWelcomeProject;
assert.ok(generator, 'tutorial project generator should be registered');
assert.strictEqual(generator.normalizeWelcomeName('  Júlia   Frigo  '), 'Júlia');
assert.strictEqual(generator.normalizeWelcomeName(''), 'Eduardo');

const batches = generator.createWelcomeProjectBatches({ name: 'Júlia Frigo', locale: 'pt-BR' });
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(batches.map((batch) => batch.id))),
  ['foundation', 'experience']
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(batches.map((batch) => batch.commitMessage))),
  [
    'chore: preparar fundação da landing page',
    'feat: concluir experiência responsiva e SEO',
  ]
);

const files = batches.flatMap((batch) => batch.files);
const paths = files.map((file) => file.path);
assert.strictEqual(new Set(paths).size, paths.length, 'generated paths should be unique across batches');
for (const file of files) {
  assert.ok(file.path && !path.isAbsolute(file.path) && !file.path.includes('..'));
  assert.ok(
    (typeof file.content === 'string' && file.content.trim().length > 0)
      || file.assetKey === 'faber-code-logo'
  );
}

for (const requiredPath of [
  'package.json',
  'app/layout.js',
  'app/page.js',
  'app/globals.css',
  'app/interactive.css',
  'components/WelcomeExperience.js',
  'components/WelcomeHero.js',
  'components/BuildBlueprint.js',
  'components/BuildPath.js',
  'components/SocialLinks.js',
  'public/faber-code-logo.png',
  'README.md',
]) {
  assert.ok(paths.includes(requiredPath), `${requiredPath} should be generated`);
}

const page = files.find((file) => file.path === 'app/page.js').content;
const layout = files.find((file) => file.path === 'app/layout.js').content;
assert.match(page, /Júlia/);
assert.doesNotMatch(page, /Júlia Frigo/);
assert.match(page, /replace\(\/\\s\+\/g/);
assert.match(page, /https:\/\/github\.com\/Eduardo-Frigo/);
assert.match(page, /https:\/\/www\.linkedin\.com\/in\/eduardo-frigo-b70067174\//);
assert.doesNotMatch(page, /SEU_USUARIO|SEU_PERFIL/);
assert.match(layout, /<html lang=\{siteCopy\.locale\} suppressHydrationWarning>/);
assert.match(layout, /<body suppressHydrationWarning>/);
const experience = files.find((file) => file.path === 'components/WelcomeExperience.js').content;
const blueprint = files.find((file) => file.path === 'components/BuildBlueprint.js').content;
const buildPath = files.find((file) => file.path === 'components/BuildPath.js').content;
const styles = files.find((file) => file.path === 'app/globals.css').content;
assert.match(experience, /IntersectionObserver/);
assert.match(experience, /updatePointerGlow/);
assert.match(blueprint, /hero-planet/);
assert.match(blueprint, /signal-thread/);
assert.doesNotMatch(blueprint, /signal-tail/);
assert.match(buildPath, /planetary-system/);
assert.match(buildPath, /planet-hover-card/);
assert.match(buildPath, /orbit-entry-thread/);
assert.match(buildPath, /orbitThread/);
assert.match(buildPath, /orbitalSectionRef/);
assert.match(buildPath, /coreRef/);
assert.match(buildPath, /ResizeObserver/);
assert.match(buildPath, /orbit-thread-terminal/);
assert.match(buildPath, /setPointerCapture/);
assert.match(buildPath, /connectionStartPoints/);
assert.match(buildPath, /connectionDockPoints/);
assert.match(buildPath, /createPortal/);
assert.match(buildPath, /document\.body/);
assert.match(buildPath, /startX = width \+ clamp/);
assert.match(buildPath, /verticalDistance \* 0\.46/);
assert.match(buildPath, /hoverCardRef/);
assert.match(buildPath, /connectionProgress/);
assert.match(buildPath, /connection-origin--/);
assert.match(buildPath, /connection-complete-message/);
assert.match(buildPath, /3200/);
assert.match(buildPath, /story-pulse/);
assert.match(buildPath, /story-track/);
assert.match(buildPath, /Math\.round/);
assert.match(styles, /journey-beacon/);
assert.match(styles, /html \{ scroll-behavior: smooth; overflow-x: clip;/);
assert.match(styles, /\.site-shell \{[^}]*overflow-x: clip;/);
assert.match(styles, /\.ambient-glow \{[^}]*right: 0;/);
const interactiveStyles = files.find((file) => file.path === 'app/interactive.css').content;
assert.match(interactiveStyles, /planet-orbit/);
assert.match(interactiveStyles, /planet-orbit\.is-paused/);
assert.match(interactiveStyles, /orbit-thread-terminal/);
assert.match(interactiveStyles, /\.planet-hover-card\{[^}]*position:fixed/);
assert.match(interactiveStyles, /\.planet-hover-card\.is-positioned/);
assert.match(interactiveStyles, /width:min\(50vw,38rem\)/);
assert.match(interactiveStyles, /connection-dock/);
assert.match(interactiveStyles, /connection-cursor/);
assert.match(interactiveStyles, /connection-origin-progress/);
assert.match(interactiveStyles, /connection-complete-message/);
assert.match(interactiveStyles, /origin-lock/);
assert.match(interactiveStyles, /origin-double-pulse/);
assert.match(interactiveStyles, /origin-complete/);
assert.match(interactiveStyles, /signal-story/);
assert.match(interactiveStyles, /story-progress-stops/);
assert.match(interactiveStyles, /width:min\(82vw,25rem\)/);
assert.match(styles, /prefers-reduced-motion/);
assert.doesNotMatch(styles, /signal-tail/);
const generatedText = files
  .filter((file) => typeof file.content === 'string')
  .map((file) => file.content)
  .join('\n');
assert.match(generatedText, /Olá,/);
assert.match(generatedText, /SESSÃO 01/);
assert.match(generatedText, /Dê forma à ideia/);
assert.match(generatedText, /Todo projeto começa com uma direção/);
assert.doesNotMatch(generatedText, /\bOla\b|SESSAO|De forma a ideia|faber-code-mark\.svg/);
const logo = files.find((file) => file.path === 'public/faber-code-logo.png');
assert.strictEqual(logo.assetKey, 'faber-code-logo');
assert.doesNotMatch(source, /sendAssistantMessage|fetch\(|invokeAi|callModel/);

for (const scenario of [
  {
    locale: 'pt-BR',
    greeting: 'Olá,',
    session: 'SESSÃO 01',
    direction: 'direção',
    code: 'próximoPasso',
    connectionComplete: 'Direção pronta para virar plano.',
    storyTitle: 'Uma direção. Quatro camadas de execução.',
    storyText: 'O Faber Code transforma contexto em decisões',
  },
  {
    locale: 'en-US',
    greeting: 'Hello,',
    session: 'SESSION 01',
    direction: 'direction',
    code: 'nextStep',
    connectionComplete: 'Direction ready to become a plan.',
    storyTitle: 'One direction. Four layers of execution.',
    storyText: 'Faber Code turns context into decisions',
  },
  {
    locale: 'es-ES',
    greeting: 'Hola,',
    session: 'SESIÓN 01',
    direction: 'dirección',
    code: 'siguientePaso',
    connectionComplete: 'La dirección está lista para convertirse en plan.',
    storyTitle: 'Una dirección. Cuatro capas de ejecución.',
    storyText: 'Faber Code transforma contexto en decisiones',
  },
]) {
  const localizedFiles = generator
    .createWelcomeProjectBatches({ name: 'Júlia Frigo', locale: scenario.locale })
    .flatMap((batch) => batch.files);
  const localizedText = localizedFiles
    .filter((file) => typeof file.content === 'string')
    .map((file) => file.content)
    .join('\n');
  assert.match(localizedText, new RegExp(scenario.greeting));
  assert.match(localizedText, new RegExp(scenario.session));
  assert.match(localizedText, new RegExp(scenario.direction));
  assert.match(localizedText, new RegExp(scenario.code));
  assert.match(localizedText, /signalConnected/);
  assert.match(localizedText, /journeyReadyTitle/);
  assert.match(localizedText, /connectionProgress/);
  assert.match(localizedText, /storyPanels/);
  assert.ok(localizedText.includes(scenario.connectionComplete));
  assert.ok(localizedText.includes(scenario.storyTitle));
  assert.ok(localizedText.includes(scenario.storyText));
  assert.match(localizedText, /Júlia/);
  assert.doesNotMatch(localizedText, /Júlia Frigo/);
  assert.doesNotMatch(localizedText, /faber-code-mark\.svg/);
}

console.log('renderer-tutorial-welcome-project.test.js: ok');

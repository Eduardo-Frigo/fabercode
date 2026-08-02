const previewPlanets = [
  { label: "Clareza", className: "hero-planet--clarity" },
  { label: "Estrutura", className: "hero-planet--structure" },
  { label: "Evolução", className: "hero-planet--evolution" },
];

export function BuildBlueprint({ name, started, onActivate, onPointerMove }) {
  return (
    <div className={`blueprint-wrap reveal reveal-3${started ? " is-awake" : ""}`}>
      <aside className="blueprint" aria-label="Resumo do ponto de partida">
        <div className="blueprint-topline">
          <span>WELCOME_PROTOCOL</span>
          <span>FABER / 01</span>
        </div>

        <div
          className="signal-field"
          onPointerMove={onPointerMove}
        >
          <span className="signal-orbit signal-orbit-outer" aria-hidden="true" />
          <span className="signal-orbit signal-orbit-inner" aria-hidden="true" />
          <button
            className="signal-core signal-core-button"
            type="button"
            onClick={onActivate}
            aria-label="Seguir o sinal até a experiência orbital"
            aria-pressed={started}
          >
            <span />
          </button>
          {previewPlanets.map((planet) => (
            <button
              key={planet.label}
              className={`hero-planet ${planet.className}`}
              type="button"
              onClick={onActivate}
              onPointerEnter={onActivate}
              aria-label={`${planet.label}: explorar órbita`}
            >
              <span>{planet.label}</span>
            </button>
          ))}
          <span className="signal-coordinate coordinate-a" aria-hidden="true">CLAREZA</span>
          <span className="signal-coordinate coordinate-b" aria-hidden="true">ESTRUTURA</span>
          <span className="signal-coordinate coordinate-c" aria-hidden="true">EVOLUÇÃO</span>
          <span className="signal-callout">
            <span className="signal-callout-dot" aria-hidden="true" />
            {started ? "Sinal conectado · siga o fio" : "Toque no sinal para iniciar"}
          </span>
          <svg className="signal-thread" viewBox="0 0 420 320" preserveAspectRatio="none" aria-hidden="true">
            <path className="signal-thread-shadow" d="M210 156 C274 162 280 226 390 272" />
            <path className="signal-thread-line" d="M210 156 C274 162 280 226 390 272" />
            <circle className="signal-thread-dot" r="5">
              <animateMotion dur="4.8s" repeatCount="indefinite" path="M210 156 C274 162 280 226 390 272" />
            </circle>
          </svg>
          <span className="journey-thread-anchor" data-journey-thread-start="true" aria-hidden="true" />
        </div>

        <div className="blueprint-code" aria-label={`Sessão personalizada para ${name}`}>
          <div className="code-toolbar">
            <span className="code-light" aria-hidden="true" />
            <span>session/welcome.js</span>
          </div>
          <pre>
            <code>
              <span className="code-muted">const</span> começo = {"{"}
              {"\n"}  pessoa: <span className="code-value">&quot;{name}&quot;</span>,
              {"\n"}  ideia: <span className="code-value">&quot;em movimento&quot;</span>,
              {"\n"}  próximoPasso: <span className="code-accent">true</span>
              {"\n"}{"}"};
            </code>
          </pre>
        </div>
      </aside>
    </div>
  );
}

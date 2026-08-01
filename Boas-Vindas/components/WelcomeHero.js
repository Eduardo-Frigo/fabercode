function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

export function WelcomeHero({ name, onStart }) {
  const [displayName = "Eduardo"] = String(name || "").trim().split(/\s+/);

  return (
    <div className="hero-copy">
      <p className="eyebrow reveal reveal-1">
        <span>BOAS-VINDAS</span>
        <span className="eyebrow-line" aria-hidden="true" />
        <span>SESSÃO 01</span>
      </p>

      <h1 id="welcome-title" className="hero-title reveal reveal-2">
        Olá,
        <span>{displayName}.</span>
      </h1>

      <p className="hero-lead reveal reveal-3">
        Seja bem-vindo ao Faber Code. Um espaço para transformar ideias em projetos
        <strong> claros, organizados e prontos para evoluir.</strong>
      </p>

      <div className="hero-actions reveal reveal-4">
        <button className="primary-action" type="button" onClick={onStart}>
          <span>Começar agora</span>
          <span className="action-icon">
            <ArrowIcon />
          </span>
        </button>
        <button className="secondary-action" type="button" onClick={onStart}>
          Conhecer o fluxo
          <span aria-hidden="true">↘</span>
        </button>
      </div>

      <dl className="hero-metrics reveal reveal-5" aria-label="Princípios do ambiente">
        <div>
          <dt>01</dt>
          <dd>Uma direção clara</dd>
        </div>
        <div>
          <dt>∞</dt>
          <dd>Espaço para evoluir</dd>
        </div>
      </dl>
    </div>
  );
}

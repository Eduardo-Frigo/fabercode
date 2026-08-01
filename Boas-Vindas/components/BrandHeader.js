import Image from "next/image";

export function BrandHeader() {
  return (
    <header className="brand-header">
      <a className="brand-link" href="#inicio" aria-label="Faber Code, voltar ao início">
        <Image
          className="brand-logo"
          src="/faber-code-logo.png"
          alt="Faber Code"
          width={4500}
          height={1093}
          priority
        />
      </a>

      <div className="session-status" aria-label="Ambiente preparado">
        <span className="status-dot" aria-hidden="true" />
        <span>Ambiente preparado</span>
        <span className="status-code">01</span>
      </div>
    </header>
  );
}

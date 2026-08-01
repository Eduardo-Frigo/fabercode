function SocialIcon({ kind }) {
  if (kind === "github") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M15 22v-4.2c.1-1-.4-1.8-.9-2.3 3 0 6.1-1.5 6.1-6.5 0-1.5-.5-2.7-1.4-3.7.1-.4.6-1.8-.2-3.7 0 0-1.1-.4-3.8 1.4a13 13 0 0 0-6.8 0C5.4 1.2 4.2 1.6 4.2 1.6c-.7 1.9-.3 3.3-.1 3.7A5.3 5.3 0 0 0 2.7 9c0 5 3 6.5 6 6.5-.4.4-.8 1.1-.8 2.1V22" />
        <path d="M7.9 19c-3 .9-3-1.5-4.2-2" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4V8h4v2a5 5 0 0 1 2-2Z" />
      <path d="M2 9h4v12H2z" />
      <path d="M4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    </svg>
  );
}

export function SocialLinks({ links }) {
  return (
    <nav className="social-links" aria-label="Redes sociais">
      {links.map((link) => (
        <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`${link.label}, link provisório`}
        >
          <span className="social-icon"><SocialIcon kind={link.kind} /></span>
          <span>
            <strong>{link.label}</strong>
            <small>{link.detail}</small>
          </span>
          <span className="social-arrow" aria-hidden="true">↗</span>
        </a>
      ))}
    </nav>
  );
}

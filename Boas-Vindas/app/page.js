import { BrandHeader } from "@/components/BrandHeader";
import { SocialLinks } from "@/components/SocialLinks";
import { WelcomeExperience } from "@/components/WelcomeExperience";

function readPublicValue(key, fallback) {
  return process.env[key]?.trim() || fallback;
}

function firstName(value, fallback) {
  const [firstWord = ""] = String(value || "").trim().split(/\s+/);
  return firstWord || fallback;
}

export default function Home() {
  const welcomeName = firstName(
    readPublicValue("NEXT_PUBLIC_WELCOME_NAME", "Eduardo"),
    "Eduardo",
  );
  const socialLinks = [
    {
      label: "GitHub",
      detail: "Eduardo-Frigo",
      href: readPublicValue("NEXT_PUBLIC_GITHUB_URL", "https://github.com/Eduardo-Frigo"),
      kind: "github",
    },
    {
      label: "LinkedIn",
      detail: "eduardo-frigo-b70067174",
      href: readPublicValue(
        "NEXT_PUBLIC_LINKEDIN_URL",
        "https://www.linkedin.com/in/eduardo-frigo-b70067174/",
      ),
      kind: "linkedin",
    },
  ];

  return (
    <div className="site-shell">
      <a className="skip-link" href="#conteudo-principal">
        Ir para o conteúdo principal
      </a>
      <div className="ambient-grid" aria-hidden="true" />
      <div className="ambient-glow" aria-hidden="true" />

      <BrandHeader />

      <main id="conteudo-principal">
        <WelcomeExperience name={welcomeName} />
      </main>

      <footer className="site-footer">
        <div>
          <p className="footer-kicker">CONTINUE A CONVERSA</p>
          <p className="footer-copy">O próximo passo começa com uma boa pergunta.</p>
        </div>
        <SocialLinks links={socialLinks} />
        <p className="footer-signature">Faber Code / ponto de partida 01</p>
      </footer>
    </div>
  );
}

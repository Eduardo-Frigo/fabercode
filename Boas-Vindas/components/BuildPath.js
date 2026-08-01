"use client";

import { useEffect, useRef, useState } from "react";

const planets = [
  {
    id: "clarity",
    number: "01",
    label: "Clareza",
    title: "Dê forma à ideia",
    text: "Intenção e contexto entram em órbita antes da primeira linha.",
  },
  {
    id: "structure",
    number: "02",
    label: "Estrutura",
    title: "Conecte as decisões",
    text: "Referências dispersas passam a compartilhar uma direção.",
  },
  {
    id: "evolution",
    number: "03",
    label: "Evolução",
    title: "Construa com propósito",
    text: "Cada marco mantém o projeto vivo e pronto para crescer.",
  },
];

const connectionOrigin = { x: 14, y: 50 };

const connectionStartPoints = {
  clarity: { x: 84, y: 20 },
  structure: { x: 88, y: 50 },
  evolution: { x: 84, y: 80 },
};

const connectionDockPoints = {
  clarity: { x: 43, y: 24 },
  structure: { x: 50, y: 50 },
  evolution: { x: 43, y: 76 },
};

const connectionProgress = [
  {
    label: "FONTE DO MAPA",
    text: "Aguardando a primeira decisão.",
  },
  {
    label: "PRIMEIRO SINAL",
    text: "Uma decisão ganhou direção.",
  },
  {
    label: "CONTEXTO ALINHADO",
    text: "Duas decisões compartilham o mapa.",
  },
  {
    label: "MAPA EM MOVIMENTO",
    text: "As três decisões avançam juntas.",
  },
];

const storyPanels = [
  {
    number: "01",
    eyebrow: "MAPA",
    title: "A intenção ganha uma estrutura visível.",
    text: "Briefings, referências e regras passam a compartilhar o mesmo contexto antes do desenvolvimento.",
  },
  {
    number: "02",
    eyebrow: "ANÁLISE",
    title: "A IA encontra lacunas antes do código.",
    text: "O assistente revisa o mapa, sinaliza informações ausentes e reduz retrabalho na execução.",
  },
  {
    number: "03",
    eyebrow: "MILESTONES",
    title: "O plano se torna executável.",
    text: "Cada etapa reúne objetivos, critérios e arquivos de referência para orientar o desenvolvimento.",
  },
  {
    number: "∞",
    eyebrow: "DESENVOLVIMENTO",
    title: "Chat, Git e execução fecham o ciclo.",
    text: "Os arquivos evoluem com histórico, commits e uma prévia local pronta para validar.",
  },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function initialTargetPositions() {
  return Object.fromEntries(
    Object.entries(connectionStartPoints).map(([id, point]) => [id, { ...point }]),
  );
}

function ConnectionLab() {
  const surfaceRef = useRef(null);
  const dragStateRef = useRef(null);
  const [targetPositions, setTargetPositions] = useState(initialTargetPositions);
  const [draggingId, setDraggingId] = useState(null);
  const [pointerVisible, setPointerVisible] = useState(false);
  const [connected, setConnected] = useState([]);
  const isComplete = connected.length === planets.length;
  const originStep = connectionProgress[connected.length];

  useEffect(() => {
    if (!isComplete) return undefined;
    const transition = window.setTimeout(() => {
      document.getElementById("signal-story")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 3200);
    return () => window.clearTimeout(transition);
  }, [isComplete]);

  function readPoint(event) {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds) return connectionOrigin;
    return {
      x: clamp(((event.clientX - bounds.left) / bounds.width) * 100, 3, 97),
      y: clamp(((event.clientY - bounds.top) / bounds.height) * 100, 5, 95),
    };
  }

  function setCursorPosition(point) {
    surfaceRef.current?.style.setProperty("--connection-x", `${point.x}%`);
    surfaceRef.current?.style.setProperty("--connection-y", `${point.y}%`);
  }

  function connect(id) {
    setConnected((current) => (current.includes(id) ? current : [...current, id]));
    setTargetPositions((current) => ({
      ...current,
      [id]: { ...connectionDockPoints[id] },
    }));
    dragStateRef.current = null;
    setDraggingId(null);
  }

  function beginTargetDrag(event, id) {
    if (connected.includes(id)) return;
    event.preventDefault();
    const pointer = readPoint(event);
    const current = targetPositions[id];
    dragStateRef.current = {
      id,
      offsetX: current.x - pointer.x,
      offsetY: current.y - pointer.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setCursorPosition(pointer);
    setPointerVisible(true);
    setDraggingId(id);
  }

  function movePointer(event) {
    const pointer = readPoint(event);
    setCursorPosition(pointer);
    setPointerVisible(true);

    const dragState = dragStateRef.current;
    if (!dragState) return;
    const next = {
      x: clamp(pointer.x + dragState.offsetX, 5, 95),
      y: clamp(pointer.y + dragState.offsetY, 7, 93),
    };
    setTargetPositions((current) => ({ ...current, [dragState.id]: next }));
  }

  function finishDrag(event) {
    const dragState = dragStateRef.current;
    if (!dragState) return;

    const pointer = readPoint(event);
    const dropped = {
      x: clamp(pointer.x + dragState.offsetX, 5, 95),
      y: clamp(pointer.y + dragState.offsetY, 7, 93),
    };
    const dock = connectionDockPoints[dragState.id];
    const distance = Math.hypot(dropped.x - dock.x, dropped.y - dock.y);

    if (distance <= 12) connect(dragState.id);
    else {
      setTargetPositions((current) => ({
        ...current,
        [dragState.id]: { ...connectionStartPoints[dragState.id] },
      }));
      dragStateRef.current = null;
      setDraggingId(null);
    }
  }

  return (
    <section className="experience-section connection-lab" aria-labelledby="connection-title">
      <div className="experience-heading" data-enter>
        <p>GESTO 02 · CONECTAR</p>
        <h2 id="connection-title">Arraste as decisões. Construa o mapa.</h2>
        <span>Leve cada item ao encaixe correspondente. A cor só aparece quando a conexão estiver completa.</span>
      </div>

      <div
        ref={surfaceRef}
        className={`connection-surface${draggingId ? " is-dragging" : ""}${connected.length ? " has-connections" : ""}${isComplete ? " is-complete" : ""}`}
        onPointerMove={movePointer}
        onPointerLeave={() => !dragStateRef.current && setPointerVisible(false)}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        data-enter
      >
        <svg className="connection-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {planets.map((planet) => {
            const dock = connectionDockPoints[planet.id];
            return (
              <line
                key={`guide-${planet.id}`}
                className="connection-line is-guide"
                x1={connectionOrigin.x}
                y1={connectionOrigin.y}
                x2={dock.x}
                y2={dock.y}
              />
            );
          })}
          {connected.map((id) => (
            <line
              key={id}
              className="connection-line is-fixed"
              x1={connectionOrigin.x}
              y1={connectionOrigin.y}
              x2={connectionDockPoints[id].x}
              y2={connectionDockPoints[id].y}
            />
          ))}
          {draggingId && (
            <line
              className="connection-line is-live"
              x1={connectionOrigin.x}
              y1={connectionOrigin.y}
              x2={targetPositions[draggingId].x}
              y2={targetPositions[draggingId].y}
            />
          )}
        </svg>

        <div
          key={`origin-${connected.length}`}
          className={`connection-origin connection-origin--${connected.length}${connected.length ? " has-connections" : ""}${isComplete ? " is-complete" : ""}`}
          style={{ left: `${connectionOrigin.x}%`, top: `${connectionOrigin.y}%` }}
          aria-label="Fonte do mapa"
        >
          <span className="connection-origin-core" />
          <span className="connection-origin-ring connection-origin-ring--one" />
          <span className="connection-origin-ring connection-origin-ring--two" />
          <span className="connection-origin-copy">
            <strong>{originStep.label}</strong>
            <small>{originStep.text}</small>
          </span>
          <span className="connection-origin-progress" aria-hidden="true">
            {planets.map((planet, index) => (
              <i key={planet.id} className={index < connected.length ? "is-active" : ""} />
            ))}
          </span>
        </div>

        {planets.map((planet) => {
          const dock = connectionDockPoints[planet.id];
          const isConnected = connected.includes(planet.id);
          return (
            <span
              key={`dock-${planet.id}`}
              className={`connection-dock${isConnected ? " is-connected" : ""}`}
              style={{ left: `${dock.x}%`, top: `${dock.y}%` }}
              aria-hidden="true"
            >
              {planet.number}
            </span>
          );
        })}

        {planets.map((planet) => {
          const point = targetPositions[planet.id];
          const isConnected = connected.includes(planet.id);
          const isDragging = draggingId === planet.id;
          return (
            <button
              key={planet.id}
              className={`connection-target${isConnected ? " is-connected" : ""}${isDragging ? " is-dragging" : ""}`}
              type="button"
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
              onPointerDown={(event) => beginTargetDrag(event, planet.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  connect(planet.id);
                }
              }}
              aria-label={`Arraste ${planet.label} até o encaixe ${planet.number}`}
              aria-pressed={isConnected}
            >
              <span>{planet.number}</span>
              <strong>{planet.label}</strong>
              {!isConnected && <small>ARRASTE</small>}
            </button>
          );
        })}

        <div className={`connection-cursor${pointerVisible ? " is-visible" : ""}`} aria-hidden="true">
          <span>{draggingId ? "SOLTE NO ENCAIXE" : "ESCOLHA E ARRASTE"}</span>
        </div>

        <p className="connection-status" aria-live="polite">
          {isComplete
            ? "Preparando a próxima etapa..."
            : `${connected.length} de ${planets.length} decisões conectadas`}
        </p>

        <div className={`connection-complete-message${isComplete ? " is-visible" : ""}`} aria-live="polite">
          <small>MAPA CONECTADO</small>
          <strong>Direção pronta para virar plano.</strong>
          <span>Clareza, estrutura e evolução agora avançam juntas.</span>
        </div>
      </div>
    </section>
  );
}

function SignalStory() {
  const sectionRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [awake, setAwake] = useState(false);

  useEffect(() => {
    let frame = 0;

    function updateProgress() {
      frame = 0;
      const section = sectionRef.current;
      if (!section) return;
      const bounds = section.getBoundingClientRect();
      const travel = Math.max(section.offsetHeight - window.innerHeight, 1);
      const progress = clamp(-bounds.top / travel, 0, 1);
      const nextIndex = Math.min(
        storyPanels.length - 1,
        Math.round(progress * (storyPanels.length - 1)),
      );
      setActiveIndex(nextIndex);
      if (progress > 0.025) setAwake(true);
    }

    function onScroll() {
      if (frame) return;
      frame = window.requestAnimationFrame(updateProgress);
    }

    updateProgress();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  function awakenStory() {
    setAwake(true);
    const section = sectionRef.current;
    if (!section) return;
    window.scrollTo({
      top: section.offsetTop + window.innerHeight * 0.7,
      behavior: "smooth",
    });
  }

  const settledProgress = activeIndex / (storyPanels.length - 1);

  return (
    <section
      ref={sectionRef}
      id="signal-story"
      className={`signal-story${awake ? " is-awake" : ""}`}
      aria-labelledby="story-title"
    >
      <div className="signal-story-sticky">
        <header className="story-header">
          <p>FABER CODE · DO MAPA À ENTREGA</p>
          <h2 id="story-title">Uma direção. Quatro camadas de execução.</h2>
          <span>O Faber Code transforma contexto em decisões, decisões em milestones e milestones em código rastreável.</span>
        </header>

        <button
          className="story-pulse"
          type="button"
          onClick={awakenStory}
          aria-label="Ativar a narrativa do sinal"
          aria-pressed={awake}
        >
          <span className="story-pulse-core" />
          <span className="story-pulse-ring story-pulse-ring--one" />
          <span className="story-pulse-ring story-pulse-ring--two" />
          <strong>{awake ? "SINAL EM MOVIMENTO" : "TOQUE NO PULSO"}</strong>
        </button>

        <div className="story-viewport">
          <div
            className="story-track"
            style={{ transform: `translate3d(-${activeIndex * 25}%, 0, 0)` }}
          >
            {storyPanels.map((panel, index) => (
              <article
                key={panel.number}
                className={`story-panel${index === activeIndex ? " is-current" : ""}`}
                aria-hidden={index !== activeIndex}
              >
                <span className="story-panel-number">{panel.number}</span>
                <div>
                  <p>{panel.eyebrow}</p>
                  <h3>{panel.title}</h3>
                  <span>{panel.text}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="story-progress" aria-hidden="true">
          <span style={{ width: `${Math.max(settledProgress * 100, awake ? 4 : 0)}%` }} />
          <div className="story-progress-stops">
            {storyPanels.map((panel, index) => (
              <i key={panel.number} className={index <= activeIndex ? "is-active" : ""} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function BuildPath({ started, onStart }) {
  const systemRef = useRef(null);
  const hoveredTargetRef = useRef(null);
  const hoverCardRef = useRef(null);
  const [focusedPlanet, setFocusedPlanet] = useState("clarity");
  const [hoveredPlanet, setHoveredPlanet] = useState(null);
  const [hoverCard, setHoverCard] = useState(null);
  const currentPlanet = planets.find((planet) => planet.id === focusedPlanet) || planets[0];
  const hoverPlanetId = hoverCard?.planet.id;

  useEffect(() => {
    let frame = 0;
    const system = systemRef.current;
    const target = hoveredTargetRef.current;
    const card = hoverCardRef.current;
    if (!hoverPlanetId || !system || !target || !card) return undefined;

    function updateHoverCard() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const systemBounds = system.getBoundingClientRect();
        const targetBounds = target.getBoundingClientRect();
        const cardBounds = card.getBoundingClientRect();
        if (!cardBounds.width || !cardBounds.height) return;

        const margin = 10;
        const gap = 14;
        const viewport = window.visualViewport;
        const viewportLeft = viewport?.offsetLeft || 0;
        const viewportTop = viewport?.offsetTop || 0;
        const viewportWidth = viewport?.width || window.innerWidth;
        const viewportHeight = viewport?.height || window.innerHeight;
        const anchorX = targetBounds.left + targetBounds.width / 2 - systemBounds.left;
        const anchorY = targetBounds.top + targetBounds.height / 2 - systemBounds.top;
        const targetTop = targetBounds.top - systemBounds.top;
        const targetBottom = targetBounds.bottom - systemBounds.top;
        const visibleLeft = viewportLeft - systemBounds.left + margin;
        const visibleRight = viewportLeft + viewportWidth - systemBounds.left - margin;
        const visibleTop = viewportTop - systemBounds.top + margin;
        const visibleBottom = viewportTop + viewportHeight - systemBounds.top - margin;
        const maxLeft = Math.max(visibleLeft, visibleRight - cardBounds.width);
        const left = clamp(anchorX - cardBounds.width / 2, visibleLeft, maxLeft);
        const aboveTop = targetTop - cardBounds.height - gap;
        const belowTop = targetBottom + gap;
        const fitsAbove = aboveTop >= visibleTop;
        const fitsBelow = belowTop + cardBounds.height <= visibleBottom;
        let placement = "above";

        if (fitsBelow && !fitsAbove) placement = "below";
        else if (fitsAbove && fitsBelow) {
          placement = anchorY < (visibleTop + visibleBottom) / 2 ? "below" : "above";
        } else if (!fitsAbove && !fitsBelow) {
          placement = anchorY - visibleTop > visibleBottom - anchorY ? "above" : "below";
        }

        const proposedTop = placement === "above" ? aboveTop : belowTop;
        const maxTop = Math.max(visibleTop, visibleBottom - cardBounds.height);
        const top = clamp(proposedTop, visibleTop, maxTop);
        const connectorX = clamp(anchorX - left, 12, cardBounds.width - 12);
        const nextPosition = {
          left: Number(left.toFixed(1)),
          top: Number(top.toFixed(1)),
          connectorX: Number(connectorX.toFixed(1)),
          placement,
          positioned: true,
        };

        setHoverCard((current) => {
          if (!current || current.planet.id !== hoverPlanetId) return current;
          if (
            current.left === nextPosition.left
            && current.top === nextPosition.top
            && current.placement === nextPosition.placement
            && current.connectorX === nextPosition.connectorX
            && current.positioned
          ) return current;
          return { ...current, ...nextPosition };
        });
      });
    }

    updateHoverCard();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateHoverCard);
    resizeObserver?.observe(system);
    resizeObserver?.observe(target);
    resizeObserver?.observe(card);
    window.addEventListener("resize", updateHoverCard);
    window.addEventListener("scroll", updateHoverCard, true);
    window.visualViewport?.addEventListener("resize", updateHoverCard);
    window.visualViewport?.addEventListener("scroll", updateHoverCard);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateHoverCard);
      window.removeEventListener("scroll", updateHoverCard, true);
      window.visualViewport?.removeEventListener("resize", updateHoverCard);
      window.visualViewport?.removeEventListener("scroll", updateHoverCard);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [hoverPlanetId]);

  function revealPlanet(event, planet) {
    hoveredTargetRef.current = event.currentTarget;
    setFocusedPlanet(planet.id);
    setHoveredPlanet(planet.id);
    setHoverCard({ planet, positioned: false });
  }

  function hidePlanet() {
    hoveredTargetRef.current = null;
    setHoveredPlanet(null);
    setHoverCard(null);
  }

  return (
    <div className={`interactive-journey${started ? " is-active" : ""}`}>
      <section
        id="orbital-lab"
        className="experience-section orbital-lab"
        aria-labelledby="orbit-title"
      >
        <div className="experience-heading" data-enter>
          <p>GESTO 01 · EXPLORAR</p>
          <h2 id="orbit-title">Entre na órbita do projeto.</h2>
          <span>Passe o ponteiro por cada planeta. Apenas aquela órbita pausa e a decisão aparece inteira.</span>
        </div>

        <div className="planetary-stage" data-enter>
          <div ref={systemRef} className="planetary-system" aria-label="Órbita interativa das decisões do projeto">
            <span className="planetary-axis" aria-hidden="true" />
            <button
              className="planetary-core"
              type="button"
              onClick={onStart}
              data-journey-thread-end
              aria-label="Ativar órbitas"
            >
              <span />
            </button>
            {planets.map((planet, index) => (
              <div
                key={planet.id}
                className={`planet-orbit planet-orbit--${index + 1}${hoveredPlanet === planet.id ? " is-paused" : ""}`}
              >
                <button
                  className={`planet planet--${planet.id}`}
                  type="button"
                  onPointerEnter={(event) => revealPlanet(event, planet)}
                  onPointerLeave={hidePlanet}
                  onFocus={(event) => revealPlanet(event, planet)}
                  onBlur={hidePlanet}
                  onClick={() => setFocusedPlanet(planet.id)}
                  aria-pressed={focusedPlanet === planet.id}
                  aria-label={`${planet.number}, ${planet.label}: ${planet.title}`}
                >
                  <span className="planet-surface" />
                </button>
              </div>
            ))}

            {hoverCard && (
              <div
                ref={hoverCardRef}
                className={`planet-hover-card planet-hover-card--${hoverCard.placement || "above"}${hoverCard.positioned ? " is-positioned" : ""}`}
                style={{
                  left: `${hoverCard.left || 0}px`,
                  top: `${hoverCard.top || 0}px`,
                  "--planet-card-connector": `${hoverCard.connectorX || 24}px`,
                }}
                role="status"
              >
                <small>{hoverCard.planet.number} · {hoverCard.planet.label}</small>
                <strong>{hoverCard.planet.title}</strong>
                <span>{hoverCard.planet.text}</span>
              </div>
            )}
          </div>

          <aside className="orbit-readout" aria-live="polite">
            <span>{currentPlanet.number} / 03</span>
            <p>{currentPlanet.label.toUpperCase()}</p>
            <h3>{currentPlanet.title}</h3>
            <p>{currentPlanet.text}</p>
            <span className="orbit-readout-hint">MOVA O PONTEIRO ENTRE OS PLANETAS</span>
          </aside>
        </div>
      </section>

      <ConnectionLab />
      <SignalStory />
    </div>
  );
}

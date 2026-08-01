"use client";

import { useEffect, useRef, useState } from "react";
import { BuildBlueprint } from "@/components/BuildBlueprint";
import { BuildPath } from "@/components/BuildPath";
import { WelcomeHero } from "@/components/WelcomeHero";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function updatePointerGlow(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - bounds.left) / bounds.width) * 100;
  const y = ((event.clientY - bounds.top) / bounds.height) * 100;
  event.currentTarget.style.setProperty("--pointer-x", `${x}%`);
  event.currentTarget.style.setProperty("--pointer-y", `${y}%`);
}

export function WelcomeExperience({ name }) {
  const rootRef = useRef(null);
  const [started, setStarted] = useState(false);
  const [journeyThread, setJourneyThread] = useState(null);

  useEffect(() => {
    const root = rootRef.current;
    const elements = root?.querySelectorAll("[data-enter]") || [];

    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.setAttribute("data-enter-visible", "true"));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.setAttribute("data-enter-visible", "true");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8%" },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;
    const root = rootRef.current;
    const start = root?.querySelector("[data-journey-thread-start]");
    const end = root?.querySelector("[data-journey-thread-end]");
    if (!root || !start || !end) return undefined;

    function updateJourneyThread() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const rootBounds = root.getBoundingClientRect();
        const startBounds = start.getBoundingClientRect();
        const endBounds = end.getBoundingClientRect();
        const width = Math.max(rootBounds.width, 1);
        const height = Math.max(rootBounds.height, 1);
        const startX = startBounds.left + startBounds.width / 2 - rootBounds.left;
        const startY = startBounds.top + startBounds.height / 2 - rootBounds.top;
        const endX = endBounds.left + endBounds.width / 2 - rootBounds.left;
        const endY = endBounds.top + endBounds.height / 2 - rootBounds.top;
        const verticalDistance = Math.max(endY - startY, 1);
        const firstControlX = clamp(
          startX + clamp(width * 0.08, 36, 104),
          16,
          width - 16,
        );
        const secondControlX = clamp(
          endX + clamp(Math.abs(startX - endX) * 0.42, 42, width * 0.28),
          16,
          width - 16,
        );
        const path = [
          `M ${startX.toFixed(1)} ${startY.toFixed(1)}`,
          `C ${firstControlX.toFixed(1)} ${(startY + verticalDistance * 0.24).toFixed(1)}`,
          `${secondControlX.toFixed(1)} ${(endY - verticalDistance * 0.3).toFixed(1)}`,
          `${endX.toFixed(1)} ${endY.toFixed(1)}`,
        ].join(" ");

        const nextThread = {
          width: Number(width.toFixed(1)),
          height: Number(height.toFixed(1)),
          endX: Number(endX.toFixed(1)),
          endY: Number(endY.toFixed(1)),
          path,
        };
        setJourneyThread((current) => (current?.path === path ? current : nextThread));
      });
    }

    updateJourneyThread();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateJourneyThread);
    resizeObserver?.observe(root);
    resizeObserver?.observe(start);
    resizeObserver?.observe(end);
    window.addEventListener("resize", updateJourneyThread);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateJourneyThread);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  function startJourney() {
    setStarted(true);
    window.requestAnimationFrame(() => {
      document.getElementById("orbital-lab")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  return (
    <div
      ref={rootRef}
      className={`welcome-experience${started ? " is-started" : ""}`}
    >
      {journeyThread && (
        <svg
          className="journey-thread"
          viewBox={`0 0 ${journeyThread.width} ${journeyThread.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={journeyThread.path} />
          <circle key={journeyThread.path} className="journey-thread-signal" r="5">
            <animateMotion dur="7.2s" repeatCount="indefinite" path={journeyThread.path} />
          </circle>
          <circle
            className="journey-thread-terminal"
            cx={journeyThread.endX}
            cy={journeyThread.endY}
            r="7"
          />
        </svg>
      )}

      <section id="inicio" className="hero-layout" aria-labelledby="welcome-title">
        <WelcomeHero name={name} onStart={startJourney} />
        <BuildBlueprint
          name={name}
          started={started}
          onActivate={startJourney}
          onPointerMove={updatePointerGlow}
        />
      </section>

      <BuildPath started={started} onStart={startJourney} />
    </div>
  );
}

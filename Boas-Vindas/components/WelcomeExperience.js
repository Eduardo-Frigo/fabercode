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
    let entranceFrame = 0;
    const root = rootRef.current;
    const start = root?.querySelector("[data-journey-thread-start]");
    const end = root?.querySelector("[data-journey-thread-end]");
    const orbitalLab = root?.querySelector("#orbital-lab");
    if (!root || !start || !end || !orbitalLab) return undefined;

    function updateJourneyThread() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const rootBounds = root.getBoundingClientRect();
        const startBounds = start.getBoundingClientRect();
        const endBounds = end.getBoundingClientRect();
        const orbitalBounds = orbitalLab.getBoundingClientRect();
        const width = Math.max(rootBounds.width, 1);
        const height = Math.max(rootBounds.height, 1);
        const startX = startBounds.left + startBounds.width / 2 - rootBounds.left;
        const startY = startBounds.top + startBounds.height / 2 - rootBounds.top;
        const endX = endBounds.left + endBounds.width / 2 - rootBounds.left;
        const endY = endBounds.top + endBounds.height / 2 - rootBounds.top;
        const orbitalTop = orbitalBounds.top - rootBounds.top;
        const edgeX = width + clamp(width * 0.025, 24, 42);
        const distanceToEdge = Math.max(edgeX - startX, 80);
        const exitY = Math.min(
          startY + clamp((orbitalTop - startY) * 0.34, 72, 170),
          orbitalTop - 28,
        );
        const entryY = orbitalTop + clamp((endY - orbitalTop) * 0.17, 64, 148);
        const outboundPath = [
          `M ${startX.toFixed(1)} ${startY.toFixed(1)}`,
          `C ${(startX + distanceToEdge * 0.34).toFixed(1)} ${(startY + 18).toFixed(1)}`,
          `${(edgeX - distanceToEdge * 0.2).toFixed(1)} ${(exitY - 34).toFixed(1)}`,
          `${edgeX.toFixed(1)} ${exitY.toFixed(1)}`,
        ].join(" ");
        const inboundPath = [
          `M ${edgeX.toFixed(1)} ${entryY.toFixed(1)}`,
          `C ${(width - clamp(width * 0.045, 38, 74)).toFixed(1)} ${(entryY + 48).toFixed(1)}`,
          `${(endX + Math.max((width - endX) * 0.32, 92)).toFixed(1)} ${(endY - Math.max((endY - entryY) * 0.38, 92)).toFixed(1)}`,
          `${endX.toFixed(1)} ${endY.toFixed(1)}`,
        ].join(" ");

        const nextThread = {
          width: Number(width.toFixed(1)),
          height: Number(height.toFixed(1)),
          endX: Number(endX.toFixed(1)),
          endY: Number(endY.toFixed(1)),
          outboundPath,
          inboundPath,
        };
        setJourneyThread((current) => (
          current?.outboundPath === outboundPath && current?.inboundPath === inboundPath
            ? current
            : nextThread
        ));
      });
    }

    updateJourneyThread();
    const entranceEndsAt = window.performance.now() + 1400;
    function followEntrance() {
      updateJourneyThread();
      if (window.performance.now() < entranceEndsAt) {
        entranceFrame = window.requestAnimationFrame(followEntrance);
      }
    }
    entranceFrame = window.requestAnimationFrame(followEntrance);

    const animatedStart = start.closest(".reveal");
    animatedStart?.addEventListener("animationend", updateJourneyThread);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateJourneyThread);
    resizeObserver?.observe(root);
    resizeObserver?.observe(start);
    resizeObserver?.observe(end);
    resizeObserver?.observe(orbitalLab);
    window.addEventListener("resize", updateJourneyThread);

    return () => {
      resizeObserver?.disconnect();
      animatedStart?.removeEventListener("animationend", updateJourneyThread);
      window.removeEventListener("resize", updateJourneyThread);
      if (frame) window.cancelAnimationFrame(frame);
      if (entranceFrame) window.cancelAnimationFrame(entranceFrame);
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
          <path className="journey-thread-path journey-thread-path--outbound" d={journeyThread.outboundPath} />
          <path className="journey-thread-path journey-thread-path--inbound" d={journeyThread.inboundPath} />
          <circle key={journeyThread.outboundPath} className="journey-thread-signal journey-thread-signal--outbound" r="5">
            <animateMotion dur="5.8s" repeatCount="indefinite" path={journeyThread.outboundPath} />
          </circle>
          <circle key={journeyThread.inboundPath} className="journey-thread-signal journey-thread-signal--inbound" r="5">
            <animateMotion begin="1.4s" dur="6.6s" repeatCount="indefinite" path={journeyThread.inboundPath} />
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

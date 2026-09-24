"use client";

import cliSpinners from "cli-spinners";
import { useEffect, useRef } from "react";

const spinner = cliSpinners.dots;

export default function TerminalSpinner() {
  const glyph = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const element = glyph.current;
    if (!element) return;
    const spinnerElement: HTMLSpanElement = element;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let timer = 0;

    function stop() {
      window.clearInterval(timer);
      timer = 0;
      spinnerElement.textContent = spinner.frames[0];
    }

    function start() {
      stop();
      if (reducedMotion.matches) return;
      timer = window.setInterval(() => {
        frame = (frame + 1) % spinner.frames.length;
        spinnerElement.textContent = spinner.frames[frame];
      }, spinner.interval);
    }

    start();
    reducedMotion.addEventListener("change", start);
    return () => {
      reducedMotion.removeEventListener("change", start);
      window.clearInterval(timer);
    };
  }, []);

  return <span ref={glyph} className="terminal-spinner" aria-hidden="true">{spinner.frames[0]}</span>;
}

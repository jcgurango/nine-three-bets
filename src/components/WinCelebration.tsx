"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/delta";
import { credits } from "@/lib/format";

export interface Win {
  /** Changes for every new win so the celebration restarts. */
  key: number;
  amount: number;
  subtitle: string;
  bestOdds: number;
}

/** Matches the length of public/winner.mp3. */
const DURATION_MS = 5000;
const COUNT_MS = 1400;

/** Valorant-style round banner: bigger wins get a bigger word and more confetti. */
function tier(win: Win): { word: string; power: number } {
  if (win.amount >= 40_000) return { word: "Flawless", power: 2.4 };
  if (win.bestOdds >= 3) return { word: "Thrifty", power: 1.6 };
  if (win.amount >= 15_000) return { word: "Ace", power: 1.7 };
  if (win.amount >= 5_000) return { word: "Clutch", power: 1.2 };
  return { word: "Nice", power: 0.8 };
}

export function WinCelebration({
  win,
  muted,
  onDone,
}: {
  win: Win;
  muted: boolean;
  onDone: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [counted, setCounted] = useState(0);
  const { word, power } = tier(win);

  useEffect(() => {
    const reduced = prefersReducedMotion();
    const done = setTimeout(onDone, DURATION_MS);

    const audio = new Audio("/winner.mp3");
    audio.volume = 0.8;
    audioRef.current = audio;
    // Browsers block sound until the player has interacted with the page; the visuals still run.
    audio.play().catch(() => {});

    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const t = reduced ? 1 : Math.min(1, (now - start) / COUNT_MS);
      setCounted(Math.round(win.amount * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    });

    const main = document.getElementById("app-main");
    let stopConfetti = () => {};
    if (!reduced) {
      main?.classList.add("win-shake");
      if (canvasRef.current) stopConfetti = launchConfetti(canvasRef.current, power);
    }

    return () => {
      clearTimeout(done);
      cancelAnimationFrame(raf);
      stopConfetti();
      main?.classList.remove("win-shake");
      audio.pause();
    };
  }, [win, power, onDone]);

  // Runs after the effect above, so a muted player never hears the first note.
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  return (
    <div className="win-overlay" aria-hidden>
      <div className="win-flash" />
      <div className="win-rays" />
      <div className="win-glow" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="win-banner">
        <div className="win-word-wrap">
          <div className="win-bar" />
          <div className="win-word font-display">{word}</div>
        </div>
        <div className="win-amount font-display">
          <span className="credit-icon" />+{credits(counted)}
        </div>
        <div className="win-sub">{win.subtitle}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- confetti

const COLORS = ["#ff4655", "#2bd4b4", "#f5c04a", "#ece8e1", "#ff8a3d", "#b784ff"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  size: number;
  color: string;
  coin: boolean;
  phase: number;
}

/**
 * A coin stamped with the credits icon, drawn once and reused for every falling
 * coin. Gold for wins; `tarnished` gives the dull grey one used for losses.
 */
export function makeCoinSprite(tarnished = false): HTMLCanvasElement {
  const size = 96;
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = size;
  const ctx = sprite.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size * 0.35, size * 0.3, 4, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, tarnished ? "#c9d1d9" : "#fff3c4");
  gradient.addColorStop(0.5, tarnished ? "#7d8894" : "#f5c04a");
  gradient.addColorStop(1, tarnished ? "#4a535d" : "#b97f10");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = tarnished ? "#2f363d" : "#8a5a00";
  ctx.stroke();

  const icon = new Image();
  icon.onload = () => {
    const stamp = document.createElement("canvas");
    stamp.width = stamp.height = size;
    const sctx = stamp.getContext("2d")!;
    const inset = size * 0.24;
    sctx.drawImage(icon, inset, inset, size - inset * 2, size - inset * 2);
    sctx.globalCompositeOperation = "source-in";
    sctx.fillStyle = tarnished ? "#2f363d" : "#7a4d00";
    sctx.fillRect(0, 0, size, size);
    ctx.drawImage(stamp, 0, 0);
  };
  icon.src = "/credits.svg";
  return sprite;
}

/**
 * Confetti cannons from both bottom corners plus a rain of spinning coins.
 * Returns a function that stops the animation.
 */
function launchConfetti(canvas: HTMLCanvasElement, power: number): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;
  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  const coinSprite = makeCoinSprite();
  const particles: Particle[] = [];
  const rand = (min: number, max: number) => min + Math.random() * (max - min);

  const cannon = (fromLeft: boolean, count: number) => {
    // Launch speed scales with the viewport so the burst reaches the top on any screen.
    const reach = Math.sqrt(height / 800);
    for (let i = 0; i < count; i++) {
      const angle = ((fromLeft ? -62 : -118) + rand(-24, 24)) * (Math.PI / 180);
      const speed = rand(1100, 2400) * reach;
      particles.push({
        x: fromLeft ? -10 : width + 10,
        y: height + 10,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: rand(0, Math.PI * 2),
        spin: rand(-9, 9),
        size: rand(8, 16),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        coin: false,
        phase: rand(0, Math.PI * 2),
      });
    }
  };

  const coinRain = (count: number) => {
    for (let i = 0; i < count; i++) {
      particles.push({
        x: rand(0, width),
        y: rand(-height * 0.9, -40),
        vx: rand(-50, 50),
        vy: rand(250, 600),
        rot: rand(0, Math.PI * 2),
        spin: rand(4, 9) * (Math.random() < 0.5 ? -1 : 1),
        size: rand(20, 38),
        color: "",
        coin: true,
        phase: 0,
      });
    }
  };

  const timers = [0, 260, 600, 1300].map((delay, i) =>
    setTimeout(() => {
      const count = Math.round((i === 3 ? 50 : 90) * power);
      cannon(true, count);
      cannon(false, count);
    }, delay),
  );
  timers.push(setTimeout(() => coinRain(Math.round(45 * power)), 200));
  timers.push(setTimeout(() => coinRain(Math.round(30 * power)), 1500));

  let last = performance.now();
  let raf = requestAnimationFrame(function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, width, height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (p.coin) {
        p.vy += 700 * dt;
      } else {
        // Paper: heavy drag so it bursts up fast, then flutters down.
        p.vy += 1500 * dt;
        p.vx *= 1 - 1.3 * dt;
        p.vy *= 1 - 1.3 * dt;
        p.x += Math.sin(now / 250 + p.phase) * 40 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.y > height + 60 && p.vy > 0) {
        particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.coin) {
        // Squash horizontally to fake a coin spinning in 3D.
        ctx.scale(Math.cos(p.rot) || 0.01, 1);
        ctx.drawImage(coinSprite, -p.size / 2, -p.size / 2, p.size, p.size);
      } else {
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(now / 120 + p.phase) || 0.01);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
  });

  return () => {
    cancelAnimationFrame(raf);
    timers.forEach(clearTimeout);
    window.removeEventListener("resize", resize);
  };
}

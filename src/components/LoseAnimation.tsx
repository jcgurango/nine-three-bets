"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/delta";
import { credits } from "@/lib/format";
import { makeCoinSprite } from "./WinCelebration";

export interface Loss {
  /** Changes for every new loss so the animation restarts. */
  key: number;
  /** Credits lost, as a positive number. */
  amount: number;
  subtitle: string;
  shortestOdds: number;
}

const DURATION_MS = 3700;
const COUNT_MS = 1200;
/**
 * When each of the three notes in public/loser.mp3 lands ("wah, wah, wahhh").
 * The sign drops in on the first, sags on the second and comes off its hinge
 * on the third, then falls off the screen as the last note dies away.
 */
const NOTE_MS = [150, 720, 1380];
const FALL_MS = 2650;

/** How the sign hangs at each stage; index 0 is before it has dropped in. */
const POSES = [
  "translateY(-120vh) rotate(-3deg)",
  "translateY(0) rotate(-2deg)",
  "translateY(0.12em) rotate(3deg)",
  "translateY(0.3em) rotate(13deg)",
  "translateY(130vh) rotate(48deg)",
];

function tier(loss: Loss): { word: string; power: number } {
  if (loss.amount >= 40_000) return { word: "9-3 Cursed", power: 2.2 };
  if (loss.shortestOdds <= 1.4) return { word: "Whiffed", power: 1.4 };
  if (loss.amount >= 15_000) return { word: "Eliminated", power: 1.6 };
  if (loss.amount >= 5_000) return { word: "Defeat", power: 1.2 };
  return { word: "Unlucky", power: 0.8 };
}

export function LoseAnimation({
  loss,
  muted,
  onDone,
}: {
  loss: Loss;
  muted: boolean;
  onDone: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [counted, setCounted] = useState(0);
  const [pose, setPose] = useState(0);
  const { word, power } = tier(loss);

  useEffect(() => {
    const reduced = prefersReducedMotion();
    const timers = [
      setTimeout(onDone, DURATION_MS),
      ...NOTE_MS.map((ms, i) => setTimeout(() => setPose(i + 1), reduced ? 0 : ms)),
    ];
    if (!reduced) timers.push(setTimeout(() => setPose(4), FALL_MS));

    const audio = new Audio("/loser.mp3");
    audio.volume = 0.8;
    audioRef.current = audio;
    // Browsers block sound until the player has interacted with the page; the visuals still run.
    audio.play().catch(() => {});

    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const t = reduced ? 1 : Math.min(1, Math.max(0, now - start - NOTE_MS[0]) / COUNT_MS);
      setCounted(Math.round(loss.amount * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    });

    const main = document.getElementById("app-main");
    let stopCanvas = () => {};
    if (!reduced) {
      main?.classList.add("lose-slump");
      if (canvasRef.current) stopCanvas = startGloom(canvasRef.current, power);
    }

    return () => {
      timers.forEach(clearTimeout);
      cancelAnimationFrame(raf);
      stopCanvas();
      main?.classList.remove("lose-slump");
      audio.pause();
    };
  }, [loss, power, onDone]);

  // Runs after the effect above, so a muted player never hears the first note.
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  return (
    <div className="lose-overlay" aria-hidden>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="lose-banner">
        {/* Above the sign: it swings down from its top-left corner and would cover anything below. */}
        <div className={`lose-sub ${pose >= 1 && pose < 4 ? "opacity-100" : "opacity-0"}`}>
          {loss.subtitle}
        </div>
        <div className={`lose-sign ${pose === 4 ? "lose-sign-falling" : ""}`} style={{ transform: POSES[pose] }}>
          <div className="lose-word font-display">{word}</div>
          <div className="lose-amount font-display">
            <span className="credit-icon" />
            {"−"}
            {credits(counted)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- rain and lost coins

interface Coin {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  size: number;
}

/**
 * Rain over the whole screen, plus tarnished coins spilling out of the
 * player's balance and dropping away. Returns a function that stops it.
 */
function startGloom(canvas: HTMLCanvasElement, power: number): () => void {
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
  const rand = (min: number, max: number) => min + Math.random() * (max - min);

  const drops = Array.from({ length: Math.round(140 * power) }, () => ({
    x: rand(-0.2, 1.1),
    y: rand(-1, 1),
    speed: rand(900, 1500),
    length: rand(14, 30),
  }));

  // Coins leave from wherever the balance is shown, or the top right if it isn't on screen.
  const pill = document.getElementById("balance-pill")?.getBoundingClientRect();
  const origin = pill
    ? { x: pill.left + pill.width / 2, y: pill.top + pill.height / 2 }
    : { x: width - 120, y: 28 };
  const coinSprite = makeCoinSprite(true);
  const coins: Coin[] = [];
  const coinTotal = Math.round(16 * power);
  const spill = setInterval(() => {
    if (coins.length >= coinTotal) return clearInterval(spill);
    coins.push({
      x: origin.x + rand(-20, 20),
      y: origin.y,
      vx: rand(-260, 120),
      vy: rand(-320, -60),
      rot: rand(0, Math.PI * 2),
      spin: rand(5, 11) * (Math.random() < 0.5 ? -1 : 1),
      size: rand(22, 36),
    });
  }, 1400 / coinTotal);

  let last = performance.now();
  let raf = requestAnimationFrame(function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "rgb(150 180 210 / 0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const d of drops) {
      d.y += (d.speed * dt) / height;
      if (d.y > 1.05) {
        d.y = rand(-0.3, -0.05);
        d.x = rand(-0.2, 1.1);
      }
      const x = d.x * width + d.y * height * 0.18;
      const y = d.y * height;
      ctx.moveTo(x, y);
      ctx.lineTo(x + d.length * 0.18, y + d.length);
    }
    ctx.stroke();

    for (const c of coins) {
      c.vy += 1300 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.spin * dt;
      if (c.y > height + 60) continue;
      ctx.save();
      ctx.translate(c.x, c.y);
      // Squash horizontally to fake a coin spinning in 3D.
      ctx.scale(Math.cos(c.rot) || 0.01, 1);
      ctx.drawImage(coinSprite, -c.size / 2, -c.size / 2, c.size, c.size);
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
  });

  return () => {
    cancelAnimationFrame(raf);
    clearInterval(spill);
    window.removeEventListener("resize", resize);
  };
}

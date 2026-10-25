// Cosmic background: twinkling star field, parallax, shooting stars. Pauses when hidden.
const canvas = document.getElementById('bg-stars');
const ctx = canvas.getContext('2d');
let stars = [];
let shooters = [];
let w = 0, h = 0, dpr = 1;
let raf = 0, running = false;
let cfg = { shooting: true, parallax: true, animate: true, light: false };
let mx = 0, my = 0, tx = 0, ty = 0;
let nextShoot = 0;
let accentRgb = [139, 92, 246];
let density = 60;

function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  w = window.innerWidth; h = window.innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function build(density) {
  const count = Math.round((w * h) / 9000 * (density / 60));
  stars = Array.from({ length: count }, () => {
    const depth = Math.random();
    return {
      x: Math.random() * w, y: Math.random() * h, z: depth,
      r: 0.35 + depth * 1.25, base: 0.35 + Math.random() * 0.65,
      tw: 0.6 + Math.random() * 2.2, ph: Math.random() * Math.PI * 2,
      tint: Math.random() < 0.16 ? 1 : Math.random() < 0.1 ? 2 : 0,
    };
  });
}

function color(star, alpha) {
  if (cfg.light) return `rgba(${accentRgb[0]},${accentRgb[1]},${accentRgb[2]},${alpha * 0.8})`;
  if (star.tint === 1) return `rgba(190,170,255,${alpha})`;
  if (star.tint === 2) return `rgba(150,225,255,${alpha})`;
  return `rgba(255,255,255,${alpha})`;
}

function frame(t) {
  raf = requestAnimationFrame(frame);
  ctx.clearRect(0, 0, w, h);
  tx += (mx - tx) * 0.05; ty += (my - ty) * 0.05;
  const time = t / 1000;
  for (const s of stars) {
    const tw = cfg.animate ? 0.5 + 0.5 * Math.sin(time * s.tw + s.ph) : 1;
    const a = s.base * (0.35 + 0.65 * tw);
    const px = cfg.parallax ? tx * s.z * 26 : 0;
    const py = cfg.parallax ? ty * s.z * 18 : 0;
    const x = ((s.x + px) % w + w) % w;
    const y = ((s.y + py) % h + h) % h;
    ctx.fillStyle = color(s, a);
    ctx.beginPath(); ctx.arc(x, y, s.r, 0, 6.2832); ctx.fill();
    if (s.r > 1.25 && !cfg.light) { // soft glow for the brightest stars
      ctx.fillStyle = color(s, a * 0.12);
      ctx.beginPath(); ctx.arc(x, y, s.r * 3.4, 0, 6.2832); ctx.fill();
    }
  }
  if (cfg.shooting && cfg.animate && !cfg.light) {
    if (t > nextShoot) {
      const fromLeft = Math.random() < 0.5;
      shooters.push({ x: Math.random() * w * 0.8, y: Math.random() * h * 0.45, vx: (fromLeft ? 1 : 0.7) * (9 + Math.random() * 6), vy: 3.5 + Math.random() * 3, life: 0, max: 42 + Math.random() * 26 });
      nextShoot = t + 3500 + Math.random() * 7000;
    }
    shooters = shooters.filter((s) => s.life < s.max);
    for (const s of shooters) {
      s.life++; s.x += s.vx; s.y += s.vy;
      const k = 1 - s.life / s.max;
      const len = 90 * k + 20;
      const ang = Math.atan2(s.vy, s.vx);
      const g = ctx.createLinearGradient(s.x, s.y, s.x - Math.cos(ang) * len, s.y - Math.sin(ang) * len);
      g.addColorStop(0, `rgba(255,255,255,${0.9 * k})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - Math.cos(ang) * len, s.y - Math.sin(ang) * len); ctx.stroke();
    }
  }
}

function start() { if (running) return; running = true; raf = requestAnimationFrame(frame); }
function stop() { running = false; cancelAnimationFrame(raf); }

export function restartCosmos(a, theme) {
  stop();
  ctx.clearRect(0, 0, w, h);
  if (a.background !== 'cosmic') return;
  cfg = { shooting: a.shootingStars, parallax: a.parallax, animate: a.animations, light: theme === 'light' };
  accentRgb = hexRgb(a.accent);
  density = a.starDensity;
  resize(); build(density);
  if (a.animations) start();
  else { frame(0); cancelAnimationFrame(raf); running = false; }
}

window.addEventListener('resize', () => { if (running || stars.length) { resize(); build(density); } });
window.addEventListener('mousemove', (e) => { mx = e.clientX / window.innerWidth - 0.5; my = e.clientY / window.innerHeight - 0.5; }, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (stars.length && cfg.animate && document.documentElement.dataset.bg === 'cosmic') start(); });
resize();

// Particle system with object pooling.
// A fixed-size pool is pre-allocated once; emitters reuse dead slots
// instead of allocating new objects every frame.

const MAX_PARTICLES = 170;

// Hue ranges (degrees) rather than fixed swatches — every particle gets its
// own randomized hue/saturation/lightness within the range, so a cluster of
// particles reads as organic variation instead of the same 5 colors on loop.
const HUE_RANGES = {
  trail: [248, 280], // purple-blue
  burst: [8, 48], // fire: red-orange-yellow
  heart: [332, 356], // red-pink
};

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function hsl(h, s, l) {
  return `hsl(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;
}

function randomHueSat(effect, satRange = [75, 100]) {
  const [hueMin, hueMax] = HUE_RANGES[effect];
  return {
    hue: randRange(hueMin, hueMax),
    sat: randRange(satRange[0], satRange[1]),
  };
}

function randomParticleColor(effect, satRange = [75, 100], lightRange = [52, 72]) {
  const { hue, sat } = randomHueSat(effect, satRange);
  return hsl(hue, sat, randRange(lightRange[0], lightRange[1]));
}

class ParticleSystem {
  constructor(maxParticles) {
    this.max = maxParticles;
    this.pool = new Array(maxParticles);
    for (let i = 0; i < maxParticles; i++) {
      this.pool[i] = {
        alive: false,
        x: 0, y: 0,
        vx: 0, vy: 0,
        size: 0,
        startSize: 0,
        color: '#fff',
        coreColor: '#fff',
        shape: 'circle', // 'circle' | 'heart' | 'spark' | 'comet'
        additive: false,
        rotation: 0,
        rotSpeed: 0,
        twinklePhase: 0,
        twinkleSpeed: 0,
        age: 0,
        life: 0,
        gravity: 0,
        drag: 1,
      };
    }
    this.activeCount = 0;
  }

  // Finds a free slot, or steals the oldest (largest age ratio) particle
  // when the pool is fully saturated, so newest effects stay responsive.
  _acquire() {
    for (let i = 0; i < this.max; i++) {
      if (!this.pool[i].alive) return this.pool[i];
    }
    let oldest = this.pool[0];
    let oldestRatio = -1;
    for (let i = 0; i < this.max; i++) {
      const p = this.pool[i];
      const ratio = p.age / p.life;
      if (ratio > oldestRatio) {
        oldestRatio = ratio;
        oldest = p;
      }
    }
    return oldest;
  }

  emitTrail(x, y) {
    const p = this._acquire();
    if (!p.alive) this.activeCount++;
    p.alive = true;
    p.x = x;
    p.y = y;
    const angle = randRange(0, Math.PI * 2);
    const speed = randRange(0.1, 0.6);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed - 0.15;
    p.startSize = randRange(8, 16);
    p.size = p.startSize;
    const { hue, sat } = randomHueSat('trail');
    p.color = hsl(hue, sat, randRange(52, 72));
    // Pale, almost-white version of the same hue for the bright core —
    // cheap to compute once here rather than a per-frame gradient.
    p.coreColor = hsl(hue, sat * 0.3, 92);
    p.shape = 'comet';
    p.additive = false;
    p.rotation = 0;
    p.rotSpeed = 0;
    p.twinklePhase = randRange(0, Math.PI * 2);
    p.twinkleSpeed = randRange(0.5, 1.1);
    p.age = 0;
    p.life = randRange(45, 75); // ~0.75-1.25s at 60fps
    p.gravity = 0;
    p.drag = 0.96;
  }

  // Fountain-style sparkle emission — called every frame while the peace
  // gesture is held (not a one-shot burst), so it reads as a continuous
  // shower of fireworks-style sparks rather than a single pop.
  emitBurst(x, y) {
    const count = 2;
    for (let i = 0; i < count; i++) {
      const p = this._acquire();
      if (!p.alive) this.activeCount++;
      p.alive = true;
      p.x = x;
      p.y = y;
      const angle = randRange(-Math.PI * 0.85, -Math.PI * 0.15); // upward cone
      const speed = randRange(2.5, 7.5);
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.startSize = randRange(9, 19);
      p.size = p.startSize;
      p.color = randomParticleColor('burst', [80, 100], [55, 75]);
      p.shape = 'spark';
      p.additive = true;
      p.rotation = randRange(0, Math.PI * 2);
      p.rotSpeed = randRange(-0.3, 0.3);
      p.twinklePhase = randRange(0, Math.PI * 2);
      p.twinkleSpeed = randRange(0.4, 0.9);
      p.age = 0;
      p.life = randRange(20, 34);
      p.gravity = 0.15;
      p.drag = 0.97;
    }
  }

  emitHeart(x, y) {
    const p = this._acquire();
    if (!p.alive) this.activeCount++;
    p.alive = true;
    const angle = randRange(0, Math.PI * 2);
    const r = randRange(0, 6);
    p.x = x + Math.cos(angle) * r;
    p.y = y + Math.sin(angle) * r;
    p.vx = randRange(-0.3, 0.3);
    p.vy = randRange(-0.9, -0.3);
    p.startSize = randRange(13, 23);
    p.size = p.startSize;
    p.color = randomParticleColor('heart');
    p.shape = 'heart';
    p.additive = false;
    p.age = 0;
    p.life = randRange(50, 80);
    p.gravity = -0.01;
    p.drag = 0.97;
  }

  update() {
    let active = 0;
    for (let i = 0; i < this.max; i++) {
      const p = this.pool[i];
      if (!p.alive) continue;
      p.age++;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      p.vy += p.gravity;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotSpeed;

      const lifeRatio = p.age / p.life;
      p.size = p.startSize * (1 - lifeRatio);
      active++;
    }
    this.activeCount = active;
  }

  draw(ctx) {
    let mode = 'source-over';
    ctx.globalCompositeOperation = mode;

    for (let i = 0; i < this.max; i++) {
      const p = this.pool[i];
      if (!p.alive) continue;
      const lifeRatio = p.age / p.life;
      let alpha = Math.max(0, 1 - lifeRatio);
      if (p.size <= 0.1) continue;

      if (p.shape === 'spark' || p.shape === 'comet') {
        // Fast flicker on top of the fade-out, so these read as glittery
        // rather than smoothly dimming. Comet flicker stays shallower
        // (never drops below ~55%) so the trail still reads as continuous.
        const t = 0.5 + 0.5 * Math.sin(p.age * p.twinkleSpeed + p.twinklePhase);
        alpha *= p.shape === 'comet' ? 0.55 + 0.45 * t : t;
        alpha = Math.max(0, alpha);
      }

      const wantMode = p.additive ? 'lighter' : 'source-over';
      if (wantMode !== mode) {
        mode = wantMode;
        ctx.globalCompositeOperation = mode;
      }

      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;

      // shadowBlur is too expensive to use here — glow instead comes from
      // additive blending (sparks) or a cheap two-fill halo+core (comet),
      // never a per-shape blur pass.

      if (p.shape === 'heart') {
        drawHeart(ctx, p.x, p.y, p.size);
      } else if (p.shape === 'spark') {
        drawSpark(ctx, p.x, p.y, p.size, p.rotation);
      } else if (p.shape === 'comet') {
        drawComet(ctx, p.x, p.y, p.size, p.color, p.coreColor, alpha);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = Math.max(0.75, p.size * 0.12);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

function drawHeart(ctx, x, y, size) {
  const s = size / 8;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 3 * s);
  ctx.bezierCurveTo(-8 * s, -4 * s, -4 * s, -8 * s, 0, -2 * s);
  ctx.bezierCurveTo(4 * s, -8 * s, 8 * s, -4 * s, 0, 3 * s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = Math.max(0.75, size * 0.1);
  ctx.stroke();
  ctx.restore();
}

// Classic 4-point sparkle/star shape, with a small glowing core so it
// reads as a bright glinting particle rather than a flat polygon.
function drawSpark(ctx, x, y, size, rotation) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);

  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.18, -size * 0.18);
  ctx.lineTo(size, 0);
  ctx.lineTo(size * 0.18, size * 0.18);
  ctx.lineTo(0, size);
  ctx.lineTo(-size * 0.18, size * 0.18);
  ctx.lineTo(-size, 0);
  ctx.lineTo(-size * 0.18, -size * 0.18);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, size * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  ctx.restore();
}

// Soft outer halo + bright inner core — a cheap stand-in for a radial
// gradient (no per-frame gradient allocation) that still reads as an
// inner glow, giving the trail a comet-like look.
function drawComet(ctx, x, y, size, color, coreColor, baseAlpha) {
  ctx.globalAlpha = baseAlpha * 0.45;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = baseAlpha;
  ctx.fillStyle = coreColor;
  ctx.beginPath();
  ctx.arc(x, y, size * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

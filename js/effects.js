// 타격감을 위한 가벼운 연출: 히트 스파크와 화면 흔들림.

const SPARK_LIFE = 0.32;

class HitSparks {
  constructor() {
    this.particles = [];
  }

  burst(x, y, facing, scale) {
    const count = 7;
    for (let i = 0; i < count; i += 1) {
      const angle = (-0.9 + Math.random() * 1.8) + (facing > 0 ? 0 : Math.PI);
      const speed = (140 + Math.random() * 200) * scale;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60 * scale,
        life: SPARK_LIFE,
        size: (3 + Math.random() * 4) * scale,
      });
    }
  }

  update(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 900 * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  draw(ctx, cameraX) {
    ctx.save();
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / SPARK_LIFE, 0, 1);
      ctx.fillStyle = p.life > SPARK_LIFE * 0.5 ? "#fff6c9" : "#ffb03a";
      ctx.fillRect(p.x - cameraX - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }

  clear() {
    this.particles.length = 0;
  }
}

class ScreenShake {
  constructor() {
    this.time = 0;
    this.power = 0;
  }

  kick(power, duration) {
    this.power = Math.max(this.power, power);
    this.time = Math.max(this.time, duration);
  }

  update(dt) {
    if (this.time <= 0) return;
    this.time -= dt;
    if (this.time <= 0) this.power = 0;
  }

  get offset() {
    if (this.time <= 0) return { x: 0, y: 0 };
    return {
      x: (Math.random() - 0.5) * 2 * this.power,
      y: (Math.random() - 0.5) * 2 * this.power,
    };
  }

  clear() {
    this.time = 0;
    this.power = 0;
  }
}

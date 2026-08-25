// 적을 쓰러뜨렸을 때 낮은 확률로 떨어지는 회복 아이템.
// 튀어올랐다 착지한 뒤, 일정 시간이 지나면 깜빡이다 사라진다.

class Pickup {
  constructor(image, x, y) {
    this.image = image;
    this.x = x;
    this.y = y;      // 그림자가 놓이는 바닥 y (= 깊이)
    this.height = 0; // 바닥에서 떠 있는 높이
    this.vz = CONFIG.pickup.bounceSpeed;
    this.life = CONFIG.pickup.lifetimeMs / 1000;
    this.taken = false;
  }

  get expired() {
    return this.taken || this.life <= 0;
  }

  get scale() {
    return depthScale(this.y) * CONFIG.pickup.scale;
  }

  /** 사라지기 직전 깜빡임. */
  get visible() {
    const blink = CONFIG.pickup.blinkMs / 1000;
    if (this.life > blink) return true;
    return Math.floor(this.life * 10) % 2 === 0;
  }

  update(dt) {
    this.life -= dt;

    if (this.height > 0 || this.vz > 0) {
      this.height += this.vz * dt;
      this.vz -= CONFIG.pickup.gravity * dt;

      if (this.height <= 0) {
        this.height = 0;
        this.vz = -this.vz * CONFIG.pickup.bounceDamping;
        if (Math.abs(this.vz) < 40) this.vz = 0;
      }
    }
  }

  overlaps(player) {
    const { rangeX, rangeY } = CONFIG.pickup;
    if (Math.abs(player.y - this.y) > rangeY) return false;
    return Math.abs(player.x - this.x) <= rangeX * this.scale;
  }

  draw(ctx, cameraX) {
    if (!this.visible) return;

    const screenX = this.x - cameraX;
    const scale = this.scale;
    const width = this.image.width * scale;
    const height = this.image.height * scale;

    drawShadow(ctx, screenX, this.y, width * 0.4, 0.28);
    ctx.drawImage(this.image, screenX - width / 2, this.y - this.height - height, width, height);
  }
}

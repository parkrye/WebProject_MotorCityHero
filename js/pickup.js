// 적을 쓰러뜨렸을 때 낮은 확률로 떨어지는 아이템.
// 튀어올랐다 착지한 뒤, 일정 시간이 지나면 깜빡이다 사라진다.
// kind 가 "heal" 이면 생명, 나머지(attack · shield · speed)는 버프다.
//
// 범위는 두 겹이다. 바깥(magnet)에 들어오면 플레이어 쪽으로 끌려오기 시작하고,
// 끌려오다 안쪽(rangeX · rangeY)에 닿으면 그때 먹힌다.

class Pickup {
  constructor(image, x, y, kind = "heal") {
    this.image = image;
    this.kind = kind;
    this.x = x;
    this.y = y;      // 그림자가 놓이는 바닥 y (= 깊이)
    this.height = 0; // 바닥에서 떠 있는 높이
    this.vz = CONFIG.pickup.bounceSpeed;
    this.life = CONFIG.pickup.lifetimeMs / 1000;
    this.taken = false;
    this.pullSpeed = 0; // 0 이면 아직 안 끌리는 중
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

  /** 튀어오름이 끝나 바닥에 놓였는지. 자석은 이때부터 작동한다. */
  get landed() {
    return this.height <= 0 && this.vz === 0;
  }

  /** @param {Player} [player]  자석이 노릴 대상. 없거나 쓰러졌으면 끌지 않는다 */
  update(dt, player) {
    this.life -= dt;

    if (this.landed && player && !player.downed) this.#pull(dt, player);

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

  /**
   * 자석 범위 안이면 플레이어 쪽으로 끌어당긴다.
   * 처음에는 느리게 출발해 가까워질수록 빨라지고, 범위를 벗어나면 그 자리에 멈춘다.
   */
  #pull(dt, player) {
    const { rangeX, rangeY, speed, accel, maxSpeed } = CONFIG.pickup.magnet;
    const dx = player.x - this.x;
    const dy = player.y - this.y;

    if (Math.abs(dy) > rangeY || Math.abs(dx) > rangeX * this.scale) {
      this.pullSpeed = 0;
      return;
    }

    this.pullSpeed = this.pullSpeed === 0
      ? speed
      : Math.min(maxSpeed, this.pullSpeed + accel * dt);

    // 지나쳐서 왔다 갔다 하지 않도록 남은 거리보다 더 가지 않는다.
    const distance = Math.hypot(dx, dy) || 1;
    const step = Math.min(this.pullSpeed * dt, distance);
    this.x += (dx / distance) * step;
    this.y += (dy / distance) * step;
  }

  /** 실제로 먹는 범위. 자석에 끌려와 여기 닿으면 획득이다. */
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

    drawShadow(ctx, screenX, this.y, width * 0.4, "#000", 0.28);
    ctx.drawImage(this.image, screenX - width / 2, this.y - this.height - height, width, height);
  }
}

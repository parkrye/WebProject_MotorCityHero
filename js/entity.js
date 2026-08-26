// 플레이어/에너미가 공유하는 액터 기반 클래스.
// 좌표계: x 는 월드 가로 좌표, y 는 발끝의 화면 세로 좌표(= 깊이).

/** 도로 안쪽(위)일수록 작게, 앞쪽(아래)일수록 크게. 고전 벨트스크롤 원근. */
function depthScale(y) {
  const { top, bottom, scaleFar, scaleNear } = CONFIG.stage;
  const t = clamp((y - top) / (bottom - top), 0, 1);
  return scaleFar + (scaleNear - scaleFar) * t;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

class Actor {
  constructor({ x, y, animator, maxHp, bodyWidth }) {
    this.x = x;
    this.y = y;
    this.facing = 1; // 1 = 오른쪽(정방향), -1 = 왼쪽(반전)
    this.animator = animator;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.bodyWidth = bodyWidth; // 밀림/충돌 판정용 반폭 (배율 적용 전)
    this.knockbackX = 0;
    this.flashTimer = 0;
    this.dead = false;
  }

  get scale() {
    return depthScale(this.y);
  }

  get isFlipped() {
    return this.facing === -1;
  }

  /** 히트 이펙트용 흰 플래시. 살아있는 동안만 색을 반환한다. */
  get tint() {
    return this.flashTimer > 0 ? "rgba(255, 245, 245, 0.72)" : null;
  }

  takeDamage(amount, fromX) {
    this.hp -= amount;
    this.flashTimer = 0.12;
    this.facing = fromX > this.x ? 1 : -1;
    return this.hp <= 0;
  }

  applyKnockback(speed, fromX) {
    this.knockbackX = fromX > this.x ? -speed : speed;
  }

  /** 넉백 감쇠 + 플래시 타이머. 하위 클래스의 update 앞부분에서 호출한다. */
  updateCommon(dt) {
    if (this.flashTimer > 0) this.flashTimer -= dt;

    if (this.knockbackX !== 0) {
      this.x += this.knockbackX * dt;
      this.knockbackX *= Math.pow(0.0025, dt); // 지수 감쇠
      if (Math.abs(this.knockbackX) < 6) this.knockbackX = 0;
    }

    this.animator.update(dt);
  }

  clampToStage(margin = 0) {
    this.x = clamp(this.x, margin, CONFIG.world.width - margin);
    this.y = clamp(this.y, CONFIG.stage.top, CONFIG.stage.bottom);
  }

  draw(ctx, cameraX) {
    const screenX = this.x - cameraX;
    const scale = this.scale;
    drawShadow(ctx, screenX, this.y, this.bodyWidth * scale * 1.1);
    this.animator.draw(ctx, screenX, this.y, scale, this.isFlipped, { tint: this.tint });
  }
}

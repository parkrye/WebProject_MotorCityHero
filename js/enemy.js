// 에너미. enemy_1 ~ enemy_6 으로 갈수록 강해진다.
// 원본 GIF 가 한 종류뿐이라 이동/대기를 같은 루프로 쓰고,
// 공격은 준비 동작(정지) → 타격 → 쿨다운 으로 표현한다.

const ENEMY_STATE = { APPROACH: "approach", WINDUP: "windup", COOLDOWN: "cooldown", DYING: "dying" };

const ENEMY_DEATH_MS = 480;
const ENEMY_STAGGER_MS = 160;
const ENEMY_DEPTH_TOLERANCE = 26;

class Enemy extends Actor {
  constructor(anims, stats, x, y) {
    const animator = new Animator(anims);
    animator.play("move");

    super({
      x,
      y,
      animator,
      maxHp: stats.hp,
      bodyWidth: animator.sheet.frameWidth * 0.26,
    });

    this.stats = stats;
    this.state = ENEMY_STATE.APPROACH;
    this.timer = 0;
    this.staggerTimer = 0;
    this.deathTimer = 0;
    this.scoreGiven = false;
  }

  get scale() {
    return depthScale(this.y) * this.stats.scale;
  }

  get isDying() {
    return this.state === ENEMY_STATE.DYING;
  }

  /**
   * @param {Player[]} players  노릴 수 있는 플레이어들
   * @returns {Player|null} 이번 프레임에 때린 플레이어. 게임 루프가 데미지를 적용한다.
   */
  update(dt, players) {
    this.updateCommon(dt);

    if (this.isDying) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.dead = true;
      return null;
    }

    if (this.staggerTimer > 0) {
      this.staggerTimer -= dt;
      return null;
    }

    const target = this.#pickTarget(players);
    if (!target) return null;

    this.timer -= dt;

    if (this.state === ENEMY_STATE.WINDUP) return this.#updateWindup(target);
    if (this.state === ENEMY_STATE.COOLDOWN && this.timer > 0) return null;

    this.state = ENEMY_STATE.APPROACH;
    this.#approach(dt, target);
    return null;
  }

  /** 가장 가까운 플레이어를 노린다. 쓰러진 쪽은 쳐다보지 않는다. */
  #pickTarget(players) {
    let best = null;
    let bestDistance = Infinity;

    for (const player of players) {
      if (player.downed) continue;

      // 깊이 차이는 좁히기 더 어려우므로 가중치를 준다.
      const distance = Math.hypot(player.x - this.x, (player.y - this.y) * 1.6);
      if (distance >= bestDistance) continue;

      best = player;
      bestDistance = distance;
    }
    return best;
  }

  #updateWindup(player) {
    if (this.timer > 0) return null;

    this.state = ENEMY_STATE.COOLDOWN;
    this.timer = this.stats.attackCooldown / 1000;
    return this.#inAttackRange(player) ? player : null;
  }

  #approach(dt, player) {
    const dx = player.x - this.x;
    const dy = player.y - this.y;

    if (dx !== 0) this.facing = dx > 0 ? 1 : -1;

    if (this.#inAttackRange(player)) {
      this.state = ENEMY_STATE.WINDUP;
      this.timer = this.stats.windup / 1000;
      return;
    }

    // 깊이를 먼저 맞추고 옆으로 붙는다. 그래야 가로로만 겹치는 상황이 줄어든다.
    const speed = this.stats.speed;
    const distance = Math.hypot(dx, dy) || 1;
    this.x += (dx / distance) * speed * dt;
    this.y += (dy / distance) * speed * 0.55 * dt;

    this.clampToStage(0);
  }

  #inAttackRange(player) {
    if (Math.abs(player.y - this.y) > ENEMY_DEPTH_TOLERANCE) return false;
    return Math.abs(player.x - this.x) <= this.stats.attackRange * this.scale;
  }

  takeDamage(amount, fromX) {
    if (this.isDying) return false;

    const killed = super.takeDamage(amount, fromX);
    this.applyKnockback(CONFIG.player.attack.knockback, fromX);
    this.staggerTimer = ENEMY_STAGGER_MS / 1000;
    this.state = ENEMY_STATE.APPROACH;
    this.timer = 0;

    if (killed) {
      this.state = ENEMY_STATE.DYING;
      this.deathTimer = ENEMY_DEATH_MS / 1000;
    }
    return killed;
  }

  draw(ctx, cameraX) {
    const screenX = this.x - cameraX;
    const scale = this.scale;

    if (!this.isDying) {
      // 준비 동작은 살짝 뒤로 젖히는 느낌으로 예고한다.
      const lean = this.state === ENEMY_STATE.WINDUP ? -6 * scale * this.facing : 0;
      drawShadow(ctx, screenX, this.y, this.bodyWidth * scale * 1.1);
      this.animator.draw(ctx, screenX + lean, this.y, scale, this.isFlipped, { tint: this.tint });
      this.#drawHealthBar(ctx, screenX, scale);
      return;
    }

    const t = 1 - this.deathTimer / (ENEMY_DEATH_MS / 1000);
    ctx.save();
    ctx.translate(screenX, this.y - t * 26);
    ctx.rotate(this.facing * t * 0.5);
    this.animator.draw(ctx, 0, 0, scale, this.isFlipped, {
      tint: "rgba(90, 20, 20, 0.55)",
      alpha: 1 - t,
    });
    ctx.restore();
  }

  #drawHealthBar(ctx, screenX, scale) {
    if (this.hp >= this.maxHp) return;

    const width = 46 * scale;
    const height = 5;
    const top = this.y - this.animator.sheet.frameHeight * scale - 10;
    const ratio = clamp(this.hp / this.maxHp, 0, 1);

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(screenX - width / 2 - 1, top - 1, width + 2, height + 2);
    ctx.fillStyle = "#e5484d";
    ctx.fillRect(screenX - width / 2, top, width * ratio, height);
    ctx.restore();
  }
}

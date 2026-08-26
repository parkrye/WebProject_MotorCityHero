// 에너미. 번호가 커질수록 강해진다.
// 원본 GIF 가 한 종류뿐이라 이동/대기를 같은 루프로 쓰고,
// 공격은 준비 동작(정지) → 타격 → 쿨다운 으로 표현한다.
//
// 체력만 불리면 다 똑같이 걸어오므로 번호마다 다가오는 규칙을 다르게 준다.

// APPROACH(다가옴) → WINDUP(예고. 판정 없음) → STRIKE(판정이 켜져 있는 짧은 구간)
// → COOLDOWN. 판정은 STRIKE 동안에만 살아 있으므로 예고를 보고 빠지면 피할 수 있다.
const ENEMY_STATE = {
  APPROACH: "approach",
  WINDUP: "windup",
  STRIKE: "strike",
  COOLDOWN: "cooldown",
  DYING: "dying",
};

const ENEMY_BEHAVIOR = {
  STRAIGHT: "straight",     // 곧장 다가온다
  ZIGZAG: "zigzag",         // 깊이축으로 물결치며 다가온다
  FLANK: "flank",           // 등 뒤로 돌아 들어온다
  DASH: "dash",             // 멈췄다 짧게 치고 들어온다
  HIT_AND_RUN: "hitAndRun", // 때리면 물러났다 다시 붙는다
  STALK: "stalk",           // 사거리 밖을 맴돌다 파고든다
};

const ENEMY_DEATH_MS = 480;
const ENEMY_STAGGER_MS = 160;

class Enemy extends Actor {
  /** @param {boolean} options.boss  최종보스면 체력과 크기를 키운다 */
  constructor(anims, stats, x, y, { boss = false } = {}) {
    const animator = new Animator(anims);
    animator.play("move");

    super({
      x,
      y,
      animator,
      maxHp: boss ? Math.round(stats.hp * CONFIG.boss.hpMultiplier) : stats.hp,
      // 배율 적용 전 값이다. 보스 배율은 scale 에 이미 들어 있으므로 여기서 또 곱하지 않는다.
      bodyWidth: animator.sheet.frameWidth * 0.26,
    });

    this.boss = boss;
    this.stats = stats;
    this.behavior = stats.behavior ?? ENEMY_BEHAVIOR.STRAIGHT;
    this.state = ENEMY_STATE.APPROACH;
    this.timer = 0;
    this.staggerTimer = 0;
    this.deathTimer = 0;
    this.scoreGiven = false;

    // 같은 종류가 여럿 나와도 한 몸처럼 움직이지 않도록 위상을 흩어둔다.
    this.moveTime = Math.random() * 4;
    this.hitLanded = false; // 한 번의 STRIKE 에 한 대만 들어간다
    this.retreatTimer = 0;
    this.lunging = false;
    this.lungeTimer = CONFIG.enemyBehavior.stalk.waitMs / 1000;
  }

  get scale() {
    return depthScale(this.y) * this.stats.scale * (this.boss ? CONFIG.boss.scaleMultiplier : 1);
  }

  /**
   * 공격 판정에만 쓰는 배율. 보스는 몸(scale)만큼 사거리를 늘려주지 않는다.
   * 몸이 커진 만큼 피격 판정은 이미 커졌으므로, 여기까지 같이 키우면
   * "때리기는 어렵고 맞기는 쉬운" 역전이 생긴다.
   */
  get attackScale() {
    return depthScale(this.y) * this.stats.scale * (this.boss ? CONFIG.boss.reachMultiplier : 1);
  }

  /** 접근을 멈추고 준비 동작에 들어가는 거리. 실제 판정은 이보다 좁다. */
  get approachReach() {
    return this.stats.attackRange * this.attackScale;
  }

  get speed() {
    return this.stats.speed * (this.boss ? CONFIG.boss.speedMultiplier : 1);
  }

  get score() {
    return Math.round(this.stats.score * (this.boss ? CONFIG.boss.scoreMultiplier : 1));
  }

  get isDying() {
    return this.state === ENEMY_STATE.DYING;
  }

  /**
   * @param {Player} player  노릴 대상
   * @returns {boolean} 이번 프레임에 때렸는지. 데미지는 게임 루프가 적용한다.
   */
  update(dt, player) {
    this.updateCommon(dt);

    if (this.isDying) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.dead = true;
      return false;
    }

    if (this.staggerTimer > 0) {
      this.staggerTimer -= dt;
      return false;
    }

    if (player.downed) return false;

    this.timer -= dt;
    this.moveTime += dt;
    if (this.retreatTimer > 0) this.retreatTimer -= dt;

    if (this.state === ENEMY_STATE.WINDUP) return this.#updateWindup();
    if (this.state === ENEMY_STATE.STRIKE) return this.#updateStrike(player);
    if (this.state === ENEMY_STATE.COOLDOWN && this.timer > 0) {
      // 치고 빠지는 부류만 쿨다운 동안 뒤로 물러난다.
      if (this.retreatTimer > 0) this.#retreat(dt, player);
      return false;
    }

    this.state = ENEMY_STATE.APPROACH;
    this.#approach(dt, player);
    return false;
  }

  /** 준비 동작. 여기서는 판정이 없다. 끝나면 판정을 켠다. */
  #updateWindup() {
    if (this.timer > 0) return false;

    this.state = ENEMY_STATE.STRIKE;
    this.timer = CONFIG.hitbox.enemyActiveMs / 1000;
    this.hitLanded = false;
    return false;
  }

  /**
   * 판정이 켜져 있는 짧은 구간. 매 프레임 검사하므로 이 동안 창 안에
   * 들어오면 맞고, 예고를 보고 빠져나갔으면 헛친다.
   */
  #updateStrike(player) {
    const landed = !this.hitLanded && this.#attackHits(player);
    if (landed) this.hitLanded = true;

    if (this.timer <= 0) {
      this.state = ENEMY_STATE.COOLDOWN;
      this.timer = this.stats.attackCooldown / 1000;

      if (this.behavior === ENEMY_BEHAVIOR.HIT_AND_RUN) {
        this.retreatTimer = CONFIG.enemyBehavior.hitAndRun.retreatMs / 1000;
      }
    }
    return landed;
  }

  #approach(dt, player) {
    if (player.x !== this.x) this.facing = player.x > this.x ? 1 : -1;

    if (this.#inAttackRange(player)) {
      this.state = ENEMY_STATE.WINDUP;
      this.timer = this.stats.windup / 1000;
      return;
    }

    if (this.behavior === ENEMY_BEHAVIOR.STALK) this.#updateLunge(dt);

    const goal = this.#goal(player);
    const dx = goal.x - this.x;
    const dy = goal.y - this.y;
    const distance = Math.hypot(dx, dy) || 1;

    // 깊이를 먼저 맞추고 옆으로 붙는다. 그래야 가로로만 겹치는 상황이 줄어든다.
    const speed = this.speed * this.#speedFactor();
    this.x += (dx / distance) * speed * dt;
    this.y += (dy / distance) * speed * 0.55 * dt;

    this.clampToStage(0);
  }

  /** 이동 규칙별로 노리는 지점. 여기로 향하는 것만으로 성격이 갈린다. */
  #goal(player) {
    const rules = CONFIG.enemyBehavior;

    if (this.behavior === ENEMY_BEHAVIOR.ZIGZAG) {
      const { frequency, amplitude } = rules.zigzag;
      return { x: player.x, y: player.y + Math.sin(this.moveTime * frequency) * amplitude };
    }
    if (this.behavior === ENEMY_BEHAVIOR.FLANK) {
      // 플레이어가 보는 반대쪽. 앞을 막지 않고 등 뒤로 돌아 들어간다.
      return { x: player.x - player.facing * rules.flank.behind, y: player.y };
    }
    if (this.behavior === ENEMY_BEHAVIOR.STALK && !this.lunging) {
      const side = Math.sign(this.x - player.x) || 1;
      return { x: player.x + side * rules.stalk.orbit, y: player.y };
    }
    return { x: player.x, y: player.y };
  }

  /** 맴돌기와 파고들기를 번갈아 켠다. */
  #updateLunge(dt) {
    this.lungeTimer -= dt;
    if (this.lungeTimer > 0) return;

    const { waitMs, lungeMs } = CONFIG.enemyBehavior.stalk;
    this.lunging = !this.lunging;
    this.lungeTimer = (this.lunging ? lungeMs : waitMs) / 1000;
  }

  #speedFactor() {
    const rules = CONFIG.enemyBehavior;

    if (this.behavior === ENEMY_BEHAVIOR.DASH) {
      const { moveMs, restMs, boost } = rules.dash;
      const cycle = moveMs + restMs;
      return (this.moveTime * 1000) % cycle < moveMs ? boost : 0;
    }
    if (this.behavior === ENEMY_BEHAVIOR.STALK && this.lunging) {
      return rules.stalk.boost;
    }
    return 1;
  }

  /** 때린 뒤 물러나기. 물러나면서도 플레이어를 계속 본다. */
  #retreat(dt, player) {
    const away = Math.sign(this.x - player.x) || 1;
    this.facing = -away;
    this.x += away * this.speed * CONFIG.enemyBehavior.hitAndRun.boost * dt;
    this.clampToStage(0);
  }

  /** 준비 동작에 들어갈지. 판정 자체가 아니라 "이쯤에서 팔을 든다" 하는 거리다. */
  #inAttackRange(player) {
    if (Math.abs(player.y - this.y) > CONFIG.hitbox.enemyDepth * this.attackScale) return false;
    return Math.abs(player.x - this.x) <= this.approachReach;
  }

  /**
   * 실제로 닿는 판정. 접근 사거리보다 enemyReachRatio 만큼 좁고,
   * 바라보는 쪽으로만 나간다. 대신 플레이어 몸 가장자리까지 재준다.
   */
  #attackHits(player) {
    const depth = CONFIG.hitbox.enemyDepth * this.attackScale + player.hurtDepth;
    if (Math.abs(player.y - this.y) > depth) return false;

    const half = player.hurtHalfWidth;
    const dx = (player.x - this.x) * this.facing; // 바라보는 쪽을 + 로
    return dx > -half && dx < this.approachReach * CONFIG.hitbox.enemyReachRatio + half;
  }

  takeDamage(amount, fromX) {
    if (this.isDying) return false;

    const killed = super.takeDamage(amount, fromX);
    const resist = this.stats.knockbackResist ?? 0;
    this.applyKnockback(CONFIG.player.attack.knockback * (1 - resist), fromX);
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
      // 준비 동작은 뒤로 젖혔다가, 판정이 켜지는 순간 앞으로 내민다.
      // 판정이 상시가 아니라 이 구간에만 살아 있으므로 눈으로 읽히게 둔다.
      const lean = this.#leanOffset() * scale * this.facing;
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

  #leanOffset() {
    if (this.state === ENEMY_STATE.WINDUP) return -6;
    if (this.state === ENEMY_STATE.STRIKE) return 10;
    return 0;
  }

  /** 최종보스는 화면 위에 큰 게이지가 따로 뜨므로 머리 위에는 그리지 않는다. */
  #drawHealthBar(ctx, screenX, scale) {
    if (this.boss || this.hp >= this.maxHp) return;

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

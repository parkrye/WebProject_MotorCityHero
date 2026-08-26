// 플레이어. WASD 로 움직이고 J 로 펀치, K 로 킥을 낸다.
// 상태: idle / walk / attack / hit. 공격과 피격 중에는 이동 입력을 받지 않는다.
// 펀치와 킥은 대미지와 사거리가 같고, 깊이 판정만 위아래로 갈린다.
// 생명은 Game 이 들고 있고, 여기서는 "맞았다"까지만 판단한다.

const PLAYER_STATE = { IDLE: "idle", WALK: "walk", ATTACK: "attack", HIT: "hit" };

class Player extends Actor {
  constructor(anims, x, y, { audio = null, buffAnims = {}, powerStacks = 0 } = {}) {
    // 무엇에 맞든 한 대 = 생명 1. 개별 hp 는 쓰지 않는다.
    super({
      x,
      y,
      animator: new Animator(anims),
      maxHp: 1,
      bodyWidth: 38,
    });

    this.audio = audio;
    this.buffAnims = buffAnims;
    this.buffs = new Map(); // 종류 -> { timer, animator }. timer 가 Infinity 면 스테이지 끝까지
    this.powerStacks = powerStacks; // 누적 공격력 강화. 한 판 내내 유지된다.
    this.powerFlashTimer = 0;       // 파워업 직후 잠깐 뜨는 공격 오라
    this.powerAnimator = buffAnims.attack ? new Animator(buffAnims.attack) : null;
    this.powerAnimator?.play("loop");
    // 킥 시트가 아직 없는 빌드에서는 펀치 모션으로 대신 낸다.
    this.kickAnim = anims.kick ? "kick" : PLAYER_STATE.ATTACK;
    this.kicking = false; // 지금 나가는 공격이 킥인지. 깊이 판정이 갈린다.

    this.state = PLAYER_STATE.IDLE;
    this.downed = false;      // 생명이 0 이 되어 쓰러진 상태. 마지막 프레임을 유지한다.
    this.invincibleTimer = 0; // 컨티뉴 직후의 짧은 무적
    this.recoveryTimer = 0;
    // 인트로 연출용. entering 동안은 화면 밖에 있어도 스테이지 경계로 끌려오지 않는다.
    this.entering = true;
    this.autoWalkTargetX = null; // null 이 아니면 입력 대신 이 x 까지 자동으로 걸어온다
    this.hitThisSwing = new Set();
    this.animator.play(PLAYER_STATE.IDLE);
  }

  /** 누적 강화가 얹힌 실제 공격력. 스택 하나당 기본값의 perStack 만큼 더해진다. */
  get attackDamage() {
    return Math.round(CONFIG.player.attack.damage * (1 + this.powerStacks * CONFIG.power.perStack));
  }

  /**
   * 공격력 아이템을 먹는다. 상한에 닿아 있으면 아무 일도 없다.
   * @returns {number} 갱신된 스택 수
   */
  gainPower() {
    this.powerStacks = Math.min(CONFIG.power.maxStacks, this.powerStacks + 1);
    this.powerFlashTimer = CONFIG.buffs.powerFlashMs / 1000;
    return this.powerStacks;
  }

  get speedFactor() {
    return this.buffs.has("speed") ? CONFIG.buffs.speed.factor : 1;
  }

  /**
   * 버프를 건다. 같은 종류를 다시 먹으면 시간만 갱신되고,
   * 종류가 다르면 셋까지 함께 걸린다.
   */
  applyBuff(kind) {
    const def = CONFIG.buffs[kind];
    if (!def) return;

    const timer = def.durationMs === null ? Infinity : def.durationMs / 1000;
    const existing = this.buffs.get(kind);
    if (existing) {
      existing.timer = timer;
      return;
    }

    const anims = this.buffAnims[kind];
    const animator = anims ? new Animator(anims) : null;
    animator?.play("loop");
    this.buffs.set(kind, { timer, animator });
  }

  /**
   * 보호막이 있으면 한 대를 대신 맞고 사라진다.
   * @returns {boolean} 막아냈는지
   */
  consumeShield() {
    if (this.isInvincible || !this.buffs.has("shield")) return false;

    this.buffs.delete("shield");
    this.invincibleTimer = CONFIG.buffs.shield.graceMs / 1000;
    this.flashTimer = 0.2;
    return true;
  }

  /** HUD 표시용. 남은 시간이 Infinity 면 보호막처럼 시간 제한이 없는 것이다. */
  get activeBuffs() {
    return [...this.buffs].map(([kind, buff]) => ({ kind, seconds: buff.timer }));
  }

  #updateBuffs(dt) {
    if (this.powerFlashTimer > 0) {
      this.powerFlashTimer -= dt;
      this.powerAnimator?.update(dt);
    }

    for (const [kind, buff] of this.buffs) {
      buff.animator?.update(dt);
      if (buff.timer === Infinity) continue;

      buff.timer -= dt;
      if (buff.timer <= 0) this.buffs.delete(kind);
    }
  }

  get isBusy() {
    return this.state === PLAYER_STATE.ATTACK || this.state === PLAYER_STATE.HIT;
  }

  /** 쓰러졌거나, hit 애니메이션이 도는 동안, 그리고 부활 직후 잠깐은 맞지 않는다. */
  get isInvincible() {
    return this.downed || this.state === PLAYER_STATE.HIT || this.invincibleTimer > 0;
  }

  /**
   * 공격이 닿는 깊이 창. 펀치는 안쪽(위)으로, 킥은 앞쪽(아래)으로 치우친다.
   * @returns {{up: number, down: number}} 발끝 y 기준 위/아래 허용치
   */
  get attackDepth() {
    const { depthTolerance, depthBias } = CONFIG.player.attack;
    const bias = this.kicking ? -depthBias : depthBias;
    return { up: depthTolerance + bias, down: depthTolerance - bias };
  }

  /** 공격 애니메이션 중 판정이 살아있는 프레임 구간인지. */
  get isAttackActive() {
    if (this.state !== PLAYER_STATE.ATTACK) return false;
    const { activeFrom, activeTo } = CONFIG.player.attack;
    return this.animator.frame >= activeFrom && this.animator.frame <= activeTo;
  }

  /** @param {Pad} pad  이 플레이어에게 배정된 입력 */
  update(dt, pad, controllable) {
    this.updateCommon(dt);
    this.#updateBuffs(dt);

    if (this.invincibleTimer > 0) this.invincibleTimer -= dt;
    if (this.recoveryTimer > 0) this.recoveryTimer -= dt;

    // 쓰러진 뒤에는 애니메이터가 마지막 프레임에서 멈춰 있다. 상태를 건드리지 않는다.
    if (this.downed) return;

    // 인트로는 화면 밖에서 시작한다. 걸어 들어와 자리를 잡기 전까지는
    // 스테이지 경계를 적용하지 않는다. 클램프하면 왼쪽 끝으로 튀어 들어온다.
    if (this.entering) {
      this.#updateEntrance(dt);
      return;
    }

    if (this.isBusy) {
      this.#updateBusy();
    } else if (controllable) {
      this.#updateControl(dt, pad);
    } else {
      this.#enterState(PLAYER_STATE.IDLE);
    }

    this.clampToStage(this.bodyWidth);
  }

  /** 걸어 들어오라는 신호. 그전까지는 화면 밖에 가만히 서 있는다. */
  startWalkIn(targetX) {
    this.autoWalkTargetX = targetX;
  }

  #updateEntrance(dt) {
    // 아직 신호가 없으면 화면 밖에서 대기만 한다.
    if (this.autoWalkTargetX === null) {
      this.#enterState(PLAYER_STATE.IDLE);
      return;
    }

    this.facing = 1;
    this.#enterState(PLAYER_STATE.WALK);
    this.x += CONFIG.intro.walkSpeed * dt;

    if (this.x < this.autoWalkTargetX) return;

    this.x = this.autoWalkTargetX;
    this.autoWalkTargetX = null;
    this.entering = false;
    this.#enterState(PLAYER_STATE.IDLE);
  }

  #updateBusy() {
    if (!this.animator.finished) return;

    if (this.state === PLAYER_STATE.ATTACK) {
      this.recoveryTimer = CONFIG.player.attack.recovery / 1000;
    }
    this.#enterState(PLAYER_STATE.IDLE);
  }

  #updateControl(dt, pad) {
    if (this.recoveryTimer <= 0) {
      if (pad.justPressed("action")) return this.#startAttack(false);
      if (pad.justPressed("kick")) return this.#startAttack(true);
    }

    const move = pad.moveVector();

    // 좌우 입력이 있을 때만 방향을 갱신한다. 위/아래만 눌렀을 땐 보던 방향 유지.
    if (move.x !== 0) this.facing = move.x > 0 ? 1 : -1;

    if (move.x === 0 && move.y === 0) {
      this.#enterState(PLAYER_STATE.IDLE);
      return;
    }

    const factor = this.speedFactor;
    this.x += move.x * CONFIG.player.speedX * factor * dt;
    this.y += move.y * CONFIG.player.speedY * factor * dt;
    this.#enterState(PLAYER_STATE.WALK);
  }

  /** @param {boolean} kick  킥이면 아래쪽, 펀치면 위쪽으로 판정이 넓어진다. */
  #startAttack(kick) {
    this.audio?.play("attack");
    this.state = PLAYER_STATE.ATTACK;
    this.kicking = kick;
    this.hitThisSwing.clear();
    this.animator.play(kick ? this.kickAnim : PLAYER_STATE.ATTACK, { loop: false, restart: true });
  }

  #enterState(state) {
    if (this.state === state) return;
    this.state = state;
    this.animator.play(state, { loop: true });
  }

  /**
   * 한 번의 스윙에 같은 대상을 여러 번 때리지 않도록 걸러낸 히트 판정.
   *
   * 거리는 중심끼리가 아니라 **대상의 몸 가장자리까지** 재므로, 보스처럼 덩치가
   * 큰 상대는 그만큼 먼저 닿는다. 이게 "공격 판정 < 피격 판정" 의 한쪽 축이다.
   */
  canHit(target) {
    if (!this.isAttackActive || this.hitThisSwing.has(target)) return false;

    const { up, down } = this.attackDepth;
    const pad = target.hurtDepth;
    const depth = target.y - this.y; // + 가 앞쪽(아래), - 가 안쪽(위)
    if (depth < -(up + pad) || depth > down + pad) return false;

    const scale = this.scale;
    const half = target.hurtHalfWidth;
    const dx = (target.x - this.x) * this.facing; // 바라보는 쪽을 + 로
    return dx > -(18 * scale + half) && dx < CONFIG.player.attack.reach * scale + half;
  }

  registerHit(target) {
    this.hitThisSwing.add(target);
  }

  /**
   * 한 대 맞는다. 생명 차감은 팀 생명을 들고 있는 Game 이 한다.
   * @returns {boolean} 실제로 피격이 적용되었는지
   */
  takeDamage(fromX) {
    if (this.isInvincible) return false;

    this.flashTimer = 0.12;
    this.facing = fromX > this.x ? 1 : -1;
    this.applyKnockback(CONFIG.player.hit.knockback, fromX);
    this.state = PLAYER_STATE.HIT;
    this.animator.play(PLAYER_STATE.HIT, { loop: false, restart: true });
    return true;
  }

  /** 생명이 0 이 되었을 때. hit 마지막 프레임(쓰러진 자세)에서 멈춘다. */
  knockOut() {
    this.downed = true;
    this.buffs.clear(); // 쓰러지면 걸려 있던 버프는 사라진다. 누적 공격력은 남는다.
    if (this.state === PLAYER_STATE.HIT) return; // 맞고 넘어가는 중이면 그대로 이어서

    this.state = PLAYER_STATE.HIT;
    this.animator.play(PLAYER_STATE.HIT, { loop: false, restart: true });
  }

  /** 컨티뉴: 그 자리에서 일어나 잠깐 무적 상태로 다시 시작한다. */
  revive() {
    this.downed = false;
    this.invincibleTimer = CONFIG.player.continueGraceMs / 1000;
    this.knockbackX = 0;
    this.state = PLAYER_STATE.IDLE;
    this.animator.play(PLAYER_STATE.IDLE, { loop: true, restart: true });
  }

  draw(ctx, cameraX) {
    // 무적 동안 깜빡여서 알린다. 쓰러진 동안에는 깜빡이지 않는다.
    const blinking = !this.downed && this.invincibleTimer > 0 && this.state !== PLAYER_STATE.HIT;
    const alpha = blinking && Math.floor(this.invincibleTimer * 20) % 2 === 0 ? 0.35 : 1;

    const screenX = this.x - cameraX;
    const scale = this.scale;

    drawShadow(ctx, screenX, this.y, this.bodyWidth * scale * 1.1, CONFIG.player.shadowColor, 0.42);
    this.#drawBuffs(ctx, screenX, scale, alpha);
    this.animator.draw(ctx, screenX, this.y, scale, this.isFlipped, { tint: this.tint, alpha });
  }

  /**
   * 버프 이펙트는 발밑에 캐릭터보다 먼저 그려서 몸에 가려지게 둔다.
   * 발끝보다 offsetY 만큼 더 내려야 정강이가 아니라 바닥에서 피어오르는 것처럼 보인다.
   */
  #drawBuffs(ctx, screenX, scale, alpha) {
    if (this.downed) return;

    const y = this.y + CONFIG.buffs.offsetY * scale;
    const effectScale = scale * CONFIG.buffs.scale;

    if (this.powerFlashTimer > 0) {
      const fade = Math.min(1, this.powerFlashTimer / 0.35); // 사라질 때만 부드럽게 뺀다
      this.powerAnimator?.draw(ctx, screenX, y, effectScale, false, { alpha: alpha * 0.9 * fade });
    }

    for (const buff of this.buffs.values()) {
      buff.animator?.draw(ctx, screenX, y, effectScale, false, { alpha: alpha * 0.9 });
    }
  }
}

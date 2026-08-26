// 플레이어. WASD 로 움직이고 J 로 때린다.
// 상태: idle / walk / attack / hit. 공격과 피격 중에는 이동 입력을 받지 않는다.
// 생명은 Game 이 들고 있고, 여기서는 "맞았다"까지만 판단한다.

const PLAYER_STATE = { IDLE: "idle", WALK: "walk", ATTACK: "attack", HIT: "hit" };

class Player extends Actor {
  constructor(anims, x, y, { audio = null } = {}) {
    // 무엇에 맞든 한 대 = 생명 1. 개별 hp 는 쓰지 않는다.
    super({
      x,
      y,
      animator: new Animator(anims),
      maxHp: 1,
      bodyWidth: 38,
    });

    this.audio = audio;

    this.state = PLAYER_STATE.IDLE;
    this.downed = false;      // 생명이 0 이 되어 쓰러진 상태. 마지막 프레임을 유지한다.
    this.invincibleTimer = 0; // 컨티뉴 직후의 짧은 무적
    this.recoveryTimer = 0;
    this.autoWalkTargetX = null; // 인트로 연출용. null 이 아니면 입력 대신 자동 이동.
    this.hitThisSwing = new Set();
    this.animator.play(PLAYER_STATE.IDLE);
  }

  get isBusy() {
    return this.state === PLAYER_STATE.ATTACK || this.state === PLAYER_STATE.HIT;
  }

  /** 쓰러졌거나, hit 애니메이션이 도는 동안, 그리고 부활 직후 잠깐은 맞지 않는다. */
  get isInvincible() {
    return this.downed || this.state === PLAYER_STATE.HIT || this.invincibleTimer > 0;
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

    if (this.invincibleTimer > 0) this.invincibleTimer -= dt;
    if (this.recoveryTimer > 0) this.recoveryTimer -= dt;

    // 쓰러진 뒤에는 애니메이터가 마지막 프레임에서 멈춰 있다. 상태를 건드리지 않는다.
    if (this.downed) return;

    if (this.autoWalkTargetX !== null) {
      // 인트로는 화면 밖에서 시작하므로 스테이지 경계를 적용하지 않는다.
      this.#updateAutoWalk(dt);
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

  #updateAutoWalk(dt) {
    this.facing = 1;
    this.#enterState(PLAYER_STATE.WALK);
    this.x += CONFIG.intro.walkSpeed * dt;

    if (this.x >= this.autoWalkTargetX) {
      this.x = this.autoWalkTargetX;
      this.autoWalkTargetX = null;
      this.#enterState(PLAYER_STATE.IDLE);
    }
  }

  #updateBusy() {
    if (!this.animator.finished) return;

    if (this.state === PLAYER_STATE.ATTACK) {
      this.recoveryTimer = CONFIG.player.attack.recovery / 1000;
    }
    this.#enterState(PLAYER_STATE.IDLE);
  }

  #updateControl(dt, pad) {
    if (pad.justPressed("action") && this.recoveryTimer <= 0) {
      this.#startAttack();
      return;
    }

    const move = pad.moveVector();

    // 좌우 입력이 있을 때만 방향을 갱신한다. 위/아래만 눌렀을 땐 보던 방향 유지.
    if (move.x !== 0) this.facing = move.x > 0 ? 1 : -1;

    if (move.x === 0 && move.y === 0) {
      this.#enterState(PLAYER_STATE.IDLE);
      return;
    }

    this.x += move.x * CONFIG.player.speedX * dt;
    this.y += move.y * CONFIG.player.speedY * dt;
    this.#enterState(PLAYER_STATE.WALK);
  }

  #startAttack() {
    this.audio?.play("attack");
    this.state = PLAYER_STATE.ATTACK;
    this.hitThisSwing.clear();
    this.animator.play(PLAYER_STATE.ATTACK, { loop: false, restart: true });
  }

  #enterState(state) {
    if (this.state === state) return;
    this.state = state;
    this.animator.play(state, { loop: true });
  }

  /** 한 번의 스윙에 같은 대상을 여러 번 때리지 않도록 걸러낸 히트 판정. */
  canHit(target) {
    if (!this.isAttackActive || this.hitThisSwing.has(target)) return false;

    const { reach, depthTolerance } = CONFIG.player.attack;
    if (Math.abs(target.y - this.y) > depthTolerance) return false;

    const scale = this.scale;
    const dx = (target.x - this.x) * this.facing; // 바라보는 쪽을 + 로
    return dx > -18 * scale && dx < reach * scale;
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

  /** 팀 생명이 0 이 되었을 때. hit 마지막 프레임(쓰러진 자세)에서 멈춘다. */
  knockOut() {
    this.downed = true;
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
    this.animator.draw(ctx, screenX, this.y, scale, this.isFlipped, { tint: this.tint, alpha });
  }
}

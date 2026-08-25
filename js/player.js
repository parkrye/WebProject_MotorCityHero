// 플레이어. WASD 이동 + J 공격.
// 상태: idle / walk / attack / hit. 공격과 피격 중에는 이동 입력을 받지 않는다.

const PLAYER_STATE = { IDLE: "idle", WALK: "walk", ATTACK: "attack", HIT: "hit" };

class Player extends Actor {
  constructor(anims, x, y) {
    // 플레이어는 hp 대신 생명(lives)으로 버틴다. 무엇에 맞든 한 대 = 생명 1.
    super({
      x,
      y,
      animator: new Animator(anims),
      maxHp: 1,
      bodyWidth: 38,
    });

    this.lives = CONFIG.player.startLives;
    this.state = PLAYER_STATE.IDLE;
    this.invincibleTimer = 0; // 컨티뉴 직후의 짧은 무적
    this.recoveryTimer = 0;
    this.autoWalkTargetX = null; // 인트로 연출용. null 이 아니면 입력 대신 자동 이동.
    this.hitThisSwing = new Set();
    this.animator.play(PLAYER_STATE.IDLE);
  }

  get isBusy() {
    return this.state === PLAYER_STATE.ATTACK || this.state === PLAYER_STATE.HIT;
  }

  /** hit 애니메이션이 도는 동안, 그리고 컨티뉴 직후 잠깐은 맞지 않는다. */
  get isInvincible() {
    return this.state === PLAYER_STATE.HIT || this.invincibleTimer > 0;
  }

  /** 공격 애니메이션 중 판정이 살아있는 프레임 구간인지. */
  get isAttackActive() {
    if (this.state !== PLAYER_STATE.ATTACK) return false;
    const { activeFrom, activeTo } = CONFIG.player.attack;
    return this.animator.frame >= activeFrom && this.animator.frame <= activeTo;
  }

  update(dt, input, controllable) {
    this.updateCommon(dt);

    if (this.invincibleTimer > 0) this.invincibleTimer -= dt;
    if (this.recoveryTimer > 0) this.recoveryTimer -= dt;

    if (this.autoWalkTargetX !== null) {
      // 인트로는 화면 밖에서 시작하므로 스테이지 경계를 적용하지 않는다.
      this.#updateAutoWalk(dt);
      return;
    }

    if (this.isBusy) {
      this.#updateBusy();
    } else if (controllable) {
      this.#updateControl(dt, input);
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

  #updateControl(dt, input) {
    if (input.justPressed("attack") && this.recoveryTimer <= 0) {
      this.#startAttack();
      return;
    }

    const move = input.moveVector();

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

  /** @returns {boolean} 생명이 모두 떨어졌는지 */
  takeDamage(fromX) {
    if (this.isInvincible) return false;

    this.lives -= 1;
    this.flashTimer = 0.12;
    this.facing = fromX > this.x ? 1 : -1;
    this.applyKnockback(CONFIG.player.hit.knockback, fromX);
    this.state = PLAYER_STATE.HIT;
    this.animator.play(PLAYER_STATE.HIT, { loop: false, restart: true });
    return this.lives <= 0;
  }

  gainLife() {
    this.lives += 1;
  }

  /** 컨티뉴: 생명을 채우고 잠깐 무적 상태로 그 자리에서 다시 시작한다. */
  revive() {
    this.lives = CONFIG.player.startLives;
    this.invincibleTimer = CONFIG.player.continueGraceMs / 1000;
    this.knockbackX = 0;
    this.#enterState(PLAYER_STATE.IDLE);
  }

  draw(ctx, cameraX) {
    // 컨티뉴 직후 무적 동안 깜빡여서 알린다.
    const blinking = this.invincibleTimer > 0 && this.state !== PLAYER_STATE.HIT;
    const alpha = blinking && Math.floor(this.invincibleTimer * 20) % 2 === 0 ? 0.35 : 1;

    const screenX = this.x - cameraX;
    const scale = this.scale;
    drawShadow(ctx, screenX, this.y, this.bodyWidth * scale * 1.1);
    this.animator.draw(ctx, screenX, this.y, scale, this.isFlipped, this.tint, alpha);
  }
}

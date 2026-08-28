// 플레이어. WASD 로 움직이고 J 로 점프, K 로 펀치, L 로 킥을 낸다.
// 상태: idle / walk / jump / attack / hit / clear. 공격과 피격 중에는 이동 입력을 받지 않는다.
// 펀치와 킥은 대미지와 사거리가 같고, 깊이 판정만 위아래로 갈린다.
// 생명은 Game 이 들고 있고, 여기서는 "맞았다"까지만 판단한다.
//
// 점프는 **그림만 띄운다.** 발밑 좌표(x · 깊이 y)는 지면 그대로여서 때리고 맞는 판정이
// 전부 평소처럼 돌고, 뜨는 순간의 짧은 무적만으로 공격을 넘긴다. 그래서 공중에서 맞아도
// 궤적은 그대로 올라갔다 내려오고 모션만 피격으로 바뀐다.

const PLAYER_STATE = {
  IDLE: "idle",
  WALK: "walk",
  JUMP: "jump",
  ATTACK: "attack",
  HIT: "hit",
  CLEAR: "clear", // 스테이지 클리어 승리 모션. 입력을 받지 않는다
};

// 무적 동안 깜빡일 때 덮어씌우는 색.
const INVINCIBLE_TINT = "rgba(255, 255, 255, 0.85)";

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
    // 승리 모션도 마찬가지. 없으면 그냥 서 있는다.
    this.clearAnim = anims.clear ? PLAYER_STATE.CLEAR : PLAYER_STATE.IDLE;
    // 점프 · 점프 공격도 없으면 지상 모션으로 대신한다.
    this.jumpAnim = anims.jump ? PLAYER_STATE.JUMP : PLAYER_STATE.IDLE;
    this.jumpAttackAnim = anims.jumpAttack ? "jumpAttack" : PLAYER_STATE.ATTACK;
    this.jumpKickAnim = anims.jumpKick ? "jumpKick" : this.kickAnim;
    this.kicking = false; // 지금 나가는 공격이 킥인지. 깊이 판정이 갈린다.

    this.state = PLAYER_STATE.IDLE;
    this.downed = false;      // 생명이 0 이 되어 쓰러진 상태. 마지막 프레임을 유지한다.
    this.invincibleTimer = 0; // 컨티뉴 직후 · 일어난 직후의 무적. 도는 동안 깜빡인다.
    this.recoveryTimer = 0;
    this.downTimer = 0;       // 피격 모션이 끝난 뒤 그대로 누워 있는 시간

    // 체공. jumpZ 는 그리는 높이일 뿐이고 어떤 판정에도 들어가지 않는다.
    this.jumping = false;
    this.jumpZ = 0;
    this.jumpVz = 0;
    this.jumpInvincibleTimer = 0;
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

  /**
   * 스테이지를 깼다. 클리어 연출이 끝날 때까지 승리 모션을 돌린다.
   * 다음 스테이지는 새 Player 로 시작하므로 여기서 풀어줄 필요가 없다.
   */
  celebrate() {
    if (this.downed || this.state === PLAYER_STATE.CLEAR) return;

    this.state = PLAYER_STATE.CLEAR;
    this.knockbackX = 0;
    this.#resetJump();
    this.animator.play(this.clearAnim, { loop: true, restart: true });
  }

  /**
   * 쓰러졌거나, 피격 모션이 도는 동안, 일어난 직후, 부활 직후,
   * 그리고 점프해서 막 떠오르는 동안은 맞지 않는다.
   */
  get isInvincible() {
    if (this.downed || this.state === PLAYER_STATE.HIT) return true;
    return this.invincibleTimer > 0 || this.jumpInvincibleTimer > 0;
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
    // 공중에서 쓰러졌으면 바닥까지 떨어지기는 한다.
    if (this.downed) {
      if (this.jumping) this.#updateJumpArc(dt);
      return;
    }

    // 승리 모션은 클리어 연출이 끝날 때까지 그대로 둔다.
    if (this.state === PLAYER_STATE.CLEAR) return;

    // 인트로는 화면 밖에서 시작한다. 걸어 들어와 자리를 잡기 전까지는
    // 스테이지 경계를 적용하지 않는다. 클램프하면 왼쪽 끝으로 튀어 들어온다.
    if (this.entering) {
      this.#updateEntrance(dt);
      return;
    }

    if (this.jumping) {
      this.#updateAir(dt, pad, controllable);
      this.clampToStage(this.bodyWidth);
      return;
    }

    if (this.isBusy) {
      this.#updateBusy(dt, pad, controllable);
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

  /**
   * 체공 중. 뜬 궤적은 무슨 일이 있어도 그대로 돈다 — 공중에서 맞아도 올라갔다 내려오고
   * 모션만 피격으로 바뀐다. 그 위에 이동과 점프 공격만 얹는다.
   */
  #updateAir(dt, pad, controllable) {
    if (this.jumpInvincibleTimer > 0) this.jumpInvincibleTimer -= dt;

    const landed = this.#updateJumpArc(dt);
    if (controllable && this.state !== PLAYER_STATE.HIT) this.#updateAirControl(dt, pad);
    if (landed) this.#land();
  }

  /**
   * 체공 높이만 갱신한다. 상태와 무관하게 돌아야 해서 따로 뺐다.
   * @returns {boolean} 이번 프레임에 착지했는지
   */
  #updateJumpArc(dt) {
    this.jumpVz -= CONFIG.player.jump.gravity * dt;
    this.jumpZ += this.jumpVz * dt;
    if (this.jumpZ > 0) return false;

    this.#resetJump();
    return true;
  }

  /** 공중 이동 + 점프 공격. 한 번 낸 점프 공격은 착지할 때까지 그 자세를 유지한다. */
  #updateAirControl(dt, pad) {
    if (this.state !== PLAYER_STATE.ATTACK) this.#tryAttack(pad);

    const move = pad.moveVector();
    if (move.x !== 0 && this.state !== PLAYER_STATE.ATTACK) {
      this.facing = move.x > 0 ? 1 : -1;
    }

    const factor = this.speedFactor;
    this.x += move.x * CONFIG.player.speedX * factor * dt;
    this.y += move.y * CONFIG.player.speedY * factor * dt;
  }

  /** 착지. 맞고 내려온 거면 그대로 쓰러져 있고, 아니면 짧은 후딜을 두고 선다. */
  #land() {
    if (this.state === PLAYER_STATE.HIT) return;

    this.recoveryTimer = CONFIG.player.jump.landRecoveryMs / 1000;
    this.#enterState(PLAYER_STATE.IDLE);
  }

  #resetJump() {
    this.jumping = false;
    this.jumpZ = 0;
    this.jumpVz = 0;
    this.jumpInvincibleTimer = 0;
  }

  /**
   * 공격 · 피격 모션 중. 판정이 끝난 뒤부터는 선입력으로 다음 공격을 바로 이어간다.
   * 모션이 끝나기를 기다리지 않으므로 빠르게 두 번 누르면 딜레이 없이 붙는다.
   */
  #updateBusy(dt, pad, controllable) {
    if (controllable && this.canChainAttack && this.#tryAttack(pad)) return;
    if (!this.animator.finished) return;

    if (this.state === PLAYER_STATE.HIT) {
      // 넘어진 마지막 프레임 그대로 잠깐 누워 있는다.
      this.downTimer -= dt;
      if (this.downTimer > 0) return;
      // 일어난 뒤에도 잠깐 무적이다. 그동안 흰색으로 깜빡여서 알린다.
      this.invincibleTimer = CONFIG.player.hit.invincibleAfterMs / 1000;
    } else if (this.state === PLAYER_STATE.ATTACK) {
      this.recoveryTimer = CONFIG.player.attack.recovery / 1000;
    }

    this.#enterState(PLAYER_STATE.IDLE);
  }

  /** 판정이 끝난 뒤 구간. 여기서부터 다음 공격으로 캔슬할 수 있다. */
  get canChainAttack() {
    if (this.state !== PLAYER_STATE.ATTACK) return false;
    return this.animator.frame >= CONFIG.input.cancelFromFrame;
  }

  /**
   * 선입력을 꺼내 공격을 낸다. 펀치를 먼저 본다.
   * @returns {boolean} 실제로 냈는지
   */
  #tryAttack(pad) {
    if (pad.consumeBuffered("action")) {
      this.#startAttack(false);
      return true;
    }
    if (pad.consumeBuffered("kick")) {
      this.#startAttack(true);
      return true;
    }
    return false;
  }

  #updateControl(dt, pad) {
    if (this.recoveryTimer <= 0) {
      if (this.#tryAttack(pad)) return;
      if (pad.consumeBuffered("jump")) {
        this.#startJump();
        return;
      }
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
    this.animator.play(this.#attackAnim(kick), { loop: false, restart: true });
  }

  /** 공중에서 낸 공격은 점프 공격 모션으로 나간다. 대미지와 판정은 지상과 같다. */
  #attackAnim(kick) {
    if (this.jumping) return kick ? this.jumpKickAnim : this.jumpAttackAnim;
    return kick ? this.kickAnim : PLAYER_STATE.ATTACK;
  }

  /** 위로 폴짝. 발밑 좌표는 그대로 두고 그림만 띄운다. 떠오르는 동안만 무적이다. */
  #startJump() {
    const { speed, invincibleMs } = CONFIG.player.jump;

    this.jumping = true;
    this.jumpZ = 0;
    this.jumpVz = speed;
    this.jumpInvincibleTimer = invincibleMs / 1000;
    this.state = PLAYER_STATE.JUMP;
    this.animator.play(this.jumpAnim, { loop: false, restart: true });
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
    this.downTimer = CONFIG.player.hit.downMs / 1000;
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
    this.#resetJump();
    this.state = PLAYER_STATE.IDLE;
    this.animator.play(PLAYER_STATE.IDLE, { loop: true, restart: true });
  }

  draw(ctx, cameraX) {
    // 무적 동안 흰색으로 깜빡여서 알린다. 쓰러져 있는 동안에는 깜빡이지 않는다.
    const blinking = !this.downed && this.invincibleTimer > 0 && this.state !== PLAYER_STATE.HIT;
    const flashing = blinking && Math.floor(this.invincibleTimer * 20) % 2 === 0;

    const screenX = this.x - cameraX;
    const scale = this.scale;
    const lift = this.jumpZ * scale; // 판정은 발밑 그대로고 그림만 이만큼 뜬다

    // 그림자는 바닥에 남는다. 높이 뜰수록 작고 옅어져서 뜬 만큼이 눈에 보인다.
    const fade = 1 - Math.min(0.5, lift / 200);
    drawShadow(ctx, screenX, this.y, this.bodyWidth * scale * 1.1 * fade,
      CONFIG.player.shadowColor, 0.42 * fade);

    this.#drawBuffs(ctx, screenX, scale, lift);
    this.animator.draw(ctx, screenX, this.y - lift, scale, this.isFlipped, {
      tint: flashing ? INVINCIBLE_TINT : this.tint,
    });
  }

  /**
   * 버프 이펙트는 발밑에 캐릭터보다 먼저 그려서 몸에 가려지게 둔다.
   * 발끝보다 offsetY 만큼 더 내려야 정강이가 아니라 바닥에서 피어오르는 것처럼 보인다.
   */
  #drawBuffs(ctx, screenX, scale, lift) {
    if (this.downed) return;

    const y = this.y - lift + CONFIG.buffs.offsetY * scale; // 발밑을 따라 같이 뜬다
    const effectScale = scale * CONFIG.buffs.scale;

    if (this.powerFlashTimer > 0) {
      const fade = Math.min(1, this.powerFlashTimer / 0.35); // 사라질 때만 부드럽게 뺀다
      this.powerAnimator?.draw(ctx, screenX, y, effectScale, false, { alpha: 0.9 * fade });
    }

    for (const buff of this.buffs.values()) {
      buff.animator?.draw(ctx, screenX, y, effectScale, false, { alpha: 0.9 });
    }
  }
}

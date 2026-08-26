// 에너미. 번호가 커질수록 강해진다.
// 원본 GIF 가 "걷기" 한 종류뿐이라 이동/대기를 같은 루프로 쓰고,
// 공격은 준비 동작(정지) → 타격 → 쿨다운 으로 표현한다.
//
// 체력만 불리면 일곱 종류가 다 똑같이 걸어오므로 두 겹으로 성격을 나눈다.
//   behavior  어디로 다가오는가 (CONFIG.enemyBehavior)
//   motion    어떻게 움직이고 어떤 자세로 때리는가 (CONFIG.enemyMotion)
// motion 은 그림만 흔드는 게 아니라 전진 타이밍 · 사거리 · 깊이 판정까지 같이 바꾼다.

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
    this.motion = enemyMotion(stats.motion);
    this.entered = false; // 맵 밖에서 걸어 들어오는 중인지. 한 번 들어오면 다시 나가지 못한다
    this.state = ENEMY_STATE.APPROACH;
    this.timer = 0;
    this.staggerTimer = 0;
    this.deathTimer = 0;
    this.scoreGiven = false;

    // 같은 종류가 여럿 나와도 한 몸처럼 움직이지 않도록 위상을 흩어둔다.
    this.moveTime = Math.random() * 4;
    this.gaitTime = Math.random() * 4; // 폴짝·스텝 리듬. 다 같이 뛰면 우스워진다
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

    this.gaitTime += dt; // 자세는 계속 돌아야 한다. 멈춰 서도 제자리에서 뛴다
    if (player.downed) return false;

    this.timer -= dt;
    this.moveTime += dt;
    if (this.retreatTimer > 0) this.retreatTimer -= dt;

    if (this.state === ENEMY_STATE.WINDUP) return this.#updateWindup();
    if (this.state === ENEMY_STATE.STRIKE) return this.#updateStrike(dt, player);
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
  #updateStrike(dt, player) {
    // 덮치기 · 내지르기는 판정이 켜져 있는 동안 실제로 앞으로 나간다.
    const { lunge } = this.motion.attack;
    if (lunge) {
      this.x += this.facing * lunge * dt;
      this.clampToStage(0);
    }

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
    const speed = this.speed * this.#behaviorFactor() * this.#gaitFactor();
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

  /** 다가오는 규칙(behavior)이 만드는 속도 배율. */
  #behaviorFactor() {
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

  /**
   * 이동 리듬(gait)이 만드는 속도 배율. 폴짝이는 부류는 **공중에 떠 있는 동안에만** 나아간다.
   * 멈춰 있는 시간만큼 공중에서 더 빨리 가므로 평균 속도는 stats.speed 그대로 남는다.
   * 갤럽은 두 박자 중 밟는 쪽에서만 밀고 나간다.
   */
  #gaitFactor() {
    const gait = this.motion.gait;

    if (gait.kind === "hop") {
      return this.#gaitPhase() < gait.airRatio ? 1 / gait.airRatio : 0;
    }
    if (gait.kind === "gallop") {
      return 0.6 + Math.abs(Math.sin(Math.PI * 2 * this.#gaitPhase())) * 0.8;
    }
    return 1;
  }

  /** 이동 리듬의 위상. 0 에서 1 로 한 주기를 돈다. */
  #gaitPhase() {
    const { periodMs } = this.motion.gait;
    return ((this.gaitTime * 1000) % periodMs) / periodMs;
  }

  /** 때린 뒤 물러나기. 물러나면서도 플레이어를 계속 본다. */
  #retreat(dt, player) {
    const away = Math.sign(this.x - player.x) || 1;
    this.facing = -away;
    const speed = this.speed * CONFIG.enemyBehavior.hitAndRun.boost * this.#gaitFactor();
    this.x += away * speed * dt;
    this.clampToStage(0);
  }

  /** 공격 깊이 반경. 휘두르는 부류는 넓고, 내지르는 부류는 좁다. */
  get attackDepth() {
    return CONFIG.hitbox.enemyDepth * this.motion.attack.depthMul * this.attackScale;
  }

  /** 실제로 닿는 가로 사거리. 접근 사거리보다 언제나 좁게 잡고 거기에 자세별 배율을 곱한다. */
  get strikeReach() {
    return this.approachReach * CONFIG.hitbox.enemyReachRatio * this.motion.attack.reachMul;
  }

  /** 준비 동작에 들어갈지. 판정 자체가 아니라 "이쯤에서 팔을 든다" 하는 거리다. */
  #inAttackRange(player) {
    if (Math.abs(player.y - this.y) > this.attackDepth) return false;
    return Math.abs(player.x - this.x) <= this.approachReach;
  }

  /**
   * 실제로 닿는 판정. 접근 사거리보다 좁고 바라보는 쪽으로만 나간다.
   * 다만 도는 공격(omni)은 앞뒤를 가리지 않는다. 대신 플레이어 몸 가장자리까지 재준다.
   */
  #attackHits(player) {
    if (Math.abs(player.y - this.y) > this.attackDepth + player.hurtDepth) return false;

    const half = player.hurtHalfWidth;
    const reach = this.strikeReach;
    const dx = (player.x - this.x) * this.facing; // 바라보는 쪽을 + 로

    if (this.motion.attack.omni) return Math.abs(dx) < reach + half;
    return dx > -half && dx < reach + half;
  }

  /**
   * 맵 밖에서 걸어 들어오는 동안은 월드 경계를 걸지 않는다.
   * 카메라가 맵 끝에 붙어 있어도 그 너머에서 나올 수 있어야 양쪽에서 온다.
   * 한 번 안으로 들어온 뒤부터는 평소대로 가둔다.
   */
  clampToStage(margin = 0) {
    const limit = CONFIG.world.width - margin;
    if (!this.entered && this.x > margin && this.x < limit) this.entered = true;
    if (this.entered) this.x = clamp(this.x, margin, limit);

    this.y = clamp(this.y, CONFIG.stage.top, CONFIG.stage.bottom);
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

    if (this.isDying) {
      this.#drawDeath(ctx, screenX, scale);
      return;
    }

    const pose = this.#pose();
    const hover = pose.hover * scale;
    const footY = this.y - hover;
    const footX = screenX + (pose.lean * this.facing + pose.sway) * scale;

    // 그림자는 바닥에 남고, 뜬 만큼 작아지고 옅어진다. 이게 있어야 폴짝이 읽힌다.
    const lift = clamp(hover / 90, 0, 0.75);
    drawShadow(ctx, screenX, this.y, this.bodyWidth * scale * 1.1 * (1 - lift * 0.55), "#000", 0.32 * (1 - lift));

    ctx.save();
    ctx.translate(footX, footY);
    ctx.rotate(pose.tilt * this.facing);
    // 회전 자세는 좌우 폭이 0 을 지나며 뒤집힌다. 딱 0 이면 변환이 무너지므로 조금 남긴다.
    ctx.scale(pose.squashX || 0.001, pose.squashY);
    this.animator.draw(ctx, 0, 0, scale, this.isFlipped, { tint: this.tint });
    ctx.restore();

    this.#drawStrikeFx(ctx, screenX, footY, scale);
    this.#drawHealthBar(ctx, screenX, scale, footY);
  }

  #drawDeath(ctx, screenX, scale) {
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

  /**
   * 이번 프레임의 자세. 발끝을 원점으로 한 변형이다.
   *   hover  떠오른 높이(px, 배율 적용 전)   tilt  기울기(rad)
   *   lean   바라보는 쪽으로 밀린 거리        sway  좌우 스텝
   *   squashX / squashY  찌부러짐
   * 공격 중에는 공격 자세가 이동 리듬을 덮는다.
   */
  #pose() {
    const pose = { hover: 0, tilt: 0, lean: 0, sway: 0, squashX: 1, squashY: 1 };

    if (this.state === ENEMY_STATE.WINDUP) return this.#attackPose(pose, true);
    if (this.state === ENEMY_STATE.STRIKE) return this.#attackPose(pose, false);
    return this.#gaitPose(pose);
  }

  /** 이동 리듬. 종류마다 뛰는 높이 · 주기 · 착지 눌림이 다르다. */
  #gaitPose(pose) {
    const gait = this.motion.gait;
    const phase = this.#gaitPhase();

    if (gait.kind === "hop") {
      if (phase < gait.airRatio) {
        const air = phase / gait.airRatio;
        const arc = Math.sin(Math.PI * air);
        pose.hover = arc * gait.height;
        pose.tilt = Math.sin(Math.PI * 2 * air) * gait.tilt;
        pose.squashY = 1 + arc * 0.1;
        pose.squashX = 1 - arc * 0.07;
        return pose;
      }
      // 착지. 푹 눌렸다가 펴진다.
      const squash = Math.sin((Math.PI * (phase - gait.airRatio)) / (1 - gait.airRatio)) * gait.land;
      pose.squashY = 1 - squash;
      pose.squashX = 1 + squash * 0.8;
      return pose;
    }

    if (gait.kind === "gallop") {
      const beat = Math.sin(Math.PI * 2 * phase);
      pose.hover = Math.abs(beat) * gait.height;
      pose.sway = beat * gait.sway;
      pose.tilt = beat * gait.tilt;
      pose.squashY = 1 + Math.abs(beat) * 0.06;
      return pose;
    }

    // lumber / stride. 뛰지 않고 흔들리며 걷는다.
    const wave = Math.sin(Math.PI * 2 * phase);
    const squash = gait.squash ?? 0;
    pose.hover = Math.abs(wave) * (gait.bob ?? 0);
    pose.sway = wave * (gait.sway ?? 0);
    pose.tilt = (gait.tilt ?? 0) + wave * squash * 0.5;
    pose.squashY = 1 + wave * squash;
    pose.squashX = 1 - wave * squash * 0.6;
    return pose;
  }

  /**
   * 공격 자세. 준비 동작과 타격 구간을 따로 그린다.
   * @param {boolean} windup  준비 동작이면 true. 여기서는 아직 판정이 없다
   */
  #attackPose(pose, windup) {
    const total = windup ? this.stats.windup / 1000 : CONFIG.hitbox.enemyActiveMs / 1000;
    const t = clamp(1 - this.timer / total, 0, 1); // 0 에서 1 로 진행

    switch (this.motion.attack.pose) {
      // 고양이. 바짝 웅크렸다가 앞발을 뻗으며 덮친다.
      case "pounce":
        if (windup) {
          pose.squashY = 1 - 0.3 * t;
          pose.squashX = 1 + 0.24 * t;
          pose.lean = -9 * t;
          pose.tilt = -0.1 * t;
          break;
        }
        pose.hover = 10 + Math.sin(Math.PI * t) * 40;
        pose.lean = 26 * t;
        pose.tilt = 0.3 * t;
        pose.squashX = 1.1;
        pose.squashY = 0.93;
        break;

      // 꼬마아이. 뒤로 젖혔다가 뛰어올라 머리로 박는다.
      case "headbutt":
        if (windup) {
          pose.lean = -15 * t;
          pose.tilt = -0.16 * t;
          pose.squashY = 1 - 0.14 * t;
          break;
        }
        pose.hover = 26 + Math.sin(Math.PI * t) * 16;
        pose.lean = 30 * t;
        pose.tilt = 0.36 * t;
        break;

      // 원숭이. 팔을 뒤로 끌어당겼다가 몸까지 실어 길게 내지른다.
      case "thrust":
        if (windup) {
          pose.lean = -26 * t;
          pose.squashX = 1 + 0.16 * t;
          pose.tilt = -0.13 * t;
          break;
        }
        pose.lean = -8 + 56 * t;
        pose.squashX = 1.2;
        pose.squashY = 0.9;
        pose.tilt = 0.1 * t;
        break;

      // 여성. 한 번 떠올랐다가 그대로 내려찍는다.
      case "divekick":
        if (windup) {
          pose.hover = 36 * t;
          pose.tilt = -0.12 * t;
          pose.squashY = 1 + 0.1 * t;
          break;
        }
        pose.hover = 40 * (1 - t);
        pose.lean = 34 * t;
        pose.tilt = 0.42 * t;
        break;

      // 둔기. 뒤로 크게 감았다가 반대편까지 쓸어버린다.
      case "swing":
        if (windup) {
          pose.tilt = -0.62 * t;
          pose.lean = -16 * t;
          pose.squashX = 1 + 0.06 * t;
          break;
        }
        pose.tilt = -0.62 + 1.18 * t;
        pose.lean = -16 + 36 * t;
        pose.hover = Math.sin(Math.PI * t) * 10;
        break;

      // 강남스타일. 제자리에서 두 바퀴 돈다.
      // 좌우 폭을 cos 으로 눌러 앞뒤가 뒤집히게 만들면 회전으로 읽힌다.
      case "spin":
      default:
        if (windup) {
          pose.squashY = 1 - 0.18 * t;
          pose.squashX = 1 + 0.12 * t;
          break;
        }
        pose.squashX = Math.cos(t * Math.PI * 4);
        pose.hover = Math.abs(Math.sin(t * Math.PI * 4)) * 18;
        break;
    }

    return pose;
  }

  /**
   * 타격 구간에만 뜨는 궤적. 판정이 켜져 있는 짧은 구간을 눈으로 알아보게 한다.
   * 사거리와 깊이를 실제 판정에서 그대로 가져오므로 보이는 만큼만 맞는다.
   */
  #drawStrikeFx(ctx, screenX, footY, scale) {
    const { fx } = this.motion.attack;
    if (this.state !== ENEMY_STATE.STRIKE || !fx || fx === "none") return;

    const t = clamp(1 - this.timer / (CONFIG.hitbox.enemyActiveMs / 1000), 0, 1);
    const reach = this.strikeReach;
    const chest = footY - this.animator.sheet.frameHeight * scale * 0.55;
    const dir = this.facing;

    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = "#fff6c9";
    ctx.lineWidth = Math.max(2, 3.5 * scale);
    ctx.lineCap = "round";

    if (fx === "claw") {
      // 발톱 세 줄기. 앞쪽 위에서 아래로 긋는다.
      const x = screenX + dir * reach * 0.55;
      for (let i = -1; i <= 1; i += 1) {
        ctx.beginPath();
        ctx.moveTo(x + i * 11 * scale, chest - 26 * scale);
        ctx.lineTo(x + i * 11 * scale + dir * 16 * scale, chest + 26 * scale);
        ctx.stroke();
      }
    } else if (fx === "thrust") {
      // 주먹이 지나간 잔상. 가슴 높이로 곧게 뻗는다.
      for (let i = -1; i <= 1; i += 1) {
        ctx.beginPath();
        ctx.moveTo(screenX + dir * reach * 0.2, chest + i * 9 * scale);
        ctx.lineTo(screenX + dir * reach * (0.6 + 0.4 * t), chest + i * 9 * scale);
        ctx.stroke();
      }
    } else if (fx === "swing") {
      // 휘두른 궤적. 뒤에서 앞으로 쓸리는 호를 그린다.
      const from = dir > 0 ? -2.5 : -0.64;
      ctx.lineWidth = Math.max(3, 6 * scale);
      ctx.beginPath();
      ctx.arc(screenX, chest, reach, from, from + dir * 1.9 * t, dir < 0);
      ctx.stroke();
    } else if (fx === "shock") {
      // 도는 공격. 발밑에서 고리가 퍼진다. 앞뒤 어디든 닿는다는 표시다.
      const radius = reach * (0.4 + 0.6 * t);
      ctx.lineWidth = Math.max(2, 4 * scale);
      ctx.beginPath();
      ctx.ellipse(screenX, footY - 6, radius, radius * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  /** 최종보스는 화면 위에 큰 게이지가 따로 뜨므로 머리 위에는 그리지 않는다. */
  #drawHealthBar(ctx, screenX, scale, footY) {
    if (this.boss || this.hp >= this.maxHp) return;

    const width = 46 * scale;
    const height = 5;
    const top = footY - this.animator.sheet.frameHeight * scale - 10;
    const ratio = clamp(this.hp / this.maxHp, 0, 1);

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(screenX - width / 2 - 1, top - 1, width + 2, height + 2);
    ctx.fillStyle = "#e5484d";
    ctx.fillRect(screenX - width / 2, top, width * ratio, height);
    ctx.restore();
  }
}

// 게임 루프와 상태 전이.
// INTRO(좌측에서 자동 이동) -> COUNTDOWN -> PLAYING -> (CONTINUE -> FADEOUT) -> GAMEOVER

const GAME_STATE = {
  INTRO: "intro",
  COUNTDOWN: "countdown",
  PLAYING: "playing",
  CONTINUE: "continue", // 생명 0. 코인이 들어오면 이어서 시작한다.
  FADEOUT: "fadeout",   // 컨티뉴 실패 후 암전
  GAMEOVER: "gameover",
};

const MAX_DELTA = 1 / 30; // 탭 전환 후 한 프레임에 몰려 튀는 것 방지
const SEPARATION_DEPTH = 20;

class Game {
  constructor(canvas, assets) {
    this.ctx = canvas.getContext("2d");
    this.assets = assets;
    this.input = new Input();
    this.hud = new Hud(this.ctx, assets.font, assets.icons);
    this.sparks = new HitSparks();
    this.shake = new ScreenShake();
    this.spawner = new Spawner(assets.enemies);
    this.hiScore = loadHiScore();

    this.bgTileWidth = CONFIG.view.width;
    this.reset();
  }

  reset() {
    const { top, bottom } = CONFIG.stage;
    this.player = new Player(this.assets.player, CONFIG.intro.startX, (top + bottom) / 2 + 40);
    this.player.autoWalkTargetX = CONFIG.view.width * CONFIG.camera.anchorRatio;

    this.enemies = [];
    this.pickups = [];
    this.score = 0;
    this.coins = 0;
    this.cameraX = 0;
    this.state = GAME_STATE.INTRO;
    this.countdownIndex = 0;
    this.countdownTimer = CONFIG.intro.countdownMs / 1000;
    this.continueTimer = 0;
    this.fadeTimer = 0;
    this.levelBannerTimer = 0;
    this.shownLevel = 1;

    this.spawner.reset();
    this.sparks.clear();
    this.shake.clear();
  }

  start() {
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, MAX_DELTA);
      last = now;
      this.update(dt);
      this.draw();
      this.input.endFrame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  update(dt) {
    // 코인 투입은 어느 상태에서나 받는다. 컨티뉴 카운트다운 중에도 들어와야 한다.
    if (this.state !== GAME_STATE.GAMEOVER && this.input.justPressed("coin")) {
      this.coins += 1;
    }

    if (this.state === GAME_STATE.GAMEOVER) {
      this.#updateGameOver(dt);
      return;
    }
    if (this.state === GAME_STATE.CONTINUE) {
      this.#updateContinue(dt);
      return;
    }
    if (this.state === GAME_STATE.FADEOUT) {
      this.#updateFadeOut(dt);
      return;
    }

    const controllable = this.state === GAME_STATE.PLAYING;
    this.player.update(dt, this.input, controllable);

    if (this.state === GAME_STATE.INTRO && this.player.autoWalkTargetX === null) {
      this.state = GAME_STATE.COUNTDOWN;
    }
    if (this.state === GAME_STATE.COUNTDOWN) {
      this.#updateCountdown(dt);
    }
    if (this.state === GAME_STATE.PLAYING) {
      this.#updatePlaying(dt);
    }

    this.#updateCamera(dt);
    this.sparks.update(dt);
    this.shake.update(dt);
    if (this.levelBannerTimer > 0) this.levelBannerTimer -= dt;
  }

  #updateGameOver(dt) {
    this.sparks.update(dt);
    this.shake.update(dt);
    for (const enemy of this.enemies) enemy.updateCommon(dt);

    if (this.input.justPressed("restart")) this.reset();
  }

  /** 코인이 들어오면 즉시 이어서 시작, 카운트다운이 끝나면 암전으로 넘어간다. */
  #updateContinue(dt) {
    this.player.update(dt, this.input, false); // 쓰러지는 애니메이션은 마저 재생
    this.sparks.update(dt);
    this.shake.update(dt);

    if (this.coins > 0) {
      this.#spendCoinAndResume();
      return;
    }

    this.continueTimer -= dt;
    if (this.continueTimer <= 0) {
      this.state = GAME_STATE.FADEOUT;
      this.fadeTimer = 0;
    }
  }

  #updateFadeOut(dt) {
    this.fadeTimer += dt;
    if (this.fadeTimer < CONFIG.continue.fadeMs / 1000) return;

    this.state = GAME_STATE.GAMEOVER;
    saveHiScore(this.hiScore);
  }

  #updateCountdown(dt) {
    this.countdownTimer -= dt;
    if (this.countdownTimer > 0) return;

    this.countdownIndex += 1;
    this.countdownTimer = CONFIG.intro.countdownMs / 1000;

    if (this.countdownIndex >= CONFIG.intro.countdown.length) {
      this.state = GAME_STATE.PLAYING;
    }
  }

  #updatePlaying(dt) {
    this.#updateEnemies(dt);
    this.#resolvePlayerAttack();
    this.#separateEnemies();
    this.#updatePickups(dt);
    this.#updateSpawning(dt);

    this.enemies = this.enemies.filter((enemy) => !enemy.dead);
  }

  #updateEnemies(dt) {
    for (const enemy of this.enemies) {
      const hitPlayer = enemy.update(dt, this.player);
      if (!hitPlayer || this.player.isInvincible) continue;

      const down = this.player.takeDamage(enemy.x);
      this.shake.kick(9, 0.22);
      this.sparks.burst(this.player.x, this.player.y - 90 * this.player.scale, -enemy.facing, 1);

      if (down) {
        this.#onPlayerDown(); // enemies 를 비울 수 있으므로 순회를 끝낸다
        return;
      }
    }
  }

  /** 생명이 다 떨어졌을 때. 코인이 있으면 바로, 없으면 카운트다운을 띄운다. */
  #onPlayerDown() {
    if (this.coins > 0) {
      this.#spendCoinAndResume();
      return;
    }
    this.state = GAME_STATE.CONTINUE;
    this.continueTimer = CONFIG.continue.seconds;
  }

  /** 점수와 레벨은 그대로 두고 생명만 채워 그 자리에서 이어간다. */
  #spendCoinAndResume() {
    this.coins -= 1;
    this.player.revive();
    this.enemies.length = 0; // 부활하자마자 둘러싸이지 않도록 정리
    this.spawner.timer = CONFIG.spawn.firstDelay / 1000;
    this.state = GAME_STATE.PLAYING;
  }

  #resolvePlayerAttack() {
    if (!this.player.isAttackActive) return;

    for (const enemy of this.enemies) {
      if (enemy.isDying || !this.player.canHit(enemy)) continue;

      this.player.registerHit(enemy);
      const killed = enemy.takeDamage(CONFIG.player.attack.damage, this.player.x);

      const scale = enemy.scale;
      this.sparks.burst(enemy.x, enemy.y - 120 * scale, this.player.facing, scale);
      this.shake.kick(killed ? 8 : 4, killed ? 0.2 : 0.1);

      if (killed && !enemy.scoreGiven) {
        enemy.scoreGiven = true;
        this.#addScore(enemy.stats.score);
        this.#maybeDrop(enemy);
      }
    }
  }

  #maybeDrop(enemy) {
    if (Math.random() >= CONFIG.pickup.dropChance) return;
    this.pickups.push(new Pickup(this.assets.icons.healItem, enemy.x, enemy.y));
  }

  #updatePickups(dt) {
    for (const pickup of this.pickups) {
      pickup.update(dt);
      if (pickup.taken || !pickup.overlaps(this.player)) continue;

      pickup.taken = true;
      this.player.gainLife();
      this.sparks.burst(pickup.x, pickup.y - 40, 1, 1);
    }
    this.pickups = this.pickups.filter((pickup) => !pickup.expired);
  }

  /** 에너미끼리 완전히 겹쳐 한 덩어리로 보이지 않게 살짝 밀어낸다. */
  #separateEnemies() {
    for (let i = 0; i < this.enemies.length; i += 1) {
      for (let j = i + 1; j < this.enemies.length; j += 1) {
        const a = this.enemies[i];
        const b = this.enemies[j];
        if (a.isDying || b.isDying) continue;
        if (Math.abs(a.y - b.y) > SEPARATION_DEPTH) continue;

        const minDistance = (a.bodyWidth * a.scale + b.bodyWidth * b.scale) * 0.8;
        const dx = b.x - a.x;
        const distance = Math.abs(dx);
        if (distance >= minDistance || distance === 0) continue;

        const push = (minDistance - distance) / 2;
        const dir = Math.sign(dx);
        a.x -= push * dir;
        b.x += push * dir;
      }
    }
  }

  #updateSpawning(dt) {
    const alive = this.enemies.filter((enemy) => !enemy.isDying).length;
    const spawned = this.spawner.update(dt, {
      score: this.score,
      cameraX: this.cameraX,
      aliveCount: alive,
    });
    if (spawned) this.enemies.push(spawned);

    if (this.spawner.level > this.shownLevel) {
      this.shownLevel = this.spawner.level;
      this.levelBannerTimer = CONFIG.hud.levelBannerMs / 1000;
    }
  }

  #addScore(amount) {
    this.score += amount;
    if (this.score > this.hiScore) this.hiScore = this.score;
  }

  #updateCamera(dt) {
    // 인트로 동안은 화면이 흔들리지 않도록 카메라를 고정한다.
    if (this.state === GAME_STATE.INTRO) {
      this.cameraX = 0;
      return;
    }

    const target = clamp(
      this.player.x - CONFIG.view.width * CONFIG.camera.anchorRatio,
      0,
      CONFIG.world.width - CONFIG.view.width
    );
    this.cameraX += (target - this.cameraX) * Math.min(1, CONFIG.camera.lerp * dt);
  }

  draw() {
    const ctx = this.ctx;
    const shake = this.shake.offset;

    ctx.save();
    ctx.translate(shake.x, shake.y);
    this.#drawBackground(ctx);
    this.#drawActors(ctx);
    this.sparks.draw(ctx, this.cameraX);
    ctx.restore();

    this.#drawOverlay();
  }

  #drawBackground(ctx) {
    const { width, height } = CONFIG.view;
    const first = Math.max(0, Math.floor(this.cameraX / this.bgTileWidth));
    const last = Math.min(CONFIG.world.tiles - 1, Math.floor((this.cameraX + width) / this.bgTileWidth));

    for (let i = first; i <= last; i += 1) {
      ctx.drawImage(this.assets.background, i * this.bgTileWidth - this.cameraX, 0, this.bgTileWidth, height);
    }
  }

  /** 발끝 y 가 작은(안쪽) 대상부터 그려 앞뒤 관계를 만든다. */
  #drawActors(ctx) {
    const drawables = [...this.enemies, ...this.pickups, this.player].sort((a, b) => a.y - b.y);
    for (const drawable of drawables) drawable.draw(ctx, this.cameraX);
  }

  #drawOverlay() {
    if (this.state === GAME_STATE.INTRO) {
      this.hud.drawTitle();
      this.hud.drawControls();
      return;
    }

    this.hud.drawStats({
      lives: Math.max(0, this.player.lives),
      coins: this.coins,
      score: this.score,
      hiScore: this.hiScore,
      level: this.spawner.level,
    });

    if (this.state === GAME_STATE.COUNTDOWN) {
      this.hud.drawCountdown(CONFIG.intro.countdown[this.countdownIndex]);
      this.hud.drawControls();
      return;
    }

    if (this.levelBannerTimer > 0) {
      this.hud.drawLevelBanner(this.spawner.level, this.levelBannerTimer);
    }

    if (this.state === GAME_STATE.CONTINUE) {
      this.hud.drawContinue(this.continueTimer);
      return;
    }
    if (this.state === GAME_STATE.FADEOUT) {
      this.hud.drawFade(this.fadeTimer / (CONFIG.continue.fadeMs / 1000));
      return;
    }
    if (this.state === GAME_STATE.GAMEOVER) {
      this.hud.drawGameOver(this.score, this.hiScore);
    }
  }
}

async function boot() {
  const canvas = document.getElementById("game");
  canvas.width = CONFIG.view.width;
  canvas.height = CONFIG.view.height;

  const ctx = canvas.getContext("2d");
  drawLoadingScreen(ctx, "LOADING...");

  try {
    const assets = await loadAssets();
    const game = new Game(canvas, assets);
    window.__game = game; // 디버깅/밸런스 확인용 (canvas id="game" 과 겹치지 않게 언더스코어)
    game.start();
  } catch (error) {
    console.error(error);
    drawLoadingScreen(ctx, error.message);
  }
}

window.addEventListener("DOMContentLoaded", boot);

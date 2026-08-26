// 게임 루프와 상태 전이.
//
// LOBBY ─ START ─> INTRO -> COUNTDOWN -> PLAYING ─ 보스 격파 ─> STAGE CLEAR ─┐
//   │                             ↑                                          │
//   │                             └────────── 다음 스테이지 ──────────────────┘
//   │                                  PLAYING ─ 생명 0 · 시간 초과 ─> CONTINUE
//   │                                                 └ 실패 -> FADEOUT -> GAMEOVER
//   ├─ RANKING <───────────────── NAME ENTRY <─────────────────────────────────┘
//   └─ EXIT
//
// 스테이지 6(수수께끼 공간)은 보스가 없고, 시간이 다 되거나 쓰러지면
// 코인을 쓰지 않고 그대로 클리어된다. 그게 마지막 스테이지다.

const GAME_STATE = {
  LOBBY: "lobby",
  RANKING: "ranking",
  EXIT: "exit",
  INTRO: "intro",
  COUNTDOWN: "countdown",
  PLAYING: "playing",
  STAGE_CLEAR: "stageClear",
  CONTINUE: "continue", // 생명 0 또는 시간 초과. 코인이 들어오면 이어서 시작한다.
  FADEOUT: "fadeout",   // 컨티뉴 실패 후 암전
  GAMEOVER: "gameover",
  NAME_ENTRY: "nameEntry",
};

const MAX_DELTA = 1 / 30; // 탭 전환 후 한 프레임에 몰려 튀는 것 방지
const SEPARATION_DEPTH = 20;
const GAMEOVER_AUTO_MS = 5000; // 이 시간이 지나면 알아서 이름 등록으로 넘어간다

class Game {
  constructor(canvas, assets, audio, board) {
    this.ctx = canvas.getContext("2d");
    this.assets = assets;
    this.audio = audio;
    this.board = board;
    this.input = new Input();
    this.hud = new Hud(this.ctx, assets.font, assets.icons);
    this.sparks = new HitSparks();
    this.shake = new ScreenShake();
    this.spawner = new Spawner(assets.enemies);
    this.hiScore = loadHiScore();

    this.crt = new CrtFilter(this.ctx, canvas);
    this.lobby = new LobbyMenu(this.ctx, assets.font, assets.icons);
    this.nameEntry = new NameEntry(this.ctx, assets.font);
    this.ranking = new RankingView(this.ctx, assets.font, board);

    this.bgTileWidth = CONFIG.view.width;
    this.touchMode = false;
    this.rankingFromGame = false; // 이름 등록을 거쳐서 온 랭킹인지

    this.input.onFirstKey = () => {
      this.audio.unlock();
      this.audio.playBgm("lobby");
    };

    this.#resetGame();
    this.state = GAME_STATE.LOBBY;
  }

  /** 새 판. 스테이지 1 부터 시작한다. */
  #resetGame() {
    this.enemies = [];
    this.pickups = [];
    this.lives = CONFIG.player.startLives;
    this.score = 0;
    this.coins = 0;
    this.continueTimer = 0;
    this.fadeTimer = 0;
    this.gameOverTimer = 0;
    this.timeUp = false;
    this.finalClear = false;
    this.usedContinue = false;
    this.powerStacks = 0; // 누적 공격력 강화. 스테이지를 넘어가도 이어진다.

    this.sparks.clear();
    this.shake.clear();
    this.#startStage(1);
  }

  /** 스테이지 하나를 인트로부터 시작한다. 점수 · 코인 · 생명은 그대로 이어진다. */
  #startStage(stage) {
    this.stage = stage;
    this.stageDef = stageConfig(stage);
    this.background = this.assets.stageBackgrounds.get(stage) ?? this.assets.background;

    this.enemies.length = 0;
    this.pickups.length = 0;
    this.boss = null;
    this.bossSpawned = false;
    this.bossBannerTimer = 0;
    this.stageTimer = this.#stageSeconds();
    this.stageHit = false; // 이 스테이지에서 한 대라도 맞았는지. 노히트 보너스 판정용
    this.clearLines = [];
    this.stageBannerTimer = 0;
    this.clearTimer = 0;
    this.introLeadTimer = CONFIG.intro.leadMs / 1000;
    this.cameraX = 0;
    this.countdownIndex = 0;
    this.countdownTimer = CONFIG.intro.countdownMs / 1000;
    this.state = GAME_STATE.INTRO;

    this.input.clearBuffer(); // 인트로 전에 눌린 입력이 시작하자마자 튀어나오지 않게
    this.spawner.reset(this.stageDef);
    this.#createPlayer();
    this.audio.playBgm(this.stageDef.bgm);
  }

  #stageSeconds() {
    const { seconds, endlessSeconds } = CONFIG.stageTimer;
    return this.stageDef.endless ? endlessSeconds : seconds;
  }

  /** 화면 왼쪽 밖에 세워둔다. 걸어 들어오는 건 인트로가 시작한다. */
  #createPlayer() {
    const { top, bottom } = CONFIG.stage;

    this.player = new Player(this.assets.player, CONFIG.intro.startX, (top + bottom) / 2 + 40, {
      audio: this.audio,
      buffAnims: this.assets.buffs,
      powerStacks: this.powerStacks, // 스테이지가 바뀌어도 강화는 그대로 이어받는다
    });
  }

  /** 스테이지 배경을 먼저 보여주고, 그다음에 플레이어가 화면 밖에서 걸어 들어온다. */
  #updateIntro(dt) {
    if (this.introLeadTimer > 0) {
      this.introLeadTimer -= dt;
      if (this.introLeadTimer <= 0) {
        this.player.startWalkIn(CONFIG.view.width * CONFIG.camera.anchorRatio);
      }
      return;
    }

    if (this.#introFinished()) this.state = GAME_STATE.COUNTDOWN;
  }

  /** 마지막 스테이지인지. 여기를 끝내야 게임 클리어다. */
  get isFinalStage() {
    return this.stage >= CONFIG.stages.length;
  }

  /**
   * 클리어 결과를 띄우는 구간인지. 필드를 잠깐 보여준 다음부터다.
   * 마지막 스테이지를 끝낸 암전 구간도 결과 화면 위에서 진행해야 화면이 튀지 않는다.
   */
  get showingClearResult() {
    if (this.state === GAME_STATE.STAGE_CLEAR) {
      return this.clearTimer * 1000 >= CONFIG.stageClear.fieldMs;
    }
    return this.finalClear && this.state === GAME_STATE.FADEOUT;
  }

  /**
   * 클리어 일러스트로 화면을 덮는 구간인지.
   * 일러스트는 게임 전체를 끝냈을 때만 나온다. 중간 스테이지는 그대로 필드를 보여준다.
   */
  get showingClearArt() {
    return this.isFinalStage && this.showingClearResult;
  }

  /** 터치 기기면 화면 안내 문구도 그쪽 버튼 이름으로 바꾼다. */
  setTouchMode(on) {
    this.touchMode = on;
    this.hud.touch = on;
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
    this.crt.update(dt);
    if (this.#updateScreens(dt)) return;

    // 코인 투입은 플레이 중 어느 상태에서나 받는다. 컨티뉴 카운트다운 중에도 들어와야 한다.
    if (this.input.justPressed("coin")) {
      this.coins += 1;
      this.audio.play("coin");
    }

    if (this.state === GAME_STATE.GAMEOVER) {
      this.#updateGameOver(dt);
      return;
    }
    if (this.state === GAME_STATE.STAGE_CLEAR) {
      this.#updateStageClear(dt);
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

    this.player.update(dt, this.input.pad, this.state === GAME_STATE.PLAYING);

    if (this.state === GAME_STATE.INTRO) {
      this.#updateIntro(dt);
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
    if (this.stageBannerTimer > 0) this.stageBannerTimer -= dt;
    if (this.bossBannerTimer > 0) this.bossBannerTimer -= dt;
  }

  /** 로비 · 랭킹 · 종료 · 이름 등록. 이 상태에서는 게임 로직이 돌지 않는다. */
  #updateScreens(dt) {
    if (this.state === GAME_STATE.LOBBY) {
      this.audio.playBgm("lobby");
      this.#handleLobbyChoice(this.lobby.update(dt, this.input, this.audio));
      return true;
    }


    if (this.state === GAME_STATE.RANKING) {
      this.audio.playBgm("ranking");
      if (this.ranking.update(dt, this.input, this.audio) === "back") {
        this.rankingFromGame = false;
        this.lobby.reset();
        this.state = GAME_STATE.LOBBY;
      }
      return true;
    }

    if (this.state === GAME_STATE.EXIT) {
      if (this.input.confirmed) {
        this.audio.play("button");
        this.lobby.reset();
        this.state = GAME_STATE.LOBBY;
      }
      return true;
    }

    if (this.state === GAME_STATE.NAME_ENTRY) {
      this.audio.playBgm("gameover");
      const name = this.nameEntry.update(dt, this.input, this.audio);
      if (name) this.#submitScore(name);
      return true;
    }

    return false;
  }

  #handleLobbyChoice(choice) {
    if (choice === "toggleSound") {
      this.audio.toggleMuted();
      this.audio.play("button"); // 다시 켠 순간 소리가 나는지 바로 확인시켜 준다
      return;
    }
    if (choice === "toggleScreen") {
      this.crt.toggle();
      return;
    }
    if (choice === "start") {
      this.#resetGame();
      return;
    }
    if (choice === "ranking") {
      this.ranking.reset();
      this.board.lastEntry = null;
      this.board.load().catch(() => {});
      this.state = GAME_STATE.RANKING;
      return;
    }
    if (choice === "exit") {
      this.audio.stopBgm();
      this.state = GAME_STATE.EXIT;
    }
  }

  async #submitScore(name) {
    this.state = GAME_STATE.RANKING;
    this.rankingFromGame = true;
    this.ranking.reset();

    try {
      await this.board.submit({ name, score: this.score, stage: this.stage });
    } catch {
      /* submit 안에서 이미 폴백까지 처리한다 */
    }
  }

  #introFinished() {
    return !this.player.entering;
  }

  /** 잠깐 점수를 보여준 뒤 이름 등록으로 넘어간다. */
  #updateGameOver(dt) {
    this.sparks.update(dt);
    this.shake.update(dt);
    for (const enemy of this.enemies) enemy.updateCommon(dt);

    this.gameOverTimer += dt;
    if (this.input.confirmed || this.gameOverTimer >= GAMEOVER_AUTO_MS / 1000) {
      this.audio.play("button");
      this.nameEntry.reset();
      this.state = GAME_STATE.NAME_ENTRY;
    }
  }

  /** 코인이 들어오면 즉시 이어서 시작, 카운트다운이 끝나면 암전으로 넘어간다. */
  #updateContinue(dt) {
    this.player.update(dt, this.input.pad, false); // 쓰러진 자세를 유지한 채 넉백만 잦아든다
    this.sparks.update(dt);
    this.shake.update(dt);

    if (this.coins > 0) {
      this.#spendCoinAndResume();
      return;
    }

    this.continueTimer -= dt;
    if (this.continueTimer <= 0) {
      this.audio.stop("countdown");
      this.state = GAME_STATE.FADEOUT;
      this.fadeTimer = 0;
    }
  }

  #updateFadeOut(dt) {
    this.fadeTimer += dt;
    if (this.fadeTimer < CONFIG.continue.fadeMs / 1000) return;

    this.state = GAME_STATE.GAMEOVER;
    this.gameOverTimer = 0;
    this.audio.playBgm("gameover");
    saveHiScore(this.hiScore);
  }

  #updateCountdown(dt) {
    this.countdownTimer -= dt;
    if (this.countdownTimer > 0) return;

    this.countdownIndex += 1;
    this.countdownTimer = CONFIG.intro.countdownMs / 1000;

    if (this.countdownIndex >= CONFIG.intro.countdown.length) {
      this.state = GAME_STATE.PLAYING;
      this.stageBannerTimer = CONFIG.hud.stageBannerMs / 1000;
    }
  }

  #updatePlaying(dt) {
    this.audio.playBgm(this.stageDef.bgm);

    this.#updateStageTimer(dt);
    if (this.state !== GAME_STATE.PLAYING) return; // 시간이 다 되어 상태가 바뀌었다

    this.#updateEnemies(dt);
    if (this.state !== GAME_STATE.PLAYING) return; // 맞고 쓰러졌다

    this.#resolveAttack(this.player);
    this.#separateEnemies();
    this.#updatePickups(dt);
    this.#updateSpawning(dt);

    this.enemies = this.enemies.filter((enemy) => !enemy.dead);
  }

  /** 제한 시간에서 0 으로. 60초가 지나면 최종보스가 나오고 0 이 되면 실패한다. */
  #updateStageTimer(dt) {
    this.stageTimer -= dt;

    const boss = !this.stageDef.endless && !this.bossSpawned;
    if (boss && this.stageTimer <= CONFIG.stageTimer.bossAtRemaining) this.#spawnBoss();

    if (this.stageTimer > 0) return;
    this.stageTimer = 0;

    // 파밍 스테이지는 시간이 다 되는 게 곧 클리어다.
    if (this.stageDef.endless) {
      this.#clearStage();
      return;
    }

    this.timeUp = true;
    this.#fail();
  }

  #spawnBoss() {
    this.bossSpawned = true;

    const boss = this.spawner.spawnBoss(this.cameraX);
    if (!boss) return;

    this.boss = boss;
    this.enemies.push(boss);
    this.bossBannerTimer = CONFIG.boss.bannerMs / 1000;
    this.shake.kick(12, 0.45);
  }

  /** 최종보스를 쓰러뜨렸거나 파밍 스테이지가 끝났다. */
  #clearStage() {
    if (this.state === GAME_STATE.STAGE_CLEAR) return;

    this.state = GAME_STATE.STAGE_CLEAR;
    this.clearTimer = 0;
    this.boss = null;
    this.audio.stop("countdown");
    this.audio.playBgm("clear");
    this.#awardClearBonus();
  }

  /** 클리어 보너스. 화면에 그대로 띄울 내역으로 남긴다. */
  #awardClearBonus() {
    const { stageClear, timePerSecond, noHit, noContinue } = CONFIG.score;
    const index = this.stage - 1;
    const last = this.isFinalStage;

    const lines = [
      { label: "STAGE BONUS", value: stageClear[index] ?? 0 },
      { label: "TIME BONUS", value: Math.floor(this.stageTimer) * (timePerSecond[index] ?? 0) },
      { label: "NO DAMAGE", value: this.stageHit ? 0 : noHit[index] ?? 0 },
    ];
    if (last && !this.usedContinue) {
      lines.push({ label: "NO CONTINUE", value: noContinue });
    }

    this.clearLines = lines.filter((line) => line.value > 0);
    for (const line of this.clearLines) this.#addScore(line.value);
  }

  /** 잠깐 필드를 보여준 뒤 클리어 연출을 띄우고 다음 스테이지로 넘긴다. */
  #updateStageClear(dt) {
    this.clearTimer += dt;

    this.player.update(dt, this.input.pad, false);
    for (const enemy of this.enemies) enemy.update(dt, this.player);
    this.enemies = this.enemies.filter((enemy) => !enemy.dead);

    this.sparks.update(dt);
    this.shake.update(dt);
    this.#updateCamera(dt);

    const { fieldMs, resultMs } = CONFIG.stageClear;
    if (this.clearTimer * 1000 < fieldMs + resultMs) return;

    this.#advanceStage();
  }

  /** 마지막 스테이지까지 끝냈으면 암전 후 게임 오버로 마무리한다. */
  #advanceStage() {
    if (this.isFinalStage) {
      this.finalClear = true;
      this.state = GAME_STATE.FADEOUT;
      this.fadeTimer = 0;
      return;
    }
    this.#startStage(this.stage + 1);
  }

  #updateEnemies(dt) {
    const player = this.player;

    for (const enemy of this.enemies) {
      if (!enemy.update(dt, player)) continue;

      // 보호막이 있으면 생명 대신 그게 깨진다.
      if (player.consumeShield()) {
        this.audio.play("heal");
        this.sparks.burst(player.x, player.y - 70 * player.scale, -enemy.facing, 1.4);
        continue;
      }

      if (!player.takeDamage(enemy.x)) continue;

      this.lives -= 1;
      this.stageHit = true;
      this.audio.play("hit");
      this.shake.kick(9, 0.22);
      this.sparks.burst(player.x, player.y - 90 * player.scale, -enemy.facing, 1);

      if (this.lives <= 0) {
        this.#onPlayerDown(); // enemies 를 비울 수 있으므로 순회를 끝낸다
        return;
      }
    }
  }

  /** 생명이 다 떨어졌을 때. 파밍 스테이지에서는 쓰러져도 코인 없이 클리어된다. */
  #onPlayerDown() {
    this.lives = 0;

    if (this.stageDef.endless) {
      this.#clearStage();
      return;
    }
    this.#fail();
  }

  /** 코인이 있으면 바로 이어가고, 없으면 컨티뉴 카운트다운을 띄운다. */
  #fail() {
    if (this.coins > 0) {
      this.#spendCoinAndResume();
      return;
    }

    // 쓰러진 마지막 프레임 그대로 멈춰 세운다.
    this.player.knockOut();
    this.state = GAME_STATE.CONTINUE;
    this.continueTimer = CONFIG.continue.seconds;
    this.audio.playBgm("countdown");
    this.audio.play("countdown");
  }

  /** 점수와 스테이지는 그대로 두고 생명만 채워 그 자리에서 이어간다. */
  #spendCoinAndResume() {
    this.coins -= 1;
    this.usedContinue = true;
    this.lives = CONFIG.player.startLives;
    this.player.revive();

    this.audio.stop("countdown");
    this.enemies.length = 0; // 부활하자마자 둘러싸이지 않도록 정리

    // 같이 지워진 보스는 조건이 맞으면 다음 프레임에 다시 나온다.
    this.boss = null;
    this.bossSpawned = false;

    // 시간이 다 되어 실패한 거라면 시계도 되돌린다. 안 그러면 이어가자마자 또 끝난다.
    if (this.timeUp) {
      this.timeUp = false;
      this.stageTimer = this.#stageSeconds();
    }

    this.input.clearBuffer();
    this.spawner.timer = CONFIG.spawn.firstDelay / 1000;
    this.state = GAME_STATE.PLAYING;
  }

  #resolveAttack(player) {
    if (!player.isAttackActive) return;

    for (const enemy of this.enemies) {
      if (enemy.isDying || !player.canHit(enemy)) continue;

      player.registerHit(enemy);
      const killed = enemy.takeDamage(player.attackDamage, player.x);

      const scale = enemy.scale;
      this.sparks.burst(enemy.x, enemy.y - 120 * scale, player.facing, scale);
      this.shake.kick(killed ? 8 : 4, killed ? 0.2 : 0.1);
      if (killed) this.audio.play("enemyDie");

      if (killed && !enemy.scoreGiven) {
        enemy.scoreGiven = true;
        this.#addScore(this.#killScore(enemy));
        this.#maybeDrop(enemy);
        if (enemy.boss) this.#clearStage();
      }
    }
  }

  /** 드랍표를 위에서부터 한 번의 주사위로 훑는다. 어디에도 안 걸리면 안 떨어진다. */
  #maybeDrop(enemy) {
    const roll = Math.random();
    let threshold = 0;

    for (const { kind, chance } of CONFIG.pickup.drops) {
      threshold += chance;
      if (roll >= threshold) continue;

      const icon = kind === "heal" ? this.assets.icons.healItem : this.assets.icons[`powerup_${kind}`];
      if (icon) this.pickups.push(new Pickup(icon, enemy.x, enemy.y, kind));
      return;
    }
  }

  #updatePickups(dt) {
    for (const pickup of this.pickups) {
      pickup.update(dt);
      if (pickup.taken) continue;
      if (this.player.downed || !pickup.overlaps(this.player)) continue;

      pickup.taken = true;
      this.audio.play("heal");
      this.sparks.burst(pickup.x, pickup.y - 40, 1, 1);

      if (pickup.kind === "heal") {
        this.lives += 1;
      } else if (pickup.kind === "attack") {
        this.powerStacks = this.player.gainPower(); // 다음 스테이지로 넘길 수 있게 게임 쪽에도 남긴다
      } else {
        this.player.applyBuff(pickup.kind);
      }
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
    // 보스는 머릿수에 넣지 않는다. 넣으면 보스 하나로 자리가 차서 잡몹이 끊긴다.
    const alive = this.enemies.filter((enemy) => !enemy.isDying && !enemy.boss).length;
    const spawned = this.spawner.update(dt, { cameraX: this.cameraX, aliveCount: alive });
    if (spawned) this.enemies.push(spawned);
  }

  /** 파밍 스테이지에서만 처치 점수를 크게 쳐준다. */
  #killScore(enemy) {
    const multiplier = this.stageDef.endless ? CONFIG.score.farmKillMultiplier : 1;
    return enemy.score * multiplier;
  }

  #addScore(amount) {
    this.score = Math.min(CONFIG.score.max, this.score + amount);
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

    ctx.imageSmoothingEnabled = false; // 저해상도 에셋을 확대해 그리므로 보간하지 않는다

    ctx.save();
    ctx.translate(shake.x, shake.y);
    if (this.showingClearArt) {
      this.#drawIllustration(ctx, this.assets.illustrations.clear);
    } else {
      this.#drawBackground(ctx);
      if (this.state !== GAME_STATE.LOBBY) this.#drawActors(ctx);
      this.sparks.draw(ctx, this.cameraX);
    }
    ctx.restore();

    this.#drawOverlay();
    this.crt.draw();
  }

  #drawBackground(ctx) {
    const { width, height } = CONFIG.view;
    const first = Math.max(0, Math.floor(this.cameraX / this.bgTileWidth));
    const last = Math.min(CONFIG.world.tiles - 1, Math.floor((this.cameraX + width) / this.bgTileWidth));

    for (let i = first; i <= last; i += 1) {
      ctx.drawImage(this.background, i * this.bgTileWidth - this.cameraX, 0, this.bgTileWidth, height);
    }
  }

  /** 연출용 전면 일러스트. 글자가 묻히지 않도록 살짝 어둡게 깐다. */
  #drawIllustration(ctx, image) {
    const { width, height } = CONFIG.view;

    ctx.save();
    ctx.fillStyle = "#05070c";
    ctx.fillRect(0, 0, width, height);
    if (image) ctx.drawImage(image, 0, 0, width, height);
    ctx.fillStyle = "rgba(3, 5, 12, 0.42)";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  /** 발끝 y 가 작은(안쪽) 대상부터 그려 앞뒤 관계를 만든다. */
  #drawActors(ctx) {
    const drawables = [...this.enemies, ...this.pickups, this.player].sort((a, b) => a.y - b.y);
    for (const drawable of drawables) drawable.draw(ctx, this.cameraX);
  }

  #drawOverlay() {
    if (this.state === GAME_STATE.LOBBY) {
      this.hud.drawLobbyBackdrop();
      this.hud.drawTitle();
      this.lobby.draw({ sound: !this.audio.muted, screen: this.crt.enabled });
      this.hud.drawControls();
      return;
    }

    if (this.state === GAME_STATE.RANKING) {
      this.ranking.draw();
      return;
    }

    if (this.state === GAME_STATE.EXIT) {
      this.hud.drawExit();
      return;
    }

    if (this.state === GAME_STATE.NAME_ENTRY) {
      this.nameEntry.draw(this.score, this.stage);
      return;
    }

    if (this.state === GAME_STATE.INTRO) {
      this.hud.drawStageIntro(this.stage, this.stageDef.name);
      this.hud.drawControls();
      return;
    }

    // 클리어 결과 위에는 HUD 를 얹지 않는다. 연출만 보여준다.
    if (this.showingClearResult) {
      this.hud.drawStageClear(this.stage, this.stageDef.name, this.clearLines, this.score, {
        final: this.isFinalStage,
        dim: !this.showingClearArt, // 일러스트가 아니라 필드 위라면 글자가 묻히지 않게 깔아준다
      });
      if (this.state === GAME_STATE.FADEOUT) {
        this.hud.drawFade(this.fadeTimer / (CONFIG.continue.fadeMs / 1000));
      }
      return;
    }

    this.hud.drawStats({
      lives: Math.max(0, this.lives),
      coins: this.coins,
      score: this.score,
      hiScore: this.hiScore,
      stage: this.stage,
      time: this.stageTimer,
      buffs: this.player.activeBuffs,
      power: this.player.powerStacks,
    });

    if (this.boss && !this.boss.dead) this.hud.drawBossBar(this.boss.hp / this.boss.maxHp);

    if (this.state === GAME_STATE.COUNTDOWN) {
      this.hud.drawCountdown(CONFIG.intro.countdown[this.countdownIndex]);
      this.hud.drawControls();
      return;
    }

    if (this.stageBannerTimer > 0) {
      this.hud.drawStageBanner(this.stage, this.stageDef.name, this.stageBannerTimer);
    }
    if (this.bossBannerTimer > 0) {
      this.hud.drawBossBanner(this.bossBannerTimer);
    }

    if (this.state === GAME_STATE.STAGE_CLEAR) return;

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
    const audio = new AudioBank(window.SPRITE_MANIFEST.audio);
    const board = new ScoreBoard();
    await board.load().catch(() => {});

    const game = new Game(canvas, assets, audio, board);

    // 터치 기기에서만 화면 위 조이패드를 띄운다. 키보드는 언제나 그대로 먹는다.
    if (isTouchDevice()) {
      document.body.classList.add("touch-enabled");
      game.setTouchMode(true);
      new TouchControls(game.input, document.getElementById("touch"));
    }

    window.__game = game; // 디버깅/밸런스 확인용 (canvas id="game" 과 겹치지 않게 언더스코어)
    game.start();
  } catch (error) {
    console.error(error);
    drawLoadingScreen(ctx, error.message);
  }
}

window.addEventListener("DOMContentLoaded", boot);

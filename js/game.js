// 게임 루프와 상태 전이.
//
// LOBBY ─ START ─> INTRO -> COUNTDOWN -> PLAYING -> (CONTINUE -> FADEOUT) -> GAMEOVER
//   │                                                                          │
//   ├─ RANKING <───────────────── NAME ENTRY <───────────────────────────────────┘
//   └─ EXIT
//
// 2P 는 NumpadEnter 로 언제든 난입한다. 생명과 코인은 팀 공유라 Game 이 들고 있다.

const GAME_STATE = {
  LOBBY: "lobby",
  RANKING: "ranking",
  EXIT: "exit",
  INTRO: "intro",
  COUNTDOWN: "countdown",
  PLAYING: "playing",
  CONTINUE: "continue", // 생명 0. 코인이 들어오면 이어서 시작한다.
  FADEOUT: "fadeout",   // 컨티뉴 실패 후 암전
  GAMEOVER: "gameover",
  NAME_ENTRY: "nameEntry",
};

const MAX_DELTA = 1 / 30; // 탭 전환 후 한 프레임에 몰려 튀는 것 방지
const SEPARATION_DEPTH = 20;
const MAX_PLAYERS = 2;
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
    this.rejoinTwoPlayer = false; // 다음 판에서 2P 를 그대로 세울지
    this.rankingFromGame = false; // 이름 등록을 거쳐서 온 랭킹인지

    this.input.onFirstKey = () => {
      this.audio.unlock();
      this.audio.playBgm("lobby");
    };

    this.#resetGame();
    this.state = GAME_STATE.LOBBY;
  }

  get twoPlayer() {
    return this.players.length > 1;
  }

  /** 쓰러지지 않은 플레이어들. 카메라와 에너미 타겟의 기준이다. */
  get activePlayers() {
    const standing = this.players.filter((player) => !player.downed);
    return standing.length > 0 ? standing : this.players;
  }

  /** 새 판을 인트로 상태로 준비한다. */
  #resetGame() {
    this.players = [];
    this.enemies = [];
    this.pickups = [];
    this.lives = CONFIG.player.startLives;
    this.score = 0;
    this.coins = 0;
    this.cameraX = 0;
    this.state = GAME_STATE.INTRO;
    this.countdownIndex = 0;
    this.countdownTimer = CONFIG.intro.countdownMs / 1000;
    this.continueTimer = 0;
    this.fadeTimer = 0;
    this.gameOverTimer = 0;
    this.stageBannerTimer = 0;
    this.shownStage = 1;

    this.#addPlayer();
    if (this.rejoinTwoPlayer) this.#addPlayer(); // 직전 판이 2P 였으면 그대로 이어간다

    this.spawner.reset();
    this.sparks.clear();
    this.shake.clear();
  }

  /** 인트로면 화면 밖에서 걸어 들어오고, 플레이 중이면 1P 옆에 세운다. */
  #addPlayer() {
    const index = this.players.length;
    if (index >= MAX_PLAYERS) return null;

    const { top, bottom } = CONFIG.stage;
    const anchorX = CONFIG.view.width * CONFIG.camera.anchorRatio;
    const intro = this.state === GAME_STATE.INTRO || this.state === GAME_STATE.COUNTDOWN;

    const spawn = intro
      ? { x: CONFIG.intro.startX + index * CONFIG.players.joinOffsetX, y: (top + bottom) / 2 + 40 + index * 46 }
      : this.#joinSpot();

    const player = new Player(this.assets.players[index] ?? this.assets.players[0], spawn.x, spawn.y, {
      index,
      font: this.assets.font,
      audio: this.audio,
      // 전용 스프라이트가 없을 때만 색조를 돌려 1P 와 구분한다.
      hue: this.assets.players[index] ? 0 : index * CONFIG.players.fallbackHue,
    });

    if (intro) {
      player.autoWalkTargetX = anchorX + index * CONFIG.players.joinOffsetX;
    } else {
      player.join();
    }

    this.players.push(player);
    for (const other of this.players) other.showLabel = this.players.length > 1;
    return player;
  }

  /** 플레이 도중 난입할 자리. 1P 옆이 화면 밖이면 반대쪽에 세운다. */
  #joinSpot() {
    const leader = this.players[0];
    const margin = CONFIG.players.viewMargin;
    const left = this.cameraX + margin;
    const right = this.cameraX + CONFIG.view.width - margin;

    let x = leader.x + CONFIG.players.joinOffsetX;
    if (x < left) x = leader.x - CONFIG.players.joinOffsetX;

    return { x: clamp(x, left, right), y: clamp(leader.y + 40, CONFIG.stage.top, CONFIG.stage.bottom) };
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
    this.#handleJoin();

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
    this.#updatePlayers(dt, controllable);

    if (this.state === GAME_STATE.INTRO && this.#introFinished()) {
      this.state = GAME_STATE.COUNTDOWN;
    }
    if (this.state === GAME_STATE.COUNTDOWN) {
      this.#updateCountdown(dt);
    }
    if (this.state === GAME_STATE.PLAYING) {
      this.#updatePlaying(dt);
    }

    this.#updateCamera(dt);
    this.#keepPlayersOnScreen();
    this.sparks.update(dt);
    this.shake.update(dt);
    if (this.stageBannerTimer > 0) this.stageBannerTimer -= dt;
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
      this.audio.playBgm("game");
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
      await this.board.submit({
        name,
        score: this.score,
        stage: this.spawner.stage,
        players: this.players.length,
      });
    } catch {
      /* submit 안에서 이미 폴백까지 처리한다 */
    }
  }

  /** 컨티뉴 중이거나 게임이 끝난 뒤에는 난입을 받지 않는다. */
  #handleJoin() {
    if (this.twoPlayer) return;
    if (!this.input.for(1).confirmed) return;
    if (this.state === GAME_STATE.CONTINUE || this.state === GAME_STATE.FADEOUT) return;
    if (this.state === GAME_STATE.GAMEOVER) return;

    this.#addPlayer();
    this.audio.play("coin");
    this.rejoinTwoPlayer = true;
  }

  #updatePlayers(dt, controllable) {
    this.players.forEach((player, index) => {
      player.update(dt, this.input.for(index), controllable);
    });
  }

  #introFinished() {
    return this.players.every((player) => player.autoWalkTargetX === null);
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
    this.#updatePlayers(dt, false); // 쓰러진 자세를 유지한 채 넉백만 잦아든다
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
    }
  }

  #updatePlaying(dt) {
    this.audio.playBgm("game");
    this.#updateEnemies(dt);
    this.#resolvePlayerAttacks();
    this.#separateEnemies();
    this.#updatePickups(dt);
    this.#updateSpawning(dt);

    this.enemies = this.enemies.filter((enemy) => !enemy.dead);
  }

  #updateEnemies(dt) {
    for (const enemy of this.enemies) {
      const victim = enemy.update(dt, this.players);
      if (!victim || !victim.takeDamage(enemy.x)) continue;

      this.lives -= 1;
      this.audio.play("hit");
      this.shake.kick(9, 0.22);
      this.sparks.burst(victim.x, victim.y - 90 * victim.scale, -enemy.facing, 1);

      if (this.lives <= 0) {
        this.#onPartyDown(); // enemies 를 비울 수 있으므로 순회를 끝낸다
        return;
      }
    }
  }

  /** 팀 생명이 다 떨어졌을 때. 코인이 있으면 바로, 없으면 카운트다운을 띄운다. */
  #onPartyDown() {
    this.lives = 0;

    if (this.coins > 0) {
      this.#spendCoinAndResume();
      return;
    }

    // 쓰러진 마지막 프레임 그대로 멈춰 세운다.
    for (const player of this.players) player.knockOut();
    this.state = GAME_STATE.CONTINUE;
    this.continueTimer = CONFIG.continue.seconds;
    this.audio.playBgm("countdown");
    this.audio.play("countdown");
  }

  /** 점수와 스테이지는 그대로 두고 생명만 채워 그 자리에서 이어간다. */
  #spendCoinAndResume() {
    this.coins -= 1;
    this.lives = CONFIG.player.startLives;
    for (const player of this.players) player.revive();

    this.audio.stop("countdown");
    this.enemies.length = 0; // 부활하자마자 둘러싸이지 않도록 정리
    this.spawner.timer = CONFIG.spawn.firstDelay / 1000;
    this.state = GAME_STATE.PLAYING;
  }

  #resolvePlayerAttacks() {
    for (const player of this.players) this.#resolveAttack(player);
  }

  #resolveAttack(player) {
    if (!player.isAttackActive) return;

    for (const enemy of this.enemies) {
      if (enemy.isDying || !player.canHit(enemy)) continue;

      player.registerHit(enemy);
      const killed = enemy.takeDamage(CONFIG.player.attack.damage, player.x);

      const scale = enemy.scale;
      this.sparks.burst(enemy.x, enemy.y - 120 * scale, player.facing, scale);
      this.shake.kick(killed ? 8 : 4, killed ? 0.2 : 0.1);
      if (killed) this.audio.play("enemyDie");

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

  /** 회복 아이템은 누가 먹든 공유 생명이 늘어난다. */
  #updatePickups(dt) {
    for (const pickup of this.pickups) {
      pickup.update(dt);
      if (pickup.taken) continue;

      const taker = this.players.find((player) => !player.downed && pickup.overlaps(player));
      if (!taker) continue;

      pickup.taken = true;
      this.lives += 1;
      this.audio.play("heal");
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

    if (this.spawner.stage > this.shownStage) {
      this.shownStage = this.spawner.stage;
      this.stageBannerTimer = CONFIG.hud.stageBannerMs / 1000;
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

    // 2P 가 있으면 둘의 가운데를 따라간다.
    const group = this.activePlayers;
    const center = group.reduce((sum, player) => sum + player.x, 0) / group.length;

    const target = clamp(
      center - CONFIG.view.width * CONFIG.camera.anchorRatio,
      0,
      CONFIG.world.width - CONFIG.view.width
    );
    this.cameraX += (target - this.cameraX) * Math.min(1, CONFIG.camera.lerp * dt);
  }

  /** 2P 가 서로 반대로 달려도 한 명이 화면 밖으로 사라지지 않게 잡아둔다. */
  #keepPlayersOnScreen() {
    if (!this.twoPlayer || this.state === GAME_STATE.INTRO) return;

    for (const player of this.players) {
      if (player.autoWalkTargetX !== null) continue;
      player.clampToView(this.cameraX, CONFIG.players.viewMargin);
    }
  }

  draw() {
    const ctx = this.ctx;
    const shake = this.shake.offset;

    ctx.imageSmoothingEnabled = false; // 저해상도 에셋을 확대해 그리므로 보간하지 않는다

    ctx.save();
    ctx.translate(shake.x, shake.y);
    this.#drawBackground(ctx);
    if (this.state !== GAME_STATE.LOBBY) this.#drawActors(ctx);
    this.sparks.draw(ctx, this.cameraX);
    ctx.restore();

    this.#drawOverlay();
    this.crt.draw();
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
    const drawables = [...this.enemies, ...this.pickups, ...this.players].sort((a, b) => a.y - b.y);
    for (const drawable of drawables) drawable.draw(ctx, this.cameraX);
  }

  #drawOverlay() {
    if (this.state === GAME_STATE.LOBBY) {
      this.hud.drawLobbyBackdrop();
      this.hud.drawTitle();
      this.lobby.draw({ sound: !this.audio.muted, screen: this.crt.enabled });
      this.hud.drawControls(this.twoPlayer);
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
      this.nameEntry.draw(this.score, this.spawner.stage);
      return;
    }

    if (this.state === GAME_STATE.INTRO) {
      this.hud.drawTitle();
      this.hud.drawControls(this.twoPlayer);
      return;
    }

    this.hud.drawStats({
      lives: Math.max(0, this.lives),
      coins: this.coins,
      score: this.score,
      hiScore: this.hiScore,
      stage: this.spawner.stage,
    });

    if (this.state === GAME_STATE.COUNTDOWN) {
      this.hud.drawCountdown(CONFIG.intro.countdown[this.countdownIndex]);
      this.hud.drawControls(this.twoPlayer);
      return;
    }

    if (this.stageBannerTimer > 0) {
      this.hud.drawStageBanner(this.spawner.stage, this.stageBannerTimer);
    }

    if (this.state === GAME_STATE.PLAYING && !this.twoPlayer) {
      this.hud.drawJoinHint();
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
    const audio = new AudioBank(window.SPRITE_MANIFEST.audio);
    const board = new ScoreBoard();
    await board.load().catch(() => {});

    const game = new Game(canvas, assets, audio, board);
    window.__game = game; // 디버깅/밸런스 확인용 (canvas id="game" 과 겹치지 않게 언더스코어)
    game.start();
  } catch (error) {
    console.error(error);
    drawLoadingScreen(ctx, error.message);
  }
}

window.addEventListener("DOMContentLoaded", boot);

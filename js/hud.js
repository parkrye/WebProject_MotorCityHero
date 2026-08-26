// 생명 / 코인 / 점수 표시와 인트로 · 컨티뉴 · 게임오버 오버레이.
// 모든 글자는 비트맵 폰트(A-Z, 0-9)로 그린다. 하이픈과 콜론이 없어 공백으로 대신한다.

const HI_SCORE_KEY = "motorCityHero.hiScore";

function loadHiScore() {
  try {
    return Number(localStorage.getItem(HI_SCORE_KEY)) || 0;
  } catch {
    return 0; // file:// 등 스토리지가 막힌 환경
  }
}

function saveHiScore(score) {
  try {
    localStorage.setItem(HI_SCORE_KEY, String(score));
  } catch {
    /* 저장 불가 환경은 무시 */
  }
}

function padScore(value) {
  return String(Math.max(0, Math.floor(value))).padStart(6, "0");
}

/**
 * 컨티뉴 카운트다운에 띄울 숫자.
 *
 * 효과음이 앞부분을 조금 띄우고 세기 시작하므로 그동안은 숫자를 내지 않고,
 * 남은 시간을 displayFrom ~ 0 으로 고르게 나눈다.
 * @returns {number|null} null 이면 아직 아무것도 띄우지 않는 구간
 */
function countdownNumber(secondsLeft) {
  const { seconds, leadInSeconds, displayFrom } = CONFIG.continue;

  const elapsed = seconds - secondsLeft;
  if (elapsed < leadInSeconds) return null;

  const counting = seconds - leadInSeconds;
  const progress = clamp((elapsed - leadInSeconds) / counting, 0, 1);
  const steps = displayFrom + 1; // 10 부터 0 까지면 11 단계

  return clamp(displayFrom - Math.floor(progress * steps), 0, displayFrom);
}

/** 비트맵 폰트를 아직 못 읽은 시점(로딩 · 에러)에서만 쓰는 시스템 폰트 화면. */
function drawLoadingScreen(ctx, message) {
  const { width, height } = CONFIG.view;
  ctx.save();
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#9fd0ff";
  ctx.font = 'bold 26px "Consolas", "Courier New", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(message, width / 2, height / 2);
  ctx.restore();
}

class Hud {
  constructor(ctx, font, icons) {
    this.ctx = ctx;
    this.font = font;
    this.icons = icons;
  }

  /** 아이콘을 높이 기준으로 그리고 차지한 폭을 돌려준다. */
  #icon(image, x, y, height) {
    const width = image.width * (height / image.height);
    this.ctx.drawImage(image, x, y, width, height);
    return width;
  }

  #center(text, y, size, alpha = 1) {
    this.font.draw(this.ctx, text, CONFIG.view.width / 2, y, { size, align: "center", alpha });
  }

  drawStats({ lives, coins, score, hiScore, stage, time, buffs = [] }) {
    const ctx = this.ctx;
    const { width } = CONFIG.view;
    const { barHeight, iconSize, iconGap, labelSize, maxHeartIcons } = CONFIG.hud;

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(0, 0, width, barHeight);
    ctx.restore();

    const rowY = 14;
    const labelY = rowY + (iconSize - labelSize) / 2 + 2; // 아이콘 높이 기준 세로 중앙
    let x = 24;

    // 생명: 개수만큼 나열하되, 너무 많아지면 아이콘 하나 + X n 으로 줄인다.
    if (lives <= maxHeartIcons) {
      for (let i = 0; i < lives; i += 1) {
        x += this.#icon(this.icons.heartIcon, x, rowY, iconSize) + iconGap;
      }
    } else {
      x += this.#icon(this.icons.heartIcon, x, rowY, iconSize) + iconGap;
      x += this.font.draw(ctx, `X ${lives}`, x, labelY, { size: labelSize }) + iconGap;
    }

    x += 26;
    x += this.#icon(this.icons.coin, x, rowY, iconSize) + iconGap;
    this.font.draw(ctx, `X ${String(coins).padStart(2, "0")}`, x, labelY, { size: labelSize });

    this.font.draw(ctx, `STAGE ${stage}`, width - 24, labelY, { size: labelSize, align: "right" });
    this.#drawTime(time, labelY, labelSize);

    const scoreY = rowY + iconSize + 12;
    this.font.draw(ctx, `SCORE ${padScore(score)}`, 24, scoreY, { size: 26 });
    this.font.draw(ctx, `HI SCORE ${padScore(hiScore)}`, width - 24, scoreY, { size: 26, align: "right" });

    this.#drawBuffs(buffs, scoreY);
  }

  /** 걸려 있는 버프와 남은 초. 보호막은 시간이 아니라 한 번 막을 때까지라 ON 으로 적는다. */
  #drawBuffs(buffs, y) {
    if (buffs.length === 0) return;

    const { buffIconSize, buffLabelSize, buffGap } = CONFIG.hud;
    let x = CONFIG.view.width / 2 - (buffs.length * (buffIconSize + buffGap + 42)) / 2;

    for (const { kind, seconds } of buffs) {
      const icon = this.icons[`powerup_${kind}`];
      if (!icon) continue;

      x += this.#icon(icon, x, y - 4, buffIconSize) + 6;
      const label = seconds === Infinity ? "ON" : String(Math.ceil(seconds));
      x += this.font.draw(this.ctx, label, x, y + 2, { size: buffLabelSize, alpha: 0.9 }) + buffGap;
    }
  }

  drawTitle() {
    const { height } = CONFIG.view;
    this.#center("MOTOR CITY HERO", height * 0.2, 64);
    this.#center("MISTER D", height * 0.32, 40);
  }

  /** 하단 조작 안내. */
  drawControls() {
    this.#center("WASD MOVE    J PUNCH    K KICK    P COIN", CONFIG.view.height - 54, 20, 0.8);
  }

  /** 로비에서 배경 위에 깔아 글자가 묻히지 않게 하는 어둡기. */
  drawLobbyBackdrop() {
    const ctx = this.ctx;
    const { width, height } = CONFIG.view;

    ctx.save();
    ctx.fillStyle = "rgba(2, 4, 10, 0.62)";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  /** 브라우저 탭은 스크립트로 닫을 수 없으므로 인사만 하고 로비로 돌아간다. */
  drawExit() {
    const { height } = CONFIG.view;
    this.drawFade(1);
    this.#center("THANK YOU FOR PLAYING", height * 0.36, 52);
    this.#center("CLOSE THIS TAB TO QUIT", height * 0.52, 24, 0.7);
    this.#center("PRESS ACTION TO GO BACK", height * 0.66, 22, 0.5);
  }

  drawCountdown(text) {
    this.#center(text, CONFIG.view.height * 0.34, text.length > 1 ? 68 : 128);
  }

  /** 남은 시간. 폰트에 색을 입힐 수 없어 막바지에는 깜빡여서 재촉한다. */
  #drawTime(seconds, y, size) {
    const left = Math.max(0, Math.ceil(seconds));
    const hurry = left <= CONFIG.stageTimer.warnRemaining && Math.floor(seconds * 4) % 2 === 0;
    this.font.draw(this.ctx, `TIME ${String(left).padStart(3, "0")}`, CONFIG.view.width / 2, y, {
      size,
      align: "center",
      alpha: hurry ? 0.35 : 1,
    });
  }

  drawStageBanner(stage, name, remaining) {
    const alpha = clamp(remaining / 0.4, 0, 1);
    this.#center(`STAGE ${stage}`, CONFIG.view.height * 0.2, 60, alpha);
    this.#center(name, CONFIG.view.height * 0.3, 34, alpha * 0.85);
  }

  /** 스테이지 진입 화면. 배경 일러스트 위에 어디로 들어가는지 알려준다. */
  drawStageIntro(stage, name) {
    const { height } = CONFIG.view;
    this.#center(`STAGE ${stage}`, height * 0.18, 62);
    this.#center(name, height * 0.29, 40, 0.9);
  }

  drawBossBanner(remaining) {
    const alpha = clamp(remaining / 0.5, 0, 1);
    this.#center("BOSS", CONFIG.view.height * 0.36, 92, alpha);
  }

  /** 최종보스 체력. 머리 위 작은 막대 대신 화면 위에 크게 하나만 둔다. */
  drawBossBar(ratio) {
    const ctx = this.ctx;
    const { width } = CONFIG.view;
    const barWidth = CONFIG.hud.bossBarWidth;
    const x = (width - barWidth) / 2;
    const y = CONFIG.hud.barHeight + 26;
    const height = 14;

    this.font.draw(ctx, "BOSS", width / 2, y - 26, { size: 20, align: "center", alpha: 0.9 });

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(x - 3, y - 3, barWidth + 6, height + 6);
    ctx.fillStyle = "#e5484d";
    ctx.fillRect(x, y, barWidth * clamp(ratio, 0, 1), height);
    ctx.strokeStyle = "rgba(255, 214, 92, 0.85)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 3, y - 3, barWidth + 6, height + 6);
    ctx.restore();
  }

  drawStageClear(stage, name) {
    const { height } = CONFIG.view;
    this.#center("STAGE CLEAR", height * 0.3, 70);
    this.#center(`STAGE ${stage}  ${name}`, height * 0.44, 28, 0.85);
  }

  /** 컨티뉴 카운트다운. 이 사이에 코인이 들어오면 이어서 시작한다. */
  drawContinue(secondsLeft) {
    const ctx = this.ctx;
    const { width, height } = CONFIG.view;

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    this.#center("CONTINUE", height * 0.24, 58);
    const shown = countdownNumber(secondsLeft);
    if (shown !== null) this.#center(String(shown), height * 0.36, 132);
    this.#center("PRESS P TO INSERT COIN", height * 0.68, 26);
  }

  /** 컨티뉴 실패 후 암전. */
  drawFade(progress) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${clamp(progress, 0, 1)})`;
    ctx.fillRect(0, 0, CONFIG.view.width, CONFIG.view.height);
    ctx.restore();
  }

  drawGameOver(score, hiScore) {
    const { height } = CONFIG.view;
    this.drawFade(1);
    this.#center("GAME OVER", height * 0.26, 84);
    this.#center(`SCORE ${padScore(score)}`, height * 0.45, 34);
    this.#center(`HI SCORE ${padScore(hiScore)}`, height * 0.54, 26);
    this.#center("PRESS ACTION TO REGISTER YOUR NAME", height * 0.7, 24);
  }
}

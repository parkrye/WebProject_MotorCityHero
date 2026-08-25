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

  drawStats({ lives, coins, score, hiScore, level }) {
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

    this.font.draw(ctx, `LEVEL ${level}`, width - 24, labelY, { size: labelSize, align: "right" });

    const scoreY = rowY + iconSize + 12;
    this.font.draw(ctx, `SCORE ${padScore(score)}`, 24, scoreY, { size: 26 });
    this.font.draw(ctx, `HI SCORE ${padScore(hiScore)}`, width - 24, scoreY, { size: 26, align: "right" });
  }

  drawTitle() {
    const { height } = CONFIG.view;
    this.#center("MOTOR CITY HERO", height * 0.2, 64);
    this.#center("MISTER D", height * 0.32, 40);
  }

  drawControls() {
    this.#center("WASD MOVE    J ATTACK    P COIN", CONFIG.view.height - 46, 20, 0.8);
  }

  drawCountdown(text) {
    this.#center(text, CONFIG.view.height * 0.34, text.length > 1 ? 68 : 128);
  }

  drawLevelBanner(level, remaining) {
    const alpha = clamp(remaining / 0.4, 0, 1);
    this.#center(`LEVEL ${level}`, CONFIG.view.height * 0.24, 60, alpha);
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
    this.#center(String(Math.max(0, Math.ceil(secondsLeft))), height * 0.36, 132);
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
    this.#center("PRESS R TO RESTART", height * 0.7, 26);
  }
}

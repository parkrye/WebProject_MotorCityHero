// 생명 / 코인 / 점수 표시와 인트로 · 컨티뉴 · 게임오버 오버레이.
// 모든 글자는 비트맵 폰트(A-Z, 0-9)로 그린다. 하이픈과 콜론이 없어 공백으로 대신한다.

// 게임 이름이 바뀌어도 그대로 둔다. 키를 바꾸면 기존 최고 점수가 날아간다.
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
    this.touch = false; // 터치 기기면 안내 문구를 그쪽 버튼 이름으로 바꾼다
  }

  /** 아이콘을 높이 기준으로 그리고 차지한 폭을 돌려준다. */
  #icon(image, x, y, height) {
    const width = image.width * (height / image.height);
    this.ctx.drawImage(image, x, y, width, height);
    return width;
  }

  /**
   * 아이콘 하나 + `X nn`. 두 자리로 고정해 개수가 변해도 폭이 흔들리지 않는다.
   * @returns {number} 차지한 가로 폭
   */
  #drawCount(image, count, x, rowY, labelY) {
    const { iconSize, iconGap, labelSize } = CONFIG.hud;
    const text = `X ${String(Math.max(0, count)).padStart(2, "0")}`;

    const iconWidth = this.#icon(image, x, rowY, iconSize) + iconGap;
    return iconWidth + this.font.draw(this.ctx, text, x + iconWidth, labelY, { size: labelSize });
  }

  #center(text, y, size, alpha = 1) {
    this.font.draw(this.ctx, text, CONFIG.view.width / 2, y, { size, align: "center", alpha });
  }

  drawStats({ lives, coins, score, hiScore, stage, time, buffs = [], power = 0 }) {
    const ctx = this.ctx;
    const { width } = CONFIG.view;
    const { barHeight, iconSize, iconGap, labelSize, countGap } = CONFIG.hud;

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(0, 0, width, barHeight);
    ctx.restore();

    const rowY = 14;
    const labelY = rowY + (iconSize - labelSize) / 2 + 2; // 아이콘 높이 기준 세로 중앙
    let x = 24;

    // 생명 · 코인 둘 다 아이콘 하나 + X n. 개수만큼 나열하면 생명이 늘어났을 때
    // 오른쪽 표시를 밀고 들어가므로 폭이 변하지 않는 이 형태로 통일한다.
    x += this.#drawCount(this.icons.heartIcon, lives, x, rowY, labelY) + countGap;
    this.#drawCount(this.icons.coin, coins, x, rowY, labelY);

    this.font.draw(ctx, `STAGE ${stage}`, width - 24, labelY, { size: labelSize, align: "right" });
    this.#drawTime(time, labelY, labelSize);

    const scoreY = rowY + iconSize + 12;
    this.font.draw(ctx, `SCORE ${padScore(score)}`, 24, scoreY, { size: 26 });
    this.font.draw(ctx, `HI SCORE ${padScore(hiScore)}`, width - 24, scoreY, { size: 26, align: "right" });

    this.#drawBuffs(buffs, power, scoreY);
  }

  /**
   * 누적 공격력과 걸려 있는 버프를 한 줄로 늘어놓는다.
   * 공격력은 시간이 아니라 단계라 LV 로, 보호막은 한 번 막을 때까지라 ON 으로 적는다.
   * 폰트에 소수점이 없어 배율(1.5 배) 대신 단계로 보여준다.
   */
  #drawBuffs(buffs, power, y) {
    const slots = [];
    if (power > 0) slots.push({ kind: "attack", label: `LV ${power}` });
    for (const { kind, seconds } of buffs) {
      slots.push({ kind, label: seconds === Infinity ? "ON" : String(Math.ceil(seconds)) });
    }
    if (slots.length === 0) return;

    const { buffIconSize, buffLabelSize, buffGap } = CONFIG.hud;
    let x = CONFIG.view.width / 2 - (slots.length * (buffIconSize + buffGap + 42)) / 2;

    for (const { kind, label } of slots) {
      const icon = this.icons[`powerup_${kind}`];
      if (!icon) continue;

      x += this.#icon(icon, x, y - 4, buffIconSize) + 6;
      x += this.font.draw(this.ctx, label, x, y + 2, { size: buffLabelSize, alpha: 0.9 }) + buffGap;
    }
  }

  drawTitle() {
    const { height } = CONFIG.view;
    this.#center("DONALD FURY 2088", height * 0.2, 64);
    this.#center("TEXAS TO THE MOON", height * 0.32, 40);
  }

  /** 하단 조작 안내. */
  drawControls() {
    const text = this.touch
      ? "STICK MOVE    A PUNCH    B KICK    P COIN"
      : "WASD MOVE    J PUNCH    K KICK    P COIN";
    this.#center(text, CONFIG.view.height - 54, 20, 0.8);
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
    this.#center(this.touch ? "TAP A TO GO BACK" : "PRESS ACTION TO GO BACK", height * 0.66, 22, 0.5);
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

  /** 스테이지 진입 화면. 스테이지 배경 위에 어디로 들어가는지 알려준다. */
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

  /** @param {{label: string, value: number}[]} lines  이번 스테이지에서 번 점수 내역 */
  /**
   * 클리어 결과. 점수는 한 줄씩 순서대로 "쾅" 하고 찍힌다.
   * @param {number} options.elapsed  결과 화면이 뜬 뒤 흐른 시간(ms). 도장 순서를 잡는다
   */
  drawStageClear(stage, name, lines, total, { final = false, dim = false, elapsed = Infinity } = {}) {
    const ctx = this.ctx;
    const { width, height } = CONFIG.view;
    const { stampIntervalMs } = CONFIG.stageClear;

    // 필드 위에 그대로 얹을 때는 배경이 밝아 글자가 묻힌다. 한 겹 깔아준다.
    if (dim) {
      ctx.save();
      ctx.fillStyle = "rgba(2, 4, 10, 0.62)";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    this.#center(final ? "GAME CLEAR" : "STAGE CLEAR", height * 0.16, 64);
    this.#center(final ? "ALL STAGE CLEAR" : `STAGE ${stage}  ${name}`, height * 0.28, 26, 0.85);

    let y = height * 0.42;
    lines.forEach(({ label, value }, index) => {
      this.#drawStampRow(label, padScore(value), y, 23, 0.85, elapsed - index * stampIntervalMs);
      y += 36;
    });

    // TOTAL 은 보너스 줄이 다 찍힌 다음에 마지막으로 박힌다.
    const totalAge = elapsed - lines.length * stampIntervalMs;
    this.#drawStampRow("TOTAL", padScore(total), y + 16, 30, 1, totalAge);
  }

  /**
   * 도장 한 줄. 아직 차례가 오지 않았으면 아무것도 그리지 않고,
   * 막 찍힌 순간에는 크게 들어왔다가 제자리 크기로 줄어든다.
   * @param {number} age  이 줄이 찍힌 뒤 흐른 시간(ms). 음수면 아직 안 찍혔다
   */
  #drawStampRow(label, value, y, size, alpha, age) {
    if (age < 0) return;

    const ctx = this.ctx;
    const { stampPunchMs, stampScale } = CONFIG.stageClear;
    const half = 220;
    const punch = Math.max(0, 1 - age / stampPunchMs);
    const scale = 1 + punch * stampScale;

    ctx.save();
    ctx.translate(CONFIG.view.width / 2, y);
    ctx.scale(scale, scale);
    this.font.draw(ctx, label, -half, 0, { size, alpha });
    this.font.draw(ctx, value, half, 0, { size, align: "right", alpha });
    ctx.restore();
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
    this.#center(this.touch ? "TAP P TO INSERT COIN" : "PRESS P TO INSERT COIN", height * 0.68, 26);
  }

  /** 컨티뉴 실패 후 암전. */
  drawFade(progress) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${clamp(progress, 0, 1)})`;
    ctx.fillRect(0, 0, CONFIG.view.width, CONFIG.view.height);
    ctx.restore();
  }

  /** @param {boolean} options.cleared  마지막 스테이지를 끝내고 온 거라면 실패가 아니다. */
  drawGameOver(score, hiScore, { cleared = false } = {}) {
    const { height } = CONFIG.view;
    this.drawFade(1);
    this.#center(cleared ? "GAME CLEAR" : "GAME OVER", height * 0.26, cleared ? 74 : 84);
    if (cleared) this.#center("CONGRATULATIONS", height * 0.36, 28, 0.85);
    this.#center(`SCORE ${padScore(score)}`, height * 0.45, 34);
    this.#center(`HI SCORE ${padScore(hiScore)}`, height * 0.54, 26);
    const hint = this.touch ? "TAP A TO REGISTER YOUR NAME" : "PRESS ACTION TO REGISTER YOUR NAME";
    this.#center(hint, height * 0.7, 24);
  }
}

// 로비 메뉴 · 이름 등록 · 랭킹 화면.
//
// 조작은 게임과 같다. WASD 또는 화살표로 고르고, J 또는 NumpadEnter 로 확정한다.
// 비트맵 폰트에 A-Z 와 0-9 밖에 없어 화살표·기호 대신 깜빡임과 밑줄로 커서를 표시한다.

const NAME_COMMANDS = ["DEL", "END"];

/** 선택된 항목을 감싸는 반투명 박스. 폰트에 색을 입힐 수 없어 배경으로 표시한다. */
function drawHighlight(ctx, x, y, width, height, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(255, 214, 92, 0.22)";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "rgba(255, 214, 92, 0.85)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
  ctx.restore();
}

/** 로비. GAME START / RANKING / EXIT 를 위아래로 고른다. */
class LobbyMenu {
  constructor(ctx, font) {
    this.ctx = ctx;
    this.font = font;
    this.index = 0;
    this.time = 0;
  }

  reset() {
    this.index = 0;
    this.time = 0;
  }

  /** @returns {"start"|"ranking"|"exit"|null} */
  update(dt, input, audio) {
    this.time += dt;

    const step = input.menuStep();
    if (step.y !== 0) {
      const count = CONFIG.lobby.items.length;
      this.index = (this.index + step.y + count) % count;
      audio.play("button");
    }

    if (!input.confirmed) return null;

    audio.play("button");
    return ["start", "ranking", "exit"][this.index];
  }

  draw() {
    const ctx = this.ctx;
    const { width, height } = CONFIG.view;
    const { items, itemSize, itemGap, blinkHz } = CONFIG.lobby;

    const top = height * 0.52;
    const blink = Math.floor(this.time * blinkHz) % 2 === 0;

    items.forEach((label, index) => {
      const y = top + index * itemGap;
      const selected = index === this.index;
      const textWidth = this.font.measure(label, itemSize);

      if (selected) {
        drawHighlight(ctx, width / 2 - textWidth / 2 - 22, y - 8, textWidth + 44, itemSize + 16, blink ? 1 : 0.45);
      }
      this.font.draw(ctx, label, width / 2, y, {
        size: itemSize,
        align: "center",
        alpha: selected ? 1 : 0.55,
      });
    });
  }
}

/** 오락실식 이름 등록. 문자표를 커서로 골라 한 글자씩 넣는다. */
class NameEntry {
  constructor(ctx, font) {
    this.ctx = ctx;
    this.font = font;
    this.cells = [...CONFIG.ranking.charset, ...NAME_COMMANDS];
    this.reset();
  }

  reset() {
    this.name = "";
    this.cursor = 0;
    this.time = 0;
  }

  get columns() {
    return CONFIG.ranking.gridColumns;
  }

  get rows() {
    return Math.ceil(this.cells.length / this.columns);
  }

  /** @returns {string|null} 확정된 이름 */
  update(dt, input, audio) {
    this.time += dt;

    const step = input.menuStep();
    if (step.x !== 0 || step.y !== 0) {
      this.#moveCursor(step);
      audio.play("button");
    }

    if (!input.confirmed) return null;

    return this.#select(audio);
  }

  #moveCursor({ x, y }) {
    const columns = this.columns;
    let row = Math.floor(this.cursor / columns);
    let col = this.cursor % columns;

    if (x !== 0) {
      col = (col + x + columns) % columns;
    }
    if (y !== 0) {
      row = (row + y + this.rows) % this.rows;
    }

    // 마지막 줄은 칸이 모자랄 수 있다. 넘치면 그 줄의 마지막 칸으로 붙인다.
    const index = row * columns + col;
    this.cursor = Math.min(index, this.cells.length - 1);
  }

  #select(audio) {
    const cell = this.cells[this.cursor];
    audio.play("button");

    if (cell === "END") {
      return this.name.trim() || "NO NAME";
    }
    if (cell === "DEL") {
      this.name = this.name.slice(0, -1);
      return null;
    }
    if (this.name.length < CONFIG.ranking.nameMaxLength) {
      this.name += cell;
    }
    return null;
  }

  draw(score, stage) {
    const ctx = this.ctx;
    const { width, height } = CONFIG.view;

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    this.font.draw(ctx, "ENTER YOUR NAME", width / 2, 74, { size: 46, align: "center" });
    this.font.draw(ctx, `SCORE ${padScore(score)}    STAGE ${stage}`, width / 2, 138, {
      size: 24,
      align: "center",
      alpha: 0.8,
    });

    this.#drawNameField(180);
    this.#drawGrid(268);

    this.font.draw(ctx, "MOVE AND PRESS ACTION    END TO FINISH", width / 2, height - 44, {
      size: 18,
      align: "center",
      alpha: 0.5,
    });
  }

  /** 입력한 이름을 16칸 밑줄 위에 얹어 보여준다. */
  #drawNameField(y) {
    const ctx = this.ctx;
    const max = CONFIG.ranking.nameMaxLength;
    const size = 34;
    const slot = 34;
    const totalWidth = slot * max;
    const startX = (CONFIG.view.width - totalWidth) / 2;
    const caretVisible = Math.floor(this.time * 3) % 2 === 0;

    ctx.save();
    for (let i = 0; i < max; i += 1) {
      const x = startX + i * slot;
      const filled = i < this.name.length;
      const isCaret = i === this.name.length;

      ctx.fillStyle = isCaret && caretVisible ? "rgba(255, 214, 92, 0.9)" : "rgba(150, 190, 255, 0.4)";
      ctx.fillRect(x + 4, y + size + 6, slot - 8, 3);

      if (filled) {
        this.font.draw(ctx, this.name[i], x + slot / 2, y, { size, align: "center" });
      }
    }
    ctx.restore();

    this.font.draw(ctx, `${this.name.length} OF ${max}`, CONFIG.view.width / 2, y + size + 26, {
      size: 16,
      align: "center",
      alpha: 0.45,
    });
  }

  #drawGrid(top) {
    const ctx = this.ctx;
    const columns = this.columns;
    const cellW = 68; // DEL·END 같은 세 글자 라벨이 옆칸과 붙지 않을 만큼
    const cellH = 52;
    const startX = (CONFIG.view.width - columns * cellW) / 2;
    const blink = Math.floor(this.time * 4) % 2 === 0;

    this.cells.forEach((cell, index) => {
      const row = Math.floor(index / columns);
      const col = index % columns;
      const x = startX + col * cellW;
      const y = top + row * cellH;
      const selected = index === this.cursor;

      if (selected) drawHighlight(ctx, x + 3, y + 2, cellW - 6, cellH - 6, blink ? 1 : 0.5);

      const label = cell === " " ? "SP" : cell;
      const size = label.length > 1 ? 15 : 28;
      this.font.draw(ctx, label, x + cellW / 2, y + (cellH - size) / 2, {
        size,
        align: "center",
        alpha: selected ? 1 : 0.7,
      });
    });
  }
}

/** 랭킹. 1페이지는 상위 10위를 크게, 이후는 20개씩 목록으로 보여준다. */
class RankingView {
  constructor(ctx, font, board) {
    this.ctx = ctx;
    this.font = font;
    this.board = board;
    this.reset();
  }

  reset() {
    this.page = 0;
    this.onBack = true; // 왼쪽 뒤로가기 버튼에 커서를 두고 시작한다
    this.time = 0;
  }

  get pageCount() {
    const { topCount, pageSize } = CONFIG.ranking;
    const rest = Math.max(0, this.board.entries.length - topCount);
    return 1 + Math.ceil(rest / pageSize);
  }

  /** @returns {"back"|null} */
  update(dt, input, audio) {
    this.time += dt;

    const step = input.menuStep();
    if (step.x !== 0) {
      this.onBack = step.x < 0;
      audio.play("button");
    }
    if (step.y !== 0) {
      const count = this.pageCount;
      this.page = (this.page + step.y + count) % count;
      audio.play("button");
    }

    if (!input.confirmed) return null;

    audio.play("button");
    return this.onBack ? "back" : null;
  }

  draw() {
    const ctx = this.ctx;
    const { width, height } = CONFIG.view;

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.86)";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    this.font.draw(ctx, "RANKING", width / 2, 44, { size: 46, align: "center" });
    this.#drawBackButton();
    this.#drawSource();

    if (this.board.isEmpty) {
      this.font.draw(ctx, "NO RECORDS YET", width / 2, height * 0.45, { size: 30, align: "center", alpha: 0.6 });
    } else if (this.page === 0) {
      this.#drawTop();
    } else {
      this.#drawList();
    }

    const pageLabel = `PAGE ${this.page + 1} OF ${this.pageCount}`;
    this.font.draw(ctx, pageLabel, width / 2, height - 62, { size: 20, align: "center", alpha: 0.65 });
    this.font.draw(ctx, "UP DOWN TO TURN PAGE    LEFT TO BACK", width / 2, height - 34, {
      size: 17,
      align: "center",
      alpha: 0.45,
    });
  }

  #drawBackButton() {
    const ctx = this.ctx;
    const label = "BACK";
    const size = 24;
    const blink = Math.floor(this.time * 3) % 2 === 0;
    const boxWidth = this.font.measure(label, size) + 36;

    if (this.onBack) drawHighlight(ctx, 24, 96, boxWidth, size + 22, blink ? 1 : 0.5);
    this.font.draw(ctx, label, 24 + boxWidth / 2, 96 + 11, {
      size,
      align: "center",
      alpha: this.onBack ? 1 : 0.55,
    });
  }

  /** 기록이 서버에 남는지 이 브라우저에만 남는지 알려준다. */
  #drawSource() {
    const label = this.board.online ? "SHARED ON THIS SERVER" : "SAVED IN THIS BROWSER ONLY";
    this.font.draw(this.ctx, label, CONFIG.view.width - 24, 104, {
      size: 16,
      align: "right",
      alpha: 0.4,
    });
  }

  /** 1~10 위. 1위는 더 크게 뽑아준다. */
  #drawTop() {
    const ctx = this.ctx;
    const { width } = CONFIG.view;
    const entries = this.board.entries.slice(0, CONFIG.ranking.topCount);
    const top = 168;
    const rowHeight = 50;

    entries.forEach((entry, index) => {
      const y = top + index * rowHeight;
      const first = index === 0;
      const size = first ? 34 : 26;
      const alpha = entry === this.board.lastEntry ? 1 : 0.9 - index * 0.03;
      const offset = first ? 0 : (34 - size) / 2;

      if (entry === this.board.lastEntry) {
        drawHighlight(ctx, 80, y - 6, width - 216, rowHeight - 8, 0.9);
      }

      // 1 위는 글자가 커서 16 자 이름이 겨우 들어간다. 좌우 여백을 그만큼 좁게 잡는다.
      // 이름 시작은 모든 행에서 같은 x 로 맞춰 세로줄이 흐트러지지 않게 한다.
      const nameX = 186;
      const scoreRight = width - 148;
      const nameWidth = scoreRight - nameX - this.font.measure("000000", size) - 24;

      this.font.draw(ctx, String(index + 1).padStart(2, "0"), 96, y + offset, { size, alpha });
      this.font.draw(ctx, this.#fit(entry.name, size, nameWidth), nameX, y + offset, { size, alpha });
      this.font.draw(ctx, padScore(entry.score), scoreRight, y + offset, { size, align: "right", alpha });
    });
  }

  /** 넘치는 이름은 잘라서 점수와 겹치지 않게 한다. */
  #fit(text, size, maxWidth) {
    let out = text;
    while (out.length > 1 && this.font.measure(out, size) > maxWidth) {
      out = out.slice(0, -1);
    }
    return out;
  }

  /** 11 위부터. 순위 · 이름 · 점수만 담백하게 두 단으로. */
  #drawList() {
    const ctx = this.ctx;
    const { width } = CONFIG.view;
    const { topCount, pageSize } = CONFIG.ranking;

    const start = topCount + (this.page - 1) * pageSize;
    const entries = this.board.entries.slice(start, start + pageSize);
    const half = Math.ceil(entries.length / 2);

    const size = 20;
    const columnWidth = 400;
    const columnGap = 28;
    const nameOffset = this.font.measure("000", size) + 16;
    const scoreWidth = this.font.measure("000000", size) + 16;
    const nameWidth = columnWidth - nameOffset - scoreWidth;
    const startX = (width - (columnWidth * 2 + columnGap)) / 2;

    entries.forEach((entry, index) => {
      const column = index < half ? 0 : 1;
      const row = index - column * half;
      const x = startX + column * (columnWidth + columnGap);
      const y = 168 + row * 28;
      const highlighted = entry === this.board.lastEntry;
      const alpha = highlighted ? 1 : 0.85;

      if (highlighted) drawHighlight(ctx, x - 10, y - 4, columnWidth + 20, 26, 0.9);

      this.font.draw(ctx, String(start + index + 1).padStart(3, "0"), x, y, { size, alpha: 0.75 });
      this.font.draw(ctx, this.#fit(entry.name, size, nameWidth), x + nameOffset, y, { size, alpha });
      this.font.draw(ctx, padScore(entry.score), x + columnWidth, y, { size, align: "right", alpha });
    });
  }
}

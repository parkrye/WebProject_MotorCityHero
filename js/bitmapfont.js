// 비트맵 폰트 렌더러. 게임 내 모든 글자는 이 폰트로 그린다.
// 원본 시트는 A-Z / 0-9 만 있으므로 UI 문구는 전부 영문 대문자다.

const LETTER_SPACING = 0.1; // size 대비 자간
const SPACE_RATIO = 0.34;   // size 대비 공백 폭
const SHADOW_RATIO = 0.055; // size 대비 그림자 오프셋

// 글자를 한 번 그려두고 통째로 합성한다. 글리프마다 틴트하면 비싸다.
const textBuffer = document.createElement("canvas");
const textCtx = textBuffer.getContext("2d");
const shadowBuffer = document.createElement("canvas");
const shadowCtx = shadowBuffer.getContext("2d");

class BitmapFont {
  constructor(image, refHeight, glyphs) {
    this.image = image;
    this.refHeight = refHeight;
    this.glyphs = glyphs;
  }

  /** @returns {number} 렌더링될 가로 폭(px) */
  measure(text, size) {
    const scale = size / this.refHeight;
    const spacing = size * LETTER_SPACING;

    let width = 0;
    for (const char of String(text).toUpperCase()) {
      const glyph = this.glyphs[char];
      width += (glyph ? glyph.width * scale : size * SPACE_RATIO) + spacing;
    }
    return Math.max(0, width - spacing);
  }

  /**
   * @param {number} y  글자 윗변 기준 y
   * @param {"left"|"center"|"right"} align
   * @returns {number} 그린 폭
   */
  draw(ctx, text, x, y, { size = 24, align = "left", alpha = 1, shadow = true } = {}) {
    const upper = String(text).toUpperCase();
    const width = this.measure(upper, size);
    if (width <= 0) return 0;

    this.#renderToBuffer(upper, size, width);

    const drawX = Math.round(this.#alignedX(x, width, align));
    const drawY = Math.round(y);

    ctx.save();
    ctx.globalAlpha = alpha;
    if (shadow) {
      const offset = Math.max(2, Math.round(size * SHADOW_RATIO));
      ctx.drawImage(this.#shadowOf(), drawX + offset, drawY + offset);
    }
    ctx.drawImage(textBuffer, drawX, drawY);
    ctx.restore();

    return width;
  }

  #alignedX(x, width, align) {
    if (align === "center") return x - width / 2;
    if (align === "right") return x - width;
    return x;
  }

  #renderToBuffer(text, size, width) {
    const scale = size / this.refHeight;
    const spacing = size * LETTER_SPACING;

    // width 대입만으로 캔버스가 초기화된다 (합성 모드도 함께 리셋).
    textBuffer.width = Math.ceil(width) + 2;
    textBuffer.height = Math.ceil(size * 1.08);
    textCtx.imageSmoothingEnabled = false; // 저해상도 시트를 키워도 도트가 살아있게

    let cursor = 0;
    for (const char of text) {
      const glyph = this.glyphs[char];
      if (!glyph) {
        cursor += size * SPACE_RATIO + spacing;
        continue;
      }
      textCtx.drawImage(
        this.image, glyph.x, 0, glyph.width, glyph.height,
        cursor, 0, glyph.width * scale, glyph.height * scale
      );
      cursor += glyph.width * scale + spacing;
    }
  }

  #shadowOf() {
    shadowBuffer.width = textBuffer.width;
    shadowBuffer.height = textBuffer.height;
    shadowCtx.imageSmoothingEnabled = false;
    shadowCtx.drawImage(textBuffer, 0, 0);
    shadowCtx.globalCompositeOperation = "source-atop";
    shadowCtx.fillStyle = "rgba(0, 0, 0, 0.85)";
    shadowCtx.fillRect(0, 0, shadowBuffer.width, shadowBuffer.height);
    return shadowBuffer;
  }
}

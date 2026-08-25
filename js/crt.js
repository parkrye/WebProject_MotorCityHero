// 옛날 오락기 CRT 모니터 흉내.
//
// 화면을 다 그린 다음 맨 위에 덮는다. 픽셀을 직접 훑지 않고
// 작은 타일 패턴 하나와 그라디언트 두 개만 쓰기 때문에 매 프레임 그려도 부담이 없다.
//
//   1. 주사선 + RGB 섀도우마스크  (multiply)
//   2. 화면 가장자리 비네팅        (source-over)
//   3. 아래로 흐르는 밝은 띠       (lighter)

class CrtFilter {
  constructor(ctx, canvas) {
    this.ctx = ctx;
    this.canvas = canvas;
    this.enabled = true;
    this.time = 0;

    this.mask = this.#buildMask();
    this.vignette = this.#buildVignette();
    this.#syncCanvasClass();
  }

  toggle() {
    this.enabled = !this.enabled;
    this.#syncCanvasClass();
    return this.enabled;
  }

  /** 밝기·채도 보정은 CSS 쪽에 맡긴다. 캔버스 픽셀을 건드리지 않아 공짜다. */
  #syncCanvasClass() {
    this.canvas?.classList.toggle("crt", this.enabled);
  }

  /**
   * 주사선과 섀도우마스크를 한 타일에 담아 반복시킨다.
   * 가로 3픽셀이 각각 R·G·B 서브픽셀, 세로는 마지막 줄만 어둡다.
   */
  #buildMask() {
    const { scanlineHeight, scanlineStrength, maskStrength } = CONFIG.crt;

    const tile = document.createElement("canvas");
    tile.width = 3;
    tile.height = scanlineHeight;

    const tileCtx = tile.getContext("2d");
    const image = tileCtx.createImageData(3, scanlineHeight);
    const dim = Math.round(255 * (1 - maskStrength));

    for (let y = 0; y < scanlineHeight; y += 1) {
      // 마지막 줄이 주사선 사이의 어두운 틈이다.
      const line = y === scanlineHeight - 1 ? 1 - scanlineStrength : 1;

      for (let x = 0; x < 3; x += 1) {
        const offset = (y * 3 + x) * 4;
        image.data[offset] = (x === 0 ? 255 : dim) * line;
        image.data[offset + 1] = (x === 1 ? 255 : dim) * line;
        image.data[offset + 2] = (x === 2 ? 255 : dim) * line;
        image.data[offset + 3] = 255;
      }
    }

    tileCtx.putImageData(image, 0, 0);
    return this.ctx.createPattern(tile, "repeat");
  }

  #buildVignette() {
    const { width, height } = CONFIG.view;
    const gradient = this.ctx.createRadialGradient(
      width / 2, height / 2, height * 0.32,
      width / 2, height / 2, height * 0.78
    );
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(1, `rgba(0, 0, 0, ${CONFIG.crt.vignette})`);
    return gradient;
  }

  update(dt) {
    if (this.enabled) this.time += dt;
  }

  draw() {
    if (!this.enabled) return;

    const ctx = this.ctx;
    const { width, height } = CONFIG.view;
    const { rollSpeed, rollHeight, rollStrength, flicker } = CONFIG.crt;

    ctx.save();

    // 주사선 + 섀도우마스크. multiply 라 흰 부분은 그대로, 어두운 부분만 깎인다.
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 1 - flicker * (0.5 + 0.5 * Math.sin(this.time * 7));
    ctx.fillStyle = this.mask;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, width, height);

    // 수직 동기가 살짝 어긋난 브라운관처럼 밝은 띠가 아래로 흐른다.
    const rollY = ((this.time * rollSpeed) % (height + rollHeight)) - rollHeight;
    const roll = ctx.createLinearGradient(0, rollY, 0, rollY + rollHeight);
    roll.addColorStop(0, "rgba(255, 255, 255, 0)");
    roll.addColorStop(0.5, `rgba(190, 225, 255, ${rollStrength})`);
    roll.addColorStop(1, "rgba(255, 255, 255, 0)");

    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = roll;
    ctx.fillRect(0, rollY, width, rollHeight);

    ctx.restore();
  }
}

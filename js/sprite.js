// 스프라이트시트 렌더링 + 애니메이션 재생.
// 모든 원본 이미지는 오른쪽이 정방향이므로, 왼쪽을 볼 때만 좌우 반전해서 그린다.

// 피격 플래시용 오프스크린 버퍼. 메인 캔버스에 합성 모드를 쓰면 아래 픽셀까지 물들어서 따로 둔다.
const tintBuffer = document.createElement("canvas");
const tintCtx = tintBuffer.getContext("2d");

class SpriteSheet {
  /**
   * @param {HTMLImageElement} image  프레임이 가로로 이어붙은 시트
   * @param {number} anchorX  프레임 안에서 캐릭터의 좌우 중심 x
   */
  constructor(image, frameWidth, frameHeight, frameCount, anchorX) {
    this.image = image;
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;
    this.frameCount = frameCount;
    this.anchorX = anchorX;
  }

  /**
   * 발끝(footX, footY)을 기준으로 한 프레임을 그린다.
   * @param {boolean} flip  true 면 좌우 반전 (왼쪽을 보는 상태)
   * @param {string|null} tint  피격 플래시 색. null 이면 원본 그대로.
   */
  draw(ctx, frame, footX, footY, scale, flip, tint = null, alpha = 1) {
    const index = Math.min(Math.max(frame | 0, 0), this.frameCount - 1);
    const sx = index * this.frameWidth;
    const width = this.frameWidth * scale;
    const height = this.frameHeight * scale;
    const offsetX = -this.anchorX * scale;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(footX, footY);
    if (flip) ctx.scale(-1, 1);

    if (tint) {
      this.#drawTinted(ctx, sx, offsetX, -height, width, height, tint);
    } else {
      ctx.drawImage(
        this.image, sx, 0, this.frameWidth, this.frameHeight,
        offsetX, -height, width, height
      );
    }

    ctx.restore();
  }

  #drawTinted(ctx, sx, dx, dy, width, height, tint) {
    tintBuffer.width = this.frameWidth;
    tintBuffer.height = this.frameHeight;
    tintCtx.clearRect(0, 0, this.frameWidth, this.frameHeight);
    tintCtx.drawImage(
      this.image, sx, 0, this.frameWidth, this.frameHeight,
      0, 0, this.frameWidth, this.frameHeight
    );
    tintCtx.globalCompositeOperation = "source-atop";
    tintCtx.fillStyle = tint;
    tintCtx.fillRect(0, 0, this.frameWidth, this.frameHeight);
    tintCtx.globalCompositeOperation = "source-over";
    ctx.drawImage(tintBuffer, dx, dy, width, height);
  }
}

class Animator {
  /** @param {object} anims  { name: { sheet, frameDuration } } */
  constructor(anims) {
    this.anims = anims;
    this.name = null;
    this.frame = 0;
    this.elapsed = 0;
    this.loop = true;
    this.finished = false;
  }

  get current() {
    return this.anims[this.name];
  }

  get sheet() {
    return this.current?.sheet ?? null;
  }

  /** 같은 애니메이션을 다시 지정해도 restart 가 아니면 진행 중인 재생을 유지한다. */
  play(name, { loop = true, restart = false } = {}) {
    if (this.name === name && !restart) return;
    this.name = name;
    this.frame = 0;
    this.elapsed = 0;
    this.loop = loop;
    this.finished = false;
  }

  update(dt) {
    const anim = this.current;
    if (!anim || this.finished) return;

    this.elapsed += dt * 1000;
    while (this.elapsed >= anim.frameDuration) {
      this.elapsed -= anim.frameDuration;
      this.frame += 1;

      if (this.frame < anim.sheet.frameCount) continue;

      if (this.loop) {
        this.frame = 0;
      } else {
        this.frame = anim.sheet.frameCount - 1;
        this.finished = true;
        return;
      }
    }
  }

  draw(ctx, footX, footY, scale, flip, tint, alpha) {
    this.sheet?.draw(ctx, this.frame, footX, footY, scale, flip, tint, alpha);
  }
}

/** 캐릭터를 바닥에 붙여 보이게 하는 타원 그림자. */
function drawShadow(ctx, footX, footY, radius, alpha = 0.32) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(footX, footY, radius, radius * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

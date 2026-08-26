// 스프라이트시트 이미지 로더.
// 매니페스트는 build_sprites.py 가 구운 assets/sprites.js (window.SPRITE_MANIFEST) 를 쓴다.

const ASSET_DIR = "assets/";

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`이미지 로드 실패: ${file}`));
    image.src = ASSET_DIR + file;
  });
}

/**
 * 매니페스트의 한 캐릭터 정의를 { animName: SpriteSheet } 로 만든다.
 * @param {object} def  { frameWidth, frameHeight, anchorX, anims }
 * @param {object} durations  애니메이션별 프레임 지속시간(ms)
 */
async function loadCharacter(def, durations) {
  const entries = await Promise.all(
    Object.entries(def.anims).map(async ([name, meta]) => {
      const image = await loadImage(meta.file);
      const sheet = new SpriteSheet(image, def.frameWidth, def.frameHeight, meta.frames, def.anchorX);
      return [name, { sheet, frameDuration: durations[name] ?? 100 }];
    })
  );
  return Object.fromEntries(entries);
}

async function loadPlayer(manifest) {
  const { attack, hit, idleFrameDuration, walkFrameDuration } = CONFIG.player;
  const durations = {
    idle: idleFrameDuration,
    walk: walkFrameDuration,
    attack: attack.frameDuration,
    hit: hit.frameDuration,
  };

  return loadCharacter(manifest.player, durations);
}

async function loadIcons(manifest) {
  const entries = await Promise.all(
    Object.entries(manifest.icons ?? {}).map(async ([name, meta]) => [name, await loadImage(meta.file)])
  );
  return Object.fromEntries(entries);
}

/** @returns {Map<number, object>} 스테이지 -> 애니메이션 세트 */
async function loadEnemies(manifest) {
  const entries = await Promise.all(
    Object.entries(manifest.enemies).map(async ([stage, def]) => [
      Number(stage),
      await loadCharacter(def, { move: CONFIG.spawn.frameDuration }),
    ])
  );
  return new Map(entries);
}

async function loadAssets() {
  const manifest = window.SPRITE_MANIFEST;
  if (!manifest) {
    throw new Error("assets/sprites.js 가 로드되지 않았습니다. build_sprites.py 를 실행하세요.");
  }

  const [background, font, player, icons, enemies] = await Promise.all([
    loadImage(manifest.background),
    loadFont(manifest.font),
    loadPlayer(manifest),
    loadIcons(manifest),
    loadEnemies(manifest),
  ]);

  return { background, font, player, icons, enemies };
}

async function loadFont(def) {
  if (!def) throw new Error("폰트 메타데이터가 없습니다. build_sprites.py 를 다시 실행하세요.");
  return new BitmapFont(await loadImage(def.file), def.refHeight, def.glyphs);
}

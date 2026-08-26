// 게임 전역 상수. 밸런스 수치는 전부 여기에만 둔다.

const VIEW_WIDTH = 1024;
const VIEW_HEIGHT = 768; // 배경(1448x1086)과 동일한 4:3 비율
const BACKGROUND_TILES = 3; // 배경을 가로로 이어붙여 만든 스테이지 길이
const WORLD_WIDTH = VIEW_WIDTH * BACKGROUND_TILES;

const CONFIG = {
  view: { width: VIEW_WIDTH, height: VIEW_HEIGHT },
  world: { width: WORLD_WIDTH, tiles: BACKGROUND_TILES },

  // 캐릭터가 밟고 다니는 도로 영역. y 는 발끝 기준 화면 좌표.
  stage: {
    top: 508,
    bottom: 748,
    scaleFar: 0.58,  // 안쪽(위)에 섰을 때 배율
    scaleNear: 0.92, // 앞쪽(아래)에 섰을 때 배율
  },

  camera: {
    // 플레이어를 화면 이 비율 지점에 두려고 따라간다.
    anchorRatio: 1 / 3,
    lerp: 6,
  },

  player: {
    startLives: 3,
    shadowColor: "#3a0f10", // 발밑 그림자
    speedX: 265,
    speedY: 155, // 깊이축은 느리게 (고전 벨트스크롤 감각)
    // 킥은 모션만 다르고 판정 · 대미지 · 사거리는 펀치와 똑같다. 그래서 표를 나누지 않는다.
    attack: {
      frameDuration: 60,
      damage: 12,
      activeFrom: 3, // 8프레임 중 판정이 살아있는 구간
      activeTo: 5,
      reach: 118,     // 발 기준 앞쪽 사거리 (배율 적용 전)
      depthTolerance: 38,
      knockback: 190,
      recovery: 60,
    },
    // 한 대 맞으면 생명 1 감소. 무적은 hit 애니메이션이 도는 동안만 유지된다.
    hit: {
      frameDuration: 70,
      knockback: 210,
    },
    continueGraceMs: 1200, // 컨티뉴 직후 잠깐 무적
    idleFrameDuration: 120,
    walkFrameDuration: 100,
  },

  // 오락실 컨티뉴. 코인이 있으면 즉시, 없으면 카운트다운 동안 기다린다.
  // 11초인 이유는 countdown 효과음(10 부터 세는 음성)이 11초짜리라서다.
  continue: {
    seconds: 11,        // countdown 효과음 길이와 맞춘다
    leadInSeconds: 1,   // 음성이 세기 시작하기 전 여백. 이 동안은 숫자를 띄우지 않는다
    displayFrom: 10,    // 남은 시간을 10 부터 0 까지 고르게 나눠 보여준다
    fadeMs: 1100,       // 카운트다운이 끝나면 암전
  },

  audio: {
    sfxVolume: 0.75,
    bgmVolume: 0.45,
  },

  // 로비 메뉴. 위아래로 고르고 확인키로 들어간다.
  // 메뉴 아래 한 줄이 토글 버튼 행이고, 그 줄에서는 좌우로 버튼을 고른다.
  lobby: {
    items: ["GAME START", "RANKING", "EXIT"],
    itemSize: 34,
    itemGap: 50,
    blinkHz: 3,
    toggleIconSize: 50,
    toggleGap: 160,   // 두 버튼 사이 간격
    toggleLabelSize: 16,
  },

  // 옛날 오락기 모니터 흉내. 주사선 · 섀도우마스크 · 비네팅 · 흐르는 밝은 띠.
  // 일부러 눈에 띄게 세게 잡았다. 약하게 하려면 strength 값들을 낮추면 된다.
  crt: {
    scanlineHeight: 3,     // 주사선 한 주기(캔버스 픽셀)
    scanlineStrength: 0.4, // 어두운 줄이 얼마나 어두운지
    maskStrength: 0.16,    // RGB 서브픽셀 마스크 세기
    vignette: 0.5,         // 화면 가장자리 어둡기
    rollSpeed: 150,        // 밝은 띠가 아래로 흐르는 속도(px/s)
    rollHeight: 160,
    rollStrength: 0.07,
    flicker: 0.025,        // 밝기 미세 흔들림. 발작 위험이 없도록 아주 얕게 둔다
  },

  ranking: {
    maxEntries: 100, // 서버에 남기는 최대 기록 수
    topCount: 10,    // 첫 페이지에 크게 보여줄 순위
    pageSize: 20,    // 11위부터는 이 개수씩 목록으로
    nameMaxLength: 16,
    // 비트맵 폰트에 있는 글자만 쓴다. 마지막 두 칸은 지우기/확정 버튼.
    charset: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ",
    gridColumns: 10,
  },

  pickup: {
    dropChance: 0.05, // 적 격파 시 회복 아이템 드랍 확률
    scale: 0.5,
    bounceSpeed: 260,
    bounceDamping: 0.42,
    gravity: 900,
    lifetimeMs: 12000,
    blinkMs: 3000,
    rangeX: 58,
    rangeY: 30,
  },

  // 에너미 능력치. 스테이지가 아니라 "몇 번 에너미인지" 기준이다.
  // hp 는 플레이어 공격력(12) 기준 "몇 대 맞아야 죽는지"로 잡았다.
  // 반대로 플레이어는 무엇에 맞든 한 대 = 생명 1 이라 에너미 쪽 damage 는 없다.
  enemies: [
    { id: 1, hp: 10, speed: 96,  score: 60,  attackRange: 74, attackCooldown: 1250, windup: 320, scale: 0.72 },
    { id: 2, hp: 20, speed: 86,  score: 90,  attackRange: 78, attackCooldown: 1150, windup: 320, scale: 0.80 },
    { id: 3, hp: 32, speed: 102, score: 130, attackRange: 80, attackCooldown: 1050, windup: 300, scale: 0.84 },
    { id: 4, hp: 44, speed: 92,  score: 180, attackRange: 92, attackCooldown: 1000, windup: 300, scale: 0.96 },
    { id: 5, hp: 56, speed: 112, score: 240, attackRange: 84, attackCooldown: 900,  windup: 280, scale: 0.88 },
    { id: 6, hp: 68, speed: 100, score: 310, attackRange: 96, attackCooldown: 850,  windup: 280, scale: 0.98 },
    { id: 7, hp: 82, speed: 108, score: 390, attackRange: 92, attackCooldown: 820,  windup: 260, scale: 0.94 },
  ],

  // 스테이지 구성. major 가 다수, minor 가 소수, boss 가 최종보스다.
  // 이름은 비트맵 폰트에 있는 글자(A-Z · 0-9 · 공백)로만 쓴다.
  stages: [
    { stage: 1, name: "TEXAS",           bgm: "stage1", major: 1, minor: 2, boss: 3 },
    { stage: 2, name: "DETROIT",         bgm: "stage2", major: 2, minor: 3, boss: 4 },
    { stage: 3, name: "NEW YORK CITY",   bgm: "stage3", major: 3, minor: 4, boss: 5 },
    { stage: 4, name: "TESLA SPACESHIP", bgm: "stage4", major: 4, minor: 5, boss: 6 },
    { stage: 5, name: "MOON BASE",       bgm: "stage5", major: 5, minor: 6, boss: 7 },
    // 수수께끼 공간. 모든 에너미가 나오고 보스가 없다. 시간이 다 되거나 쓰러지면
    // 코인을 쓰지 않고 그대로 클리어된다. 점수 파밍용이라 항상 마지막이다.
    { stage: 6, name: "MYSTERY ZONE",    bgm: "stage6", endless: true },
  ],

  // 스테이지 제한 시간. 5분에서 0 으로 줄고, 3분 남는 순간 최종보스가 나온다.
  stageTimer: {
    seconds: 300,
    bossAtRemaining: 180,
    endlessSeconds: 60, // 파밍 스테이지는 1분
    warnRemaining: 30,  // 이 아래로 남으면 시계가 붉게 깜빡인다
  },

  // 최종보스는 같은 에너미를 체력과 크기만 키워 특별하게 세운다.
  boss: {
    hpMultiplier: 7,
    scaleMultiplier: 1.55,
    scoreMultiplier: 6,
    speedMultiplier: 0.86, // 덩치값을 하느라 조금 느리다
    bannerMs: 1800,
  },

  stageClear: {
    fieldMs: 900,   // 보스가 쓰러지는 걸 보여주는 시간
    illustMs: 2600, // 클리어 일러스트를 띄우는 시간
  },

  spawn: {
    firstDelay: 900,
    intervalBase: 1900,
    intervalPerStage: -110, // 스테이지가 오를수록 촘촘하게
    intervalMin: 700,
    maxAliveBase: 2,
    maxAlivePerStage: 0.5,
    maxAliveCap: 5,
    marginX: 90,          // 화면 밖 어느 정도에서 등장시킬지
    fromLeftChance: 0.2,  // 흐름은 좌>우 이므로 대부분 오른쪽에서 등장
    minorChance: 0.25,    // 다수(major) 사이에 소수(minor)가 섞이는 비율
    frameDuration: 80,
  },

  intro: {
    startX: -120,
    walkSpeed: 190,
    countdown: ["3", "2", "1", "START"],
    countdownMs: 620,
  },

  hud: {
    stageBannerMs: 1600,
    bossBarWidth: 460,
    barHeight: 104,
    iconSize: 38,
    iconGap: 8,
    labelSize: 22,
    maxHeartIcons: 10, // 이보다 많아지면 아이콘 하나 + X n 으로 축약
  },
};

/** @returns {object} 스테이지 정의. 범위를 벗어나면 마지막 스테이지로 잡는다. */
function stageConfig(stage) {
  return CONFIG.stages[clamp(stage, 1, CONFIG.stages.length) - 1];
}

/** @returns {object} 에너미 번호별 능력치. */
function enemyStats(id) {
  return CONFIG.enemies[clamp(id, 1, CONFIG.enemies.length) - 1];
}

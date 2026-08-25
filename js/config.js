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
    startLives: 3, // 1P·2P 가 함께 쓰는 팀 생명
    speedX: 265,
    speedY: 155, // 깊이축은 느리게 (고전 벨트스크롤 감각)
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

  // 2P 는 NumpadEnter 로 언제든 난입한다. 생명과 코인은 1P 와 공유한다.
  players: {
    labels: ["1P", "2P"],
    labelSize: 17,
    labelGap: 10,        // 머리 위 여백
    shadowColors: ["#3a0f10", "#0d1a3a"], // 발밑 그림자로 1P/2P 를 구분한다
    joinOffsetX: -130,   // 1P 기준 난입 위치. 화면 밖으로 나가면 반대편에 세운다.
    joinGraceMs: 1400,   // 난입 직후 잠깐 무적
    // player2 스프라이트가 없을 때만 쓰는 폴백. 1P 시트를 색조만 돌려서 그린다.
    fallbackHue: 190,
    viewMargin: 56,      // 2P 플레이 중 화면 밖으로 벗어나지 않게 잡는 여백
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
  lobby: {
    items: ["GAME START", "RANKING", "EXIT"],
    itemSize: 34,
    itemGap: 54,
    blinkHz: 3,
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

  // 스테이지(= enemy_N)별 능력치. 숫자가 커질수록 강해진다.
  // hp 는 플레이어 공격력(12) 기준 "몇 대 맞아야 죽는지"로 잡았다: 1, 2, 3, 4, 5, 6대.
  // 반대로 플레이어는 무엇에 맞든 한 대 = 생명 1 이라 에너미 쪽 damage 는 없다.
  enemyStages: [
    { stage: 1, hp: 10, speed: 96,  score: 100,  attackRange: 74, attackCooldown: 1250, windup: 320, scale: 0.72 },
    { stage: 2, hp: 20, speed: 86,  score: 220,  attackRange: 78, attackCooldown: 1150, windup: 320, scale: 0.80 },
    { stage: 3, hp: 32, speed: 102, score: 380,  attackRange: 80, attackCooldown: 1050, windup: 300, scale: 0.84 },
    { stage: 4, hp: 44, speed: 92,  score: 600,  attackRange: 92, attackCooldown: 1000, windup: 300, scale: 0.96 },
    { stage: 5, hp: 56, speed: 112, score: 900,  attackRange: 84, attackCooldown: 900,  windup: 280, scale: 0.88 },
    { stage: 6, hp: 68, speed: 100, score: 1400, attackRange: 96, attackCooldown: 850,  windup: 280, scale: 0.98 },
  ],

  // 누적 점수가 이 값을 넘으면 해당 인덱스의 스테이지가 해금된다.
  stageThresholds: [0, 600, 1600, 3200, 5600, 9000],

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
    barHeight: 104,
    iconSize: 38,
    iconGap: 8,
    labelSize: 22,
    maxHeartIcons: 10, // 이보다 많아지면 아이콘 하나 + X n 으로 축약
  },
};

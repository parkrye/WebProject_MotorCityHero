// 키 입력 상태 관리.
//
// 이 게임이 받는 키는 아래가 전부다. 마우스와 나머지 키는 전부 무시한다.
//   1P : W A S D 이동, J 공격 / 확인
//   2P : 화살표 이동, NumpadEnter 공격 / 확인 / 난입
//   공용 : P 코인 투입
//
// 판정은 event.code 기준이라 NumLock 상태와 무관하고,
// 문자열 위쪽의 숫자열(Digit0~9)은 어떤 동작에도 매핑되지 않는다.

const PAD_KEY_MAPS = [
  {
    KeyW: "up",
    KeyS: "down",
    KeyA: "left",
    KeyD: "right",
    KeyJ: "action",
  },
  {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    NumpadEnter: "action", // 넘패드 세로 2칸짜리 큰 키
  },
];

const SHARED_KEY_MAP = {
  KeyP: "coin", // 오락실 코인 투입 흉내
};

/** 한 조작 주체(플레이어 한 명 또는 공용 키)의 눌림 상태. */
class Pad {
  constructor() {
    this.held = new Set();
    this.pressed = new Set(); // 이번 프레임에 새로 눌린 키
  }

  press(action) {
    this.held.add(action);
    this.pressed.add(action);
  }

  release(action) {
    this.held.delete(action);
  }

  isHeld(action) {
    return this.held.has(action);
  }

  justPressed(action) {
    return this.pressed.has(action);
  }

  /** 공격이자 메뉴 확인. 게임 안에서는 때리고, 화면에서는 고른다. */
  get confirmed() {
    return this.justPressed("action");
  }

  /** -1 ~ 1 이동 벡터. 대각선도 속도가 같도록 정규화한다. */
  moveVector() {
    let x = (this.isHeld("right") ? 1 : 0) - (this.isHeld("left") ? 1 : 0);
    let y = (this.isHeld("down") ? 1 : 0) - (this.isHeld("up") ? 1 : 0);

    if (x !== 0 && y !== 0) {
      const inv = Math.SQRT1_2;
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  /** 메뉴용. 누르고 있어도 한 칸만 움직이도록 눌린 순간만 본다. */
  step() {
    const x = (this.justPressed("right") ? 1 : 0) - (this.justPressed("left") ? 1 : 0);
    const y = (this.justPressed("down") ? 1 : 0) - (this.justPressed("up") ? 1 : 0);
    return { x, y };
  }
}

class Input {
  constructor() {
    this.pads = PAD_KEY_MAPS.map(() => new Pad());
    this.shared = new Pad();
    this.onFirstKey = null; // 오디오 잠금 해제용. 첫 입력 때 한 번만 불린다.

    window.addEventListener("keydown", (event) => this.#onKeyDown(event));
    window.addEventListener("keyup", (event) => this.#onKeyUp(event));
    window.addEventListener("blur", () => this.#releaseAll());
  }

  /** @param {number} index 0 = 1P, 1 = 2P */
  for(index) {
    return this.pads[index];
  }

  #resolve(code) {
    for (let i = 0; i < PAD_KEY_MAPS.length; i += 1) {
      const action = PAD_KEY_MAPS[i][code];
      if (action) return { pad: this.pads[i], action };
    }
    const shared = SHARED_KEY_MAP[code];
    return shared ? { pad: this.shared, action: shared } : null;
  }

  #onKeyDown(event) {
    const bound = this.#resolve(event.code);
    if (!bound) return;

    event.preventDefault(); // 화살표로 페이지가 스크롤되지 않게
    if (event.repeat) return;

    // 브라우저는 사용자 입력 전에 소리를 내주지 않는다. 첫 키에서 잠금을 푼다.
    if (this.onFirstKey) {
      this.onFirstKey();
      this.onFirstKey = null;
    }

    bound.pad.press(bound.action);
  }

  #onKeyUp(event) {
    const bound = this.#resolve(event.code);
    if (!bound) return;

    event.preventDefault();
    bound.pad.release(bound.action);
  }

  #releaseAll() {
    for (const pad of this.pads) pad.held.clear();
    this.shared.held.clear();
  }

  isHeld(action) {
    return this.shared.isHeld(action);
  }

  justPressed(action) {
    return this.shared.justPressed(action);
  }

  /** 메뉴는 1P·2P 중 누가 조작해도 된다. */
  get confirmed() {
    return this.pads.some((pad) => pad.confirmed);
  }

  /** 여러 패드가 동시에 움직여도 한 칸만 움직인다. */
  menuStep() {
    const steps = this.pads.map((pad) => pad.step());
    return {
      x: Math.sign(steps.reduce((sum, step) => sum + step.x, 0)),
      y: Math.sign(steps.reduce((sum, step) => sum + step.y, 0)),
    };
  }

  /** 프레임 끝에서 호출. justPressed 를 한 프레임만 살아있게 한다. */
  endFrame() {
    for (const pad of this.pads) pad.pressed.clear();
    this.shared.pressed.clear();
  }
}

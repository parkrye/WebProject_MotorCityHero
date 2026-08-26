// 키 입력 상태 관리.
//
// 이 게임이 받는 키는 아래가 전부다. 마우스와 나머지 키는 전부 무시한다.
//   이동        : W A S D
//   펀치 · 확인 : J
//   킥          : K
//   코인 투입   : P
//
// 판정은 event.code 기준이라 NumLock 상태와 무관하고,
// 문자열 위쪽의 숫자열(Digit0~9)은 어떤 동작에도 매핑되지 않는다.

const KEY_MAP = {
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
  KeyJ: "action", // 펀치. 화면에서는 확인키로도 쓴다
  KeyK: "kick",
  KeyP: "coin",   // 오락실 코인 투입 흉내
};

/** 눌림 상태. 키보드와 (모바일) 터치 조이패드가 같은 창구를 쓴다. */
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
    this.pad = new Pad();
    this.onFirstKey = null; // 오디오 잠금 해제용. 첫 입력 때 한 번만 불린다.

    window.addEventListener("keydown", (event) => this.#onKeyDown(event));
    window.addEventListener("keyup", (event) => this.#onKeyUp(event));
    window.addEventListener("blur", () => this.pad.held.clear());
  }

  /** 터치 조이패드처럼 키보드 밖에서 들어오는 입력도 같은 창구를 쓴다. */
  press(action) {
    this.#notifyFirstInput();
    this.pad.press(action);
  }

  release(action) {
    this.pad.release(action);
  }

  #notifyFirstInput() {
    // 브라우저는 사용자 입력 전에 소리를 내주지 않는다. 첫 입력에서 잠금을 푼다.
    if (!this.onFirstKey) return;
    this.onFirstKey();
    this.onFirstKey = null;
  }

  #onKeyDown(event) {
    const action = KEY_MAP[event.code];
    if (!action) return;

    event.preventDefault(); // 화살표로 페이지가 스크롤되지 않게
    if (event.repeat) return;

    this.#notifyFirstInput();
    this.pad.press(action);
  }

  #onKeyUp(event) {
    const action = KEY_MAP[event.code];
    if (!action) return;

    event.preventDefault();
    this.pad.release(action);
  }

  isHeld(action) {
    return this.pad.isHeld(action);
  }

  justPressed(action) {
    return this.pad.justPressed(action);
  }

  get confirmed() {
    return this.pad.confirmed;
  }

  menuStep() {
    return this.pad.step();
  }

  /** 프레임 끝에서 호출. justPressed 를 한 프레임만 살아있게 한다. */
  endFrame() {
    this.pad.pressed.clear();
  }
}

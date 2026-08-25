// 키 입력 상태 관리. WASD 이동 / J 공격 / R 재시작.

const KEY_MAP = {
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
  KeyJ: "attack",
  KeyP: "coin", // 오락실 코인 투입 흉내
  KeyR: "restart",
};

class Input {
  constructor() {
    this.held = new Set();
    this.pressed = new Set(); // 이번 프레임에 새로 눌린 키

    window.addEventListener("keydown", (event) => this.#onKeyDown(event));
    window.addEventListener("keyup", (event) => this.#onKeyUp(event));
    window.addEventListener("blur", () => this.held.clear());
  }

  #onKeyDown(event) {
    const action = KEY_MAP[event.code];
    if (!action) return;

    event.preventDefault();
    if (event.repeat) return;

    this.held.add(action);
    this.pressed.add(action);
  }

  #onKeyUp(event) {
    const action = KEY_MAP[event.code];
    if (!action) return;

    event.preventDefault();
    this.held.delete(action);
  }

  isHeld(action) {
    return this.held.has(action);
  }

  justPressed(action) {
    return this.pressed.has(action);
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

  /** 프레임 끝에서 호출. justPressed 를 한 프레임만 살아있게 한다. */
  endFrame() {
    this.pressed.clear();
  }
}

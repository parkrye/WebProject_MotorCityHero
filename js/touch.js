// 모바일 터치 조작.
//
// 화면 위에 얹은 DOM 버튼이 키보드와 똑같은 입력을 Input 에 넣는다.
// 게임 쪽은 어디서 들어온 입력인지 모르고, 메뉴 · 이름 등록 · 랭킹도 그대로 조작된다.
//
//   왼쪽 스틱  이동 (한 손가락으로 대각선까지)
//   A          펀치 · 확인
//   B          킥
//   P          코인 투입. 실수로 누르지 않도록 구석에 작게 둔다

const STICK_DEAD_ZONE = 0.3; // 반지름 대비. 이보다 덜 밀면 중립으로 본다

/** 터치로 조작하는 기기인지. ?touch=1 / ?touch=0 으로 강제할 수 있다. */
function isTouchDevice() {
  const forced = new URLSearchParams(location.search).get("touch");
  if (forced !== null) return forced !== "0";

  return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}

class TouchControls {
  constructor(input, root) {
    this.input = input;
    this.root = root;
    this.stick = root.querySelector("[data-stick]");
    this.knob = root.querySelector("[data-knob]");

    this.held = new Set();  // 지금 켜져 있는 방향
    this.stickPointer = null;

    this.#bindStick();
    for (const button of root.querySelectorAll("[data-action]")) this.#bindButton(button);
  }

  #bindStick() {
    if (!this.stick) return;

    const move = (event) => {
      if (this.stickPointer !== event.pointerId) return;
      event.preventDefault();
      this.#aim(event);
    };
    const end = (event) => {
      if (this.stickPointer !== event.pointerId) return;
      event.preventDefault();
      this.stickPointer = null;
      this.#applyDirections(new Set());
      this.#moveKnob(0, 0);
    };

    this.stick.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.stickPointer = event.pointerId;
      this.stick.setPointerCapture(event.pointerId);
      this.#aim(event);
    });
    this.stick.addEventListener("pointermove", move);
    this.stick.addEventListener("pointerup", end);
    this.stick.addEventListener("pointercancel", end);
  }

  /** 스틱 가운데를 원점으로 보고 밀린 방향을 켠다. */
  #aim(event) {
    const rect = this.stick.getBoundingClientRect();
    const x = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const y = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);

    const next = new Set();
    if (Math.hypot(x, y) > STICK_DEAD_ZONE) {
      if (x < -STICK_DEAD_ZONE) next.add("left");
      else if (x > STICK_DEAD_ZONE) next.add("right");

      if (y < -STICK_DEAD_ZONE) next.add("up");
      else if (y > STICK_DEAD_ZONE) next.add("down");
    }

    this.#applyDirections(next);
    this.#moveKnob(clamp(x, -1, 1), clamp(y, -1, 1));
  }

  /** 바뀐 것만 눌렀다 뗀다. 계속 밀고 있는 방향을 매 프레임 다시 누르면 안 된다. */
  #applyDirections(next) {
    for (const direction of this.held) {
      if (!next.has(direction)) this.input.release(direction);
    }
    for (const direction of next) {
      if (!this.held.has(direction)) this.input.press(direction);
    }
    this.held = next;
  }

  #moveKnob(x, y) {
    if (!this.knob) return;
    this.knob.style.transform = `translate(${x * 32}%, ${y * 32}%)`;
  }

  #bindButton(button) {
    const action = button.dataset.action;

    const press = (event) => {
      event.preventDefault();
      button.classList.add("down");
      this.input.press(action);
    };
    const release = (event) => {
      event.preventDefault();
      button.classList.remove("down");
      this.input.release(action);
    };

    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);
  }
}

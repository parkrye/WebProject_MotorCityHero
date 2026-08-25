// 효과음 · BGM 재생.
//
// Web Audio 대신 HTMLAudioElement 를 쓴다. file:// 로 열었을 때 fetch 가 막혀
// decodeAudioData 를 쓸 수 없기 때문이다. 대신 소리마다 인스턴스를 몇 개 두고
// 돌려써서 겹쳐 나는 소리를 처리하고, 매번 새로 받아오는 일도 없앤다.
//
// 브라우저는 사용자 입력이 있기 전에는 소리를 내주지 않으므로
// 첫 키 입력 때 unlock() 을 한 번 호출해야 한다.

const POOL_SIZE = 4; // 같은 효과음이 동시에 겹칠 수 있는 최대 수

class AudioBank {
  /** @param {object} manifest  { sfx: {name: path}, bgm: {name: path} } */
  constructor(manifest = {}) {
    this.pools = new Map();
    this.bgm = new Map();
    this.currentBgm = null;
    this.unlocked = false;

    for (const [name, file] of Object.entries(manifest.sfx ?? {})) {
      this.pools.set(name, {
        next: 0,
        items: Array.from({ length: POOL_SIZE }, () => this.#element(file)),
      });
    }
    for (const [name, file] of Object.entries(manifest.bgm ?? {})) {
      // BGM 은 곡당 수 MB 라 미리 받아두면 첫 화면이 느려진다. 재생할 때 스트리밍한다.
      const element = this.#element(file, "none");
      element.loop = true;
      this.bgm.set(name, element);
    }
  }

  #element(file, preload = "auto") {
    const element = new Audio(ASSET_DIR + file);
    element.preload = preload;
    return element;
  }

  /** 첫 사용자 입력 안에서 호출해야 한다. 이후로는 자유롭게 재생할 수 있다. */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;

    for (const pool of this.pools.values()) {
      const element = pool.items[0];
      element.muted = true;
      element
        .play()
        .then(() => {
          element.pause();
          element.currentTime = 0;
          element.muted = false;
        })
        .catch(() => {
          element.muted = false;
        });
    }
  }

  play(name, volume = 1) {
    const pool = this.pools.get(name);
    if (!pool) return;

    const element = pool.items[pool.next];
    pool.next = (pool.next + 1) % pool.items.length;

    element.currentTime = 0;
    element.volume = clamp(volume * CONFIG.audio.sfxVolume, 0, 1);
    element.play().catch(() => {
      /* 아직 잠금이 안 풀린 경우 등은 무시한다 */
    });
  }

  /** 길게 도는 효과음(컨티뉴 카운트다운)을 도중에 끊을 때. */
  stop(name) {
    const pool = this.pools.get(name);
    if (!pool) return;

    for (const element of pool.items) {
      element.pause();
      element.currentTime = 0;
    }
  }

  /**
   * 이미 같은 곡이 돌고 있으면 끊지 않는다.
   *
   * 게임 루프가 매 프레임 부르는 것을 전제로 한다. 잠금이 풀리기 전에는 아무것도 하지 않고
   * 곡 이름만 기억해 두었다가, 풀린 뒤 다음 호출에서 실제로 튼다.
   * (곡 이름을 먼저 바꿔놓고 재생에 실패하면 "이미 트는 중"으로 착각해 영영 안 나온다.)
   */
  playBgm(name) {
    const element = this.bgm.get(name);
    const alreadyPlaying = this.currentBgm === name && element && !element.paused;
    if (alreadyPlaying) return;

    if (this.currentBgm !== name) this.stopBgm();
    this.currentBgm = name;

    if (!element || !this.unlocked) return; // 파일이 없거나 아직 소리를 낼 수 없는 상태

    element.volume = CONFIG.audio.bgmVolume;
    element.play().catch(() => {
      /* 잠금이 아직이면 다음 프레임에 다시 시도된다 */
    });
  }

  stopBgm() {
    const element = this.bgm.get(this.currentBgm);
    this.currentBgm = null;
    if (!element) return;

    element.pause();
    element.currentTime = 0;
  }
}

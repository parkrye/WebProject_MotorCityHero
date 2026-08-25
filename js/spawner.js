// 점수에 따라 스테이지를 해금하고 에너미를 화면 밖에서 밀어 넣는다.

class Spawner {
  /** @param {Map<number, object>} enemyAnims  스테이지 -> 애니메이션 세트 */
  constructor(enemyAnims) {
    this.enemyAnims = enemyAnims;
    this.maxStage = Math.min(CONFIG.enemyStages.length, enemyAnims.size);
    this.reset();
  }

  reset() {
    this.stage = 1;
    this.timer = CONFIG.spawn.firstDelay / 1000;
  }

  /** 누적 점수로 해금된 최고 스테이지. */
  stageForScore(score) {
    let stage = 1;
    CONFIG.stageThresholds.forEach((threshold, index) => {
      if (score >= threshold) stage = index + 1;
    });
    return Math.min(stage, this.maxStage);
  }

  get maxAlive() {
    const { maxAliveBase, maxAlivePerStage, maxAliveCap } = CONFIG.spawn;
    return Math.min(maxAliveCap, Math.floor(maxAliveBase + (this.stage - 1) * maxAlivePerStage));
  }

  get interval() {
    const { intervalBase, intervalPerStage, intervalMin } = CONFIG.spawn;
    return Math.max(intervalMin, intervalBase + (this.stage - 1) * intervalPerStage) / 1000;
  }

  /**
   * @returns {Enemy|null} 이번 프레임에 새로 등장한 에너미
   */
  update(dt, { score, cameraX, aliveCount }) {
    this.stage = this.stageForScore(score);

    this.timer -= dt;
    if (this.timer > 0) return null;

    this.timer = this.interval;
    if (aliveCount >= this.maxAlive) return null;

    return this.#spawn(cameraX);
  }

  #spawn(cameraX) {
    const stage = this.#pickStage();
    const anims = this.enemyAnims.get(stage);
    if (!anims) return null;

    const stats = CONFIG.enemyStages[stage - 1];
    const { marginX, fromLeftChance } = CONFIG.spawn;

    const leftX = cameraX - marginX;
    const rightX = cameraX + CONFIG.view.width + marginX;
    // 흐름이 좌>우 이므로 기본은 오른쪽 등장. 왼쪽이 월드 밖이면 무조건 오른쪽.
    const useLeft = Math.random() < fromLeftChance && leftX > 0;
    const x = clamp(useLeft ? leftX : rightX, 0, CONFIG.world.width);

    const { top, bottom } = CONFIG.stage;
    const y = top + 10 + Math.random() * (bottom - top - 16);

    const enemy = new Enemy(anims, stats, x, y);
    enemy.facing = useLeft ? 1 : -1;
    return enemy;
  }

  /** 현재 스테이지 위주로, 가끔 한 단계 아래도 섞어 뽑는다. */
  #pickStage() {
    if (this.stage === 1 || Math.random() < 0.65) return this.stage;
    return this.stage - 1;
  }
}

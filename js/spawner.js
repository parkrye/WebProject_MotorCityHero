// 점수에 따라 레벨을 해금하고 에너미를 화면 밖에서 밀어 넣는다.

class Spawner {
  /** @param {Map<number, object>} enemyAnims  레벨 -> 애니메이션 세트 */
  constructor(enemyAnims) {
    this.enemyAnims = enemyAnims;
    this.maxLevel = Math.min(CONFIG.enemyLevels.length, enemyAnims.size);
    this.reset();
  }

  reset() {
    this.level = 1;
    this.timer = CONFIG.spawn.firstDelay / 1000;
  }

  /** 누적 점수로 해금된 최고 레벨. */
  levelForScore(score) {
    let level = 1;
    CONFIG.levelThresholds.forEach((threshold, index) => {
      if (score >= threshold) level = index + 1;
    });
    return Math.min(level, this.maxLevel);
  }

  get maxAlive() {
    const { maxAliveBase, maxAlivePerLevel, maxAliveCap } = CONFIG.spawn;
    return Math.min(maxAliveCap, Math.floor(maxAliveBase + (this.level - 1) * maxAlivePerLevel));
  }

  get interval() {
    const { intervalBase, intervalPerLevel, intervalMin } = CONFIG.spawn;
    return Math.max(intervalMin, intervalBase + (this.level - 1) * intervalPerLevel) / 1000;
  }

  /**
   * @returns {Enemy|null} 이번 프레임에 새로 등장한 에너미
   */
  update(dt, { score, cameraX, aliveCount }) {
    this.level = this.levelForScore(score);

    this.timer -= dt;
    if (this.timer > 0) return null;

    this.timer = this.interval;
    if (aliveCount >= this.maxAlive) return null;

    return this.#spawn(cameraX);
  }

  #spawn(cameraX) {
    const level = this.#pickLevel();
    const anims = this.enemyAnims.get(level);
    if (!anims) return null;

    const stats = CONFIG.enemyLevels[level - 1];
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

  /** 현재 레벨 위주로, 가끔 한 단계 아래도 섞어 뽑는다. */
  #pickLevel() {
    if (this.level === 1 || Math.random() < 0.65) return this.level;
    return this.level - 1;
  }
}

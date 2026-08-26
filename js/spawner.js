// 스테이지 구성표대로 에너미를 화면 밖에서 밀어 넣는다.
//
// 다수(major)를 기본으로 뽑고 정해진 비율로 소수(minor)를 섞는다.
// 최종보스는 시간이 되면 게임 루프가 spawnBoss 로 따로 세운다.

class Spawner {
  /** @param {Map<number, object>} enemyAnims  에너미 번호 -> 애니메이션 세트 */
  constructor(enemyAnims) {
    this.enemyAnims = enemyAnims;
    this.config = CONFIG.stages[0];
    this.timer = 0;
  }

  reset(config) {
    this.config = config;
    this.timer = CONFIG.spawn.firstDelay / 1000;
  }

  get stage() {
    return this.config.stage;
  }

  get maxAlive() {
    const { maxAliveBase, maxAlivePerStage, maxAliveCap } = CONFIG.spawn;
    return Math.min(maxAliveCap, Math.floor(maxAliveBase + (this.stage - 1) * maxAlivePerStage));
  }

  get interval() {
    const { intervalBase, intervalPerStage, intervalMin } = CONFIG.spawn;
    return Math.max(intervalMin, intervalBase + (this.stage - 1) * intervalPerStage) / 1000;
  }

  /** @returns {Enemy|null} 이번 프레임에 새로 등장한 에너미 */
  update(dt, { cameraX, aliveCount }) {
    this.timer -= dt;
    if (this.timer > 0) return null;

    this.timer = this.interval;
    if (aliveCount >= this.maxAlive) return null;

    return this.#spawn(this.#pickEnemy(), cameraX, false);
  }

  /** 최종보스. 보스가 없는 스테이지(수수께끼 공간)에서는 null 이다. */
  spawnBoss(cameraX) {
    if (!this.config.boss) return null;
    return this.#spawn(this.config.boss, cameraX, true);
  }

  /** 파밍 스테이지는 전부 섞고, 나머지는 다수 위주로 가끔 소수를 낀다. */
  #pickEnemy() {
    if (this.config.endless) {
      return 1 + Math.floor(Math.random() * this.enemyAnims.size);
    }
    return Math.random() < CONFIG.spawn.minorChance ? this.config.minor : this.config.major;
  }

  #spawn(id, cameraX, boss) {
    const anims = this.enemyAnims.get(id);
    if (!anims) return null;

    const { marginX, fromLeftChance } = CONFIG.spawn;
    const leftX = cameraX - marginX;
    const rightX = cameraX + CONFIG.view.width + marginX;

    // 흐름이 좌>우 이므로 기본은 오른쪽 등장. 보스는 언제나 정면(오른쪽)에서 걸어 나온다.
    const useLeft = !boss && Math.random() < fromLeftChance && leftX > 0;
    const x = clamp(useLeft ? leftX : rightX, 0, CONFIG.world.width);

    const { top, bottom } = CONFIG.stage;
    const y = boss ? (top + bottom) / 2 : top + 10 + Math.random() * (bottom - top - 16);

    const enemy = new Enemy(anims, enemyStats(id), x, y, { boss });
    enemy.facing = useLeft ? 1 : -1;
    return enemy;
  }
}

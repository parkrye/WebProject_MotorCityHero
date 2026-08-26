// 랭킹 저장소.
//
// tools/serve.py 가 열어둔 서버로 띄웠으면 GET/POST /api/scores 를 통해
// 레포의 data/scores.json 에 기록한다. 같은 LAN 의 모든 기기가 기록을 공유한다.
// file:// 로 열었거나 서버가 응답하지 않으면 localStorage 로 조용히 물러난다.

const SCORES_API = "api/scores";
const SCORES_STORAGE_KEY = "motorCityHero.scores";
const REQUEST_TIMEOUT_MS = 2500;

function sanitizeName(name) {
  const allowed = new Set(CONFIG.ranking.charset);
  const upper = String(name ?? "").toUpperCase();

  let out = "";
  for (const char of upper) {
    if (allowed.has(char)) out += char;
  }
  return out.trim().slice(0, CONFIG.ranking.nameMaxLength) || "NO NAME";
}

/** 점수 내림차순. 같으면 먼저 올린 기록이 위로 간다. */
function rankEntries(entries) {
  return [...entries]
    .sort((a, b) => b.score - a.score || (a.at ?? 0) - (b.at ?? 0))
    .slice(0, CONFIG.ranking.maxEntries);
}

class ScoreBoard {
  constructor() {
    this.entries = [];
    this.online = false;
    this.lastEntry = null; // 방금 등록한 기록. 랭킹에서 강조 표시한다.
  }

  get isEmpty() {
    return this.entries.length === 0;
  }

  /** 방금 등록한 기록의 순위(1부터). 없으면 0. */
  get lastRank() {
    if (!this.lastEntry) return 0;
    const index = this.entries.indexOf(this.lastEntry);
    return index < 0 ? 0 : index + 1;
  }

  async #request(path, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(path, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  #readLocal() {
    try {
      return JSON.parse(localStorage.getItem(SCORES_STORAGE_KEY) ?? "[]");
    } catch {
      return [];
    }
  }

  #writeLocal(entries) {
    try {
      localStorage.setItem(SCORES_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      /* 저장 불가 환경은 무시 */
    }
  }

  async load() {
    try {
      const data = await this.#request(SCORES_API, { method: "GET" });
      this.entries = rankEntries(data.entries ?? []);
      this.online = true;
    } catch {
      this.entries = rankEntries(this.#readLocal());
      this.online = false;
    }
    return this.entries;
  }

  /**
   * 기록을 올리고 갱신된 목록을 받는다.
   * @returns {number} 등록된 순위(1부터). 100위 밖이면 0.
   */
  async submit({ name, score, stage }) {
    const entry = {
      name: sanitizeName(name),
      score: Math.max(0, Math.floor(score)),
      stage,
      at: Date.now(),
    };

    try {
      const data = await this.#request(SCORES_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      this.entries = rankEntries(data.entries ?? []);
      this.online = true;
    } catch {
      this.entries = rankEntries([...this.#readLocal(), entry]);
      this.#writeLocal(this.entries);
      this.online = false;
    }

    // 서버가 돌려준 목록에서 방금 올린 기록을 찾아 잡아둔다.
    this.lastEntry =
      this.entries.find(
        (item) => item.at === entry.at && item.name === entry.name && item.score === entry.score
      ) ?? null;

    return this.lastRank;
  }
}

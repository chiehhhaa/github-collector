import { Database } from "bun:sqlite";

export interface User {
  id: string;
  created_at: string;
  last_seen_at: string;
  github_id: string | null;
  github_login: string | null;
  github_name: string | null;
  github_avatar_url: string | null;
}

export interface Evaluation {
  id: number;
  seq: number;
  user_id: string;
  url: string;
  repo_name: string;
  total_score: number;
  recommend: string;
  analysis_json: string;
  created_at: string;
  updated_at: string;
}

export interface AnalysisData {
  overview: {
    one_liner: string;
    problem: string;
    target_user: string;
  };
  how_to_use: {
    install: string;
    example: string;
    use_cases: string;
  };
  scores: {
    practicality: number;
    learning_value: number;
    ease_of_use: number;
    maintenance: number;
    reliability: number;
    relevance: number;
  };
  supplement: {
    alternatives: string;
    pairs_with: string;
    final_advice: string;
  };
  details?: Array<{ title: string; body: string }>;
}

const db = new Database("evaluations.db");

// 1. users 表（必須先建好，因為 evaluations migration 會把舊資料掛到 'legacy' user）
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    github_id TEXT,
    github_login TEXT,
    github_name TEXT,
    github_avatar_url TEXT
  )
`);
db.run("INSERT OR IGNORE INTO users (id) VALUES ('legacy')");

// 既有 users 表補上 github_* 欄位
const userCols = db.query("PRAGMA table_info(users)").all() as Array<{
  name: string;
}>;
const userColNames = new Set(userCols.map((c) => c.name));
for (const col of [
  "github_id",
  "github_login",
  "github_name",
  "github_avatar_url",
]) {
  if (!userColNames.has(col)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
  }
}
// github_id 唯一（為 NULL 的匿名 user 不參與唯一性）
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id) WHERE github_id IS NOT NULL",
);

// 2. evaluations 表
const existingCols = db
  .query("PRAGMA table_info(evaluations)")
  .all() as Array<{ name: string }>;

if (existingCols.length === 0) {
  // 全新安裝
  db.exec(`
    CREATE TABLE evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      url TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      total_score INTEGER NOT NULL,
      recommend TEXT NOT NULL,
      analysis_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, url),
      UNIQUE(user_id, seq),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
} else if (!existingCols.some((c) => c.name === "user_id")) {
  // 舊 schema：重建表並把所有舊資料掛到 'legacy' user，URL 唯一性改為 (user_id, url) 複合
  const hasUpdatedAt = existingCols.some((c) => c.name === "updated_at");
  const updatedAtExpr = hasUpdatedAt
    ? "COALESCE(updated_at, created_at)"
    : "created_at";

  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE evaluations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        url TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        total_score INTEGER NOT NULL,
        recommend TEXT NOT NULL,
        analysis_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, url),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    db.exec(`
      INSERT INTO evaluations_new
        (id, user_id, url, repo_name, total_score, recommend, analysis_json, created_at, updated_at)
      SELECT id, 'legacy', url, repo_name, total_score, recommend, analysis_json, created_at, ${updatedAtExpr}
      FROM evaluations
    `);
    db.exec("DROP TABLE evaluations");
    db.exec("ALTER TABLE evaluations_new RENAME TO evaluations");
  });
  migrate();
}

db.exec(
  "CREATE INDEX IF NOT EXISTS idx_evaluations_user_id ON evaluations(user_id)",
);

// Migration：補上 seq 欄位（既有 user 的舊資料按 id 順序回填 1, 2, 3...）
const evalCols = db.query("PRAGMA table_info(evaluations)").all() as Array<{
  name: string;
}>;
if (!evalCols.some((c) => c.name === "seq")) {
  db.exec("ALTER TABLE evaluations ADD COLUMN seq INTEGER");
  db.exec(`
    UPDATE evaluations SET seq = (
      SELECT COUNT(*) FROM evaluations e2
      WHERE e2.user_id = evaluations.user_id AND e2.id <= evaluations.id
    )
    WHERE seq IS NULL
  `);
}
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_evaluations_user_seq ON evaluations(user_id, seq) WHERE seq IS NOT NULL",
);

// ——— 使用者 ———

export function findUserById(id: string): User | null {
  return db.query("SELECT * FROM users WHERE id = ?").get(id) as User | null;
}

export function createUser(): string {
  const id = crypto.randomUUID();
  db.run("INSERT INTO users (id) VALUES (?)", [id]);
  return id;
}

export function touchUser(id: string): void {
  db.run("UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
}

export function findUserByGithubId(githubId: string): User | null {
  return db
    .query("SELECT * FROM users WHERE github_id = ?")
    .get(githubId) as User | null;
}

export interface GithubProfile {
  github_id: string;
  github_login: string;
  github_name: string | null;
  github_avatar_url: string | null;
}

// 把目前匿名的 user 「升級」成 GitHub 連結帳號（沿用同一 user_id）
export function linkGithubToUser(userId: string, profile: GithubProfile): void {
  db.run(
    "UPDATE users SET github_id = ?, github_login = ?, github_name = ?, github_avatar_url = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?",
    [
      profile.github_id,
      profile.github_login,
      profile.github_name,
      profile.github_avatar_url,
      userId,
    ],
  );
}

// 同步 GitHub user 的 profile（每次登入都更新一次最新資訊）
export function refreshGithubProfile(
  userId: string,
  profile: GithubProfile,
): void {
  db.run(
    "UPDATE users SET github_login = ?, github_name = ?, github_avatar_url = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?",
    [
      profile.github_login,
      profile.github_name,
      profile.github_avatar_url,
      userId,
    ],
  );
}

// 把 fromUserId 的所有評估搬到 toUserId
// 用在「匿名 user 登入後合併到 GitHub user」場景
// 搬過去時 seq 要重新編號（跟在 toUserId 既有 seq 後面），URL 衝突的就丟掉
export function mergeUserData(fromUserId: string, toUserId: string): void {
  if (fromUserId === toUserId) return;
  const tx = db.transaction(() => {
    const maxSeq = (
      db
        .query(
          "SELECT COALESCE(MAX(seq), 0) AS m FROM evaluations WHERE user_id = ?",
        )
        .get(toUserId) as { m: number }
    ).m;

    const fromRows = db
      .query(
        "SELECT id, url FROM evaluations WHERE user_id = ? ORDER BY seq",
      )
      .all(fromUserId) as Array<{ id: number; url: string }>;

    let nextSeq = maxSeq + 1;
    for (const row of fromRows) {
      const urlConflict = db
        .query("SELECT 1 FROM evaluations WHERE user_id = ? AND url = ?")
        .get(toUserId, row.url);
      if (urlConflict) {
        db.run("DELETE FROM evaluations WHERE id = ?", [row.id]);
      } else {
        db.run(
          "UPDATE evaluations SET user_id = ?, seq = ? WHERE id = ?",
          [toUserId, nextSeq, row.id],
        );
        nextSeq++;
      }
    }

    db.run(
      "DELETE FROM users WHERE id = ? AND github_id IS NULL AND id != 'legacy'",
      [fromUserId],
    );
  });
  tx();
}

// ——— 評估 ———

export function findByUrl(userId: string, url: string): Evaluation | null {
  return db
    .query("SELECT * FROM evaluations WHERE user_id = ? AND url = ?")
    .get(userId, url) as Evaluation | null;
}

export function findBySeq(userId: string, seq: number): Evaluation | null {
  return db
    .query("SELECT * FROM evaluations WHERE user_id = ? AND seq = ?")
    .get(userId, seq) as Evaluation | null;
}

export function listAll(userId: string): Evaluation[] {
  return db
    .query(
      "SELECT * FROM evaluations WHERE user_id = ? ORDER BY created_at DESC",
    )
    .all(userId) as Evaluation[];
}

// 新評估：算 user 的 next seq + INSERT；舊 URL 重評估：沿用既有 seq + UPDATE。
// 用 db.transaction 保證 atomicity，避免並行請求/重試導致 race（兩個 request 同時拿到同一個 seq）
export function upsertEvaluation(data: {
  user_id: string;
  url: string;
  repo_name: string;
  total_score: number;
  recommend: string;
  analysis_json: string;
}): number {
  const tx = db.transaction(() => {
    const existing = db
      .query("SELECT id, seq FROM evaluations WHERE user_id = ? AND url = ?")
      .get(data.user_id, data.url) as { id: number; seq: number } | null;

    if (existing) {
      db.run(
        `UPDATE evaluations
         SET repo_name = ?, total_score = ?, recommend = ?, analysis_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          data.repo_name,
          data.total_score,
          data.recommend,
          data.analysis_json,
          existing.id,
        ],
      );
      return existing.seq;
    }

    const maxSeq = db
      .query(
        "SELECT COALESCE(MAX(seq), 0) AS m FROM evaluations WHERE user_id = ?",
      )
      .get(data.user_id) as { m: number };
    const seq = maxSeq.m + 1;

    db.run(
      `INSERT INTO evaluations (user_id, seq, url, repo_name, total_score, recommend, analysis_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.user_id,
        seq,
        data.url,
        data.repo_name,
        data.total_score,
        data.recommend,
        data.analysis_json,
      ],
    );
    return seq;
  });
  return tx();
}

export function getRecommendLevel(totalScore: number): string {
  if (totalScore >= 50) return "強烈推薦，值得馬上學";
  if (totalScore >= 40) return "推薦，找時間研究看看";
  if (totalScore >= 30) return "還行，有特定需求時再考慮";
  if (totalScore >= 20) return "不太推薦";
  return "不推薦，浪費時間";
}

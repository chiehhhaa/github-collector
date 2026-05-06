import { Database } from "bun:sqlite";

export interface Evaluation {
  id: number;
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

db.exec(`
  CREATE TABLE IF NOT EXISTS evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE NOT NULL,
    repo_name TEXT NOT NULL,
    total_score INTEGER NOT NULL,
    recommend TEXT NOT NULL,
    analysis_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migration: 既有 DB 補上 updated_at 欄位（舊資料以 created_at 回填）
const cols = db.query("PRAGMA table_info(evaluations)").all() as Array<{
  name: string;
}>;
if (!cols.some((c) => c.name === "updated_at")) {
  db.exec("ALTER TABLE evaluations ADD COLUMN updated_at DATETIME");
  db.exec(
    "UPDATE evaluations SET updated_at = created_at WHERE updated_at IS NULL",
  );
}

export function findByUrl(url: string): Evaluation | null {
  return db
    .query("SELECT * FROM evaluations WHERE url = ?")
    .get(url) as Evaluation | null;
}

export function findById(id: number): Evaluation | null {
  return db
    .query("SELECT * FROM evaluations WHERE id = ?")
    .get(id) as Evaluation | null;
}

export function listAll(): Evaluation[] {
  return db
    .query("SELECT * FROM evaluations ORDER BY created_at DESC")
    .all() as Evaluation[];
}

export function insert(data: {
  url: string;
  repo_name: string;
  total_score: number;
  recommend: string;
  analysis_json: string;
}): number {
  const result = db.run(
    "INSERT INTO evaluations (url, repo_name, total_score, recommend, analysis_json) VALUES (?, ?, ?, ?, ?)",
    [data.url, data.repo_name, data.total_score, data.recommend, data.analysis_json],
  );
  return Number(result.lastInsertRowid);
}

export function update(
  id: number,
  data: {
    repo_name: string;
    total_score: number;
    recommend: string;
    analysis_json: string;
  },
): void {
  db.run(
    "UPDATE evaluations SET repo_name = ?, total_score = ?, recommend = ?, analysis_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [data.repo_name, data.total_score, data.recommend, data.analysis_json, id],
  );
}

export function getRecommendLevel(totalScore: number): string {
  if (totalScore >= 50) return "強烈推薦，值得馬上學";
  if (totalScore >= 40) return "推薦，找時間研究看看";
  if (totalScore >= 30) return "還行，有特定需求時再考慮";
  if (totalScore >= 20) return "不太推薦";
  return "不推薦，浪費時間";
}

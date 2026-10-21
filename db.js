// db.js — SQLite database setup and schema
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");

const db = new DatabaseSync(path.join(__dirname, "complaints.db"));
db.exec("PRAGMA journal_mode = WAL;");

// ---- Schema ----
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_id TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL,
  category TEXT NOT NULL,
  department TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT,
  priority TEXT DEFAULT 'Normal',
  status TEXT DEFAULT 'Submitted',
  photo_path TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  changed_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (complaint_id) REFERENCES complaints(id)
);
`);

// ---- Migration: add lat/lng columns for the map feature (safe on existing DBs) ----
const complaintColumns = db.prepare("PRAGMA table_info(complaints)").all().map((c) => c.name);
if (!complaintColumns.includes("latitude")) {
  db.exec("ALTER TABLE complaints ADD COLUMN latitude REAL");
}
if (!complaintColumns.includes("longitude")) {
  db.exec("ALTER TABLE complaints ADD COLUMN longitude REAL");
}

// ---- Seed a default admin account if none exists ----
const adminCount = db.prepare("SELECT COUNT(*) AS c FROM admins").get().c;
if (adminCount === 0) {
  const defaultUser = process.env.ADMIN_USER || "admin";
  const defaultPass = process.env.ADMIN_PASS || "admin123";
  const hash = bcrypt.hashSync(defaultPass, 10);
  db.prepare("INSERT INTO admins (username, password_hash) VALUES (?, ?)").run(
    defaultUser,
    hash
  );
  console.log(`Seeded default admin -> username: "${defaultUser}", password: "${defaultPass}"`);
  console.log("Change these via ADMIN_USER / ADMIN_PASS env vars or the admins table.");
}

module.exports = db;
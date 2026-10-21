// server.js — Government Complaint Management System API
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ---------- Uploads (camera photo or file) ----------
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG or WEBP images are allowed"));
  },
});
app.use("/uploads", express.static(uploadDir));
app.use(express.static(path.join(__dirname, "public")));

// ---------- Rate limiting ----------
// Citizens can only file so many complaints per IP in a given window — stops spam/abuse
const complaintLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many complaints submitted from this device. Please try again in a while." },
});

// Slows down brute-force login attempts against staff accounts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in a while." },
});

// A lighter general limit across the whole API as a safety net
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", generalLimiter);

// ---------- Helpers ----------
function makeTrackingId() {
  const year = new Date().getFullYear();
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `GCMS-${year}-${rand}`;
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ================= AUTH =================
app.post("/api/auth/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, {
    expiresIn: "8h",
  });
  res.json({ token, username: admin.username });
});

// ================= PUBLIC: SUBMIT COMPLAINT =================
app.post("/api/complaints", complaintLimiter, upload.single("photo"), (req, res) => {
  try {
    const {
      full_name,
      email,
      phone,
      category,
      department,
      description,
      location,
      priority,
      latitude,
      longitude,
    } = req.body;

    if (!full_name || !phone || !category || !department || !description) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const lat = latitude ? parseFloat(latitude) : null;
    const lng = longitude ? parseFloat(longitude) : null;
    const validLat = Number.isFinite(lat) ? lat : null;
    const validLng = Number.isFinite(lng) ? lng : null;

    const tracking_id = makeTrackingId();
    const photo_path = req.file ? `/uploads/${req.file.filename}` : null;

    const info = db
      .prepare(
        `INSERT INTO complaints
         (tracking_id, full_name, email, phone, category, department, description, location, priority, photo_path, latitude, longitude)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        tracking_id,
        full_name,
        email || null,
        phone,
        category,
        department,
        description,
        location || null,
        priority || "Normal",
        photo_path,
        validLat,
        validLng
      );

    db.prepare(
      "INSERT INTO status_history (complaint_id, status, note) VALUES (?, ?, ?)"
    ).run(info.lastInsertRowid, "Submitted", "Complaint registered by citizen");

    const complaint = db
      .prepare("SELECT * FROM complaints WHERE id = ?")
      .get(info.lastInsertRowid);

    res.status(201).json(complaint);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit complaint" });
  }
});

// ================= PUBLIC: TRACK COMPLAINT =================
app.get("/api/complaints/track/:tracking_id", (req, res) => {
  const complaint = db
    .prepare("SELECT * FROM complaints WHERE tracking_id = ?")
    .get(req.params.tracking_id.toUpperCase());
  if (!complaint) return res.status(404).json({ error: "No complaint found with that ID" });

  const history = db
    .prepare("SELECT * FROM status_history WHERE complaint_id = ? ORDER BY changed_at ASC")
    .all(complaint.id);

  res.json({ ...complaint, history });
});

// ================= ADMIN: LIST / FILTER =================
app.get("/api/admin/complaints", authRequired, (req, res) => {
  const { status, category, priority, search } = req.query;
  let sql = "SELECT * FROM complaints WHERE 1=1";
  const params = [];

  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (category) {
    sql += " AND category = ?";
    params.push(category);
  }
  if (priority) {
    sql += " AND priority = ?";
    params.push(priority);
  }
  if (search) {
    sql += " AND (full_name LIKE ? OR tracking_id LIKE ? OR description LIKE ?)";
    const term = `%${search}%`;
    params.push(term, term, term);
  }
  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// ================= ADMIN: STATS =================
app.get("/api/admin/stats", authRequired, (req, res) => {
  const total = db.prepare("SELECT COUNT(*) c FROM complaints").get().c;
  const byStatus = db
    .prepare("SELECT status, COUNT(*) c FROM complaints GROUP BY status")
    .all();
  const byCategory = db
    .prepare("SELECT category, COUNT(*) c FROM complaints GROUP BY category")
    .all();
  const byPriority = db
    .prepare("SELECT priority, COUNT(*) c FROM complaints GROUP BY priority")
    .all();
  res.json({ total, byStatus, byCategory, byPriority });
});

// ================= ADMIN: UPDATE STATUS =================
app.patch("/api/admin/complaints/:id/status", authRequired, (req, res) => {
  const { status, note } = req.body || {};
  const valid = ["Submitted", "Under Review", "In Progress", "Resolved", "Rejected"];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${valid.join(", ")}` });
  }
  const complaint = db.prepare("SELECT * FROM complaints WHERE id = ?").get(req.params.id);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  db.prepare(
    "UPDATE complaints SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, req.params.id);

  db.prepare(
    "INSERT INTO status_history (complaint_id, status, note) VALUES (?, ?, ?)"
  ).run(req.params.id, status, note || null);

  const updated = db.prepare("SELECT * FROM complaints WHERE id = ?").get(req.params.id);
  res.json(updated);
});

// ================= ADMIN: STAFF ACCOUNTS =================
// List every staff/admin account (password hashes never leave the server)
app.get("/api/admin/admins", authRequired, (req, res) => {
  const rows = db
    .prepare("SELECT id, username, created_at FROM admins ORDER BY created_at ASC")
    .all();
  res.json(rows);
});

// Add a new staff/admin account — any logged-in admin can add another
app.post("/api/admin/admins", authRequired, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  const existing = db.prepare("SELECT id FROM admins WHERE username = ?").get(username);
  if (existing) {
    return res.status(409).json({ error: "That username is already taken" });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO admins (username, password_hash) VALUES (?, ?)")
    .run(username, hash);
  const created = db
    .prepare("SELECT id, username, created_at FROM admins WHERE id = ?")
    .get(info.lastInsertRowid);
  res.status(201).json(created);
});

// Remove a staff/admin account — can't delete yourself or the last remaining account
app.delete("/api/admin/admins/:id", authRequired, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.admin.id) {
    return res.status(400).json({ error: "You can't delete your own account while logged in" });
  }
  const total = db.prepare("SELECT COUNT(*) c FROM admins").get().c;
  if (total <= 1) {
    return res.status(400).json({ error: "At least one staff account must remain" });
  }
  const target = db.prepare("SELECT * FROM admins WHERE id = ?").get(targetId);
  if (!target) return res.status(404).json({ error: "Staff account not found" });

  db.prepare("DELETE FROM admins WHERE id = ?").run(targetId);
  res.json({ success: true });
});

// ================= ADMIN: DELETE =================
app.delete("/api/admin/complaints/:id", authRequired, (req, res) => {
  const complaint = db.prepare("SELECT * FROM complaints WHERE id = ?").get(req.params.id);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  if (complaint.photo_path) {
    const filePath = path.join(__dirname, complaint.photo_path.replace("/uploads/", "uploads/"));
    fs.existsSync(filePath) && fs.unlinkSync(filePath);
  }
  db.prepare("DELETE FROM status_history WHERE complaint_id = ?").run(req.params.id);
  db.prepare("DELETE FROM complaints WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`GCMS backend running at http://localhost:${PORT}`);
});
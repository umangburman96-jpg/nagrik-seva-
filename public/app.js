// app.js — Nagrik Seva Grievance Portal frontend logic
// Uses whatever hostname the page was opened with (localhost, 127.0.0.1, or a LAN IP)
// so it works the same way regardless of which one you use — as long as the backend
// is running on port 5000 on that same machine.
const API_BASE = `/api`;

let adminToken = localStorage.getItem("gcms_token") || null;
let adminUsername = localStorage.getItem("gcms_admin") || null;
let cameraStream = null;
let capturedBlob = null;

// ---------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------
const tabs = document.querySelectorAll(".gov-tab");
const panels = document.querySelectorAll("[data-panel]");
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    panels.forEach((p) => (p.hidden = true));
    document.getElementById(`panel-${tab.dataset.tab}`).hidden = false;
    stopCamera();
  });
});

// ---------------------------------------------------------------
// API connection check
// ---------------------------------------------------------------
async function checkApi() {
  const dot = document.getElementById("apiDot");
  const text = document.getElementById("apiStatusText");
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error();
    dot.classList.add("ok");
    text.textContent = "Backend connected";
  } catch {
    dot.classList.add("bad");
    text.textContent = "Backend unreachable — start the server";
  }
}
checkApi();

// ---------------------------------------------------------------
// Priority segmented control
// ---------------------------------------------------------------
const segButtons = document.querySelectorAll("#prioritySegment .seg-btn");
segButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    segButtons.forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    document.getElementById("priority").value = btn.dataset.value;
  });
});

// ---------------------------------------------------------------
// Camera capture
// ---------------------------------------------------------------
const cameraFeed = document.getElementById("cameraFeed");
const captureCanvas = document.getElementById("captureCanvas");
const photoPreviewImg = document.getElementById("photoPreviewImg");
const evidencePlaceholder = document.getElementById("evidencePlaceholder");
const startCameraBtn = document.getElementById("startCameraBtn");
const captureBtn = document.getElementById("captureBtn");
const retakeBtn = document.getElementById("retakeBtn");
const fileUpload = document.getElementById("fileUpload");
const cameraHint = document.getElementById("cameraHint");

startCameraBtn.addEventListener("click", async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    cameraHint.textContent = "Camera access isn't supported in this browser. Please upload a photo instead.";
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    cameraFeed.srcObject = cameraStream;
    cameraFeed.hidden = false;
    photoPreviewImg.hidden = true;
    evidencePlaceholder.hidden = true;
    startCameraBtn.hidden = true;
    captureBtn.hidden = false;
    retakeBtn.hidden = true;
    cameraHint.textContent = "Camera is live. Frame the issue and tap capture.";
  } catch (err) {
    cameraHint.textContent = "Couldn't access the camera (permission denied or unavailable). Try uploading a photo instead.";
  }
});

captureBtn.addEventListener("click", () => {
  const w = cameraFeed.videoWidth || 640;
  const h = cameraFeed.videoHeight || 480;
  captureCanvas.width = w;
  captureCanvas.height = h;
  captureCanvas.getContext("2d").drawImage(cameraFeed, 0, 0, w, h);
  captureCanvas.toBlob(
    (blob) => {
      capturedBlob = blob;
      photoPreviewImg.src = URL.createObjectURL(blob);
      photoPreviewImg.hidden = false;
      cameraFeed.hidden = true;
      captureBtn.hidden = true;
      retakeBtn.hidden = false;
      cameraHint.textContent = "Photo captured. You can retake it if needed.";
      stopCamera();
    },
    "image/jpeg",
    0.9
  );
});

retakeBtn.addEventListener("click", () => {
  capturedBlob = null;
  photoPreviewImg.hidden = true;
  retakeBtn.hidden = true;
  startCameraBtn.hidden = false;
  evidencePlaceholder.hidden = false;
  cameraHint.textContent = "";
});

fileUpload.addEventListener("change", () => {
  const file = fileUpload.files[0];
  if (!file) return;
  capturedBlob = file;
  photoPreviewImg.src = URL.createObjectURL(file);
  photoPreviewImg.hidden = false;
  evidencePlaceholder.hidden = true;
  cameraFeed.hidden = true;
  startCameraBtn.hidden = true;
  captureBtn.hidden = true;
  retakeBtn.hidden = false;
  cameraHint.textContent = `Selected: ${file.name}`;
  stopCamera();
});

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
}

function resetEvidence() {
  capturedBlob = null;
  stopCamera();
  cameraFeed.hidden = true;
  photoPreviewImg.hidden = true;
  evidencePlaceholder.hidden = false;
  startCameraBtn.hidden = false;
  captureBtn.hidden = true;
  retakeBtn.hidden = true;
  cameraHint.textContent = "";
  fileUpload.value = "";
}

// ---------------------------------------------------------------
// Location capture (for the complaint form)
// ---------------------------------------------------------------
const useLocationBtn = document.getElementById("useLocationBtn");
const locationHint = document.getElementById("locationHint");

useLocationBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    locationHint.textContent = "Geolocation isn't supported in this browser.";
    return;
  }
  locationHint.textContent = "Getting your location…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById("latitude").value = pos.coords.latitude;
      document.getElementById("longitude").value = pos.coords.longitude;
      locationHint.textContent = `Location captured (±${Math.round(pos.coords.accuracy)}m accuracy).`;
    },
    () => {
      locationHint.textContent = "Couldn't get your location (permission denied or unavailable). You can still type it manually above.";
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// ---------------------------------------------------------------
// Submit complaint
// ---------------------------------------------------------------
const complaintForm = document.getElementById("complaintForm");
const formMsg = document.getElementById("formMsg");
const submitBtn = document.getElementById("submitBtn");
const confirmCard = document.getElementById("confirmCard");

complaintForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg.textContent = "";
  formMsg.className = "form-msg";

  const fd = new FormData();
  fd.append("full_name", document.getElementById("full_name").value.trim());
  fd.append("phone", document.getElementById("phone").value.trim());
  fd.append("email", document.getElementById("email").value.trim());
  fd.append("department", document.getElementById("department").value);
  fd.append("category", document.getElementById("category").value);
  fd.append("location", document.getElementById("location").value.trim());
  fd.append("description", document.getElementById("description").value.trim());
  fd.append("priority", document.getElementById("priority").value);
  fd.append("latitude", document.getElementById("latitude").value);
  fd.append("longitude", document.getElementById("longitude").value);
  if (capturedBlob) fd.append("photo", capturedBlob, "evidence.jpg");

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting…";

  try {
    const res = await fetch(`${API_BASE}/complaints`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Submission failed");

    complaintForm.hidden = true;
    confirmCard.hidden = false;
    document.getElementById("confirmTrackingId").textContent = data.tracking_id;
  } catch (err) {
    formMsg.textContent = err.message;
    formMsg.classList.add("error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit complaint";
  }
});

document.getElementById("newComplaintBtn").addEventListener("click", () => {
  complaintForm.reset();
  document.getElementById("priority").value = "Normal";
  document.getElementById("latitude").value = "";
  document.getElementById("longitude").value = "";
  locationHint.textContent = "";
  segButtons.forEach((b) => b.classList.toggle("is-active", b.dataset.value === "Normal"));
  resetEvidence();
  confirmCard.hidden = true;
  complaintForm.hidden = false;
});

// ---------------------------------------------------------------
// Track complaint
// ---------------------------------------------------------------
const trackForm = document.getElementById("trackForm");
const trackResult = document.getElementById("trackResult");

trackForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("trackingIdInput").value.trim();
  trackResult.innerHTML = `<p class="muted">Looking up ${escapeHtml(id)}…</p>`;

  try {
    const res = await fetch(`${API_BASE}/complaints/track/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Not found");

    const statusClass = `status-${data.status.replace(/\s+/g, "-")}`;
    const historyHtml = data.history
      .map(
        (h) => `<li><span class="t-status">${escapeHtml(h.status)}</span> — <span class="t-time">${formatDate(h.changed_at)}</span>${h.note ? `<br>${escapeHtml(h.note)}` : ""}</li>`
      )
      .join("");

    trackResult.innerHTML = `
      <div class="track-card">
        <h3>${escapeHtml(data.full_name)}'s complaint</h3>
        <p class="muted">${escapeHtml(data.department)} · ${escapeHtml(data.category)} · filed ${formatDate(data.created_at)}</p>
        <p><span class="status-pill ${statusClass}">${escapeHtml(data.status)}</span></p>
        <p>${escapeHtml(data.description)}</p>
        <ul class="track-timeline">${historyHtml}</ul>
      </div>
    `;
  } catch (err) {
    trackResult.innerHTML = `<p class="form-msg error">${escapeHtml(err.message)}</p>`;
  }
});

// ---------------------------------------------------------------
// Admin: login
// ---------------------------------------------------------------
const loginForm = document.getElementById("loginForm");
const loginMsg = document.getElementById("loginMsg");
const adminLoginBlock = document.getElementById("adminLoginBlock");
const adminDashboard = document.getElementById("adminDashboard");

function showAdminUi() {
  if (adminToken) {
    adminLoginBlock.hidden = true;
    adminDashboard.hidden = false;
    document.getElementById("adminWelcome").textContent = `Logged in as ${adminUsername}`;
    loadStats();
    loadComplaints();
    loadStaff();
  } else {
    adminLoginBlock.hidden = false;
    adminDashboard.hidden = true;
  }
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginMsg.textContent = "";
  loginMsg.className = "form-msg";
  const username = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value;

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");

    adminToken = data.token;
    adminUsername = data.username;
    localStorage.setItem("gcms_token", adminToken);
    localStorage.setItem("gcms_admin", adminUsername);
    loginForm.reset();
    showAdminUi();
  } catch (err) {
    loginMsg.textContent = err.message;
    loginMsg.classList.add("error");
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  adminToken = null;
  adminUsername = null;
  localStorage.removeItem("gcms_token");
  localStorage.removeItem("gcms_admin");
  showAdminUi();
});

function authHeaders() {
  return { Authorization: `Bearer ${adminToken}` };
}

async function authedFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...authHeaders() },
  });
  if (res.status === 401) {
    adminToken = null;
    localStorage.removeItem("gcms_token");
    showAdminUi();
    throw new Error("Session expired, please log in again");
  }
  return res;
}

// ---------------------------------------------------------------
// Admin: stats
// ---------------------------------------------------------------
async function loadStats() {
  try {
    const res = await authedFetch(`${API_BASE}/admin/stats`);
    const data = await res.json();
    const resolved = (data.byStatus.find((s) => s.status === "Resolved") || {}).c || 0;
    const pending = data.total - resolved;
    const urgent = (data.byPriority.find((p) => p.priority === "Urgent") || {}).c || 0;

    document.getElementById("statRow").innerHTML = `
      <div class="stat-box"><div class="num">${data.total}</div><div class="lbl">Total complaints</div></div>
      <div class="stat-box"><div class="num">${pending}</div><div class="lbl">Pending</div></div>
      <div class="stat-box"><div class="num">${resolved}</div><div class="lbl">Resolved</div></div>
      <div class="stat-box"><div class="num">${urgent}</div><div class="lbl">Urgent priority</div></div>
    `;
  } catch (err) {
    console.error(err);
  }
}

// ---------------------------------------------------------------
// Admin: complaint list
// ---------------------------------------------------------------
const complaintTableBody = document.getElementById("complaintTableBody");
const searchInput = document.getElementById("searchInput");
const filterStatus = document.getElementById("filterStatus");
const filterPriority = document.getElementById("filterPriority");

async function loadComplaints() {
  const params = new URLSearchParams();
  if (searchInput.value.trim()) params.set("search", searchInput.value.trim());
  if (filterStatus.value) params.set("status", filterStatus.value);
  if (filterPriority.value) params.set("priority", filterPriority.value);

  try {
    const res = await authedFetch(`${API_BASE}/admin/complaints?${params.toString()}`);
    const rows = await res.json();
    renderTable(rows);
  } catch (err) {
    complaintTableBody.innerHTML = `<tr><td colspan="8">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderTable(rows) {
  updateMap(rows);

  if (!rows.length) {
    complaintTableBody.innerHTML = `<tr><td colspan="8" class="no-evidence">No complaints match these filters.</td></tr>`;
    return;
  }

  const statuses = ["Submitted", "Under Review", "In Progress", "Resolved", "Rejected"];

  complaintTableBody.innerHTML = rows
    .map((r) => {
      const statusOptions = statuses
        .map((s) => `<option value="${s}" ${s === r.status ? "selected" : ""}>${s}</option>`)
        .join("");
      const evidence = r.photo_path
        ? `<button class="evidence-link" data-photo="${API_BASE.replace("/api", "")}${r.photo_path}">View</button>`
        : `<span class="no-evidence">None</span>`;

      return `
        <tr data-id="${r.id}">
          <td>${escapeHtml(r.tracking_id)}</td>
          <td>${escapeHtml(r.full_name)}<br><span class="no-evidence">${escapeHtml(r.phone)}</span></td>
          <td>${escapeHtml(r.department)}</td>
          <td>${escapeHtml(r.priority)}</td>
          <td><span class="status-pill status-${r.status.replace(/\s+/g, "-")}">${escapeHtml(r.status)}</span></td>
          <td>${formatDate(r.created_at)}</td>
          <td>${evidence}</td>
          <td><select class="status-select" data-id="${r.id}">${statusOptions}</select></td>
        </tr>
      `;
    })
    .join("");

  document.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const id = sel.dataset.id;
      try {
        await authedFetch(`${API_BASE}/admin/complaints/${id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: sel.value }),
        });
        loadStats();
        loadComplaints();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  document.querySelectorAll(".evidence-link").forEach((btn) => {
    btn.addEventListener("click", () => openLightbox(btn.dataset.photo));
  });
}

// ---------------------------------------------------------------
// Admin: complaint map
// ---------------------------------------------------------------
let complaintMap = null;
let markerLayer = null;

function initMap() {
  if (complaintMap || typeof L === "undefined") return;
  complaintMap = L.map("complaintMap").setView([22.9734, 78.6569], 5); // India, default view
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(complaintMap);
  markerLayer = L.layerGroup().addTo(complaintMap);
}

function updateMap(rows) {
  initMap();
  if (!complaintMap) return;
  markerLayer.clearLayers();

  const geoRows = rows.filter(
    (r) => r.latitude !== null && r.latitude !== undefined && r.longitude !== null && r.longitude !== undefined
  );
  const mapHint = document.getElementById("mapHint");

  if (!geoRows.length) {
    mapHint.textContent = "No complaints in this view have a captured location yet.";
  } else {
    mapHint.textContent = `${geoRows.length} complaint${geoRows.length > 1 ? "s" : ""} plotted below.`;
    const bounds = [];
    geoRows.forEach((r) => {
      const marker = L.marker([r.latitude, r.longitude]).addTo(markerLayer);
      marker.bindPopup(
        `<b>${escapeHtml(r.tracking_id)}</b><br>${escapeHtml(r.department)}<br>Status: ${escapeHtml(r.status)}`
      );
      bounds.push([r.latitude, r.longitude]);
    });
    complaintMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
  }

  // Leaflet needs a nudge to size correctly right after its container becomes visible
  setTimeout(() => complaintMap.invalidateSize(), 200);
}

[searchInput, filterStatus, filterPriority].forEach((el) => {
  el.addEventListener("input", debounce(loadComplaints, 300));
  el.addEventListener("change", loadComplaints);
});
document.getElementById("refreshBtn").addEventListener("click", () => {
  loadStats();
  loadComplaints();
});

// ---------------------------------------------------------------
// Admin: staff accounts
// ---------------------------------------------------------------
const staffTableBody = document.getElementById("staffTableBody");
const addStaffForm = document.getElementById("addStaffForm");
const staffMsg = document.getElementById("staffMsg");

async function loadStaff() {
  try {
    const res = await authedFetch(`${API_BASE}/admin/admins`);
    const rows = await res.json();
    staffTableBody.innerHTML = rows
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(r.username)}</td>
          <td>${formatDate(r.created_at)}</td>
          <td>${
            r.username === adminUsername
              ? `<span class="no-evidence">You</span>`
              : `<button class="remove-staff-link" data-id="${r.id}">Remove</button>`
          }</td>
        </tr>`
      )
      .join("");

    document.querySelectorAll(".remove-staff-link").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this staff account? They won't be able to log in anymore.")) return;
        try {
          const res = await authedFetch(`${API_BASE}/admin/admins/${btn.dataset.id}`, {
            method: "DELETE",
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Could not remove account");
          loadStaff();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  } catch (err) {
    staffTableBody.innerHTML = `<tr><td colspan="3">${escapeHtml(err.message)}</td></tr>`;
  }
}

addStaffForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  staffMsg.textContent = "";
  staffMsg.className = "form-msg";
  const username = document.getElementById("newStaffUser").value.trim();
  const password = document.getElementById("newStaffPass").value;

  try {
    const res = await authedFetch(`${API_BASE}/admin/admins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not add staff account");

    addStaffForm.reset();
    staffMsg.textContent = `Added "${data.username}"`;
    staffMsg.classList.add("ok");
    loadStaff();
  } catch (err) {
    staffMsg.textContent = err.message;
    staffMsg.classList.add("error");
  }
});

// ---------------------------------------------------------------
// Lightbox
// ---------------------------------------------------------------
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
function openLightbox(src) {
  lightboxImg.src = src;
  lightbox.hidden = false;
}
document.getElementById("lightboxClose").addEventListener("click", () => (lightbox.hidden = true));
lightbox.addEventListener("click", (e) => { if (e.target === lightbox) lightbox.hidden = true; });

// ---------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T") + "Z");
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Init
showAdminUi();
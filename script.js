// --- Wait for the DOM to be fully loaded before running the script ---
document.addEventListener('DOMContentLoaded', () => {

  // --- SUPABASE & FIREBASE CREDENTIALS (REPLACE WITH YOURS) ---
  // IMPORTANT: Replace these placeholder values with your actual
  // Supabase and Firebase project credentials.
  const SUPABASE_URL = 'https://nhujrxbdkslbyzzudvuy.supabase.co'; // e.g., 'https://xyz.supabase.co'
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5odWpyeGJka3NsYnl6enVkdnV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyNTIxMzgsImV4cCI6MjA3MDgyODEzOH0.VJAb2-m21XGBALQx74svCti5HDyQ4nADtQrBg6wz3u8';
// For Firebase JS SDK v7.20.0 and later, measurementId is optional


/* =========================
   Hybrid Share: Supabase (≤100MB) + WebRTC (>100MB)
   ========================= */

/* ---------- 0) Config ---------- */
const SUPABASE_URL = "https://nhujrxbdkslbyzzudvuy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5odWpyeGJka3NsYnl6enVkdnV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyNTIxMzgsImV4cCI6MjA3MDgyODEzOH0.VJAb2-m21XGBALQx74svCti5HDyQ4nADtQrBg6wz3u8";
const SUPABASE_BUCKET = "vercel"; // must exist in Supabase

const firebaseConfig = {
  apiKey: "AIzaSyCa1afy-ZtcAFj5pgB5hw2nPtrEgWEqIW8",
  authDomain: "four-digit-share.firebaseapp.com",
  projectId: "four-digit-share",
  storageBucket: "four-digit-share.firebasestorage.app",
  messagingSenderId: "576071952474",
  appId: "1:576071952474:web:bb6d6baa88de0b29c91063",
  measurementId: "G-BEY5Q8Y1FM"
};

/* ---------- 1) Init Clients ---------- */
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
firebase.initializeApp(firebaseConfig);
const rtdb = firebase.database();

/* ---------- 2) Helpers ---------- */
const SMALL_LIMIT = 100 * 1024 * 1024; // 100 MB
const genCode = () => String(Math.floor(1000 + Math.random() * 9000));
const formatBytes = (b) => (!+b ? "0 B" : `${(b / 1024 / 1024).toFixed(1)} MB`);

function createEl(html) {
  const d = document.createElement("div");
  d.innerHTML = html.trim();
  return d.firstElementChild;
}

function showToast(msg) {
  alert(msg); // simple toast replacement; can integrate nicer UI
}

/* ---------- 3) Small File Upload → Supabase ---------- */
async function uploadSmallFile(code, file) {
  const safeName = `${code}/${Date.now()}-${file.name}`;
  const { data, error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(safeName, file, {
      cacheControl: "3600",
      upsert: false
    });

  if (error) throw error;

  const { data: publicData } = supabase.storage
    .from(SUPABASE_BUCKET)
    .getPublicUrl(safeName);

  return {
    name: file.name,
    size: file.size,
    url: publicData.publicUrl
  };
}

async function saveFileLinks(code, filesMeta) {
  const { error } = await supabase
    .from("links")
    .upsert({
      code,
      files: filesMeta,
      expires_at: new Date(Date.now() + 15 * 60 * 1000) // 15 mins
    });

  if (error) throw error;
}

/* ---------- 4) Large File P2P (unchanged from before) ---------- */
const STUN = [{ urls: ["stun:stun.l.google.com:19302"] }];
async function setupP2PSender(code, onChannel) {
  const pc = new RTCPeerConnection({ iceServers: STUN });
  const channel = pc.createDataChannel("file");
  channel.binaryType = "arraybuffer";

  channel.onopen = () => showToast("P2P connected");
  onChannel(channel);

  const ref = rtdb.ref(`signals/${code}`);
  await ref.set({
    offer: null, answer: null,
    offerCandidates: [], answerCandidates: [],
    createdAt: firebase.database.ServerValue.TIMESTAMP
  });

  pc.onicecandidate = (e) => {
    if (e.candidate) ref.child("offerCandidates").push(e.candidate.toJSON());
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await ref.update({ offer });

  ref.child("answer").on("value", async (snap) => {
    const ans = snap.val();
    if (ans && pc.signalingState !== "stable") {
      await pc.setRemoteDescription(new RTCSessionDescription(ans));
    }
  });
  ref.child("answerCandidates").on("child_added", async (snap) => {
    const c = snap.val();
    if (c) await pc.addIceCandidate(new RTCIceCandidate(c));
  });

  return { pc, channel };
}

/* ---------- 5) Receiver: Fetch from Supabase ---------- */
async function getLinksFromSupabase(code) {
  const { data, error } = await supabase
    .from("links")
    .select("*")
    .eq("code", code)
    .single();

  if (error || !data) return null;
  return data.files || [];
}

/* ---------- 6) Main Flow ---------- */
async function handleSend(files) {
  const code = genCode();
  const smalls = files.filter(f => f.size <= SMALL_LIMIT);
  const larges = files.filter(f => f.size > SMALL_LIMIT);
  let fileLinks = [];

  // Small files → Supabase
  for (const f of smalls) {
    const meta = await uploadSmallFile(code, f);
    fileLinks.push(meta);
  }
  if (fileLinks.length) {
    await saveFileLinks(code, fileLinks);
  }

  // Large files → P2P
  if (larges.length) {
    const { channel } = await setupP2PSender(code, ch => {
      // Once channel is ready, send files
      ch.onopen = async () => {
        for (const f of larges) {
          const buf = await f.arrayBuffer();
          ch.send(buf);
          ch.send(JSON.stringify({ done: true, name: f.name }));
        }
      };
    });
  }

  showToast(`Share this code: ${code}`);
}

async function handleReceive(code) {
  const links = await getLinksFromSupabase(code);
  if (links && links.length) {
    links.forEach(f => {
      const a = document.createElement("a");
      a.href = f.url;
      a.download = f.name;
      a.textContent = `Download ${f.name} (${formatBytes(f.size)})`;
      document.body.appendChild(a);
      a.click();
    });
  } else {
    showToast("No small files found; check P2P connection.");
  }
}

/* ---------- 7) Hook UI ---------- */
document.querySelector("#sendBtn").onclick = () => {
  const files = document.querySelector("#fileInput").files;
  if (!files.length) return showToast("Choose files first");
  handleSend(Array.from(files));
};

document.querySelector("#receiveBtn").onclick = () => {
  const code = document.querySelector("#codeInput").value.trim();
  if (!/^\d{4}$/.test(code)) return showToast("Enter 4-digit code");
  handleReceive(code);
};

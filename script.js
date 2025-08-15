import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// --- Firebase config ---
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCa1afy-ZtcAFj5pgB5hw2nPtrEgWEqIW8",
  authDomain: "four-digit-share.firebaseapp.com",
  projectId: "four-digit-share",
  storageBucket: "four-digit-share.firebasestorage.app",
  messagingSenderId: "576071952474",
  appId: "1:576071952474:web:bb6d6baa88de0b29c91063",
  measurementId: "G-BEY5Q8Y1FM"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// --- UI Elements ---
const fileInput = document.getElementById("fileInput");
const sendBtn = document.getElementById("sendBtn");
const receiveBtn = document.getElementById("receiveBtn");
const codeBox = document.getElementById("codeBox");
const sendStatus = document.getElementById("sendStatus");
const receiveStatus = document.getElementById("receiveStatus");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const codeInput = document.getElementById("codeInput");
const thresholdInput = document.getElementById("threshold");

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }
function setProgress(pct) { progressBar.style.width = `${pct}%`; }
function genCode() { return Math.floor(1000 + Math.random() * 9000).toString(); }
async function getUniqueCode(collectionName) {
  for (let i = 0; i < 5; i++) {
    const c = genCode();
    const d = await getDoc(doc(db, collectionName, c));
    if (!d.exists()) return c;
  }
  return genCode();
}
function mb(n) { return (n / (1024 * 1024)).toFixed(2); }

// --- Upload small file ---
async function uploadSmallFile(file) {
  const code = await getUniqueCode("links");
  const path = `files/${code}/${encodeURIComponent(file.name)}`;
  const storageRef = ref(storage, path);

  show(codeBox); codeBox.textContent = code;
  sendStatus.textContent = `Uploading ${file.name} (${mb(file.size)} MB) to cloud...`;
  show(progressWrap); setProgress(0);

  const task = uploadBytesResumable(storageRef, file);
  task.on("state_changed", (snap) => setProgress((snap.bytesTransferred / snap.totalBytes) * 100));
  await task;

  const url = await getDownloadURL(storageRef);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await setDoc(doc(db, "links", code), { url, name: file.name, size: file.size, createdAt: serverTimestamp(), expiresAt });
  sendStatus.textContent = `Share this code: ${code} (valid ~15 min)`;
}

// --- UI events ---
sendBtn.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  if (!file) return (sendStatus.textContent = "Please choose a file.");
  const thresholdMB = parseInt(thresholdInput.value || "100", 10);
  if (file.size <= thresholdMB * 1024 * 1024) {
    await uploadSmallFile(file);
  } else {
    sendStatus.textContent = `Large files (>100MB) currently not configured.`;
  }
});

receiveBtn.addEventListener("click", async () => {
  const code = (codeInput.value || "").trim();
  if (!/^[0-9]{4}$/.test(code)) return (receiveStatus.textContent = "Enter a valid 4-digit code.");
  const docRef = doc(db, "links", code);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return (receiveStatus.textContent = "No file found for this code.");
  const { url, name } = snap.data();
  receiveStatus.textContent = `Downloading ${name || "file"}...`;
  window.location.href = url;
});


document.addEventListener('DOMContentLoaded', () => {
  // ====== CONFIG (SIGNALING ONLY) ======
  const firebaseConfig = {
    apiKey: "AIzaSyCa1afy-ZtcAFj5pgB5hw2nPtrEgWEqIW8",
    authDomain: "four-digit-share.firebaseapp.com",
    projectId: "four-digit-share",
    storageBucket: "four-digit-share.firebasestorage.app",
    messagingSenderId: "576071952474",
    appId: "1:576071952474:web:bb6d6baa88de0b29c91063",
    measurementId: "G-BEY5Q8Y1FM"
  };
  firebase.initializeApp(firebaseConfig);
  const rtdb = firebase.database();

  // ====== CONSTANTS ======
  const STUN = [{ urls: ["stun:stun.l.google.com:19302"] }];
  const CHUNK_SIZE = 64 * 1024; // 64KB chunks for smooth flow control
  const LOW_WATERMARK = 1 * 1024 * 1024; // 1MB bufferedAmount threshold

  // ====== HELPERS ======
  const genCode = () => String(Math.floor(1000 + Math.random() * 9000));
  const formatBytes = (b) => {
    if (!+b) return "0 B";
    const k = 1024, sizes = ["B","KB","MB","GB","TB"];
    const i = Math.floor(Math.log(b)/Math.log(k));
    return `${(b/Math.pow(k,i)).toFixed(i>1?2:1)} ${sizes[i]}`;
  };

  const toast = document.querySelector("#toast");
  const toastMsg = document.querySelector("#toast-message");
  let toastTimer = null;
  function showToast(message, type = "success") {
    toast.classList.remove("success", "error");
    toast.classList.add("show", type);
    toastMsg.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function showQRCode(code) {
    const url = new URL(window.location.href);
    url.searchParams.set("code", code);
    const qrUrl = String(url);
    const qrWindow = window.open("", "_blank", "width=320,height=360");
    qrWindow.document.write(`
      <html><head><title>QR Code</title></head><body style="display:flex;flex-direction:column;gap:12px;justify-content:center;align-items:center;height:100vh;margin:0;font-family:sans-serif">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrUrl)}" alt="QR Code">
      <div style="font-size:14px">${qrUrl}</div>
      </body></html>
    `);
  }

  function setStatus(connected) {
    const pill = document.getElementById('conn-status');
    const dot = pill.querySelector('.dot');
    const text = pill.querySelector('.status-text');
    dot.classList.remove('dot-red','dot-green');
    dot.classList.add(connected ? 'dot-green' : 'dot-red');
    text.textContent = connected ? 'Connected' : 'Idle';
  }

  // Render lucide icons
  try { window.lucide && window.lucide.createIcons(); } catch(e) {}

  // ====== SIGNALING CLEANUP ======
  async function clearSignal(refPath) {
    try { await rtdb.ref(refPath).remove(); } catch(e) {}
  }

  // ====== P2P: SENDER ======
  async function setupP2PSender(code, onChannel) {
    const pc = new RTCPeerConnection({ iceServers: STUN });
    const channel = pc.createDataChannel("file");
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = LOW_WATERMARK;
    channel.onopen = () => { showToast("P2P connected"); setStatus(true); };
    channel.onclose = () => { setStatus(false); };
    onChannel(channel);

    const refPath = `signals/${code}`;
    const ref = rtdb.ref(refPath);
    await ref.set({ offer:null, answer:null, offerCandidates:[], answerCandidates:[], createdAt: firebase.database.ServerValue.TIMESTAMP });

    pc.onicecandidate = (e) => { if (e.candidate) ref.child("offerCandidates").push(e.candidate.toJSON()); };
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

    // tidy up on unload
    window.addEventListener('beforeunload', () => { try { pc.close(); } catch(e){} clearSignal(refPath); });
    return { pc, channel, refPath };
  }

  // ====== P2P: RECEIVER ======
  async function setupP2PReceiver(code, onDataChannel) {
    const pc = new RTCPeerConnection({ iceServers: STUN });

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      channel.binaryType = "arraybuffer";
      channel.onopen = () => { showToast("P2P connected"); setStatus(true); };
      channel.onclose = () => { setStatus(false); };
      onDataChannel(channel);
    };

    const refPath = `signals/${code}`;
    const ref = rtdb.ref(refPath);

    ref.on("value", async (snap) => {
      const val = snap.val();
      if (val?.offer && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(val.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await ref.update({ answer });
      }
    });

    pc.onicecandidate = (e) => { if (e.candidate) ref.child("answerCandidates").push(e.candidate.toJSON()); };
    ref.child("offerCandidates").on("child_added", async (snap) => {
      const c = snap.val();
      if (c) await pc.addIceCandidate(new RTCIceCandidate(c));
    });

    window.addEventListener('beforeunload', () => { try { pc.close(); } catch(e){} clearSignal(refPath); });
    return { pc, refPath };
  }

  // ====== CHUNKED SEND / RECEIVE ======
  async function sendFiles(channel, files, statusArea) {
    // UI rows for each file
    const rows = new Map();
    function makeRow(f) {
      const row = document.createElement("div");
      row.className = "upload-item";
      row.innerHTML = `
        <div class="file-info">
          <div class="file-name">${f.name}</div>
          <div class="file-size">${formatBytes(f.size)}</div>
        </div>
        <div class="progress-wrapper"><div class="progress-bar"></div></div>
      `;
      statusArea.appendChild(row);
      return row;
    }

    statusArea.classList.remove("hidden");
    statusArea.innerHTML = "";

    // Send meta list first
    const meta = files.map(f => ({ name: f.name, size: f.size, type: f.type || "application/octet-stream" }));
    channel.send(JSON.stringify({ type: "meta", files: meta }));

    // For each file, stream in chunks
    for (const file of files) {
      const row = makeRow(file);
      rows.set(file.name, row);
      const bar = row.querySelector(".progress-bar");

      channel.send(JSON.stringify({ type: "file-start", name: file.name, size: file.size, mime: file.type || "application/octet-stream" }));

      const reader = file.stream().getReader();
      let sent = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        let offset = 0;
        while (offset < value.byteLength) {
          // Backpressure: wait if bufferedAmount is high
          if (channel.bufferedAmount > LOW_WATERMARK) {
            await new Promise(res => {
              const handler = () => { channel.removeEventListener('bufferedamountlow', handler); res(); };
              channel.addEventListener('bufferedamountlow', handler, { once: true });
            });
          }
          const chunk = value.subarray(offset, offset + CHUNK_SIZE);
          channel.send(chunk);
          offset += chunk.byteLength;
          sent += chunk.byteLength;
          const pct = Math.min(100, (sent / file.size) * 100);
          bar.style.width = `${pct}%`;
        }
      }
      channel.send(JSON.stringify({ type: "file-end", name: file.name }));
      row.classList.add("completed");
    }

    // All done
    channel.send(JSON.stringify({ type: "all-done" }));
    showToast("All files sent");
  }

  function receiveFiles(channel) {
    const list = document.getElementById("transfers-list");
    list.innerHTML = "";

    const filesState = new Map(); // name -> {chunks:[], received:number, size, mime}
    let fileOrder = [];

    channel.onmessage = (e) => {
      if (typeof e.data === "string") {
        try {
          const msg = JSON.parse(e.data);

          if (msg.type === "meta") {
            fileOrder = msg.files.map(f => f.name);
            // pre-render placeholders
            for (const f of msg.files) {
              const a = document.createElement("a");
              a.className = "file-download-item";
              a.textContent = `Waiting: ${f.name} (${formatBytes(f.size)})`;
              a.href = "javascript:void(0)";
              a.dataset.name = f.name;
              list.appendChild(a);
            }
            return;
          }

          if (msg.type === "file-start") {
            filesState.set(msg.name, { chunks: [], received: 0, size: msg.size, mime: msg.mime });
            return;
          }

          if (msg.type === "file-end") {
            const state = filesState.get(msg.name);
            if (!state) return;
            const blob = new Blob(state.chunks, { type: state.mime });
            const url = URL.createObjectURL(blob);

            // update / create link
            let a = [...list.querySelectorAll(".file-download-item")].find(x => x.dataset.name === msg.name);
            if (!a) {
              a = document.createElement("a");
              a.className = "file-download-item";
              a.dataset.name = msg.name;
              list.appendChild(a);
            }
            a.href = url;
            a.download = msg.name;
            a.textContent = `Download ${msg.name} (${formatBytes(blob.size)})`;

            showToast(`Received ${msg.name}`);
            return;
          }

          if (msg.type === "all-done") {
            showToast("All files received");
            return;
          }
        } catch (_) {
          // ignore text that isn't JSON
        }
      } else {
        // Binary chunk
        // The active file is the latest file that started but not ended
        const activeName = [...filesState.keys()].findLast(name => {
          const state = filesState.get(name);
          return state && state.received < state.size;
        });
        if (!activeName) return;
        const state = filesState.get(activeName);
        state.chunks.push(e.data);
        state.received += e.data.byteLength;

        // optional: update progress by replacing text on placeholder
        let a = [...list.querySelectorAll(".file-download-item")].find(x => x.dataset.name === activeName);
        if (a) {
          const pct = Math.min(100, Math.floor((state.received / state.size) * 100));
          a.textContent = `Receiving ${activeName} • ${pct}%`;
        }
      }
    };
  }

  // ====== HIGH-LEVEL SEND / RECEIVE ======
  async function handleSend(files) {
    if (!files.length) return showToast("Choose files first", "error");

    // Generate & show code
    const code = genCode();
    const codeWrap = document.getElementById("share-code-wrap");
    const codeEl = document.getElementById("share-code");
    codeEl.textContent = code;
    codeWrap.classList.remove('hidden');

    const statusArea = document.getElementById("upload-status-section");
    const { channel, refPath } = await setupP2PSender(code, (ch) => {
      ch.onopen = async () => {
        await sendFiles(ch, files, statusArea);
        // optional cleanup of signaling after a while
        setTimeout(() => clearSignal(refPath), 60_000);
      };
    });

    // Copy / QR buttons
    document.getElementById("copy-code").onclick = async () => {
      await navigator.clipboard.writeText(code);
      showToast("Code copied");
    };
    document.getElementById("qr-code").onclick = () => showQRCode(code);

    showToast(`Share this code: ${code}`);
  }

  async function handleReceive(code) {
    const { refPath } = await setupP2PReceiver(code, (ch) => receiveFiles(ch));
    showToast("Waiting for P2P file transfer...");
    // Cleanup later
    setTimeout(() => clearSignal(refPath), 5 * 60_000);
  }

  // ====== UI ELEMENTS ======
  const fileInput = document.querySelector("#file-input");
  const browseBtn = document.querySelector("#browse-btn");
  const findBtn = document.querySelector("#find-btn");
  const codeInputs = document.querySelectorAll(".code-input");
  const themeToggle = document.querySelector("#theme-toggle");
  const dropZone = document.querySelector("#drop-zone");

  browseBtn.onclick = () => fileInput.click();
  fileInput.onchange = () => {
    if (!fileInput.files.length) return showToast("Choose files first", "error");
    handleSend(Array.from(fileInput.files));
  };

  // Code inputs
  codeInputs.forEach((input, index) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, '').slice(0,1);
      if (input.value.length === 1 && index < codeInputs.length - 1) {
        codeInputs[index + 1].focus();
      }
      const code = Array.from(codeInputs).map(i => i.value).join('');
      findBtn.disabled = code.length !== 4;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value && index > 0) {
        codeInputs[index - 1].focus();
      }
    });
  });

  findBtn.onclick = () => {
    const code = Array.from(codeInputs).map(i => i.value).join('');
    if (!/^\d{4}$/.test(code)) return showToast("Enter 4-digit code", "error");
    handleReceive(code);
  };

  // Drag & Drop
  const activate = () => dropZone.classList.add('dragover');
  const deactivate = () => dropZone.classList.remove('dragover');

  ['dragenter','dragover'].forEach(evt => dropZone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); activate(); }));
  ['dragleave','drop'].forEach(evt => dropZone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); deactivate(); }));
  dropZone.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    handleSend(files);
  });
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keypress', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

  // Theme
  themeToggle.onclick = () => {
    document.body.classList.toggle("dark");
    localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
  };
  if (localStorage.getItem("theme") === "dark") document.body.classList.add("dark");

  // Auto-connect if ?code=XXXX present (nice for QR)
  const urlCode = new URLSearchParams(location.search).get("code");
  if (/^\d{4}$/.test(urlCode || "")) {
    urlCode.split("").forEach((c,i) => { codeInputs[i].value = c; });
    findBtn.disabled = false;
    handleReceive(urlCode);
  }
});

document.addEventListener('DOMContentLoaded', () => {

  // === CONFIG ===
  const SUPABASE_URL = "https://nhujrxbdkslbyzzudvuy.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
  const SUPABASE_BUCKET = "vercel";
  const SMALL_LIMIT = 100 * 1024 * 1024;

  const firebaseConfig = {
    apiKey: "AIzaSyCa1afy-ZtcAFj5pgB5hw2nPtrEgWEqIW8",
    authDomain: "four-digit-share.firebaseapp.com",
    projectId: "four-digit-share",
    storageBucket: "four-digit-share.firebasestorage.app",
    messagingSenderId: "576071952474",
    appId: "1:576071952474:web:bb6d6baa88de0b29c91063",
    measurementId: "G-BEY5Q8Y1FM"
  };

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  firebase.initializeApp(firebaseConfig);
  const rtdb = firebase.database();

  // === HELPERS ===
  const genCode = () => String(Math.floor(1000 + Math.random() * 9000));
  const formatBytes = (b) => (!+b ? "0 B" : `${(b / 1024 / 1024).toFixed(1)} MB`);

  const toast = document.querySelector("#toast");
  const toastMsg = document.querySelector("#toast-message");
  let toastTimer = null;

  function showToast(message, type = "success") {
    toast.classList.remove("success", "error");
    toast.classList.add("show", type);
    toastMsg.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 3000);
  }

  function showQRCode(code) {
    const qrUrl = `https://yourdomain.com/?code=${code}`; // Replace with your real domain
    const qrWindow = window.open("", "_blank", "width=300,height=300");
    qrWindow.document.write(`
      <html><head><title>QR Code</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrUrl)}" alt="QR Code">
      <p>${qrUrl}</p>
      </body></html>
    `);
  }

  // === UPLOAD TO SUPABASE ===
  async function uploadSmallFile(code, file, statusArea) {
    const safeName = `${code}/${Date.now()}-${file.name}`;
    const uploadPath = supabase.storage.from(SUPABASE_BUCKET);

    const fileRow = document.createElement("div");
    fileRow.className = "upload-item";
    fileRow.innerHTML = `
      <div class="file-info">
        <div class="file-name">${file.name}</div>
        <div class="file-size">${formatBytes(file.size)}</div>
      </div>
      <div class="progress-wrapper"><div class="progress-bar"></div></div>
    `;
    statusArea.appendChild(fileRow);
    const progressBar = fileRow.querySelector(".progress-bar");

    const { error } = await uploadPath.upload(safeName, file, {
      upsert: false,
      onUploadProgress: (e) => {
        const percent = (e.loaded / e.total) * 100;
        progressBar.style.width = `${percent}%`;
      }
    });

    if (error) {
      fileRow.classList.add("error");
      throw error;
    }

    fileRow.classList.add("completed");

    const { data: publicData } = uploadPath.getPublicUrl(safeName);
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
        expires_at: new Date(Date.now() + 15 * 60 * 1000),
      });

    if (error) throw error;
  }

  // === P2P ===
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
      createdAt: firebase.database.ServerValue.TIMESTAMP,
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

  async function getLinksFromSupabase(code) {
    const { data, error } = await supabase
      .from("links")
      .select("*")
      .eq("code", code)
      .single();

    if (error || !data) return null;
    return data.files || [];
  }

  async function handleSend(files) {
    const code = genCode();
    const smalls = files.filter((f) => f.size <= SMALL_LIMIT);
    const larges = files.filter((f) => f.size > SMALL_LIMIT);
    let fileLinks = [];

    const statusArea = document.getElementById("upload-status-section");
    statusArea.classList.remove("hidden");
    statusArea.innerHTML = "";

    for (const f of smalls) {
      const meta = await uploadSmallFile(code, f, statusArea);
      fileLinks.push(meta);
    }

    if (fileLinks.length) await saveFileLinks(code, fileLinks);

    if (larges.length) {
      const { channel } = await setupP2PSender(code, (ch) => {
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
    showQRCode(code);
  }

  async function handleReceive(code) {
    const links = await getLinksFromSupabase(code);
    if (links && links.length) {
      links.forEach((f) => {
        const a = document.createElement("a");
        a.href = f.url;
        a.download = f.name;
        a.textContent = `Download ${f.name} (${formatBytes(f.size)})`;
        a.className = "file-download-item";
        document.getElementById("transfers-list").appendChild(a);
      });
    } else {
      showToast("No small files found; check P2P connection.", "error");
    }
  }

  // === UI ELEMENTS ===
  const fileInput = document.querySelector("#file-input");
  const browseBtn = document.querySelector("#browse-btn");
  const findBtn = document.querySelector("#find-btn");
  const codeInputs = document.querySelectorAll(".code-input");
  const themeToggle = document.querySelector("#theme-toggle");

  browseBtn.onclick = () => fileInput.click();

  codeInputs.forEach((input, index) => {
    input.addEventListener("input", () => {
      if (input.value.length === 1 && index < codeInputs.length - 1) {
        codeInputs[index + 1].focus();
      }
      const code = Array.from(codeInputs).map(i => i.value).join('');
      findBtn.disabled = code.length !== 4;
    });
  });

  findBtn.onclick = () => {
    const code = Array.from(codeInputs).map(i => i.value).join('');
    if (!/^\d{4}$/.test(code)) return showToast("Enter 4-digit code", "error");
    handleReceive(code);
  };

  fileInput.onchange = () => {
    if (!fileInput.files.length) return showToast("Choose files first", "error");
    handleSend(Array.from(fileInput.files));
  };

  // === Dark/Light Toggle ===
  themeToggle.onclick = () => {
    document.body.classList.toggle("dark");
    localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
  };

  if (localStorage.getItem("theme") === "dark") {
    document.body.classList.add("dark");
  }
});

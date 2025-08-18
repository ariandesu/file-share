document.addEventListener('DOMContentLoaded', () => {

  // === CONFIG ===
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

  // === P2P SETUP ===
  const STUN = [{ urls: ["stun:stun.l.google.com:19302"] }];

  async function setupP2PSender(code, onChannel) {
    const pc = new RTCPeerConnection({ iceServers: STUN });
    const channel = pc.createDataChannel("file");
    channel.binaryType = "arraybuffer";
    channel.onopen = () => showToast("P2P connected");
    onChannel(channel);

    const ref = rtdb.ref(`signals/${code}`);
    await ref.set({ offer:null, answer:null, offerCandidates:[], answerCandidates:[] });

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

  async function setupP2PReceiver(code) {
    const pc = new RTCPeerConnection({ iceServers: STUN });

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      channel.binaryType = "arraybuffer";

      let fileBuffer = [];
      channel.onmessage = (e) => {
        if (typeof e.data === "string") {
          try {
            const meta = JSON.parse(e.data);
            if (meta.done && meta.name) {
              const blob = new Blob(fileBuffer);
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = meta.name;
              a.textContent = `Download ${meta.name} (${formatBytes(blob.size)})`;
              a.className = "file-download-item";
              document.getElementById("transfers-list").appendChild(a);
              fileBuffer = [];
              showToast(`Received ${meta.name}`);
            }
          } catch (_) {}
        } else {
          fileBuffer.push(e.data);
        }
      };
    };

    const ref = rtdb.ref(`signals/${code}`);
    ref.on("value", async (snap) => {
      const val = snap.val();
      if (val?.offer && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(val.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await ref.update({ answer });
      }
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) ref.child("answerCandidates").push(e.candidate.toJSON());
    };

    ref.child("offerCandidates").on("child_added", async (snap) => {
      const c = snap.val();
      if (c) await pc.addIceCandidate(new RTCIceCandidate(c));
    });
  }

  // === SEND ===
  async function handleSend(files) {
    const code = genCode();
    const statusArea = document.getElementById("upload-status-section");
    statusArea.classList.remove("hidden");
    statusArea.innerHTML = "";

    const { channel } = await setupP2PSender(code, async (ch) => {
      ch.onopen = async () => {
        for (const f of files) {
          const buf = await f.arrayBuffer();
          ch.send(buf);
          ch.send(JSON.stringify({ done: true, name: f.name }));
        }
      };
    });

    showToast(`Share this code: ${code}`);
    showQRCode(code);
  }

  // === RECEIVE ===
  async function handleReceive(code) {
    await setupP2PReceiver(code);
    showToast("Waiting for P2P file transfer...");
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

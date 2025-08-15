document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Element References ---
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const browseBtn = document.getElementById('browse-btn');
  const uploadStatusSection = document.getElementById('upload-status-section');
  const codeInputsContainer = document.getElementById('code-inputs');
  const codeInputs = document.querySelectorAll('.code-input');
  const findBtn = document.getElementById('find-btn');
  const transfersList = document.getElementById('transfers-list');
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  const themeToggle = document.getElementById('theme-toggle');

  // --- Firebase Initialization ---
  const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : { apiKey: "AIza...", authDomain: "...", projectId: "...", storageBucket: "...", messagingSenderId: "...", appId: "..." };
  const app = firebase.initializeApp(firebaseConfig);
  const storage = firebase.storage(app);

  // --- Theme Toggle ---
  const applyTheme = () => {
      const isDarkMode = localStorage.getItem('theme') === 'dark';
      document.documentElement.classList.toggle('dark', isDarkMode);
  };
  themeToggle.addEventListener('click', () => {
      const isDarkMode = document.documentElement.classList.toggle('dark');
      localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  });
  applyTheme();

  // --- Icon Initialization ---
  const iconInterval = setInterval(() => {
      if (typeof lucide !== 'undefined') {
          lucide.createIcons();
          clearInterval(iconInterval);
      }
  }, 100);

  // --- Upload Logic ---
  browseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
      if (fileInput.files.length) handleFilesUpload(fileInput.files);
  });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
  dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
          fileInput.files = e.dataTransfer.files;
          handleFilesUpload(e.dataTransfer.files);
      }
  });

  async function handleFilesUpload(files) {
      if (!files.length) return;
      const maxFileSize = 100 * 1024 * 1024;
      
      for (const file of files) {
          if (file.size > maxFileSize) {
              showToast(`File "${file.name}" is too large. Max size is ${formatBytes(maxFileSize)}.`, true);
              return;
          }
      }
      
      uploadStatusSection.classList.remove('hidden');
      uploadStatusSection.innerHTML = `<div>Uploading ${files.length} file(s)...</div>`;

      try {
          const uploadPromises = Array.from(files).map(file => {
              const uuid = crypto.randomUUID();
              const storageRef = storage.ref(`${uuid}-${file.name}`);
              const uploadTask = storage.uploadBytesResumable(storageRef, file);
              
              return new Promise((resolve, reject) => {
                   uploadTask.on('state_changed', null, reject, async () => {
                      const downloadURL = await storage.getDownloadURL(uploadTask.snapshot.ref);
                      resolve({
                          id: uuid,
                          name: file.name,
                          size: file.size,
                          type: file.type,
                          transferType: 'supabase',
                          url: downloadURL
                      });
                   });
              });
          });

          const uploadedFilesMetadata = await Promise.all(uploadPromises);

          const shortCode = (Math.floor(1000 + Math.random() * 9000)).toString();
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

          const transferPayload = {
              code: shortCode,
              files: uploadedFilesMetadata.map(meta => JSON.stringify(meta)),
              type: 'supabase',
              status: 'active',
              expiresAt: expiresAt.toISOString(),
          };

          const response = await fetch('/api/transfers', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(transferPayload),
          });

          if (!response.ok) {
              throw new Error('Failed to create transfer on the server.');
          }
          
          const newTransfer = await response.json();
          showSharingCode(newTransfer.code);

      } catch(error) {
          console.error("Upload process failed:", error);
          showToast("An error occurred during upload. Please try again.", true);
          uploadStatusSection.classList.add('hidden');
      }
  }

  function showSharingCode(code) {
       uploadStatusSection.innerHTML = `
          <div class="text-center bg-accent text-accent-foreground p-4 rounded-md" style="background-color: var(--accent); color: var(--accent-foreground); padding: 1rem; border-radius: 0.375rem;">
              <p style="font-weight: 500; margin-bottom: 0.5rem;">🎉 Files uploaded! Your code is:</p>
              <div style="font-size: 2.25rem; font-weight: bold; letter-spacing: 0.1em; color: var(--primary);">${code}</div>
              <p style="font-size: 0.875rem; color: var(--muted-foreground); margin-top: 0.5rem;">Share this code with the recipient.</p>
          </div>
      `;
  }

  // --- Download Logic ---
  codeInputsContainer.addEventListener('input', handleCodeInput);
  codeInputsContainer.addEventListener('keydown', handleCodeKeydown);
  findBtn.addEventListener('click', findFilesByCode);

  function handleCodeInput(e) {
      const input = e.target;
      const index = parseInt(input.dataset.index);
      if (input.value && index < codeInputs.length - 1) {
          codeInputs[index + 1].focus();
      }
      validateCode();
  }

  function handleCodeKeydown(e) {
      const input = e.target;
      const index = parseInt(input.dataset.index);
      if (e.key === 'Backspace' && !input.value && index > 0) {
          codeInputs[index - 1].focus();
      }
  }
  
  function validateCode() {
      const code = Array.from(codeInputs).map(input => input.value).join('');
      findBtn.disabled = code.length !== 4;
  }

  async function findFilesByCode() {
      const code = Array.from(codeInputs).map(input => input.value).join('');
      if (code.length !== 4) return;

      findBtn.textContent = 'Searching...';
      findBtn.disabled = true;

      try {
          const response = await fetch(`/api/transfers/${code}`);
          
          if (response.status === 404) {
              showToast("Invalid code or transfer has expired.", true);
              displayNoFilesFound();
              return;
          }

          if (!response.ok) {
              throw new Error('Failed to fetch transfer data.');
          }

          const transferData = await response.json();
          displayFoundFiles(transferData.files);

      } catch (error) {
          console.error("Error finding files:", error);
          showToast("An error occurred while searching for the files.", true);
      } finally {
          resetFindButton();
      }
  }
  
  function displayFoundFiles(filesJson) {
      transfersList.innerHTML = '';
      const files = filesJson.map(fileStr => JSON.parse(fileStr));
      
      if (files.length === 0) {
          displayNoFilesFound();
          return;
      }

      files.forEach(fileData => {
          const fileElement = document.createElement('div');
          fileElement.className = 'flex items-center justify-between bg-secondary p-3 rounded-md';
          fileElement.style.display = 'flex';
          fileElement.style.alignItems = 'center';
          fileElement.style.justifyContent = 'space-between';
          fileElement.style.backgroundColor = 'var(--secondary)';
          fileElement.style.padding = '0.75rem';
          fileElement.style.borderRadius = '0.375rem';

          fileElement.innerHTML = `
              <div>
                  <p style="font-weight: 600; color: var(--secondary-foreground);">${fileData.name}</p>
                  <p style="font-size: 0.875rem; color: var(--muted-foreground);">${formatBytes(fileData.size)}</p>
              </div>
              <a href="${fileData.url}" target="_blank" class="button" style="width: auto; padding: 0.5rem 0.75rem; font-size: 0.875rem;">
                  Download
              </a>
          `;
          transfersList.appendChild(fileElement);
      });
  }

  function displayNoFilesFound() {
       transfersList.innerHTML = `
          <i data-lucide="download-cloud" class="placeholder-icon"></i>
          <p>No files found for this code.</p>
       `;
       lucide.createIcons();
  }
  
  function resetFindButton() {
      findBtn.textContent = 'Find Files';
      validateCode();
  }

  // --- Utility Functions ---
  function formatBytes(bytes, decimals = 2) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const dm = decimals < 0 ? 0 : decimals;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  function showToast(message, isError = false) {
      toastMessage.textContent = message;
      toast.classList.add('show');
      toast.classList.toggle('error', isError);
      setTimeout(() => {
          toast.classList.remove('show');
      }, 3000);
  }
});

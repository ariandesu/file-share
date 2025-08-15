// --- Wait for the DOM to be fully loaded before running the script ---
document.addEventListener('DOMContentLoaded', () => {

  // --- SUPABASE & FIREBASE CREDENTIALS (REPLACE WITH YOURS) ---
  // IMPORTANT: Replace these placeholder values with your actual
  // Supabase and Firebase project credentials.
  const SUPABASE_URL = 'https://nhujrxbdkslbyzzudvuy.supabase.co'; // e.g., 'https://xyz.supabase.co'
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5odWpyeGJka3NsYnl6enVkdnV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyNTIxMzgsImV4cCI6MjA3MDgyODEzOH0.VJAb2-m21XGBALQx74svCti5HDyQ4nADtQrBg6wz3u8';
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

 // --- INITIALIZE CLIENTS ---
 let supabaseClient, db;
 try {
     if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_URL' || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY' || !FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') {
         throw new Error("Supabase or Firebase credentials are not fully configured.");
     }
     
     supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
     firebase.initializeApp(FIREBASE_CONFIG);
     db = firebase.database();

 } catch (error) {
     console.error("Initialization Error:", error.message);
     showToast("Configuration error. Please check your credentials.", "error");
     document.querySelectorAll('button, input').forEach(el => el.disabled = true);
     return;
 }

 // --- DOM ELEMENT SELECTORS ---
 const themeToggle = document.getElementById('theme-toggle');
 const dropZone = document.getElementById('drop-zone');
 const fileInput = document.getElementById('file-input');
 const browseBtn = document.getElementById('browse-btn');
 const sendCard = document.getElementById('send-card');
 const uploadStatusSection = document.getElementById('upload-status-section');
 const codeInputs = document.querySelectorAll('.code-input');
 const findBtn = document.getElementById('find-btn');
 const transfersList = document.getElementById('transfers-list');
 const toast = document.getElementById('toast');
 const toastMessage = document.getElementById('toast-message');

 // --- THEME TOGGLE FUNCTIONALITY ---
 if (localStorage.getItem('theme') === 'dark') {
     document.body.classList.add('dark');
 }
 themeToggle.addEventListener('click', () => {
     document.body.classList.toggle('dark');
     localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
 });

 // --- LUCIDE ICONS INITIALIZATION ---
 lucide.createIcons();

 // --- EVENT DELEGATION FOR DYNAMIC BUTTONS ---
 // This single event listener on the parent card will handle clicks
 // for buttons that are added dynamically.
 sendCard.addEventListener('click', (e) => {
     const sendAnotherBtn = e.target.closest('#send-another-btn');
     const copyCodeBtn = e.target.closest('#copy-code-btn');

     if (sendAnotherBtn) {
         window.location.reload();
     }

     if (copyCodeBtn) {
         const code = document.getElementById('generated-code').textContent;
         navigator.clipboard.writeText(code).then(() => {
             showToast("Code copied to clipboard!");
         }).catch(err => {
             showToast("Failed to copy code.", "error");
         });
     }
 });


 // --- SEND FILES LOGIC ---
 dropZone.addEventListener('dragover', (e) => {
     e.preventDefault();
     dropZone.classList.add('dragover');
 });

 dropZone.addEventListener('dragleave', (e) => {
     e.preventDefault();
     dropZone.classList.remove('dragover');
 });

 dropZone.addEventListener('drop', (e) => {
     e.preventDefault();
     dropZone.classList.remove('dragover');
     const files = e.dataTransfer.files;
     if (files.length) {
         fileInput.files = files;
         handleFiles(files);
     }
 });

 dropZone.addEventListener('click', () => fileInput.click());
 browseBtn.addEventListener('click', (e) => {
     e.stopPropagation();
     fileInput.click();
 });
 fileInput.addEventListener('change', () => handleFiles(fileInput.files));

 async function handleFiles(files) {
     if (!files.length) return;
     
     const fileList = Array.from(files);
     uploadStatusSection.innerHTML = '';
     uploadStatusSection.classList.remove('hidden');

     const code = await generateUniqueCode();
     if (!code) {
         showToast("Could not generate a unique code. Please try again.", "error");
         return;
     }

     displayCode(code);

     const uploadPromises = fileList.map(file => uploadFile(file, code));

     try {
         const fileDataArray = await Promise.all(uploadPromises);
         const transferRef = db.ref(`transfers/${code}`);
         await transferRef.set({
             files: fileDataArray,
             timestamp: firebase.database.ServerValue.TIMESTAMP
         });

         setTimeout(() => {
             transferRef.remove();
         }, 3600000); // Expire after 1 hour

     } catch (error) {
         console.error('Error during file handling:', error);
         showToast("An error occurred during upload.", "error");
         db.ref(`transfers/${code}`).remove();
     }
 }

 async function uploadFile(file, code) {
     const filePath = `${code}/${file.name}`;
     const uploadStatusUI = createUploadStatusUI(file);
     uploadStatusSection.appendChild(uploadStatusUI.wrapper);

     const { data, error }. = await supabaseClient.storage
         .from('files')
         .upload(filePath, file, {
             cacheControl: '3600',
             upsert: false
         });

     if (error) {
         console.error('Supabase upload error:', error);
         uploadStatusUI.status.textContent = 'Error';
         uploadStatusUI.wrapper.classList.add('error');
         throw error;
     }

     const { data: { publicUrl } } = supabaseClient.storage
         .from('files')
         .getPublicUrl(filePath);

     uploadStatusUI.status.textContent = 'Completed';
     uploadStatusUI.progressBar.style.width = '100%';
     uploadStatusUI.wrapper.classList.add('completed');
     
     return {
         name: file.name,
         size: file.size,
         type: file.type,
         url: publicUrl
     };
 }
 
 async function generateUniqueCode() {
     let code;
     let isUnique = false;
     let attempts = 0;
     while (!isUnique && attempts < 100) {
         code = Math.floor(1000 + Math.random() * 9000).toString();
         const snapshot = await db.ref(`transfers/${code}`).once('value');
         if (!snapshot.exists()) {
             isUnique = true;
         }
         attempts++;
     }
     return isUnique ? code : null;
 }

 function createUploadStatusUI(file) {
     const wrapper = document.createElement('div');
     wrapper.className = 'upload-item';
     
     const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>`;
     
     const fileName = document.createElement('p');
     fileName.className = 'file-name';
     fileName.textContent = file.name;

     const fileSize = document.createElement('p');
     fileSize.className = 'file-size';
     fileSize.textContent = formatBytes(file.size);

     const status = document.createElement('p');
     status.className = 'upload-status-text';
     status.textContent = 'Uploading...';

     const progressWrapper = document.createElement('div');
     progressWrapper.className = 'progress-wrapper';
     const progressBar = document.createElement('div');
     progressBar.className = 'progress-bar';
     progressWrapper.appendChild(progressBar);

     wrapper.innerHTML = icon;
     const infoWrapper = document.createElement('div');
     infoWrapper.className = 'file-info';
     infoWrapper.appendChild(fileName);
     infoWrapper.appendChild(fileSize);
     wrapper.appendChild(infoWrapper);
     wrapper.appendChild(status);
     wrapper.appendChild(progressWrapper);

     let width = 0;
     const interval = setInterval(() => {
         if (width < 95) {
             width += 5;
             progressBar.style.width = width + '%';
         } else {
             clearInterval(interval);
         }
     }, 200);

     return { wrapper, status, progressBar };
 }

 function displayCode(code) {
     sendCard.innerHTML = `
         <h2 class="card-title">Your Code</h2>
         <p class="card-description">Share this code with the recipient.</p>
         <div class="generated-code-container">
             <p id="generated-code" class="generated-code">${code}</p>
             <button id="copy-code-btn" class="icon-button">
                 <i data-lucide="copy"></i>
             </button>
         </div>
         <button id="send-another-btn" class="button">Send More Files</button>
     `;
     lucide.createIcons();
 }

 // --- RECEIVE FILES LOGIC ---
 codeInputs.forEach((input, index) => {
     input.addEventListener('keyup', (e) => {
         if (e.key >= 0 && e.key <= 9) {
             if (index < codeInputs.length - 1) {
                 codeInputs[index + 1].focus();
             }
         } else if (e.key === 'Backspace') {
             if (index > 0) {
                 codeInputs[index - 1].focus();
             }
         }
         validateCodeInputs();
     });
 });

 function validateCodeInputs() {
     const code = Array.from(codeInputs).map(input => input.value).join('');
     findBtn.disabled = code.length !== 4;
 }

 findBtn.addEventListener('click', async () => {
     const code = Array.from(codeInputs).map(input => input.value).join('');
     if (code.length !== 4) return;

     findBtn.textContent = "Finding...";
     findBtn.disabled = true;

     try {
         const snapshot = await db.ref(`transfers/${code}`).once('value');
         if (snapshot.exists()) {
             const data = snapshot.val();
             displayFiles(data.files);
         } else {
             showToast("Invalid or expired code.", "error");
             transfersList.innerHTML = `
                 <i data-lucide="search-x" class="placeholder-icon"></i>
                 <p>No files found for this code.</p>
             `;
             lucide.createIcons();
         }
     } catch (error) {
         console.error("Error fetching files:", error);
         showToast("An error occurred while fetching files.", "error");
     } finally {
         findBtn.textContent = "Find Files";
         validateCodeInputs();
     }
 });

 function displayFiles(files) {
     transfersList.innerHTML = '';
     files.forEach(file => {
         const fileItem = document.createElement('a');
         fileItem.href = file.url;
         fileItem.target = "_blank";
         fileItem.download = file.name;
         fileItem.className = 'file-download-item';
         
         const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>`;
         const downloadIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;

         fileItem.innerHTML = `
             <div class="file-icon">${icon}</div>
             <div class="file-details">
                 <p class="file-name">${file.name}</p>
                 <p class="file-size">${formatBytes(file.size)}</p>
             </div>
             <div class="download-icon">${downloadIcon}</div>
         `;
         transfersList.appendChild(fileItem);
     });
 }

 // --- UTILITY FUNCTIONS ---
 function formatBytes(bytes, decimals = 2) {
     if (bytes === 0) return '0 Bytes';
     const k = 1024;
     const dm = decimals < 0 ? 0 : decimals;
     const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
     const i = Math.floor(Math.log(bytes) / Math.log(k));
     return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
 }

 function showToast(message, type = "success") {
     toastMessage.textContent = message;
     toast.className = `toast show ${type}`;
     setTimeout(() => {
         toast.className = 'toast';
     }, 3000);
 }
});

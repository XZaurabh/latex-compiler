// Elements
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const compileBtn = document.getElementById('compile-btn');
const btnText = compileBtn.querySelector('.btn-text');
const latexCode = document.getElementById('latex-code');
const logTab = document.getElementById('log-tab');
const pdfPlaceholder = document.getElementById('pdf-placeholder');
const pdfContainer = document.getElementById('pdf-container');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const downloadPdfBtn = document.getElementById('download-pdf-btn');
const downloadDocxBtn = document.getElementById('download-docx-btn');

let currentPdfUrl = null;
let lastErrorLog = '';

// Tab Switching
function switchTab(targetId) {
  tabBtns.forEach(btn => {
    if (btn.dataset.target === targetId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  tabContents.forEach(content => {
    if (content.id === targetId) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
}

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.target);
  });
});

// Logging
function clearLog() {
  logTab.innerHTML = '';
}

function addLogLine(text) {
  const line = document.createElement('div');
  line.className = 'log-line';
  
  if (text.startsWith('✓')) {
    line.classList.add('log-green');
  } else if (text.startsWith('!')) {
    line.classList.add('log-red');
  } else if (text.startsWith('//')) {
    line.classList.add('log-gray');
  }
  
  line.textContent = text;
  logTab.appendChild(line);
  logTab.scrollTop = logTab.scrollHeight;
}

// Status Updates
function setStatus(state, message) {
  statusDot.className = 'status-dot'; // reset
  if (state) {
    statusDot.classList.add(state);
  }
  statusText.textContent = message;
  statusText.title = message; // tooltip for truncated text
}

// Compile Logic
compileBtn.addEventListener('click', async () => {
  const code = latexCode.value.trim();
  if (!code) return;

  // UI updates for compiling state
  compileBtn.disabled = true;
  compileBtn.classList.add('loading');
  btnText.textContent = 'Compiling...';
  clearLog();
  lastErrorLog = '';
  addLogLine('// Starting compilation...');
  setStatus('busy', 'Compiling...');

  const targetUrl = `/api/compile?text=${encodeURIComponent(code)}`;
  
  let success = false;
  addLogLine(`// Compiling via edge proxy...`);
  
  try {
    const response = await fetch(targetUrl);
    
    // latexonline.cc returns 400 when there are compilation errors.
    if (!response.ok && response.status !== 400) {
      const text = await response.text();
      // Ensure we truncate the text to avoid flooding the log
      const shortText = text.length > 200 ? text.substring(0, 200) + '...' : text;
      throw new Error(`HTTP error! status: ${response.status}, message: ${shortText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    
    if (response.ok && (contentType.includes('pdf') || contentType.includes('octet'))) {
      // Success: PDF generated
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      currentPdfUrl = blobUrl;
      
      pdfPlaceholder.style.display = 'none';
      pdfContainer.style.display = 'flex';
      
      // Immediately make the tab visible and active so DOM layout engines 
      // calculate real pixel widths for drawing the PDF canvas.
      addLogLine('✓ Compilation successful');
      setStatus('ok', 'PDF rendering...');
      switchTab('pdf-tab');
      
      try {
        // Render PDF Custom View using PDF.js
        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        
        const loadingTask = pdfjsLib.getDocument(blobUrl);
        const pdf = await loadingTask.promise;
        
        pdfContainer.innerHTML = ''; // Clear previous pdf pages
        
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          
          // Calculate scale to fit nicely in the container
          const unscaledViewport = page.getViewport({ scale: 1 });
          // Since it is now visible, clientWidth is accurate!
          let containerWidth = pdfContainer.clientWidth - 40; 
          if (containerWidth < 300) containerWidth = 600; // fallback just in case
          
          let scale = containerWidth / unscaledViewport.width;
          
          // Cap scale so simple docs don't get blown up excessively
          if (scale > 2) scale = 2; 
          
          const viewport = page.getViewport({ scale: scale });
          
          const canvas = document.createElement('canvas');
          canvas.className = 'pdf-page-canvas';
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          
          pdfContainer.appendChild(canvas);
          
          const renderContext = { canvasContext: context, viewport: viewport };
          await page.render(renderContext).promise;
        }
      } catch (pdfError) {
        addLogLine(`! Custom PDF viewer failed to render: ${pdfError.message}`);
        console.error(pdfError);
      }
      
      downloadPdfBtn.disabled = false;
      downloadDocxBtn.disabled = false;
      setStatus('ok', 'PDF ready');
      success = true;
    } else {
      // Error: LaTeX compilation failed, read log
      const text = await response.text();
      lastErrorLog = text; // save log for AI fixing
      const lines = text.split('\\n');
      addLogLine('! Compilation failed with errors:');
      lines.forEach(line => {
        if (line.trim()) {
          addLogLine(line);
        }
      });
      setStatus('err', 'Compilation error');
      switchTab('log-tab');
      success = true; // We successfully got a response, even if it's a LaTeX error
    }
  } catch (error) {
    addLogLine(`! Proxy failed: ${error.message}`);
  }

  if (!success) {
    lastErrorLog = 'Network error: Proxy routing failed.';
    addLogLine('! Local proxy failed. If deployed, ensure _redirects is present.');
    setStatus('err', 'Network error');
    switchTab('log-tab');
  }

  // Restore UI
  compileBtn.disabled = false;
  compileBtn.classList.remove('loading');
  btnText.textContent = 'Compile PDF';
});

// Download handlers
downloadPdfBtn.addEventListener('click', () => {
  if (!currentPdfUrl) return;
  const a = document.createElement('a');
  a.href = currentPdfUrl;
  a.download = 'document.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

downloadDocxBtn.addEventListener('click', () => {
  // Since latexonline doesn't support DOCX, we show an alert or trigger a placeholder download
  alert('DOCX conversion directly from LaTeX requires a specialized backend API (like Pandoc). For now, this is a placeholder.');
  // Fallback: download the LaTeX source as a .tex file so at least they have the source
  const code = latexCode.value.trim();
  const blob = new Blob([code], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'document.tex';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});
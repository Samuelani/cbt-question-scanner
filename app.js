(function () {
  'use strict';

  const CONFIG = {
    classes: ["JSS 1", "JSS 2", "JSS 3", "SS 1", "SS 2", "SS 3"],
    subjects: ["Mathematics", "English Language", "Basic Science", "Civic Education", "Computer Studies", "Physics", "Chemistry", "Biology"]
  };

  let questionsState = [];
  let db = null;

  // --- IndexedDB Setup ---
  function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('CBTSnapperDB', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { db = request.result; resolve(db); };
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains('drafts')) {
          database.createObjectStore('drafts', { keyPath: 'id' });
        }
      };
    });
  }

  function saveDraftToDB() {
    if (!db) return;
    const tx = db.transaction('drafts', 'readwrite');
    const store = tx.objectStore('drafts');
    store.put({
      id: 'current_draft',
      className: document.getElementById('configClass').value,
      subjectName: document.getElementById('configSubject').value,
      rawText: document.getElementById('pasteInput').value,
      questions: questionsState,
      updatedAt: new Date().toISOString()
    });
  }

  function clearDraftInDB() {
    if (!db) return;
    const tx = db.transaction('drafts', 'readwrite');
    const store = tx.objectStore('drafts');
    store.delete('current_draft');
  }

  function loadDraftFromDB() {
    return new Promise((resolve) => {
      if (!db) return resolve(null);
      const tx = db.transaction('drafts', 'readonly');
      const store = tx.objectStore('drafts');
      const req = store.get('current_draft');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  // --- Dropdowns ---
  function initDropdowns() {
    const classSelect = document.getElementById('configClass');
    const subjectSelect = document.getElementById('configSubject');

    CONFIG.classes.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      classSelect.appendChild(opt);
    });

    CONFIG.subjects.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      subjectSelect.appendChild(opt);
    });

    classSelect.addEventListener('change', () => {
      saveDraftToDB();
      updateStatus();
    });
    subjectSelect.addEventListener('change', () => {
      saveDraftToDB();
      updateStatus();
    });
  }

  // --- Append Extracted Text ---
  function appendExtractedText(newText) {
    const pasteInput = document.getElementById('pasteInput');
    const current = pasteInput.value.trim();
    if (current) {
      pasteInput.value = current + '\n\n' + newText;
    } else {
      pasteInput.value = newText;
    }
    saveDraftToDB();
    showInlineMsg("Text added. Scan more pages or tap Parse.");
  }

  function showInlineMsg(msg) {
    const box = document.getElementById('inlineMsg');
    box.textContent = msg;
    box.style.display = 'block';
  }

  // --- Status & UI Update without losing focus ---
  function updateStatus() {
    const reviewSection = document.getElementById('reviewSection');
    if (questionsState.length > 0) {
      reviewSection.style.display = 'block';
    } else {
      reviewSection.style.display = 'none';
    }

    const validation = CBTParser.validateAll(questionsState);
    
    document.getElementById('statTotal').textContent = validation.total;
    const badge = document.getElementById('statStatusBadge');
    if (validation.valid) {
      badge.className = 'badge-ok';
      badge.textContent = 'All Valid & Ready to Export';
    } else {
      badge.className = 'badge-alert';
      badge.textContent = `${validation.blocking.length} Question(s) Need Attention`;
    }

    const exportBtn = document.getElementById('exportBtn');
    const blockNote = document.getElementById('exportBlockNote');
    const className = document.getElementById('configClass').value;
    const subjectName = document.getElementById('configSubject').value;

    const classSubjectSelected = className && subjectName;

    if (validation.valid && validation.total > 0 && classSubjectSelected) {
      exportBtn.disabled = false;
      blockNote.textContent = '';
    } else {
      exportBtn.disabled = true;
      if (!classSubjectSelected) {
        blockNote.textContent = 'Please select Class and Subject in Exam Settings.';
      } else if (validation.total === 0) {
        blockNote.textContent = 'No questions loaded.';
      } else {
        const firstErr = validation.blocking[0];
        blockNote.textContent = `Export blocked. Question #${firstErr.number}: ${firstErr.issues.map(i => i.message).join(', ')}`;
      }
    }

    questionsState.forEach((q, index) => {
      const card = document.querySelector(`.q-card[data-index="${index}"]`);
      if (card) {
        const hasIssue = q.issues && q.issues.length > 0;
        if (hasIssue) {
          card.classList.add('has-issue');
        } else {
          card.classList.remove('has-issue');
        }
        const tag = card.querySelector('.issue-tag');
        if (tag) {
          tag.textContent = hasIssue ? `⚠️ ${q.issues.map(i => i.message).join(' | ')}` : '';
        }
      }
    });

    saveDraftToDB();
  }

  function renderReview() {
    const reviewSection = document.getElementById('reviewSection');
    if (questionsState.length === 0) {
      reviewSection.style.display = 'none';
      return;
    }
    reviewSection.style.display = 'block';

    CBTParser.validateAll(questionsState);
    const container = document.getElementById('questionsContainer');
    container.innerHTML = '';

    questionsState.forEach((q, index) => {
      const hasIssue = q.issues && q.issues.length > 0;
      const card = document.createElement('div');
      card.className = `q-card ${hasIssue ? 'has-issue' : ''}`;
      card.setAttribute('data-index', index);

      const issueText = hasIssue ? `⚠️ ${q.issues.map(i => i.message).join(' | ')}` : '';

      card.innerHTML = `
        <div class="q-header">
          <span>Question #${index + 1}</span>
          <span class="issue-tag">${issueText}</span>
          <div class="card-actions">
            <button class="btn btn-secondary btn-sm" data-action="move-up" data-index="${index}" ${index === 0 ? 'disabled' : ''}>⬆️</button>
            <button class="btn btn-secondary btn-sm" data-action="move-down" data-index="${index}" ${index === questionsState.length - 1 ? 'disabled' : ''}>⬇️</button>
            <button class="btn btn-danger btn-sm" data-action="delete" data-index="${index}">Delete</button>
          </div>
        </div>
        <textarea data-field="question_text" data-index="${index}" placeholder="Type question text here...">${escapeHtml(q.question_text)}</textarea>
        
        <div class="opt-row"><span>A</span><input type="text" data-field="option_a" data-index="${index}" value="${escapeHtml(q.option_a)}"></div>
        <div class="opt-row"><span>B</span><input type="text" data-field="option_b" data-index="${index}" value="${escapeHtml(q.option_b)}"></div>
        <div class="opt-row"><span>C</span><input type="text" data-field="option_c" data-index="${index}" value="${escapeHtml(q.option_c)}"></div>
        <div class="opt-row"><span>D</span><input type="text" data-field="option_d" data-index="${index}" value="${escapeHtml(q.option_d)}"></div>

        <div class="ans-row">
          <label style="margin:0; font-size:13px;">Correct Answer:</label>
          <select data-field="correct_option" data-index="${index}">
            <option value="">-- Select --</option>
            <option value="A" ${q.correct_option === 'A' ? 'selected' : ''}>Option A</option>
            <option value="B" ${q.correct_option === 'B' ? 'selected' : ''}>Option B</option>
            <option value="C" ${q.correct_option === 'C' ? 'selected' : ''}>Option C</option>
            <option value="D" ${q.correct_option === 'D' ? 'selected' : ''}>Option D</option>
          </select>
        </div>
      `;
      container.appendChild(card);
    });

    updateStatus();
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/\"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function preprocessImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.getElementById('preprocessCanvas');
          const ctx = canvas.getContext('2d');
          let width = img.width;
          let height = img.height;
          const maxWidth = 2000;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);

          const imgData = ctx.getImageData(0, 0, width, height);
          const data = imgData.data;
          for (let i = 0; i < data.length; i += 4) {
            let avg = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            avg = avg < 128 ? avg * 0.8 : avg * 1.2;
            if (avg > 255) avg = 255;
            data[i] = avg; data[i + 1] = avg; data[i + 2] = avg;
          }
          ctx.putImageData(imgData, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function runOCR(file) {
    const progressBox = document.getElementById('ocrProgressBox');
    const statusText = document.getElementById('ocrStatusText');
    progressBox.style.display = 'block';
    statusText.textContent = 'Pre-processing image...';

    try {
      const processedImageUrl = await preprocessImage(file);
      statusText.textContent = 'Initializing offline OCR engine...';

      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: 'vendor/tesseract/worker.min.js',
        corePath: 'vendor/tesseract/tesseract-core.wasm.js',
        langPath: 'vendor/tesseract/',
        logger: m => {
          if (m.status === 'recognizing text') {
            const pct = Math.round(m.progress * 100);
            statusText.textContent = `Recognizing text: ${pct}%`;
          }
        }
      });

      statusText.textContent = 'Scanning text from image...';
      const { data: { text } } = await worker.recognize(processedImageUrl);
      await worker.terminate();

      progressBox.style.display = 'none';
      appendExtractedText(text);
    } catch (err) {
      progressBox.style.display = 'none';
      alert('OCR Failed: ' + err.message);
    }
  }

  async function handleDocxUpload(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
      appendExtractedText(result.value);
      if (!/^\s*\d+\s*[.)]/m.test(result.value)) {
        showInlineMsg("No question numbers (1. 2. 3.) found. If this Word file uses automatic numbering, save it as PDF or copy-paste the text instead.");
      }
    } catch (err) {
      alert('DOCX Extraction Failed: ' + err.message);
    }
  }

  async function handlePdfUpload(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdfDoc = await loadingTask.promise;
      let fullText = '';

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        let lastY = null, line = [], lines = [];
        for (const item of content.items) {
          const y = item.transform[5];
          if (lastY !== null && Math.abs(y - lastY) > 3) { lines.push(line.join(' ')); line = []; }
          if (item.str) line.push(item.str);
          lastY = y;
        }
        lines.push(line.join(' '));
        fullText += lines.join('\n') + '\n';
      }

      if (fullText.trim().length < 20) {
        alert("This PDF is a scan with no text. Take photos of the pages instead.");
        return;
      }

      appendExtractedText(fullText);
    } catch (err) {
      alert('PDF Extraction Failed: ' + err.message);
    }
  }

  function bindEvents() {
    document.getElementById('pasteInput').addEventListener('input', () => {
      saveDraftToDB();
    });

    document.getElementById('parseBtn').addEventListener('click', () => {
      const rawText = document.getElementById('pasteInput').value;
      if (!rawText.trim()) {
        alert('Please paste or scan some text first.');
        return;
      }

      if (questionsState.length > 0) {
        if (!confirm(`Replace the current ${questionsState.length} questions?`)) {
          return;
        }
      }

      const result = CBTParser.parse(rawText);
      if (result.stats.total === 0) {
        showInlineMsg("No questions found. Check that questions are numbered (1. 2. 3.) and options are lettered (A. B. C. D.).");
        return;
      }

      questionsState = result.questions;
      renderReview();

      let msg = `Successfully parsed ${result.stats.total} question(s)!`;
      if (result.stats.keyApplied > 0) {
        msg += `\n${result.stats.keyApplied} answers filled from the answer key.`;
      }
      if (result.ignored && result.ignored.length > 0) {
        msg += `\n\nSkipped/Ignored lines (${result.ignored.length}):\n` + result.ignored.join('\n');
      }
      showInlineMsg(msg);
    });

    document.getElementById('loadSampleBtn').addEventListener('click', () => {
      const sampleText = document.getElementById('sampleDisplay').textContent;
      document.getElementById('pasteInput').value = sampleText;
      saveDraftToDB();
      showInlineMsg("Sample loaded. Tap 'Parse Text into Questions'.");
    });

    document.getElementById('addQuestionBtn').addEventListener('click', () => {
      questionsState.push(CBTParser.newQuestion(questionsState.length + 1));
      renderReview();
    });

    document.getElementById('startNewPaperBtn').addEventListener('click', () => {
      if (confirm("Start a new paper? All current questions and draft data will be cleared.")) {
        questionsState = [];
        document.getElementById('pasteInput').value = '';
        document.getElementById('configClass').value = '';
        document.getElementById('configSubject').value = '';
        document.getElementById('inlineMsg').style.display = 'none';
        clearDraftInDB();
        renderReview();
      }
    });

    document.getElementById('questionsContainer').addEventListener('input', (e) => {
      const field = e.target.getAttribute('data-field');
      const index = e.target.getAttribute('data-index');
      if (field && index !== null) {
        questionsState[index][field] = e.target.value;
        CBTParser.validateAll(questionsState);
        updateStatus();
      }
    });

    document.getElementById('questionsContainer').addEventListener('change', (e) => {
      const field = e.target.getAttribute('data-field');
      const index = e.target.getAttribute('data-index');
      if (field === 'correct_option' && index !== null) {
        questionsState[index].correct_option = e.target.value;
        updateStatus();
      }
    });

    document.getElementById('questionsContainer').addEventListener('click', (e) => {
      const action = e.target.getAttribute('data-action');
      const index = parseInt(e.target.getAttribute('data-index'), 10);
      if (action === 'delete' && !isNaN(index)) {
        if (confirm(`Delete Question #${index + 1}?`)) {
          questionsState.splice(index, 1);
          renderReview();
        }
      } else if (action === 'move-up' && !isNaN(index) && index > 0) {
        const temp = questionsState[index];
        questionsState[index] = questionsState[index - 1];
        questionsState[index - 1] = temp;
        renderReview();
      } else if (action === 'move-down' && !isNaN(index) && index < questionsState.length - 1) {
        const temp = questionsState[index];
        questionsState[index] = questionsState[index + 1];
        questionsState[index + 1] = temp;
        renderReview();
      }
    });

    document.getElementById('exportBtn').addEventListener('click', () => {
      try {
        const className = document.getElementById('configClass').value;
        const subjectName = document.getElementById('configSubject').value;
        const exportData = CBTParser.buildExport({
          class_name: className,
          subject_name: subjectName,
          questions: questionsState
        });

        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = CBTParser.exportFileName(className, subjectName);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        alert(err.message);
      }
    });

    document.getElementById('importJsonFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target.result);
          if (!data.class_name || !data.subject_name || !Array.isArray(data.questions)) {
            throw new Error('Invalid JSON file format.');
          }
          document.getElementById('configClass').value = data.class_name;
          document.getElementById('configSubject').value = data.subject_name;
          questionsState = data.questions.map((q, idx) => ({
            id: 'imp_' + idx + '_' + Math.random().toString(36).slice(2, 7),
            number: idx + 1,
            question_text: q.question_text || '',
            option_a: q.option_a || '',
            option_b: q.option_b || '',
            option_c: q.option_c || '',
            option_d: q.option_d || '',
            correct_option: q.correct_option || '',
            issues: []
          }));
          renderReview();
          showInlineMsg(`Successfully imported ${questionsState.length} questions from JSON!`);
        } catch (err) {
          alert('Failed to parse JSON file: ' + err.message);
        } finally {
          e.target.value = '';
        }
      };
      reader.readAsText(file);
    });

    document.getElementById('cameraInput').addEventListener('change', (e) => {
      if (e.target.files[0]) {
        runOCR(e.target.files[0]);
        e.target.value = '';
      }
    });
    document.getElementById('imageInput').addEventListener('change', (e) => {
      if (e.target.files[0]) {
        runOCR(e.target.files[0]);
        e.target.value = '';
      }
    });
    document.getElementById('docxInput').addEventListener('change', (e) => {
      if (e.target.files[0]) {
        handleDocxUpload(e.target.files[0]);
        e.target.value = '';
      }
    });
    document.getElementById('pdfInput').addEventListener('change', (e) => {
      if (e.target.files[0]) {
        handlePdfUpload(e.target.files[0]);
        e.target.value = '';
      }
    });
  }

  window.addEventListener('DOMContentLoaded', async () => {
    initDropdowns();
    bindEvents();
    try {
      await initDB();
      const draft = await loadDraftFromDB();
      if (draft) {
        if (draft.className) document.getElementById('configClass').value = draft.className;
        if (draft.subjectName) document.getElementById('configSubject').value = draft.subjectName;
        if (draft.rawText) document.getElementById('pasteInput').value = draft.rawText;
        if (draft.questions && draft.questions.length > 0) {
          questionsState = draft.questions;
          renderReview();
        } else {
          updateStatus();
        }
      }
    } catch (e) {
      console.warn('IndexedDB unavailable:', e);
    }
  });

})();
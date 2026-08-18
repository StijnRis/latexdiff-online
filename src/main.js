import './style.css';
import { MARKUP_TYPES, MATH_MARKUP_LEVELS, buildLatexdiffArgv } from './latexdiffOptions.js';

const worker = new Worker(`${import.meta.env.BASE_URL}perl-worker.js`);

const els = {
  oldTex: document.getElementById('oldTex'),
  newTex: document.getElementById('newTex'),
  markupType: document.getElementById('markupType'),
  mathMarkup: document.getElementById('mathMarkup'),
  noPreamble: document.getElementById('noPreamble'),
  runBtn: document.getElementById('runBtn'),
  copyBtn: document.getElementById('copyBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  diffOutput: document.getElementById('diffOutput'),
  status: document.getElementById('status'),
};

function setStatus(message, kind = 'info') {
  els.status.textContent = message;
  els.status.dataset.kind = kind;
}

function setBusy(busy, label) {
  els.runBtn.disabled = busy;
  if (label) els.runBtn.textContent = label;
}

function fillSelect(select, items, selected) {
  select.replaceChildren();
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item.value;
    opt.textContent = item.label;
    if (item.value === selected) opt.selected = true;
    select.append(opt);
  }
}

fillSelect(els.markupType, MARKUP_TYPES, 'UNDERLINE');
fillSelect(els.mathMarkup, MATH_MARKUP_LEVELS, 'fine');
setBusy(true, 'Loading…');
setStatus('Loading…');

worker.postMessage({ type: 'init' });

worker.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'status') {
    setStatus(data.message);
    return;
  }
  if (data.type === 'ready') {
    setBusy(false, 'Run latexdiff');
    setStatus('Ready');
    return;
  }
  if (data.type === 'result') {
    els.diffOutput.value = data.output || '';
    setBusy(false, 'Run latexdiff');
    setStatus(data.stderr ? 'Finished with warnings.' : 'Done');
    return;
  }
  if (data.type === 'error') {
    setBusy(false, 'Run latexdiff');
    setStatus(data.message || 'latexdiff failed.', 'error');
  }
});

worker.addEventListener('error', (event) => {
  setBusy(false, 'Run latexdiff');
  setStatus(event.message || 'Worker failed to start.', 'error');
});

els.runBtn.addEventListener('click', () => {
  if (els.runBtn.disabled) return;
  setBusy(true, 'Running…');
  setStatus('Running…');
  worker.postMessage({
    type: 'run',
    oldText: els.oldTex.value,
    newText: els.newTex.value,
    argv: buildLatexdiffArgv({
      type: els.markupType.value,
      mathMarkup: els.mathMarkup.value,
      noPreamble: els.noPreamble.checked,
    }),
  });
});

els.copyBtn.addEventListener('click', async () => {
  const text = els.diffOutput.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Copied');
  } catch {
    els.diffOutput.select();
    document.execCommand('copy');
    setStatus('Copied');
  }
});

els.downloadBtn.addEventListener('click', () => {
  const text = els.diffOutput.value;
  if (!text) return;
  const blob = new Blob([text], { type: 'text/x-tex' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'latexdiff.tex';
  a.click();
  URL.revokeObjectURL(url);
});

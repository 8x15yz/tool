const fileInput    = document.getElementById('fileInput');
const dropZone     = document.getElementById('dropZone');
const errorBox     = document.getElementById('errorBox');
const workspace    = document.getElementById('workspace');
const eventList    = document.getElementById('eventList');
const eventCount   = document.getElementById('eventCount');
const eventContent = document.getElementById('eventContent');
const sourceName   = document.getElementById('sourceName');
const copyRawBtn   = document.getElementById('copyRawButton');
const rawText      = document.getElementById('rawText');

let currentRaw = '';

fileInput.addEventListener('change', e => loadFile(e.target.files[0]));

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter') fileInput.click(); });
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

copyRawBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(currentRaw).catch(() => {});
});

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}

function clearError() {
  errorBox.classList.add('hidden');
}

function loadFile(file) {
  if (!file) return;
  clearError();
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const text = e.target.result;
      const events = parseICS(text);
      if (!events.length) { showError('파싱된 일정이 없습니다.'); return; }
      sourceName.textContent = file.name;
      renderSidebar(events);
      dropZone.classList.add('hidden');
      workspace.classList.remove('hidden');
      selectEvent(events[0]);
    } catch (err) {
      showError('파일을 읽는 중 오류가 발생했습니다: ' + err.message);
    }
  };
  reader.readAsText(file, 'utf-8');
}

function parseICS(text) {
  // RFC 5545 line unfolding
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  const events = [];
  let cur = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT')   { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;

    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const rawKey = line.slice(0, sep);
    const val    = line.slice(sep + 1);
    const key    = rawKey.split(';')[0]; // strip params

    switch (key) {
      case 'SUMMARY':     cur.summary     = decode(val); break;
      case 'DTSTART':     cur.dtstart     = parseDate(val); break;
      case 'DTEND':       cur.dtend       = parseDate(val); break;
      case 'DESCRIPTION': cur.description = decode(val); break;
      case 'LOCATION':    cur.location    = decode(val); break;
      case 'ORGANIZER':   cur.organizer   = val.replace(/^mailto:/i, ''); break;
      case 'UID':         cur.uid         = val; break;
    }
  }

  events.sort((a, b) => (a.dtstart || 0) - (b.dtstart || 0));
  return events;
}

function decode(v) {
  return v.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function parseDate(val) {
  if (!val) return null;
  const s = val.replace('Z', '');
  if (s.length === 8) {
    return new Date(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8));
  }
  return new Date(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8),
                  +s.slice(9,11)||0, +s.slice(11,13)||0, +s.slice(13,15)||0);
}

function fmtDate(d) {
  if (!d) return '—';
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function renderSidebar(events) {
  eventCount.textContent = events.length;
  eventList.innerHTML = '';
  events.forEach((ev, i) => {
    const el = document.createElement('div');
    el.className = 'event-item';
    el.innerHTML = `
      <div class="event-item-title">${esc(ev.summary || '(제목 없음)')}</div>
      <div class="event-item-date">${ev.dtstart ? fmtDate(ev.dtstart) : '날짜 없음'}</div>
    `;
    el.addEventListener('click', () => {
      document.querySelectorAll('.event-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      selectEvent(ev);
    });
    eventList.appendChild(el);
  });
  eventList.firstElementChild?.classList.add('active');
}

function selectEvent(ev) {
  currentRaw = Object.entries(ev)
    .map(([k, v]) => `${k}: ${v instanceof Date ? fmtDate(v) : v}`)
    .join('\n');
  rawText.textContent = currentRaw;

  eventContent.innerHTML = `
    <h2>${esc(ev.summary || '(제목 없음)')}</h2>
    ${field('시작', fmtDate(ev.dtstart))}
    ${field('종료', fmtDate(ev.dtend))}
    ${ev.location    ? field('장소',  esc(ev.location))                    : ''}
    ${ev.organizer   ? field('주최자', esc(ev.organizer))                   : ''}
    ${ev.description ? field('내용',  `<span class="field-value description">${esc(ev.description)}</span>`, true) : ''}
  `;
}

function field(label, value, raw = false) {
  return `<div class="field-row">
    <span class="field-label">${label}</span>
    ${raw ? value : `<span class="field-value">${value}</span>`}
  </div>`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

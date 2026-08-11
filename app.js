// ── DOM refs ──────────────────────────────────────────────────────────────────
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

// ── File loading ──────────────────────────────────────────────────────────────
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
copyRawBtn.addEventListener('click', () => navigator.clipboard.writeText(currentRaw).catch(() => {}));

function showError(msg) { errorBox.textContent = msg; errorBox.classList.remove('hidden'); }
function clearError()   { errorBox.classList.add('hidden'); }

function loadFile(file) {
  if (!file) return;
  clearError();
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const { events, timezones } = parseICS(e.target.result);
      if (!events.length) { showError('파싱된 일정이 없습니다.'); return; }
      sourceName.textContent = file.name;
      renderSidebar(events, timezones);
      dropZone.classList.add('hidden');
      workspace.classList.remove('hidden');
      selectEvent(events[0], timezones);
    } catch (err) {
      showError('파일을 읽는 중 오류가 발생했습니다: ' + err.message);
    }
  };
  reader.readAsText(file, 'utf-8');
}

// ── ICS parsing ───────────────────────────────────────────────────────────────
function parseICS(text) {
  // RFC 5545 line unfolding
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  const timezones = parseTimezones(lines);
  const events = [];
  let cur = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT')   { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;

    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const params = parseParams(line.slice(0, sep));
    const val    = line.slice(sep + 1);

    switch (params.key) {
      case 'SUMMARY':     cur.summary     = decode(val); break;
      case 'DTSTART':     Object.assign(cur, prefixKeys('dtstart', parseDt(val, params, timezones))); break;
      case 'DTEND':       Object.assign(cur, prefixKeys('dtend',   parseDt(val, params, timezones))); break;
      case 'DESCRIPTION': cur.description = decode(val); break;
      case 'LOCATION':    cur.location    = decode(val); break;
      case 'ORGANIZER':   cur.organizer   = val.replace(/^mailto:/i, ''); break;
      case 'UID':         cur.uid         = val; break;
      case 'URL':         cur.url         = val; break;
      case 'X-MICROSOFT-SKYPETEAMSMEETINGURL': cur.teamsUrl      = val; break;
      case 'X-GOOGLE-CONFERENCE':              cur.conferenceUrl = val; break;
    }
  }

  events.sort((a, b) => (a.dtstart || 0) - (b.dtstart || 0));
  return { events, timezones };
}

// "DTSTART;TZID=..." → { key: 'DTSTART', TZID: '...' }
function parseParams(raw) {
  const parts = raw.split(';');
  const result = { key: parts[0] };
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq >= 0) result[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
  }
  return result;
}

function prefixKeys(prefix, obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[`${prefix}_${k}`] = v;
  return out;
}

// ── Timezone parsing ──────────────────────────────────────────────────────────
function parseTimezones(lines) {
  const map = {};
  let cur = null, block = null;

  for (const line of lines) {
    if (line === 'BEGIN:VTIMEZONE')  { cur = {}; block = null; continue; }
    if (line === 'END:VTIMEZONE')    { if (cur?.tzid) map[cur.tzid] = cur; cur = null; continue; }
    if (!cur) continue;
    if (line === 'BEGIN:STANDARD')   { block = {}; continue; }
    if (line === 'END:STANDARD')     { cur.standard = block; block = null; continue; }
    if (line === 'BEGIN:DAYLIGHT')   { block = {}; continue; }
    if (line === 'END:DAYLIGHT')     { cur.daylight = block; block = null; continue; }

    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const key = line.slice(0, sep).split(';')[0];
    const val = line.slice(sep + 1);

    if (key === 'TZID' && !block) {
      cur.tzid = val;
    } else if (block) {
      if (key === 'TZOFFSETFROM') block.from = parseOffset(val);
      else if (key === 'TZOFFSETTO') block.to = parseOffset(val);
      else if (key === 'DTSTART') block.dtstart = val;
      else if (key === 'RRULE') block.rrule = parseRRule(val);
    }
  }
  return map;
}

// "+0200" → 120, "-0500" → -300
function parseOffset(s) {
  const sign = s[0] === '-' ? -1 : 1;
  return sign * (parseInt(s.slice(1, 3), 10) * 60 + parseInt(s.slice(3, 5), 10));
}

function parseRRule(s) {
  const out = {};
  s.split(';').forEach(p => { const [k, v] = p.split('='); out[k] = v; });
  return out;
}

// Return UTC offset in minutes for a given naive-UTC timestamp in the timezone
function getOffsetMinutes(tzData, naiveMs) {
  const { standard, daylight } = tzData;
  if (!standard) return 0;
  if (!daylight) return standard.to;

  const year = new Date(naiveMs).getUTCFullYear();
  const dsStart  = transitionMs(year, daylight);
  const stdStart = transitionMs(year, standard);

  // Northern hemisphere: DST window is [dsStart, stdStart)
  if (dsStart < stdStart)
    return (naiveMs >= dsStart && naiveMs < stdStart) ? daylight.to : standard.to;
  // Southern hemisphere wraps year boundary
  return (naiveMs >= dsStart || naiveMs < stdStart) ? daylight.to : standard.to;
}

// Compute transition timestamp (ms) for a given year + VTIMEZONE block
function transitionMs(year, block) {
  const ts = block.dtstart || '';
  const tm = ts.match(/T(\d{2})(\d{2})(\d{2})/);
  const h  = tm ? +tm[1] : 0;
  const m  = tm ? +tm[2] : 0;
  const rrule = block.rrule || {};
  const month = rrule.BYMONTH ? parseInt(rrule.BYMONTH, 10) - 1 : 0;
  const byday = rrule.BYDAY || '';
  const match = byday.match(/^(-?\d+)([A-Z]{2})$/);

  if (!match) return Date.UTC(year, month, 1, h, m);

  const n      = parseInt(match[1], 10);
  const dayIdx = { SU:0, MO:1, TU:2, WE:3, TH:4, FR:5, SA:6 }[match[2]];

  if (n > 0) {
    const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const day = 1 + ((dayIdx - firstDow + 7) % 7) + (n - 1) * 7;
    return Date.UTC(year, month, day, h, m);
  } else {
    // n === -1: last occurrence
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const lastDow = new Date(Date.UTC(year, month + 1, 0)).getUTCDay();
    const day = lastDay - ((lastDow - dayIdx + 7) % 7);
    return Date.UTC(year, month, day, h, m);
  }
}

// Parse a datetime string into a proper UTC-based Date + metadata
function parseDt(val, params, timezones) {
  if (!val) return { dt: null, tzid: null, offsetMin: null };

  const s     = val.replace('Z', '');
  const isUtc = val.endsWith('Z');
  const tzid  = params.TZID || null;

  if (s.length === 8) {
    return { dt: new Date(Date.UTC(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8))), tzid, offsetMin: null };
  }

  // Treat the bare datetime as a naiveMs value (UTC-anchored for arithmetic)
  const naiveMs = Date.UTC(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8),
                            +(s.slice(9,11)||0), +(s.slice(11,13)||0), +(s.slice(13,15)||0));

  if (isUtc) return { dt: new Date(naiveMs), tzid: 'UTC', offsetMin: 0 };

  if (tzid && timezones[tzid]) {
    const offsetMin = getOffsetMinutes(timezones[tzid], naiveMs);
    return { dt: new Date(naiveMs - offsetMin * 60000), tzid, offsetMin };
  }

  // No timezone info: interpret as browser local time
  const [y, mo, d, hh, mi, ss] = [+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8),
                                   +(s.slice(9,11)||0), +(s.slice(11,13)||0), +(s.slice(13,15)||0)];
  return { dt: new Date(y, mo, d, hh, mi, ss), tzid: null, offsetMin: null };
}

function decode(v) {
  return v.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// ── Meeting link extraction ───────────────────────────────────────────────────
const LINK_PATTERNS = [
  { re: /https:\/\/teams\.microsoft\.com\/[^\s\n<>"]+/i,       label: 'Microsoft Teams', icon: '💬' },
  { re: /https:\/\/[a-z0-9.-]+\.zoom\.us\/j\/[^\s\n<>"]+/i,   label: 'Zoom',           icon: '🎥' },
  { re: /https:\/\/meet\.google\.com\/[a-z0-9-]+/i,            label: 'Google Meet',    icon: '🟢' },
  { re: /https:\/\/[^\s\n<>"]*webex\.com\/[^\s\n<>"]+/i,       label: 'Webex',          icon: '🔵' },
];

function extractMeetingLink(ev) {
  const dedicated = ev.teamsUrl || ev.conferenceUrl || ev.url;
  if (dedicated) {
    const found = LINK_PATTERNS.find(p => p.re.test(dedicated));
    return { url: dedicated, label: found?.label || '접속 링크', icon: found?.icon || '🔗' };
  }
  if (ev.description) {
    for (const p of LINK_PATTERNS) {
      const m = ev.description.match(p.re);
      if (m) return { url: m[0], label: p.label, icon: p.icon };
    }
  }
  return null;
}

function extractTeamsDetails(description) {
  if (!description) return {};
  const idMatch   = description.match(/Meeting ID[:\s]+([0-9 ]+)/i);
  const passMatch = description.match(/Passcode[:\s]+([^\n\s\\]+)/i);
  return {
    meetingId: idMatch  ? idMatch[1].trim()  : null,
    passcode:  passMatch ? passMatch[1].trim() : null,
  };
}

// ── Date formatting ───────────────────────────────────────────────────────────
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const DT_OPTS  = { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' };

function fmtDateWithTz(dt, tzid, offsetMin) {
  if (!dt) return { original: '—', tzLabel: null, local: null };

  let originalStr, tzLabel, local = null;

  if (tzid === 'UTC' || tzid === null) {
    originalStr = dt.toLocaleString('ko-KR', { ...DT_OPTS, timeZone: tzid === 'UTC' ? 'UTC' : LOCAL_TZ });
    tzLabel = tzid === 'UTC' ? 'UTC' : null;
  } else if (offsetMin != null) {
    // Reconstruct display time = UTC + offsetMin
    const displayMs = dt.getTime() + offsetMin * 60000;
    originalStr = new Date(displayMs).toLocaleString('ko-KR', { ...DT_OPTS, timeZone: 'UTC' });

    const sign = offsetMin >= 0 ? '+' : '-';
    const abs  = Math.abs(offsetMin);
    const hh   = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm   = String(abs % 60).padStart(2, '0');
    tzLabel = `UTC${sign}${hh}:${mm}`;
  } else {
    originalStr = dt.toLocaleString('ko-KR', { ...DT_OPTS, timeZone: LOCAL_TZ });
    tzLabel = tzid;
  }

  // Local time (show only when offset differs from local offset)
  if (tzid && tzid !== 'UTC' && offsetMin != null) {
    const localOffsetMin = -dt.getTimezoneOffset();
    if (localOffsetMin !== offsetMin) {
      const localSign = localOffsetMin >= 0 ? '+' : '-';
      const localAbs  = Math.abs(localOffsetMin);
      const lhh = String(Math.floor(localAbs / 60)).padStart(2, '0');
      const lmm = String(localAbs % 60).padStart(2, '0');
      local = `${dt.toLocaleString('ko-KR', { ...DT_OPTS, timeZone: LOCAL_TZ })} (UTC${localSign}${lhh}:${lmm})`;
    }
  }

  return { original: originalStr, tzLabel, local };
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderSidebar(events, timezones) {
  eventCount.textContent = events.length;
  eventList.innerHTML = '';
  events.forEach(ev => {
    const el = document.createElement('div');
    el.className = 'event-item';
    el.innerHTML = `
      <div class="event-item-title">${esc(ev.summary || '(제목 없음)')}</div>
      <div class="event-item-date">${ev.dtstart_dt ? ev.dtstart_dt.toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '날짜 없음'}</div>
    `;
    el.addEventListener('click', () => {
      document.querySelectorAll('.event-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      selectEvent(ev, timezones);
    });
    eventList.appendChild(el);
  });
  eventList.firstElementChild?.classList.add('active');
}

function selectEvent(ev, timezones) {
  currentRaw = Object.entries(ev)
    .map(([k, v]) => `${k}: ${v instanceof Date ? v.toISOString() : v}`)
    .join('\n');
  rawText.textContent = currentRaw;

  const start = fmtDateWithTz(ev.dtstart_dt, ev.dtstart_tzid, ev.dtstart_offsetMin);
  const end   = fmtDateWithTz(ev.dtend_dt,   ev.dtend_tzid,   ev.dtend_offsetMin);
  const link  = extractMeetingLink(ev);
  const teamsDetails = link?.label === 'Microsoft Teams' ? extractTeamsDetails(ev.description) : {};

  eventContent.innerHTML = `
    <h2>${esc(ev.summary || '(제목 없음)')}</h2>
    ${timeField('시작', start)}
    ${timeField('종료', end)}
    ${link ? meetingField(link, teamsDetails) : ''}
    ${ev.location  ? field('장소',  esc(ev.location))  : ''}
    ${ev.organizer ? field('주최자', esc(ev.organizer)) : ''}
    ${ev.description ? field('내용', `<span class="field-value description">${esc(ev.description)}</span>`, true) : ''}
  `;
}

function timeField(label, { original, tzLabel, local }) {
  return `<div class="field-row">
    <span class="field-label">${label}</span>
    <span class="field-value">
      <span class="time-original">${original}</span>
      ${tzLabel ? `<span class="time-tz">${esc(tzLabel)}</span>` : ''}
      ${local ? `<div class="time-local">→ ${local} (로컬)</div>` : ''}
    </span>
  </div>`;
}

function meetingField(link, { meetingId, passcode }) {
  const meta = [
    meetingId ? `<span><span class="meta-label">ID</span> ${esc(meetingId)}</span>` : '',
    passcode  ? `<span><span class="meta-label">PW</span> ${esc(passcode)}</span>`  : '',
  ].filter(Boolean).join('');

  return `<div class="field-row">
    <span class="field-label">접속</span>
    <span class="field-value">
      <div class="meeting-block">
        <div class="meeting-actions">
          <a class="meeting-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">
            ${link.icon} ${link.label}로 참가
          </a>
          <button class="copy-link-btn" onclick="copyMeetingLink('${esc(link.url)}', this)" title="링크 복사">복사</button>
        </div>
        ${meta ? `<div class="meeting-meta">${meta}</div>` : ''}
      </div>
    </span>
  </div>`;
}

function copyMeetingLink(url, btn) {
  navigator.clipboard.writeText(url).then(() => {
    const orig = btn.textContent;
    btn.textContent = '완료 ✓';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
  }).catch(() => {});
}

function field(label, value, raw = false) {
  return `<div class="field-row">
    <span class="field-label">${label}</span>
    ${raw ? value : `<span class="field-value">${value}</span>`}
  </div>`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

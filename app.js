'use strict';

/* ================= DOM ================= */
const $ = id => document.getElementById(id);
const app        = $('app');
const speedEl    = $('speed');
const unitLabelEl= $('unitLabel');
const unitBtn    = $('unitBtn');
const rotateBtn  = $('rotateBtn');
const themeBtn   = $('themeBtn');
const themeSw    = $('themeSw');
const gradStop1  = $('g1');
const gradStop2  = $('g2');
const gpsDot     = $('gpsDot');
const gpsText    = $('gpsText');
const maxVal     = $('maxVal');
const avgVal     = $('avgVal');
const distVal    = $('distVal');
const distLabel  = $('distLabel');
const timeVal    = $('timeVal');
const startBtn   = $('startBtn');
const resetBtn   = $('resetBtn');
const demoBtn    = $('demoBtn');
const accelBtn   = $('accelBtn');
const accelPanel = $('accelPanel');
const accelStateEl = $('accelState');
const accelList  = $('accelList');
const track      = $('track');
const segTrack   = $('segTrack');
const segColor   = $('segColor');
const glowArc    = $('glowArc');
const maskArc    = $('maskArc');
const needle     = $('needle');
const gaugeEl    = $('gauge');
const ticksG     = $('ticks');
const tipDot     = $('tipDot');
const tipHalo    = $('tipHalo');
const glowEl     = document.querySelector('.bg-glow');

/* ================= Геометрия шкалы ================= */
const SCALES = [60, 90, 120, 180, 240, 300, 380];
const NS = 'http://www.w3.org/2000/svg';
const rad = d => d * Math.PI / 180;

/* Шкала зависит от режима:
   portrait  — полное кольцо, цифры внутри;
   landscape — дуга 240° рядом с цифрами.
   Стиль — «ребристая» лента сегментов + игла, как в цифровых приборках. */
let GEOM = null;
function makeGeom(mode) {
  if (mode === 'portrait') {
    const R = 130, CX = 160, CY = 160;
    const at = p => 270 - 360 * p;          // старт снизу, дальше по часовой
    const polar = (r, p) => ({ x: CX + r * Math.cos(rad(at(p))), y: CY - r * Math.sin(rad(at(p))) });
    return {
      vb: '0 0 320 320',
      len: 2 * Math.PI * R,
      R, cx: CX, cy: CY, at, polar,
      band: 26, ribs: '4.8 6.2',
      nIn: R - 17, nOut: R + 5,
      d: `M ${CX} ${CY + R} A ${R} ${R} 0 1 1 ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX} ${CY + R}`,
      pt: p => polar(R, p),
    };
  }
  const R = 120, CX = 160, CY = 150, A0 = 210, A1 = -30, SW = 240;
  const at = p => A0 - SW * p;
  const polar = (r, p) => ({ x: CX + r * Math.cos(rad(at(p))), y: CY - r * Math.sin(rad(at(p))) });
  const s = polar(R, 0), e = polar(R, 1);
  return {
    vb: '0 0 320 228',
    len: 2 * Math.PI * R * SW / 360,
    R, cx: CX, cy: CY, at, polar,
    band: 24, ribs: '4.6 6.3',
    nIn: R - 16, nOut: R + 6,
    d: `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${R} ${R} 0 1 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`,
    pt: p => polar(R, p),
  };
}

/* ================= Состояние ================= */
const S = {
  mode: 'portrait',
  running: false,
  demo: false,
  unit: localStorage.getItem('spd.unit') || 'kmh',
  target: 0,            // м/с — цель анимации
  shown: 0,             // м/с — отображаемое
  rawBuf: [],
  max: 0,               // м/с
  distKm: 0,
  moveSec: 0,
  totalSec: 0,
  lastPos: null,
  watchId: null,
  clockId: null,
  scale: 120,
  wakeLock: null,
  override: null,        // ручной выбор раскладки: 'portrait' | 'landscape' | null
  theme: parseInt(localStorage.getItem('spd.theme') || '0', 10) || 0,
};

/* ================= Утилиты ================= */
const clamp   = (v, a, b) => Math.min(b, Math.max(a, v));
const toUnit  = ms => S.unit === 'kmh' ? ms * 3.6 : ms * 2.23693629;
const unitTxt = () => S.unit === 'kmh' ? 'км/ч' : 'ми/ч';
const distTxt = () => S.unit === 'kmh' ? 'дист, км' : 'дист, ми';
const distConv= km => S.unit === 'kmh' ? km : km * 0.6213712;

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor(sec % 3600 / 60);
  const s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return h ? `${h}:${mm}:${String(s).padStart(2,'0')}` : `${mm}:${String(s).padStart(2,'0')}`;
}

function haversineKm(aLat, aLon, bLat, bLon) {
  const RR = 6371;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 +
            Math.cos(rad(aLat)) * Math.cos(rad(bLat)) *
            Math.sin(rad(bLon - aLon) / 2) ** 2;
  return 2 * RR * Math.asin(Math.sqrt(h));
}

function setStatus(text, lvl) {
  gpsText.textContent = text;
  gpsDot.className = 'dot ' + lvl;
}

/* ================= Шкала ================= */
function buildTicks() {
  ticksG.textContent = '';
  const frag = document.createDocumentFragment();

  if (S.mode === 'portrait') {
    /* кольцо: минималистичные риски без подписей — цифра в центре */
    for (let i = 0; i < 12; i++) {
      const isMajor = i % 2 === 0;
      const m = rad(270 - 360 * i / 12);
      const c = Math.cos(m), sn = Math.sin(m);
      const r1 = 113, r2 = isMajor ? 103 : 107.5;
      const ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', (160 + r1 * c).toFixed(1)); ln.setAttribute('y1', (160 - r1 * sn).toFixed(1));
      ln.setAttribute('x2', (160 + r2 * c).toFixed(1)); ln.setAttribute('y2', (160 - r2 * sn).toFixed(1));
      ln.setAttribute('stroke', isMajor ? '#39424f' : '#232a34');
      ln.setAttribute('stroke-width', isMajor ? 1.8 : 1.1);
      ln.setAttribute('stroke-linecap', 'round');
      frag.appendChild(ln);
    }
  } else {
    /* дуга 240°: риски + подписи значений */
    const STEPS = 12;
    for (let i = 0; i <= STEPS; i++) {
      const isMajor = i % 2 === 0;
      const m = rad(210 - 240 * i / STEPS);
      const c = Math.cos(m), sn = Math.sin(m);
      const r1 = 104, r2 = isMajor ? 94 : 98.5;
      const ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', (160 + r1 * c).toFixed(1)); ln.setAttribute('y1', (150 - r1 * sn).toFixed(1));
      ln.setAttribute('x2', (160 + r2 * c).toFixed(1)); ln.setAttribute('y2', (150 - r2 * sn).toFixed(1));
      ln.setAttribute('stroke', isMajor ? '#39424f' : '#232a34');
      ln.setAttribute('stroke-width', isMajor ? 2 : 1.2);
      ln.setAttribute('stroke-linecap', 'round');
      frag.appendChild(ln);

      if (isMajor) {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', (160 + 80 * c).toFixed(1));
        t.setAttribute('y', (150 - 80 * sn).toFixed(1));
        t.setAttribute('fill', '#59636f');
        t.setAttribute('font-size', '11');
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('dominant-baseline', 'middle');
        t.textContent = String(Math.round(S.scale * i / STEPS));
        frag.appendChild(t);
      }
    }
  }
  ticksG.appendChild(frag);
}

function rebuildGauge() {
  GEOM = makeGeom(S.mode);
  gaugeEl.setAttribute('viewBox', GEOM.vb);
  for (const el of [track, segTrack, segColor, glowArc, maskArc]) el.setAttribute('d', GEOM.d);
  segTrack.setAttribute('stroke-width', GEOM.band);
  segTrack.setAttribute('stroke-dasharray', GEOM.ribs);
  segColor.setAttribute('stroke-width', GEOM.band);
  segColor.setAttribute('stroke-dasharray', GEOM.ribs);
  glowArc.setAttribute('stroke-width', GEOM.band + 8);
  maskArc.setAttribute('stroke-width', GEOM.band + 6);
  GEOM.dash = GEOM.len + 40;
  maskArc.setAttribute('stroke-dasharray', GEOM.dash.toFixed(1));
  needle.setAttribute('stroke-width', S.mode === 'portrait' ? 3 : 3.5);
  tipHalo.setAttribute('r', S.mode === 'portrait' ? 9 : 12);
  buildTicks();
}

function ensureScale() {
  const need = toUnit(S.max) * 1.06;
  const next = SCALES.find(s => s >= Math.max(need, 120)) || SCALES[SCALES.length - 1];
  if (next !== S.scale) { S.scale = next; buildTicks(); }
}

/* ================= Одометр (перекат цифр) ================= */
/* Барабан из 3 циклов 0–9: всегда ближайший поворот,
   после анимации позиция нормализуется в средний цикл. */
const REEL = '012345678901234567890123456789'.split('');
let reels = [];

function buildOdometer(str) {
  speedEl.textContent = '';
  reels = [];
  for (let i = 0; i < str.length; i++) {
    const col = document.createElement('span');
    col.className = 'odo-digit';
    const reel = document.createElement('span');
    reel.className = 'odo-reel';
    for (const dg of REEL) {
      const cell = document.createElement('span');
      cell.textContent = dg;
      reel.appendChild(cell);
    }
    col.appendChild(reel);
    speedEl.appendChild(col);
    reel.addEventListener('transitionend', () => normReel(reel));
    const d = +str[i] + 10;
    reel._idx = d;
    reel.style.transform = `translateY(${-d}em)`;
    reels.push(reel);
  }
}

function normReel(reel) {
  const d = ((reel._idx % 10) + 10) % 10 + 10;  // средний цикл
  if (d === reel._idx) return;
  reel.style.transition = 'none';
  reel._idx = d;
  reel.style.transform = `translateY(${-d}em)`;
  void reel.offsetWidth;
  reel.style.transition = '';
}

function setOdometer(str) {
  if (reels.length !== str.length) { buildOdometer(str); return; }
  for (let i = 0; i < str.length; i++) {
    const reel = reels[i];
    const cur = reel._idx;
    const d = +str[i];
    let best = d + 10;
    for (const c of [d, d + 10, d + 20]) {
      if (Math.abs(c - cur) < Math.abs(best - cur)) best = c;
    }
    if (best !== cur) {
      reel._idx = best;
      reel.style.transform = `translateY(${-best}em)`;
    }
  }
}

/* ================= Рендер ================= */
let lastTxt = '';
function render() {
  const vU = toUnit(S.shown);
  const p = clamp(vU / S.scale, 0, 1);

  /* маска открывает «зажжённую» часть ленты сегментов */
  maskArc.style.strokeDashoffset = (GEOM.dash - GEOM.len * p).toFixed(1);

  const pt = GEOM.pt(p);
  tipDot.setAttribute('cx', pt.x.toFixed(1));
  tipDot.setAttribute('cy', pt.y.toFixed(1));
  tipHalo.setAttribute('cx', pt.x.toFixed(1));
  tipHalo.setAttribute('cy', pt.y.toFixed(1));

  /* игла-указатель */
  const n1 = GEOM.polar(GEOM.nIn, p), n2 = GEOM.polar(GEOM.nOut, p);
  needle.setAttribute('x1', n1.x.toFixed(1));
  needle.setAttribute('y1', n1.y.toFixed(1));
  needle.setAttribute('x2', n2.x.toFixed(1));
  needle.setAttribute('y2', n2.y.toFixed(1));

  const txt = String(vU < 1 ? 0 : Math.round(vU));
  if (txt !== lastTxt) { setOdometer(txt); lastTxt = txt; }

  glowEl.style.opacity = (0.14 + p * 0.34).toFixed(3);
}

let lastF = performance.now();
function frame(t) {
  const dt = Math.min(0.06, (t - lastF) / 1000) || 0.016;
  lastF = t;
  const rate = S.target > S.shown ? 3.4 : 5.2;   // торможение резче разгона
  S.shown += (S.target - S.shown) * Math.min(1, dt * rate);
  if (Math.abs(S.shown - S.target) < 0.01) S.shown = S.target;
  render();
  requestAnimationFrame(frame);
}

function renderStats() {
  maxVal.textContent  = String(Math.round(toUnit(S.max)));
  avgVal.textContent  = S.moveSec > 2 ? String(Math.round(distConv(S.distKm) / (S.moveSec / 3600))) : '0';
  distVal.textContent = distConv(S.distKm).toFixed(1);
  timeVal.textContent = fmtTime(S.totalSec);
}

/* ================= Приём скорости ================= */
function ingestSpeed(vMS, direct) {
  accelTick(vMS);
  if (!direct) {
    S.rawBuf.push(vMS);
    if (S.rawBuf.length > 3) S.rawBuf.shift();
    if (S.rawBuf.length === 3) {
      const s = [...S.rawBuf].sort((a, b) => a - b);
      S.target = s[1];
    } else {
      S.target = vMS;
    }
  } else {
    S.target = vMS;
  }
  if (S.target > S.max) { S.max = S.target; ensureScale(); }
}

/* ================= Секундомер ================= */
function startClock() {
  if (S.clockId) return;
  S.clockId = setInterval(() => {
    S.totalSec += 0.5;
    if (toUnit(S.target) > 1) S.moveSec += 0.5;
    renderStats();
  }, 500);
}
function stopClock() {
  clearInterval(S.clockId);
  S.clockId = null;
}

/* ================= GPS ================= */
function onPos(pos) {
  if (S.lastPos && pos.timestamp <= S.lastPos.t) return;

  const { latitude: lat, longitude: lon, speed, accuracy } = pos.coords;
  let vMS = (typeof speed === 'number' && isFinite(speed) && speed >= 0) ? speed : null;
  let dKm = 0;

  if (S.lastPos) {
    const dt = (pos.timestamp - S.lastPos.t) / 1000;
    dKm = haversineKm(S.lastPos.lat, S.lastPos.lon, lat, lon);
    if (dt > 0 && dKm / dt > 0.12) dKm = 0;               // защита от «телепортов» GPS (>432 км/ч)
    if (vMS == null && dt > 0.2) vMS = (dKm * 1000) / dt; // запасной расчёт скорости
  }
  S.lastPos = { lat, lon, t: pos.timestamp };

  // статус по точности
  if (accuracy != null) {
    S.locatingDone = true;
    if (accuracy <= 25) setStatus(`±${Math.round(accuracy)} м`, 'ok');
    else if (accuracy <= 60) setStatus(`±${Math.round(accuracy)} м`, 'warn');
    else setStatus(`±${Math.round(accuracy)} м — слабый сигнал`, 'bad');
  }

  // глушение дрожания на стоянке
  if (accuracy != null && accuracy > 20 && vMS != null && vMS * 3.6 < 5) vMS = 0;
  if (vMS == null) return;

  ingestSpeed(vMS, false);
  if (accuracy == null || accuracy <= 30) S.distKm += dKm;
}

function onGeoErr(err) {
  if (err.code === 1) {
    setStatus('Нет доступа к геопозиции', 'bad');
    setRunning(false);
    alert('Разрешите доступ к геопозиции: Настройки → Конфиденциальность → Службы геолокации → Сайты Safari.');
  } else if (err.code === 2) {
    setStatus('Позиция недоступна', 'warn');
  } else {
    setStatus('Таймаут GPS, ищем…', 'warn');
  }
}

function startGPS() {
  if (!window.isSecureContext) { setStatus('Нужен HTTPS', 'bad'); return false; }
  if (!('geolocation' in navigator)) { setStatus('GPS не поддерживается', 'bad'); return false; }
  S.watchId = navigator.geolocation.watchPosition(onPos, onGeoErr, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15000,
  });
  return true;
}
function stopGPS() {
  if (S.watchId != null) navigator.geolocation.clearWatch(S.watchId);
  S.watchId = null;
}

/* ================= Wake Lock ================= */
async function lockScreen() {
  try { if ('wakeLock' in navigator) S.wakeLock = await navigator.wakeLock.request('screen'); }
  catch (e) { /* не поддерживается — не страшно */ }
}
function releaseLock() {
  try { S.wakeLock && S.wakeLock.release(); } catch (e) {}
  S.wakeLock = null;
}

/* ================= Старт / стоп ================= */
function setRunning(on) {
  if (on) {
    if (!startGPS()) return;
    S.running = true;
    setStatus('Поиск GPS…', 'locating');
    startBtn.textContent = 'Стоп';
    startBtn.classList.add('stop');
    demoBtn.disabled = true;
    startClock();
    lockScreen();
  } else {
    S.running = false;
    stopGPS();
    stopClock();
    releaseLock();
    setStatus('GPS выкл', 'off');
    startBtn.textContent = 'Старт';
    startBtn.classList.remove('stop');
    demoBtn.disabled = false;
    S.target = 0;
    S.rawBuf.length = 0;
    S.lastPos = null;
    A.state = 'waiting';
    updateAccelUI();
  }
}

/* ================= Демо ================= */
let demoInt = null, demoT = 0;
function setDemo(on) {
  S.demo = on;
  demoBtn.classList.toggle('active', on);
  demoBtn.textContent = on ? 'Демо ✓' : 'Демо';
  if (on) {
    startBtn.disabled = true;
    setStatus('Демо-режим', 'demo');
    startClock();
    demoT = 0;
    demoInt = setInterval(() => {
      demoT += 0.09;
      const v = Math.max(0,
        58 + 55 * Math.sin(demoT * 0.11)
           + 30 * Math.sin(demoT * 0.031 + 1.7)
           + 12 * Math.sin(demoT * 0.53));
      ingestSpeed(v / 3.6, true);
      S.distKm += v * (0.09 / 3600);
    }, 90);
  } else {
    clearInterval(demoInt);
    demoInt = null;
    startBtn.disabled = false;
    stopClock();
    setStatus(S.running ? 'Поиск GPS…' : 'GPS выкл', S.running ? 'locating' : 'off');
    S.target = 0;
    A.state = 'waiting';
    updateAccelUI();
  }
}

/* ================= Разгон 0–100 ================= */
const MARKS = [30, 50, 60, 70, 80, 90, 100];
const A = { state: 'waiting', t0: 0, results: {}, prevV: null, prevT: 0, rowEls: {} };
const ACCEL_STATE_TXT = { waiting: 'для замера остановитесь', armed: 'к старту готов', running: 'замер…' };

function buildAccelPanel() {
  accelList.textContent = '';
  for (const m of MARKS) {
    const row = document.createElement('div');
    row.className = 'accelRow';
    const mark = document.createElement('span');
    mark.className = 'aMark';
    mark.textContent = `0–${m}`;
    const time = document.createElement('span');
    time.className = 'aTime';
    time.textContent = '—';
    row.append(mark, time);
    accelList.appendChild(row);
    A.rowEls[m] = time;
  }
}

function updateAccelUI(flashMark) {
  accelStateEl.textContent = ACCEL_STATE_TXT[A.state];
  for (const m of MARKS) {
    const el = A.rowEls[m];
    if (!el) continue;
    const v = A.results[m];
    const txt = v != null ? v.toFixed(1) + ' с' : '—';
    if (el.textContent !== txt) {
      el.textContent = txt;
      if (flashMark === m) {
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
      }
    }
  }
}

/* вызывается на каждом сэмпле скорости (GPS ~1 Гц, демо ~11 Гц) */
function accelTick(vMS) {
  if (!S.running && !S.demo) { A.prevV = null; return; }
  const now = performance.now();
  const v = vMS * 3.6;                       // замеры всегда в км/ч
  const prevV = A.prevV, prevT = A.prevT;
  A.prevV = v; A.prevT = now;

  if (A.state === 'waiting') {
    if (v < 1) { A.state = 'armed'; updateAccelUI(); }
    return;
  }
  if (A.state === 'armed') {
    if (v > 1.5) {
      A.state = 'running';
      A.results = {};
      // момент трогания — интерполяция по сэмплам
      let t0 = now;
      if (prevV != null && v > prevV) t0 = prevT + (1 - prevV) / (v - prevV) * (now - prevT);
      A.t0 = t0;
      updateAccelUI();
    }
    return;
  }
  // running
  if (v < 1) {                               // остановились: заезд окончен, результаты остаются
    A.state = 'waiting';
    updateAccelUI();
    return;
  }
  for (const m of MARKS) {
    if (A.results[m] != null) continue;
    if (v >= m) {
      let tc = now;                          // пересечение отметки — с интерполяцией
      if (prevV != null && prevV < m && v > prevV) tc = prevT + (m - prevV) / (v - prevV) * (now - prevT);
      A.results[m] = Math.max(0, (tc - A.t0) / 1000);
      updateAccelUI(m);
    }
  }
}

function resetAccel() {
  A.state = 'waiting';
  A.results = {};
  A.prevV = null;
  updateAccelUI();
}

accelBtn.addEventListener('click', () => {
  const open = !accelPanel.classList.contains('open');
  accelPanel.classList.toggle('open', open);
  accelBtn.classList.toggle('active', open);
  accelPanel.setAttribute('aria-hidden', String(!open));
});
accelPanel.addEventListener('click', e => {
  if (e.target === accelPanel) {
    accelPanel.classList.remove('open');
    accelBtn.classList.remove('active');
    accelPanel.setAttribute('aria-hidden', 'true');
  }
});

/* ================= Сброс ================= */
function resetAll() {
  S.max = 0; S.distKm = 0; S.moveSec = 0; S.totalSec = 0;
  S.target = 0; S.rawBuf.length = 0;
  S.scale = 120; buildTicks();
  resetAccel();
  renderStats();
}

/* ================= Цветовые темы (как режимы приборки) ================= */
const THEMES = [
  { c1: '#35f2c0', c2: '#39a0ff', rgb1: '53,242,192',  rgb2: '57,160,255'  },  // мята → голубой
  { c1: '#ffb03a', c2: '#ff5e3a', rgb1: '255,176,58',  rgb2: '255,94,58'   },  // янтарь (спорт)
  { c1: '#39c6ff', c2: '#2f6bff', rgb1: '57,198,255',  rgb2: '47,107,255'  },  // синий лёд
  { c1: '#7dffa8', c2: '#12c98e', rgb1: '125,255,168', rgb2: '18,201,142'  },  // эко-зелёный
  { c1: '#c86bff', c2: '#6a3bff', rgb1: '200,107,255', rgb2: '106,59,255'  },  // фиолет
];

function applyTheme(i) {
  S.theme = ((i % THEMES.length) + THEMES.length) % THEMES.length;
  const t = THEMES[S.theme];
  const rs = document.documentElement.style;
  rs.setProperty('--accent', t.c1);
  rs.setProperty('--accent2', t.c2);
  rs.setProperty('--rgb1', t.rgb1);
  rs.setProperty('--rgb2', t.rgb2);
  gradStop1.setAttribute('stop-color', t.c1);
  gradStop2.setAttribute('stop-color', t.c2);
  themeSw.style.background = `linear-gradient(135deg, ${t.c1}, ${t.c2})`;
  localStorage.setItem('spd.theme', S.theme);
}
themeBtn.addEventListener('click', () => applyTheme(S.theme + 1));

/* ================= Единицы ================= */
function updateUnitUI() {
  unitBtn.textContent = unitTxt();
  unitLabelEl.textContent = unitTxt();
  distLabel.textContent = distTxt();
}
unitBtn.addEventListener('click', () => {
  S.unit = S.unit === 'kmh' ? 'mph' : 'kmh';
  localStorage.setItem('spd.unit', S.unit);
  updateUnitUI();
  renderStats();
  ensureScale();
});

/* ================= Кнопки ================= */
startBtn.addEventListener('click', () => setRunning(!S.running));
resetBtn.addEventListener('click', resetAll);
demoBtn.addEventListener('click', () => setDemo(!S.demo));

/* ================= Ориентация ================= */
const mq = window.matchMedia('(orientation: portrait)');
const currentMode = () => (mq.matches ? 'portrait' : 'landscape');

let rotTimer = null, rotToken = 0;
function onRotate() {
  clearTimeout(rotTimer);
  const token = ++rotToken;
  rotTimer = setTimeout(() => {
    if (token !== rotToken) return;
    S.override = null;                 // реальный поворот снимает ручной режим
    const mode = currentMode();
    if (mode === S.mode) { updateRotateBtn(); return; }
    transitionTo(mode);
  }, 80);
}

function updateRotateBtn() {
  rotateBtn.classList.toggle('active', S.override != null);
}

/* кнопка ручного переключения раскладки (для демо) */
rotateBtn.addEventListener('click', () => {
  const next = S.mode === 'portrait' ? 'landscape' : 'portrait';
  S.override = next;
  transitionTo(next);
});

let transitioning = false;
function transitionTo(mode) {
  if (transitioning) return;
  transitioning = true;
  S.mode = mode;
  updateRotateBtn();
  app.classList.add('exiting');
  setTimeout(() => {
    app.classList.remove('portrait', 'landscape');
    app.classList.add(mode);
    rebuildGauge();                    // кольцо ⇄ дуга
    app.classList.remove('exiting');
    app.classList.add('entering');
    // два кадра — чтобы «входящая» поза применилась без перехода,
    // затем базовый transition плавно вернул всё на место
    requestAnimationFrame(() => requestAnimationFrame(() => {
      app.classList.remove('entering');
      transitioning = false;
    }));
  }, 260);
}

if (mq.addEventListener) mq.addEventListener('change', onRotate);
else if (mq.addListener) mq.addListener(onRotate);
window.addEventListener('orientationchange', onRotate);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.running) lockScreen();
});

/* ================= Инициализация ================= */
(function init() {
  app.classList.remove('portrait');
  S.mode = currentMode();
  app.classList.add(S.mode);

  rebuildGauge();
  buildAccelPanel();
  updateAccelUI();
  applyTheme(S.theme);
  updateUnitUI();
  renderStats();
  render();
  requestAnimationFrame(frame);
})();

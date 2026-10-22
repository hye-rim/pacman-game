'use strict';

// 팩맨: 화면·입력·소리. 규칙(미로·팩맨·유령·모드·점수·목숨·레벨)은 logic.js (LOGIC_PACMAN) 에 있고,
// 여기서는 규칙이 남긴 st.events 를 보고 소리·점수 글씨·안내창을 만든다.
const L = LOGIC_PACMAN;
const { MAZE, COLS, ROWS, T, W, H, DX, DY, DOOR_X, FRUIT_X, FRUIT_Y, fruitFor } = L;

// ---------- Canvas ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const hudH = 52;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - hudH) / H);
  const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  $('col').style.width = cssW + 'px';
}
addEventListener('resize', fit);

// ---------- Storage ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- Sound ----------
let audio = null;
let muted = store.get('pacmanMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const melody = (notes, step, type = 'square', vol = 0.05) =>
  notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step));
let waka = false;
const sfx = {
  dot: () => { waka = !waka; tone(waka ? 250 : 330, 0.07, 'triangle', 0.08, waka ? 120 : -120); },
  power: () => tone(180, 0.35, 'sawtooth', 0.06, 400),
  ghost: () => tone(200, 0.4, 'square', 0.06, 1200),
  fruit: () => melody([660, 880, 1100], 70, 'sine', 0.1),
  life: () => melody([1047, 1319, 1568, 2093], 90, 'square', 0.05),
  start: () => melody([494, 988, 740, 622, 988, 740, 622, 523, 1047, 784, 659, 1047, 784, 659], 130),
  death: () => { for (let i = 0; i < 10; i++) setTimeout(() => tone(800 - i * 60, 0.12, 'square', 0.05, -200), i * 110); },
  clear: () => melody([523, 659, 784, 1047], 110),
};

// 벽 그리기용 경로: 이웃한 벽 타일 중심끼리 선을 긋고, 2x2 벽 덩어리는 면으로 채운다.
// 굵은 파란 선 위에 조금 가는 검은 선을 덧그리면 원작 같은 테두리 벽이 된다.
const isWall = (c, r) => r >= 0 && r < ROWS && c >= 0 && c < COLS && MAZE[r][c] === '#';
const wallSegs = new Path2D(), wallFill = new Path2D();
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (!isWall(c, r)) continue;
    const x = (c + 0.5) * T, y = (r + 0.5) * T;
    if (isWall(c + 1, r)) { wallSegs.moveTo(x, y); wallSegs.lineTo(x + T, y); }
    if (isWall(c, r + 1)) { wallSegs.moveTo(x, y); wallSegs.lineTo(x, y + T); }
    if (isWall(c + 1, r) && isWall(c, r + 1) && isWall(c + 1, r + 1)) wallFill.rect(x, y, T, T);
  }
}

// ---------- State ----------
let state = 'title';               // title · ready · play · dying · clear · over · paused (게임 중에는 규칙의 st.phase 를 따른다)
let pausedFrom = null;
let best = Number(store.get('pacmanBest')) || 0;
let G = L.newGame();               // 타이틀 화면 뒤에 깔아둘 판
G.events.length = 0;
let popups = [];
let t0 = 0;                        // 애니메이션용 시계

function startGame() {
  G = L.newGame();
  popups = [];
  state = G.phase;
  handleEvents();
  hideOverlay();
  updateHud();
}

function updateHud() {
  $('score').textContent = G.score;
  $('levelNo').textContent = G.level;
  if (G.score > best) { best = G.score; store.set('pacmanBest', String(best)); }
  $('best').textContent = best;
}

// 규칙이 남긴 일들 → 소리·점수 글씨·안내창
function handleEvents() {
  if (!G.events.length) return;
  for (const e of G.events.splice(0)) {
    if (e.type === 'ready') { if (e.jingle) sfx.start(); }
    else if (e.type === 'dot') sfx.dot();
    else if (e.type === 'power') sfx.power();
    else if (e.type === 'ghost') { popups.push({ x: e.x, y: e.y, text: String(e.pts), color: '#00ffff', t: 1 }); sfx.ghost(); }
    else if (e.type === 'fruit') { popups.push({ x: FRUIT_X, y: FRUIT_Y, text: String(e.pts), color: '#ffb8ff', t: 2 }); sfx.fruit(); }
    else if (e.type === 'life') sfx.life();
    else if (e.type === 'death') sfx.death();
    else if (e.type === 'clear') sfx.clear();
    else if (e.type === 'over') gameOver();
  }
  updateHud();
}

// ---------- Update ----------
function update(dt) {
  t0 += dt;
  popups = popups.filter((p) => (p.t -= dt) > 0);
  if (state === 'title' || state === 'over' || state === 'paused') return;
  L.update(G, dt);
  state = G.phase;
  handleEvents();
}

function gameOver() {
  state = 'over';
  updateHud();
  showOverlay(`
    <h2>GAME OVER</h2>
    <p class="big">${G.score.toLocaleString()} 점</p>
    <p>레벨 ${G.level} 까지 도달${G.score >= best && G.score > 0 ? '<br>🏆 최고 기록!' : ''}</p>
    <button id="startBtn">다시 하기</button>`);
}

// ---------- Drawing ----------
function drawMaze() {
  const flashing = state === 'clear' && G.phaseT > 1 && Math.floor((G.phaseT - 1) / 0.25) % 2 === 0;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle = flashing ? '#ffffff' : '#2121de';
  ctx.lineWidth = T * 0.55;
  ctx.stroke(wallSegs);
  ctx.fill(wallFill);
  ctx.strokeStyle = ctx.fillStyle = '#000';
  ctx.lineWidth = T * 0.55 - 4;
  ctx.stroke(wallSegs);
  ctx.fill(wallFill);
  // 유령 집 문
  ctx.fillStyle = '#ffb8ff';
  ctx.fillRect(13 * T, 12.5 * T - 2, 2 * T, 4);
}

function drawDots() {
  ctx.fillStyle = '#ffb8ae';
  const blink = state !== 'play' || Math.floor(t0 * 4) % 2 === 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = G.map[r][c];
      const x = (c + 0.5) * T, y = (r + 0.5) * T;
      if (ch === '.') ctx.fillRect(x - 2, y - 2, 4, 4);
      else if (ch === 'o' && blink) {
        ctx.beginPath();
        ctx.arc(x, y, T * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

const FACING = [-Math.PI / 2, Math.PI, Math.PI / 2, 0];
function drawPacAt(x, y, dir, mouth, r = T * 0.8) {
  const a = FACING[dir];
  ctx.fillStyle = '#ffe600';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r, a + mouth, a + Math.PI * 2 - mouth);
  ctx.closePath();
  ctx.fill();
}

function drawPac() {
  if (state === 'dying') {
    if (G.phaseT < 0.8) return drawPacAt(G.pac.x, G.pac.y, G.pac.dir, 0.2);
    const k = (G.phaseT - 0.8) / 1.5;
    if (k < 1) {
      // 위를 보고 입이 점점 벌어지며 사라진다
      const m = 0.05 + k * Math.PI;
      ctx.fillStyle = '#ffe600';
      ctx.beginPath();
      ctx.moveTo(G.pac.x, G.pac.y);
      ctx.arc(G.pac.x, G.pac.y, T * 0.8, -Math.PI / 2 + m, Math.PI * 1.5 - m);
      ctx.closePath();
      ctx.fill();
    } else if (k < 1.3) {
      ctx.strokeStyle = '#ffe600';
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(G.pac.x + Math.cos(a) * 5, G.pac.y + Math.sin(a) * 5);
        ctx.lineTo(G.pac.x + Math.cos(a) * 11, G.pac.y + Math.sin(a) * 11);
        ctx.stroke();
      }
    }
    return;
  }
  if (G.freezeT > 0) return;          // 유령을 먹은 순간에는 점수만 보인다
  const mouth = state === 'ready' ? 0 : (0.04 + 0.22 * Math.abs(Math.sin(G.pac.anim))) * Math.PI;
  drawPacAt(G.pac.x, G.pac.y, G.pac.dir, mouth);
  // 터널 끝에서 반대편에 걸친 부분
  if (G.pac.x < T) drawPacAt(G.pac.x + W, G.pac.y, G.pac.dir, mouth);
  if (G.pac.x > W - T) drawPacAt(G.pac.x - W, G.pac.y, G.pac.dir, mouth);
}

function drawGhost(g) {
  const x = g.x, y = g.y, r = T * 0.82;
  const eyesOnly = g.state === 'eyes' || g.state === 'enter';
  if (!eyesOnly) {
    let body = g.color;
    const flash = g.fright && G.frightT < 2 && Math.floor(G.frightT * 5) % 2 === 0;
    if (g.fright) body = flash ? '#f0f0ff' : '#2121ff';
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, y - r * 0.15, r, Math.PI, 0);
    const bottom = y + r * 0.9;
    ctx.lineTo(x + r, bottom);
    // 치맛자락 물결
    const waves = 4, wobble = Math.floor(t0 * 8) % 2 ? 0.5 : 0;
    for (let i = 0; i < waves; i++) {
      const x1 = x + r - ((i + 0.5 + wobble / 2) / waves) * 2 * r;
      const x2 = x + r - ((i + 1) / waves) * 2 * r;
      ctx.lineTo(x1, bottom - r * 0.3);
      ctx.lineTo(x2, bottom);
    }
    ctx.closePath();
    ctx.fill();
    if (g.fright) {
      const face = flash ? '#ff2020' : '#ffb8ae';
      ctx.fillStyle = face;
      ctx.fillRect(x - r * 0.4 - 2, y - r * 0.35, 4, 4);
      ctx.fillRect(x + r * 0.4 - 2, y - r * 0.35, 4, 4);
      ctx.strokeStyle = face;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const mx = x - r * 0.6 + (i / 6) * r * 1.2;
        const my = y + r * 0.3 + (i % 2 ? -2 : 2);
        i ? ctx.lineTo(mx, my) : ctx.moveTo(mx, my);
      }
      ctx.stroke();
      return;
    }
  }
  const ex = DX[g.dir] * r * 0.18, ey = DY[g.dir] * r * 0.18;
  for (const s of [-1, 1]) {
    const cx = x + s * r * 0.38 + ex, cy = y - r * 0.25 + ey;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.28, r * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2121de';
    ctx.beginPath();
    ctx.arc(cx + DX[g.dir] * r * 0.13, cy + DY[g.dir] * r * 0.16, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBottom() {
  const y = (ROWS + 1) * T;
  for (let i = 0; i < Math.min(G.lives - (state === 'title' || state === 'over' ? 0 : 1), 6); i++) {
    drawPacAt((2 + i * 2) * T, y, 1, 0.22 * Math.PI, T * 0.7);
  }
  ctx.font = `${T * 1.3}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < Math.min(G.level, 7); i++) {
    ctx.fillText(fruitFor(G.level - i).emoji, W - (2 + i * 2) * T, y);
  }
}

function drawText(text, color, row = 17) {
  ctx.font = `bold ${T * 1.05}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, DOOR_X, (row + 0.5) * T);
}

function draw() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  drawMaze();
  drawDots();

  if (G.fruit && state === 'play') {
    ctx.font = `${T * 1.4}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fruitFor(G.level).emoji, FRUIT_X, FRUIT_Y);
  }

  const showGhosts = state !== 'clear' && !(state === 'dying' && G.phaseT >= 0.8) && state !== 'over';
  if (showGhosts) for (const g of G.ghosts) drawGhost(g);
  if (state !== 'over') drawPac();

  for (const p of popups) {
    ctx.font = `bold ${T * 0.8}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y);
  }

  if (state === 'ready') drawText('READY!', '#ffe600');
  if (state === 'over') drawText('GAME  OVER', '#ff2020');
  drawBottom();
}

let last = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  if (state !== 'paused') update(dt);
  draw();
  requestAnimationFrame(frame);
}

// ---------- Overlay ----------
function showOverlay(html) {
  const o = $('overlay');
  o.innerHTML = html;
  o.classList.remove('hidden');
  const btn = $('startBtn');
  if (btn) btn.onclick = onOverlayButton;
}
function hideOverlay() { $('overlay').classList.add('hidden'); }

function onOverlayButton() {
  if (state === 'paused') resume();
  else startGame();
}

function pause() {
  if (state !== 'play' && state !== 'ready') return;
  pausedFrom = state;
  state = 'paused';
  showOverlay(`<h2>일시정지</h2><button id="startBtn">계속하기</button>`);
}
function resume() {
  if (state !== 'paused') return;
  state = pausedFrom;
  hideOverlay();
}

// ---------- Input ----------
const KEY_DIR = {
  ArrowUp: 0, KeyW: 0, ArrowLeft: 1, KeyA: 1, ArrowDown: 2, KeyS: 2, ArrowRight: 3, KeyD: 3,
};
addEventListener('keydown', (e) => {
  if (e.code in KEY_DIR) {
    e.preventDefault();
    L.steer(G, KEY_DIR[e.code]);
    return;
  }
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    if (state === 'title' || state === 'over' || state === 'paused') onOverlayButton();
  }
  if (e.code === 'KeyP' || e.code === 'Escape') state === 'paused' ? resume() : pause();
  if (e.code === 'KeyM') toggleMute();
});

// 스와이프: 화면 어디서든 일정 거리 이상 밀면 그 방향으로. 손을 떼지 않고 계속 방향을 바꿀 수 있다.
let swipe = null;
const SWIPE_MIN = 18;
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  swipe = { x: e.clientX, y: e.clientY };
});
document.addEventListener('pointermove', (e) => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
  L.steer(G, Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 3) : (dy < 0 ? 0 : 2));
  swipe = { x: e.clientX, y: e.clientY };
});
const endSwipe = () => { swipe = null; };
document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', endSwipe);

addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function toggleMute() {
  muted = !muted;
  store.set('pacmanMuted', muted ? '1' : '0');
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('startBtn').onclick = onOverlayButton;
$('muteBtn').textContent = muted ? '🔇' : '🔊';

fit();
requestAnimationFrame(frame);

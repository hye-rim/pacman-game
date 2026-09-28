'use strict';

// ---------- Maze ----------
// 원작과 같은 28x31 미로. # 벽, . 점, o 파워 쿠키, - 유령 집 문, 공백 빈 길.
const MAZE = [
  '############################',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o####.#####.##.#####.####o#',
  '#.####.#####.##.#####.####.#',
  '#..........................#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##....##....##......#',
  '######.##### ## #####.######',
  '     #.##### ## #####.#     ',
  '     #.##          ##.#     ',
  '     #.## ###--### ##.#     ',
  '######.## #      # ##.######',
  '      .   #      #   .      ',
  '######.## #      # ##.######',
  '     #.## ######## ##.#     ',
  '     #.##          ##.#     ',
  '     #.## ######## ##.#     ',
  '######.## ######## ##.######',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#.####.#####.##.#####.####.#',
  '#o..##.......  .......##..o#',
  '###.##.##.########.##.##.###',
  '###.##.##.########.##.##.###',
  '#......##....##....##......#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#..........................#',
  '############################',
];
const COLS = 28, ROWS = 31;
const TUNNEL_ROW = 14;
const T = 16;                      // 타일 크기 (논리 픽셀)
const W = COLS * T;                // 448
const H = (ROWS + 2) * T;          // 아래 두 줄은 남은 목숨·과일 표시
const MAX_SPEED = 9;               // 100% 속도 = 초당 9타일

// 방향: 0 위, 1 왼쪽, 2 아래, 3 오른쪽. 원작 유령은 동점일 때 이 순서로 고른다.
const DX = [0, -1, 0, 1], DY = [-1, 0, 1, 0];
const opp = (d) => (d + 2) % 4;

// 유령 집 좌표 (픽셀)
const DOOR_X = 14 * T;             // 문 가운데 (13열과 14열 사이)
const OUT_Y = 11.5 * T;            // 문 바로 위 통로
const HOME_Y = 14.5 * T;           // 집 안 가운데
const FRUIT_X = 14 * T, FRUIT_Y = 17.5 * T;

const FRUITS = [
  { emoji: '🍒', pts: 100 }, { emoji: '🍓', pts: 300 }, { emoji: '🍊', pts: 500 }, { emoji: '🍊', pts: 500 },
  { emoji: '🍎', pts: 700 }, { emoji: '🍎', pts: 700 }, { emoji: '🍈', pts: 1000 }, { emoji: '🍈', pts: 1000 },
  { emoji: '🚀', pts: 2000 }, { emoji: '🚀', pts: 2000 }, { emoji: '🔔', pts: 3000 }, { emoji: '🔔', pts: 3000 },
  { emoji: '🔑', pts: 5000 },
];
const fruitFor = (lv) => FRUITS[Math.min(lv, FRUITS.length) - 1];

// 레벨별 속도 (MAX_SPEED 대비 비율)
function speeds(lv) {
  if (lv === 1) return { pac: 0.8, pacFr: 0.9, ghost: 0.75, tunnel: 0.4, fright: 0.5, elroy1: 0.8, elroy2: 0.85 };
  if (lv <= 4) return { pac: 0.9, pacFr: 0.95, ghost: 0.85, tunnel: 0.45, fright: 0.55, elroy1: 0.9, elroy2: 0.95 };
  return { pac: 1, pacFr: 1, ghost: 0.95, tunnel: 0.5, fright: 0.6, elroy1: 1, elroy2: 1.05 };
}
const FRIGHT_TIME = [6, 5, 4, 3, 2, 5, 2, 2, 1, 5, 2, 1, 1, 3, 1, 1, 1, 1];
const frightTime = (lv) => FRIGHT_TIME[Math.min(lv, FRIGHT_TIME.length) - 1];
// 흩어지기/쫓기 교대 시간 (초). 짝수 번째가 흩어지기.
const modeSchedule = (lv) => lv === 1 ? [7, 20, 7, 20, 5, 20, 5, Infinity] : [5, 20, 5, 20, 5, Infinity];
// 블링키가 빨라지는(엘로이) 남은 점 개수
const elroyDots = (lv) => (lv === 1 ? 20 : lv <= 4 ? 30 : 40);

// ---------- Canvas ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const hudH = 52;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - hudH) / H);
  const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
  const dpr = window.devicePixelRatio || 1;
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

// ---------- Maze helpers ----------
let map = [];                      // 현재 판 (점이 먹히면 공백으로 바뀜)
const wrapC = (c) => (c + COLS) % COLS;
function tileAt(c, r) {
  if (r < 0 || r >= ROWS) return '#';
  if (c < 0 || c >= COLS) return r === TUNNEL_ROW ? ' ' : '#';
  return map[r][c];
}
const walkable = (c, r) => { const t = tileAt(c, r); return t !== '#' && t !== '-'; };
const inTunnel = (e) => e.ty === TUNNEL_ROW && (e.tx <= 5 || e.tx >= 22);

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

// ---------- Actors ----------
// 미로 위 이동: (tx,ty) 타일 중심에서 dir 방향으로 p(0~1) 만큼 나아간 상태.
// 타일 중심(p=0)에 설 때마다 decide() 로 다음 방향을 정한다.
function mazePos(e) {
  e.x = (e.tx + DX[e.dir] * e.p + 0.5) * T;
  e.y = (e.ty + DY[e.dir] * e.p + 0.5) * T;
}
function moveMaze(e, dist, decide) {
  while (dist > 1e-9) {
    if (e.p === 0 && !decide(e)) break;
    const step = Math.min(dist, 1 - e.p);
    e.p += step;
    dist -= step;
    if (e.p >= 1 - 1e-9) {
      e.tx = wrapC(e.tx + DX[e.dir]);
      e.ty += DY[e.dir];
      e.p = 0;
    }
  }
  mazePos(e);
}
function reverse(e) {
  if (e.p > 0) {
    e.tx = wrapC(e.tx + DX[e.dir]);
    e.ty += DY[e.dir];
    e.p = 1 - e.p;
  }
  e.dir = opp(e.dir);
}
// 지금 가장 가까운 타일
function nearTile(e) {
  return e.p < 0.5 ? [e.tx, e.ty] : [wrapC(e.tx + DX[e.dir]), e.ty + DY[e.dir]];
}

const pac = { tx: 14, ty: 23, dir: 1, p: 0.5, want: 1, moving: true, anim: 0, x: 0, y: 0 };

const GHOSTS = [
  { name: 'blinky', color: '#ff2020', corner: [25, -3], homeX: DOOR_X },
  { name: 'pinky',  color: '#ffb8ff', corner: [2, -3],  homeX: DOOR_X },
  { name: 'inky',   color: '#00ffff', corner: [27, 34], homeX: 12 * T },
  { name: 'clyde',  color: '#ffb852', corner: [0, 34],  homeX: 16 * T },
];
const ghosts = GHOSTS.map((g) => ({ ...g }));
const ghost = (name) => ghosts.find((g) => g.name === name);

// ---------- State ----------
let state = 'title';               // title · ready · play · dying · clear · over · paused
let pausedFrom = null;
let stateT = 0;
let level = 1, score = 0, lives = 3, best = Number(store.get('pacmanBest')) || 0;
let dotsLeft = 0, dotsEaten = 0, dotCounter = 0, afterDeath = false, idleT = 0;
let frightT = 0, combo = 0;
let modeIdx = 0, modeT = 0;
let freezeT = 0;
let fruit = null;                  // { t } 화면에 과일이 떠 있는 동안
let popups = [];
let extraGiven = false;
let S = speeds(1);
let t0 = 0;                        // 애니메이션용 시계

const chasing = () => modeIdx % 2 === 1;

function loadLevel() {
  map = MAZE.map((row) => row.split(''));
  dotsLeft = 0;
  for (const row of map) for (const ch of row) if (ch === '.' || ch === 'o') dotsLeft++;
  dotsEaten = 0;
  afterDeath = false;
  S = speeds(level);
  resetActors();
  updateHud();
}

function resetActors() {
  Object.assign(pac, { tx: 14, ty: 23, dir: 1, p: 0.5, want: 1, moving: true, anim: 0 });
  mazePos(pac);
  for (const g of ghosts) {
    g.fright = false;
    g.bob = 1;
    if (g.name === 'blinky') {
      Object.assign(g, { state: 'maze', tx: 14, ty: 11, dir: 1, p: 0.5 });
      mazePos(g);
    } else {
      Object.assign(g, { state: 'house', x: g.homeX, y: HOME_Y, dir: g.name === 'pinky' ? 2 : 0 });
    }
  }
  modeIdx = 0;
  modeT = modeSchedule(level)[0];
  frightT = 0;
  combo = 0;
  freezeT = 0;
  fruit = null;
  idleT = 0;
  dotCounter = 0;
}

function startGame() {
  level = 1; score = 0; lives = 3; extraGiven = false;
  popups = [];
  loadLevel();
  toReady(true);
  hideOverlay();
}

function toReady(jingle) {
  state = 'ready';
  stateT = jingle ? 4.2 : 2;
  if (jingle) sfx.start();
}

function updateHud() {
  $('score').textContent = score;
  $('levelNo').textContent = level;
  if (score > best) { best = score; store.set('pacmanBest', String(best)); }
  $('best').textContent = best;
}

function addScore(n) {
  score += n;
  if (!extraGiven && score >= 10000) { extraGiven = true; lives++; sfx.life(); }
  updateHud();
}

// ---------- Pac-Man ----------
function pacDecide(e) {
  if (e.want !== null && walkable(e.tx + DX[e.want], e.ty + DY[e.want])) e.dir = e.want;
  e.moving = walkable(e.tx + DX[e.dir], e.ty + DY[e.dir]);
  return e.moving;
}

function updatePac(dt) {
  if (pac.want === opp(pac.dir) && pac.p > 0) reverse(pac);
  const bx = pac.x, by = pac.y;
  const speed = (frightT > 0 ? S.pacFr : S.pac) * MAX_SPEED;
  moveMaze(pac, speed * dt, pacDecide);
  if (pac.x !== bx || pac.y !== by) pac.anim += speed * dt * 2.2;

  const [c, r] = nearTile(pac);
  const ch = tileAt(c, r);
  if (ch === '.' || ch === 'o') {
    map[r][c] = ' ';
    dotsLeft--; dotsEaten++; dotCounter++;
    idleT = 0;
    if (ch === '.') { addScore(10); sfx.dot(); }
    else { addScore(50); sfx.power(); frighten(); }
    if (dotsEaten === 70 || dotsEaten === 170) fruit = { t: 9.5 };
    if (dotsLeft === 0) { state = 'clear'; stateT = 0; sfx.clear(); }
  }
}

function frighten() {
  frightT = frightTime(level);
  combo = 0;
  for (const g of ghosts) {
    if (g.state === 'eyes' || g.state === 'enter') continue;
    if (g.state === 'maze' && !g.fright) reverse(g);
    g.fright = frightT > 0;
  }
}

// ---------- Ghosts ----------
function targetOf(g) {
  if (g.state === 'eyes') return [13, 11];
  const [pc, pr] = nearTile(pac);
  const elroy = g.name === 'blinky' && dotsLeft <= elroyDots(level);
  if (!chasing() && !elroy) return g.corner;
  switch (g.name) {
    case 'blinky': return [pc, pr];
    case 'pinky': return [pc + DX[pac.dir] * 4, pr + DY[pac.dir] * 4];
    case 'inky': {
      const b = ghost('blinky');
      const bc = Math.floor(b.x / T), br = Math.floor(b.y / T);
      const ax = pc + DX[pac.dir] * 2, ay = pr + DY[pac.dir] * 2;
      return [ax * 2 - bc, ay * 2 - br];
    }
    case 'clyde': {
      const d = Math.hypot(pc - g.tx, pr - g.ty);
      return d > 8 ? [pc, pr] : g.corner;
    }
  }
}

function ghostDecide(g) {
  if (g.state === 'eyes' && g.ty === 11 && (g.tx === 13 || g.tx === 14)) {
    g.state = 'enter';
    return false;
  }
  const options = [0, 1, 2, 3].filter((d) => d !== opp(g.dir) && walkable(g.tx + DX[d], g.ty + DY[d]));
  if (!options.length) { g.dir = opp(g.dir); return true; }
  if (g.fright) {
    g.dir = options[Math.floor(Math.random() * options.length)];
    return true;
  }
  const [gx, gy] = targetOf(g);
  let bestD = Infinity;
  for (const d of options) {
    const nx = g.tx + DX[d] - gx, ny = g.ty + DY[d] - gy;
    const dist = nx * nx + ny * ny;
    if (dist < bestD) { bestD = dist; g.dir = d; }
  }
  return true;
}

function ghostSpeed(g) {
  if (g.state === 'eyes') return 2 * MAX_SPEED;
  if (g.state === 'enter') return 1.5 * MAX_SPEED;
  if (g.state !== 'maze') return 0.45 * MAX_SPEED;
  if (inTunnel(g)) return S.tunnel * MAX_SPEED;
  if (g.fright) return S.fright * MAX_SPEED;
  if (g.name === 'blinky') {
    const e = elroyDots(level);
    if (dotsLeft <= e / 2) return S.elroy2 * MAX_SPEED;
    if (dotsLeft <= e) return S.elroy1 * MAX_SPEED;
  }
  return S.ghost * MAX_SPEED;
}

// 픽셀 단위로 (tx,ty) 를 향해 움직인다. 도착하면 true.
function slide(g, tx, ty, px) {
  const dx = tx - g.x, dy = ty - g.y;
  if (Math.abs(dx) > 0.01) {
    const s = Math.min(px, Math.abs(dx));
    g.x += Math.sign(dx) * s;
    g.dir = dx < 0 ? 1 : 3;
    return false;
  }
  g.x = tx;
  if (Math.abs(dy) > 0.01) {
    const s = Math.min(px, Math.abs(dy));
    g.y += Math.sign(dy) * s;
    g.dir = dy < 0 ? 0 : 2;
    return false;
  }
  g.y = ty;
  return true;
}

function updateGhost(g, dt) {
  const px = ghostSpeed(g) * dt * T;
  if (g.state === 'house') {
    g.y += g.bob * px;
    if (g.y < HOME_Y - T * 0.4) { g.y = HOME_Y - T * 0.4; g.bob = 1; }
    if (g.y > HOME_Y + T * 0.4) { g.y = HOME_Y + T * 0.4; g.bob = -1; }
    g.dir = g.bob < 0 ? 0 : 2;
  } else if (g.state === 'leave') {
    const tx = g.x !== DOOR_X && Math.abs(g.y - HOME_Y) > 0.5 ? g.x : DOOR_X;
    const ty = g.x === DOOR_X ? OUT_Y : HOME_Y;
    if (slide(g, tx, ty, px) && g.y === OUT_Y) {
      Object.assign(g, { state: 'maze', tx: 14, ty: 11, dir: 1, p: 0.5 });
      mazePos(g);
    }
  } else if (g.state === 'enter') {
    const ty = g.x === DOOR_X ? HOME_Y : OUT_Y;
    if (slide(g, DOOR_X, ty, px) && g.y === HOME_Y) g.state = 'leave';
  } else {
    moveMaze(g, ghostSpeed(g) * dt, ghostDecide);
  }
}

// 집에 있는 유령을 순서대로 내보낸다. 점을 일정 개수 먹거나, 한동안 점을 안 먹으면 한 마리씩.
function releaseGhosts(dt) {
  idleT += dt;
  const g = ['pinky', 'inky', 'clyde'].map(ghost).find((x) => x.state === 'house');
  if (!g) return;
  const limits = afterDeath ? { pinky: 7, inky: 17, clyde: 32 }
    : level === 1 ? { pinky: 0, inky: 30, clyde: 60 }
    : level === 2 ? { pinky: 0, inky: 0, clyde: 50 }
    : { pinky: 0, inky: 0, clyde: 0 };
  if (dotCounter >= limits[g.name] || idleT >= (level < 5 ? 4 : 3)) {
    g.state = 'leave';
    idleT = 0;
  }
}

function updateModes(dt) {
  if (frightT > 0) {
    frightT -= dt;
    if (frightT <= 0) {
      frightT = 0;
      for (const g of ghosts) g.fright = false;
    }
    return;                         // 겁먹은 동안은 흩어지기/쫓기 시계가 멈춘다
  }
  modeT -= dt;
  if (modeT <= 0) {
    modeIdx++;
    modeT = modeSchedule(level)[modeIdx] ?? Infinity;
    for (const g of ghosts) if (g.state === 'maze') reverse(g);
  }
}

function checkCollisions() {
  for (const g of ghosts) {
    if (g.state !== 'maze' && g.state !== 'leave') continue;
    if (Math.hypot(g.x - pac.x, g.y - pac.y) > T * 0.6) continue;
    if (g.fright) {
      const pts = 200 * 2 ** combo;
      combo++;
      addScore(pts);
      popups.push({ x: g.x, y: g.y, text: String(pts), color: '#00ffff', t: 1 });
      g.fright = false;
      // 집에서 나오던 중이면 눈만 그대로 집으로 돌아간다
      g.state = g.state === 'leave' ? 'enter' : 'eyes';
      freezeT = 0.7;
      sfx.ghost();
    } else {
      state = 'dying';
      stateT = 0;
      return;
    }
  }
}

// ---------- Update ----------
function update(dt) {
  t0 += dt;
  popups = popups.filter((p) => (p.t -= dt) > 0);

  if (state === 'ready') {
    stateT -= dt;
    if (stateT <= 0) state = 'play';
  } else if (state === 'play') {
    if (freezeT > 0) { freezeT -= dt; return; }
    // 빠른 이동에서 서로 통과하지 않도록 잘게 나눠서 진행
    const n = Math.ceil(dt / (1 / 240));
    for (let i = 0; i < n && state === 'play' && freezeT <= 0; i++) {
      const h = dt / n;
      updateModes(h);
      releaseGhosts(h);
      updatePac(h);
      if (state !== 'play') break;
      checkCollisions();
      for (const g of ghosts) updateGhost(g, h);
      checkCollisions();
    }
    if (fruit) {
      fruit.t -= dt;
      if (fruit.t <= 0) fruit = null;
      else if (Math.hypot(pac.x - FRUIT_X, pac.y - FRUIT_Y) < T * 0.8) {
        const f = fruitFor(level);
        addScore(f.pts);
        popups.push({ x: FRUIT_X, y: FRUIT_Y, text: String(f.pts), color: '#ffb8ff', t: 2 });
        fruit = null;
        sfx.fruit();
      }
    }
  } else if (state === 'dying') {
    const prev = stateT;
    stateT += dt;
    if (prev < 0.8 && stateT >= 0.8) sfx.death();
    if (stateT >= 3) {
      lives--;
      if (lives <= 0) gameOver();
      else {
        resetActors();
        afterDeath = true;
        toReady(false);
      }
    }
  } else if (state === 'clear') {
    stateT += dt;
    if (stateT >= 3) {
      level++;
      loadLevel();
      toReady(false);
    }
  }
}

function gameOver() {
  state = 'over';
  updateHud();
  showOverlay(`
    <h2>GAME OVER</h2>
    <p class="big">${score.toLocaleString()} 점</p>
    <p>레벨 ${level} 까지 도달${score >= best && score > 0 ? '<br>🏆 최고 기록!' : ''}</p>
    <button id="startBtn">다시 하기</button>`);
}

// ---------- Drawing ----------
function drawMaze() {
  const flashing = state === 'clear' && stateT > 1 && Math.floor((stateT - 1) / 0.25) % 2 === 0;
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
      const ch = map[r][c];
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
    if (stateT < 0.8) return drawPacAt(pac.x, pac.y, pac.dir, 0.2);
    const k = (stateT - 0.8) / 1.5;
    if (k < 1) {
      // 위를 보고 입이 점점 벌어지며 사라진다
      const m = 0.05 + k * Math.PI;
      ctx.fillStyle = '#ffe600';
      ctx.beginPath();
      ctx.moveTo(pac.x, pac.y);
      ctx.arc(pac.x, pac.y, T * 0.8, -Math.PI / 2 + m, Math.PI * 1.5 - m);
      ctx.closePath();
      ctx.fill();
    } else if (k < 1.3) {
      ctx.strokeStyle = '#ffe600';
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(pac.x + Math.cos(a) * 5, pac.y + Math.sin(a) * 5);
        ctx.lineTo(pac.x + Math.cos(a) * 11, pac.y + Math.sin(a) * 11);
        ctx.stroke();
      }
    }
    return;
  }
  if (freezeT > 0) return;          // 유령을 먹은 순간에는 점수만 보인다
  const mouth = state === 'ready' ? 0 : (0.04 + 0.22 * Math.abs(Math.sin(pac.anim))) * Math.PI;
  drawPacAt(pac.x, pac.y, pac.dir, mouth);
  // 터널 끝에서 반대편에 걸친 부분
  if (pac.x < T) drawPacAt(pac.x + W, pac.y, pac.dir, mouth);
  if (pac.x > W - T) drawPacAt(pac.x - W, pac.y, pac.dir, mouth);
}

function drawGhost(g) {
  const x = g.x, y = g.y, r = T * 0.82;
  const eyesOnly = g.state === 'eyes' || g.state === 'enter';
  if (!eyesOnly) {
    let body = g.color;
    const flash = g.fright && frightT < 2 && Math.floor(frightT * 5) % 2 === 0;
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
  for (let i = 0; i < Math.min(lives - (state === 'title' || state === 'over' ? 0 : 1), 6); i++) {
    drawPacAt((2 + i * 2) * T, y, 1, 0.22 * Math.PI, T * 0.7);
  }
  ctx.font = `${T * 1.3}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < Math.min(level, 7); i++) {
    ctx.fillText(fruitFor(level - i).emoji, W - (2 + i * 2) * T, y);
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

  if (fruit && state === 'play') {
    ctx.font = `${T * 1.4}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fruitFor(level).emoji, FRUIT_X, FRUIT_Y);
  }

  const showGhosts = state !== 'clear' && !(state === 'dying' && stateT >= 0.8) && state !== 'over';
  if (showGhosts) for (const g of ghosts) drawGhost(g);
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
    pac.want = KEY_DIR[e.code];
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
  pac.want = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 3) : (dy < 0 ? 0 : 2);
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

// 타이틀 화면 뒤에 깔아둘 판
loadLevel();
fit();
requestAnimationFrame(frame);

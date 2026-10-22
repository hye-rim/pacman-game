'use strict';

// 팩맨: 규칙만 모아 둔 파일 (그리기·입력·소리 없음). 브라우저와 테스트(Node)가 같이 쓴다.
//
// - 원작과 같은 28×31 미로. 점(10) · 파워 쿠키(50) 를 다 먹으면 다음 레벨
// - 유령 넷(블링키·핑키·잉키·클라이드)은 원작처럼 흩어지기/쫓기를 번갈아 하고, 쫓을 때 저마다 다른 칸을 노린다
// - 파워 쿠키를 먹으면 잠시 유령이 겁먹고, 그때 잡으면 200·400·800·1600점. 눈만 남아 집으로 돌아간다
// - 점 70개·170개째에 과일이 나온다. 10000점에 목숨 하나 더
// 진행 단계(st.phase): ready(준비) → play → dying(잡힘) / clear(다 먹음) → … → over
// 소리·점수 글씨는 game.js 가 st.events 를 보고 만든다.
const LOGIC_PACMAN = (() => {
// ---------- 미로 ----------
// # 벽, . 점, o 파워 쿠키, - 유령 집 문, 공백 빈 길.
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
const EXTRA_LIFE_AT = 10000;
const READY_TIME = 2, READY_JINGLE = 4.2, DYING_TIME = 3, DEATH_SOUND_AT = 0.8, CLEAR_TIME = 3, FRUIT_TIME = 9.5, EAT_FREEZE = 0.7;

// ---------- 미로 도우미 ----------
const wrapC = (c) => (c + COLS) % COLS;
function tileAt(st, c, r) {
  if (r < 0 || r >= ROWS) return '#';
  if (c < 0 || c >= COLS) return r === TUNNEL_ROW ? ' ' : '#';
  return st.map[r][c];
}
const walkable = (st, c, r) => { const t = tileAt(st, c, r); return t !== '#' && t !== '-'; };
const inTunnel = (e) => e.ty === TUNNEL_ROW && (e.tx <= 5 || e.tx >= 22);

// ---------- 움직이는 것 ----------
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

const GHOSTS = [
  { name: 'blinky', color: '#ff2020', corner: [25, -3], homeX: DOOR_X },
  { name: 'pinky',  color: '#ffb8ff', corner: [2, -3],  homeX: DOOR_X },
  { name: 'inky',   color: '#00ffff', corner: [27, 34], homeX: 12 * T },
  { name: 'clyde',  color: '#ffb852', corner: [0, 34],  homeX: 16 * T },
];
const ghostOf = (st, name) => st.ghosts.find((g) => g.name === name);
const chasing = (st) => st.modeIdx % 2 === 1;

// ---------- 게임 ----------
function newGame(rand = Math.random) {
  const st = {
    rand, level: 1, score: 0, lives: 3, extraGiven: false, phase: 'ready', phaseT: 0, events: [],
    map: [], dotsLeft: 0, dotsEaten: 0, dotCounter: 0, afterDeath: false, idleT: 0,
    frightT: 0, combo: 0, modeIdx: 0, modeT: 0, freezeT: 0, fruit: null, S: speeds(1),
    pac: { tx: 14, ty: 23, dir: 1, p: 0.5, want: 1, moving: true, anim: 0, x: 0, y: 0 },
    ghosts: GHOSTS.map((g) => ({ ...g })),
  };
  loadLevel(st);
  toReady(st, true);
  return st;
}

function loadLevel(st) {
  st.map = MAZE.map((row) => row.split(''));
  st.dotsLeft = 0;
  for (const row of st.map) for (const ch of row) if (ch === '.' || ch === 'o') st.dotsLeft++;
  st.dotsEaten = 0;
  st.afterDeath = false;
  st.S = speeds(st.level);
  resetActors(st);
}

function resetActors(st) {
  Object.assign(st.pac, { tx: 14, ty: 23, dir: 1, p: 0.5, want: 1, moving: true, anim: 0 });
  mazePos(st.pac);
  for (const g of st.ghosts) {
    g.fright = false;
    g.bob = 1;
    if (g.name === 'blinky') {
      Object.assign(g, { state: 'maze', tx: 14, ty: 11, dir: 1, p: 0.5 });
      mazePos(g);
    } else {
      Object.assign(g, { state: 'house', x: g.homeX, y: HOME_Y, dir: g.name === 'pinky' ? 2 : 0 });
    }
  }
  st.modeIdx = 0;
  st.modeT = modeSchedule(st.level)[0];
  st.frightT = 0;
  st.combo = 0;
  st.freezeT = 0;
  st.fruit = null;
  st.idleT = 0;
  st.dotCounter = 0;
}

function toReady(st, jingle) {
  st.phase = 'ready';
  st.phaseT = jingle ? READY_JINGLE : READY_TIME;
  st.events.push({ type: 'ready', jingle });
}

// 팩맨이 가고 싶은 방향 (갈 수 있게 되는 순간 꺾는다)
function steer(st, dir) { st.pac.want = dir; }

function addScore(st, n) {
  st.score += n;
  if (!st.extraGiven && st.score >= EXTRA_LIFE_AT) { st.extraGiven = true; st.lives++; st.events.push({ type: 'life' }); }
}

// ---------- 팩맨 ----------
function pacDecide(st, e) {
  if (e.want !== null && walkable(st, e.tx + DX[e.want], e.ty + DY[e.want])) e.dir = e.want;
  e.moving = walkable(st, e.tx + DX[e.dir], e.ty + DY[e.dir]);
  return e.moving;
}

function updatePac(st, dt) {
  const pac = st.pac;
  if (pac.want === opp(pac.dir) && pac.p > 0) reverse(pac);
  const bx = pac.x, by = pac.y;
  const speed = (st.frightT > 0 ? st.S.pacFr : st.S.pac) * MAX_SPEED;
  moveMaze(pac, speed * dt, (e) => pacDecide(st, e));
  if (pac.x !== bx || pac.y !== by) pac.anim += speed * dt * 2.2;

  const [c, r] = nearTile(pac);
  const ch = tileAt(st, c, r);
  if (ch === '.' || ch === 'o') {
    st.map[r][c] = ' ';
    st.dotsLeft--; st.dotsEaten++; st.dotCounter++;
    st.idleT = 0;
    if (ch === '.') { addScore(st, 10); st.events.push({ type: 'dot' }); }
    else { addScore(st, 50); st.events.push({ type: 'power' }); frighten(st); }
    if (st.dotsEaten === 70 || st.dotsEaten === 170) st.fruit = { t: FRUIT_TIME };
    if (st.dotsLeft === 0) { st.phase = 'clear'; st.phaseT = 0; st.events.push({ type: 'clear' }); }
  }
}

function frighten(st) {
  st.frightT = frightTime(st.level);
  st.combo = 0;
  for (const g of st.ghosts) {
    if (g.state === 'eyes' || g.state === 'enter') continue;
    if (g.state === 'maze' && !g.fright) reverse(g);
    g.fright = st.frightT > 0;
  }
}

// ---------- 유령 ----------
function targetOf(st, g) {
  const pac = st.pac;
  if (g.state === 'eyes') return [13, 11];
  const [pc, pr] = nearTile(pac);
  const elroy = g.name === 'blinky' && st.dotsLeft <= elroyDots(st.level);
  if (!chasing(st) && !elroy) return g.corner;
  switch (g.name) {
    case 'blinky': return [pc, pr];
    case 'pinky': return [pc + DX[pac.dir] * 4, pr + DY[pac.dir] * 4];
    case 'inky': {
      const b = ghostOf(st, 'blinky');
      const bc = Math.floor(b.x / T), br = Math.floor(b.y / T);
      const ax = pc + DX[pac.dir] * 2, ay = pr + DY[pac.dir] * 2;
      return [ax * 2 - bc, ay * 2 - br];
    }
    case 'clyde': {
      const d = Math.hypot(pc - g.tx, pr - g.ty);
      return d > 8 ? [pc, pr] : g.corner;
    }
  }
  return g.corner;
}

function ghostDecide(st, g) {
  if (g.state === 'eyes' && g.ty === 11 && (g.tx === 13 || g.tx === 14)) {
    g.state = 'enter';
    return false;
  }
  const options = [0, 1, 2, 3].filter((d) => d !== opp(g.dir) && walkable(st, g.tx + DX[d], g.ty + DY[d]));
  if (!options.length) { g.dir = opp(g.dir); return true; }
  if (g.fright) {
    g.dir = options[Math.floor(st.rand() * options.length)];
    return true;
  }
  const [gx, gy] = targetOf(st, g);
  let bestD = Infinity;
  for (const d of options) {
    const nx = g.tx + DX[d] - gx, ny = g.ty + DY[d] - gy;
    const dist = nx * nx + ny * ny;
    if (dist < bestD) { bestD = dist; g.dir = d; }
  }
  return true;
}

function ghostSpeed(st, g) {
  if (g.state === 'eyes') return 2 * MAX_SPEED;
  if (g.state === 'enter') return 1.5 * MAX_SPEED;
  if (g.state !== 'maze') return 0.45 * MAX_SPEED;
  if (inTunnel(g)) return st.S.tunnel * MAX_SPEED;
  if (g.fright) return st.S.fright * MAX_SPEED;
  if (g.name === 'blinky') {
    const e = elroyDots(st.level);
    if (st.dotsLeft <= e / 2) return st.S.elroy2 * MAX_SPEED;
    if (st.dotsLeft <= e) return st.S.elroy1 * MAX_SPEED;
  }
  return st.S.ghost * MAX_SPEED;
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

function updateGhost(st, g, dt) {
  const px = ghostSpeed(st, g) * dt * T;
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
    moveMaze(g, ghostSpeed(st, g) * dt, (e) => ghostDecide(st, e));
  }
}

// 집에 있는 유령을 순서대로 내보낸다. 점을 일정 개수 먹거나, 한동안 점을 안 먹으면 한 마리씩.
function releaseGhosts(st, dt) {
  st.idleT += dt;
  const g = ['pinky', 'inky', 'clyde'].map((n) => ghostOf(st, n)).find((x) => x.state === 'house');
  if (!g) return;
  const limits = st.afterDeath ? { pinky: 7, inky: 17, clyde: 32 }
    : st.level === 1 ? { pinky: 0, inky: 30, clyde: 60 }
    : st.level === 2 ? { pinky: 0, inky: 0, clyde: 50 }
    : { pinky: 0, inky: 0, clyde: 0 };
  if (st.dotCounter >= limits[g.name] || st.idleT >= (st.level < 5 ? 4 : 3)) {
    g.state = 'leave';
    st.idleT = 0;
  }
}

function updateModes(st, dt) {
  if (st.frightT > 0) {
    st.frightT -= dt;
    if (st.frightT <= 0) {
      st.frightT = 0;
      for (const g of st.ghosts) g.fright = false;
    }
    return;                         // 겁먹은 동안은 흩어지기/쫓기 시계가 멈춘다
  }
  st.modeT -= dt;
  if (st.modeT <= 0) {
    st.modeIdx++;
    st.modeT = modeSchedule(st.level)[st.modeIdx] ?? Infinity;
    for (const g of st.ghosts) if (g.state === 'maze') reverse(g);
  }
}

function checkCollisions(st) {
  const pac = st.pac;
  for (const g of st.ghosts) {
    if (g.state !== 'maze' && g.state !== 'leave') continue;
    if (Math.hypot(g.x - pac.x, g.y - pac.y) > T * 0.6) continue;
    if (g.fright) {
      const pts = 200 * 2 ** st.combo;
      st.combo++;
      addScore(st, pts);
      st.events.push({ type: 'ghost', x: g.x, y: g.y, pts });
      g.fright = false;
      // 집에서 나오던 중이면 눈만 그대로 집으로 돌아간다
      g.state = g.state === 'leave' ? 'enter' : 'eyes';
      st.freezeT = EAT_FREEZE;
    } else {
      st.phase = 'dying';
      st.phaseT = 0;
      return;
    }
  }
}

// ---------- 한 프레임 ----------
function update(st, dt) {
  if (st.phase === 'ready') {
    st.phaseT -= dt;
    if (st.phaseT <= 0) st.phase = 'play';
  } else if (st.phase === 'play') {
    if (st.freezeT > 0) { st.freezeT -= dt; return; }
    // 빠른 이동에서 서로 통과하지 않도록 잘게 나눠서 진행
    const n = Math.ceil(dt / (1 / 240));
    for (let i = 0; i < n && st.phase === 'play' && st.freezeT <= 0; i++) {
      const h = dt / n;
      updateModes(st, h);
      releaseGhosts(st, h);
      updatePac(st, h);
      if (st.phase !== 'play') break;
      checkCollisions(st);
      for (const g of st.ghosts) updateGhost(st, g, h);
      checkCollisions(st);
    }
    if (st.fruit) {
      st.fruit.t -= dt;
      if (st.fruit.t <= 0) st.fruit = null;
      else if (Math.hypot(st.pac.x - FRUIT_X, st.pac.y - FRUIT_Y) < T * 0.8) {
        const f = fruitFor(st.level);
        addScore(st, f.pts);
        st.events.push({ type: 'fruit', pts: f.pts });
        st.fruit = null;
      }
    }
  } else if (st.phase === 'dying') {
    const prev = st.phaseT;
    st.phaseT += dt;
    if (prev < DEATH_SOUND_AT && st.phaseT >= DEATH_SOUND_AT) st.events.push({ type: 'death' });
    if (st.phaseT >= DYING_TIME) {
      st.lives--;
      if (st.lives <= 0) { st.phase = 'over'; st.events.push({ type: 'over' }); }
      else {
        resetActors(st);
        st.afterDeath = true;
        toReady(st, false);
      }
    }
  } else if (st.phase === 'clear') {
    st.phaseT += dt;
    if (st.phaseT >= CLEAR_TIME) {
      st.level++;
      loadLevel(st);
      toReady(st, false);
    }
  }
}

return {
  MAZE, COLS, ROWS, TUNNEL_ROW, T, W, H, MAX_SPEED, DX, DY, opp, DOOR_X, OUT_Y, HOME_Y, FRUIT_X, FRUIT_Y, FRUITS, fruitFor,
  speeds, frightTime, modeSchedule, elroyDots, EXTRA_LIFE_AT, DEATH_SOUND_AT, GHOSTS,
  wrapC, tileAt, walkable, inTunnel, mazePos, moveMaze, reverse, nearTile, ghostOf, chasing,
  newGame, loadLevel, resetActors, toReady, steer, addScore, updatePac, frighten, targetOf, ghostDecide, ghostSpeed, updateGhost, releaseGhosts, updateModes, checkCollisions, update,
};
})();
if (typeof module !== 'undefined') module.exports = LOGIC_PACMAN;

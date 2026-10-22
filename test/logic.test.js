'use strict';
// 팩맨 규칙 시험. 실행: node test/logic.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

function rng(seed) {                                   // mulberry32 (시험용 고정 난수)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DT = 1 / 60;
const play = (st) => { st.phase = 'play'; st.phaseT = 0; st.events.length = 0; };
const run = (st, sec) => { for (let t = 0; t < sec; t += DT) L.update(st, DT); };
const ghost = (st, name) => L.ghostOf(st, name);
// 유령을 모두 집 안에 가둬 둔다 (팩맨만 시험할 때)
function noGhosts(st) {
  for (const g of st.ghosts) Object.assign(g, { state: 'house', x: g.homeX, y: L.HOME_Y });
  st.dotCounter = -1e9; st.idleT = -1e9;
}

test('the maze: 28x31, mirror-symmetric, 240 dots and 4 power pellets, all reachable', () => {
  assert.strictEqual(L.MAZE.length, L.ROWS);
  for (const row of L.MAZE) {
    assert.strictEqual(row.length, L.COLS);
    assert.strictEqual(row, [...row].reverse().join(''), 'left-right symmetric');
  }
  const all = L.MAZE.join('');
  assert.strictEqual((all.match(/\./g) || []).length, 240);
  assert.strictEqual((all.match(/o/g) || []).length, 4);
  const st = L.newGame(rng(1));
  const seen = new Set(['14,23']), q = [[14, 23]];
  while (q.length) {
    const [c, r] = q.pop();
    for (let d = 0; d < 4; d++) {
      const nc = L.wrapC(c + L.DX[d]), nr = r + L.DY[d];
      if (!L.walkable(st, nc, nr) || seen.has(nc + ',' + nr)) continue;
      seen.add(nc + ',' + nr); q.push([nc, nr]);
    }
  }
  L.MAZE.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '.' || ch === 'o') assert.ok(seen.has(c + ',' + r), `dot at ${c},${r}`); }));
  assert.strictEqual(st.dotsLeft, 244);
});

test('Pac-Man eats dots, stops at walls, turns when the way opens, reverses at once', () => {
  const st = L.newGame(rng(2));
  play(st); noGhosts(st);
  run(st, 1);
  assert.ok(st.score >= 50 && st.score % 10 === 0, 'ate some dots: ' + st.score);
  assert.strictEqual(st.pac.ty, 23);
  L.steer(st, 3);                                        // 바로 반대로
  const x = st.pac.x;
  run(st, 0.1);
  assert.ok(st.pac.x > x, 'reversed immediately');
  run(st, 5);
  assert.ok(!st.pac.moving, 'stopped at a wall');
  assert.strictEqual(L.tileAt(st, st.pac.tx + 1, st.pac.ty), '#');
});

test('the tunnel wraps around the sides', () => {
  const st = L.newGame(rng(3));
  play(st); noGhosts(st);
  Object.assign(st.pac, { tx: 2, ty: L.TUNNEL_ROW, dir: 1, p: 0, want: 1 });
  run(st, 1);
  assert.ok(st.pac.tx > 20, 'came out on the right: ' + st.pac.tx);
});

test('power pellets frighten the ghosts; eating them pays 200, 400, 800, 1600', () => {
  const st = L.newGame(rng(4));
  play(st);
  for (const g of st.ghosts) Object.assign(g, { state: 'maze', tx: 10, ty: 5, dir: 3, p: 0, fright: false });
  L.frighten(st);
  assert.strictEqual(st.frightT, L.frightTime(1));
  assert.ok(st.ghosts.every((g) => g.fright));
  const pays = [];
  for (const g of st.ghosts) {
    L.mazePos(g); g.x = st.pac.x; g.y = st.pac.y;
    st.events.length = 0;
    L.checkCollisions(st);
    pays.push(st.events.find((e) => e.type === 'ghost').pts);
    assert.strictEqual(g.state, 'eyes');
  }
  assert.deepStrictEqual(pays, [200, 400, 800, 1600]);
  assert.strictEqual(st.phase, 'play');
});

test('ghost targets: Blinky chases, Pinky aims ahead, Clyde backs off, everyone scatters to corners', () => {
  const st = L.newGame(rng(5));
  Object.assign(st.pac, { tx: 10, ty: 20, dir: 3, p: 0 });
  st.modeIdx = 1;                                        // 쫓기
  assert.deepStrictEqual(L.targetOf(st, ghost(st, 'blinky')), [10, 20]);
  assert.deepStrictEqual(L.targetOf(st, ghost(st, 'pinky')), [14, 20]);
  const clyde = ghost(st, 'clyde');
  Object.assign(clyde, { tx: 11, ty: 20 });
  assert.deepStrictEqual(L.targetOf(st, clyde), clyde.corner, 'Clyde runs to his corner when close');
  Object.assign(clyde, { tx: 25, ty: 5 });
  assert.deepStrictEqual(L.targetOf(st, clyde), [10, 20]);
  st.modeIdx = 0;                                        // 흩어지기
  for (const g of st.ghosts) if (g.name !== 'blinky' || st.dotsLeft > L.elroyDots(1)) assert.deepStrictEqual(L.targetOf(st, g), g.corner);
  st.dotsLeft = 5;
  assert.deepStrictEqual(L.targetOf(st, ghost(st, 'blinky')), [10, 20], 'Elroy chases even while scattering');
});

test('scatter and chase alternate on schedule; fright pauses the clock', () => {
  const st = L.newGame(rng(6));
  play(st); noGhosts(st);
  st.pac.want = null;
  assert.ok(!L.chasing(st));
  run(st, 7.1);
  assert.ok(L.chasing(st), 'chase after 7 s on level 1');
  st.frightT = 3;
  const mt = st.modeT;
  run(st, 2);
  assert.ok(Math.abs(st.modeT - mt) < 1e-9, 'mode clock frozen while frightened');
});

test('ghosts leave the house in order: Pinky, then Inky, then Clyde', () => {
  const st = L.newGame(rng(7));
  play(st);
  const order = [];
  for (let t = 0; t < 30 && order.length < 3; t += DT) {
    L.update(st, DT);
    for (const n of ['pinky', 'inky', 'clyde']) if (!order.includes(n) && ghost(st, n).state !== 'house') order.push(n);
    if (st.phase !== 'play') play(st);
  }
  assert.deepStrictEqual(order, ['pinky', 'inky', 'clyde']);
});

test('ghosts only ever stand on open tiles, and eaten ghosts return home and come back out', () => {
  const st = L.newGame(rng(8));
  play(st);
  let eyes = 0, backOut = 0;
  for (let t = 0; t < 120; t += DT) {
    if (st.phase !== 'play') play(st);
    if (Math.floor(t * 2) % 7 === 0) L.steer(st, Math.floor(st.rand() * 4));
    if (Math.floor(t) % 15 === 0 && st.frightT === 0) L.frighten(st);
    L.update(st, DT);
    for (const g of st.ghosts) {
      if (g.state === 'maze' || g.state === 'eyes') assert.ok(L.walkable(st, g.tx, g.ty) || g.ty === 11, `${g.name} on ${g.tx},${g.ty}`);
      if (g.state === 'eyes') g.wasEyes = true;
      if (g.wasEyes && g.state === 'maze') { backOut++; g.wasEyes = false; }
    }
    eyes += st.events.filter((e) => e.type === 'ghost').length;
    st.events.length = 0;
    if (st.lives < 3) st.lives = 3;
  }
  assert.ok(eyes > 0 && backOut > 0, `eaten ${eyes}, came back ${backOut}`);
  assert.ok(L.walkable(st, st.pac.tx, st.pac.ty));
});

test('caught by a ghost: lose a life and restart; the last life ends the game', () => {
  const st = L.newGame(rng(9));
  play(st);
  const b = ghost(st, 'blinky');
  b.x = st.pac.x; b.y = st.pac.y;
  L.checkCollisions(st);
  assert.strictEqual(st.phase, 'dying');
  run(st, 3.1);
  assert.strictEqual(st.lives, 2);
  assert.strictEqual(st.phase, 'ready');
  assert.ok(st.afterDeath);
  st.lives = 1; play(st);
  b.x = st.pac.x; b.y = st.pac.y;
  L.checkCollisions(st);
  run(st, 3.1);
  assert.strictEqual(st.phase, 'over');
  assert.ok(st.events.some((e) => e.type === 'death') && st.events.some((e) => e.type === 'over'));
});

test('eating the last dot clears the level; the next level is faster', () => {
  const st = L.newGame(rng(10));
  play(st); noGhosts(st);
  st.map = st.map.map((row) => row.map((ch) => (ch === '.' || ch === 'o' ? ' ' : ch)));
  st.map[23][12] = '.'; st.dotsLeft = 1;
  run(st, 1);
  assert.strictEqual(st.phase, 'clear');
  run(st, 3.1);
  assert.strictEqual(st.level, 2);
  assert.strictEqual(st.dotsLeft, 244);
  assert.ok(L.speeds(2).ghost > L.speeds(1).ghost);
});

test('fruit at 70 dots, extra life at 10,000 points', () => {
  const st = L.newGame(rng(11));
  play(st); noGhosts(st);
  st.dotsEaten = 69;
  run(st, 0.5);
  assert.ok(st.fruit);
  L.addScore(st, 10000);
  assert.strictEqual(st.lives, 4);
  L.addScore(st, 10000);
  assert.strictEqual(st.lives, 4, 'only once');
});

// 가장 가까운 점으로 가되 겁먹지 않은 유령 근처 칸은 피하는 봇
function botDir(st) {
  const danger = new Set();
  for (const g of st.ghosts) {
    if ((g.state !== 'maze' && g.state !== 'leave') || g.fright) continue;
    const gc = Math.floor(g.x / L.T), gr = Math.floor(g.y / L.T);
    for (let dc = -3; dc <= 3; dc++) for (let dr = -3; dr <= 3; dr++) if (Math.abs(dc) + Math.abs(dr) <= 3) danger.add(L.wrapC(gc + dc) + ',' + (gr + dr));
  }
  const [sc, sr] = L.nearTile(st.pac);
  const prev = new Map([[sc + ',' + sr, null]]), q = [[sc, sr]];
  while (q.length) {
    const [c, r] = q.shift();
    const ch = L.tileAt(st, c, r);
    if ((ch === '.' || ch === 'o') && !(c === sc && r === sr)) {
      let k = c + ',' + r, first = null;
      while (prev.get(k)) { first = prev.get(k); k = first.from; }
      return first ? first.d : null;
    }
    for (let d = 0; d < 4; d++) {
      const nc = L.wrapC(c + L.DX[d]), nr = r + L.DY[d], k = nc + ',' + nr;
      if (prev.has(k) || !L.walkable(st, nc, nr) || danger.has(k)) continue;
      prev.set(k, { from: c + ',' + r, d });
      q.push([nc, nr]);
    }
  }
  return null;
}

test('a dot-chasing bot that steers clear of ghosts eats most of the first maze', () => {
  for (const seed of [1, 2, 3]) {
    const st = L.newGame(rng(seed));
    let maxEaten = 0;
    for (let t = 0; t < 600 && st.phase !== 'over' && st.level === 1; t += DT) {
      const d = botDir(st);
      if (d !== null) L.steer(st, d);
      L.update(st, DT);
      st.events.length = 0;
      maxEaten = Math.max(maxEaten, 244 - st.dotsLeft);
    }
    assert.ok(maxEaten >= 150 || st.level > 1, `seed ${seed}: ate ${maxEaten}`);
  }
});

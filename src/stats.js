// ── Record / Analysis: 集計とシェアカード生成 ────────────────────────────────
//
// Record タブ: 記録日数・ストリーク・宝石称号(ユーザー決定の9段階)
// Analysis タブ: 評価付きエントリーからギア/設定を集計
// シェアカード: 1200x675(X のカード比率)を canvas で描画して画像化

export const TIERS = [
  { days: 1, name: 'Stone', color: '#8a8a83' },
  { days: 3, name: 'Amber', color: '#D99A2B' },
  { days: 7, name: 'Cobalt', color: '#2B4FA1' },
  { days: 14, name: 'Ruby', color: '#C2274B' },
  { days: 30, name: 'Sapphire', color: '#3B6FE0' },
  { days: 60, name: 'Emerald', color: '#2FA36B' },
  { days: 100, name: 'Amethyst', color: '#8E5BC0' },
  { days: 180, name: 'Diamond', color: '#9FD0E8' },
  // 光で色が変わる石 — バッジは2色グラデーションで表現
  { days: 365, name: 'Alexandrite', color: '#46B5A4', color2: '#B05BC0' },
];

const PRAISE = {
  none: '最初の1件があなたの原石になります。今日の記録から始めましょう。',
  Stone: '原石を手にしました。磨くほどに輝くのは、あなたの感度も同じです。',
  Amber: '3日継続。時間が琥珀のように、記録を結晶化し始めています。',
  Cobalt: '1週間継続。深い青は静かな集中の色。良い習慣がついてきました。',
  Ruby: '2週間継続。情熱が形になってきました。設定の変遷が見え始めるころです。',
  Sapphire: '30日到達。もう習慣です。1ヶ月分の自分データは大きな資産になります。',
  Emerald: '60日。成長の緑。振り返れば、最適解への道筋が見えてくるはずです。',
  Amethyst: '100日。気品の紫。ここまで続けられる人はごくわずかです。',
  Diamond: '180日。半年分の記録は、何より硬い自信になります。',
  Alexandrite: '365日。光で色を変える奇跡の石。あなたの探求はもう伝説です。',
};

const fmtKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 記録日数・ストリーク・称号・直近12週ヒートマップを集計する。 */
export function computeRecordStats(entries) {
  const counts = {};
  for (const [k, list] of Object.entries(entries || {})) {
    if (Array.isArray(list) && list.length) counts[k] = list.length;
  }
  const dayKeys = Object.keys(counts).sort();
  const totalDays = dayKeys.length;
  const has = (k) => Object.prototype.hasOwnProperty.call(counts, k);

  const today = new Date();
  const loggedToday = has(fmtKey(today));

  // 現在ストリーク: 今日(未記録なら昨日)から遡って連続している日数
  let currentStreak = 0;
  {
    const d = new Date(today);
    if (!loggedToday) d.setDate(d.getDate() - 1);
    while (has(fmtKey(d))) {
      currentStreak++;
      d.setDate(d.getDate() - 1);
    }
  }

  // 最長ストリーク
  let longestStreak = 0;
  let run = 0;
  let prev = null;
  for (const k of dayKeys) {
    const [y, m, dd] = k.split('-').map(Number);
    const t = new Date(y, m - 1, dd).getTime();
    run = prev !== null && t - prev === 86400000 ? run + 1 : 1;
    prev = t;
    if (run > longestStreak) longestStreak = run;
  }

  let tier = null;
  for (const t of TIERS) if (totalDays >= t.days) tier = t;
  const next = TIERS.find((t) => t.days > totalDays) || null;

  // 直近84日(12週)を古い順に7日ずつの列へ
  const cells = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const k = fmtKey(d);
    cells.push({ key: k, count: counts[k] || 0 });
  }
  const heatWeeks = [];
  for (let i = 0; i < 12; i++) heatWeeks.push(cells.slice(i * 7, i * 7 + 7));

  const praise = tier ? PRAISE[tier.name] : PRAISE.none;
  const roadmap = TIERS.map((t) => ({ ...t, reached: totalDays >= t.days }));

  return { totalDays, currentStreak, longestStreak, tier, next, loggedToday, heatWeeks, praise, roadmap };
}

/**
 * 評価付きエントリーからギアごとの平均評価と、高評価(★4.0+)時の
 * 設定値の最頻値を集計する。
 */
export function computeAnalysis(flatEntries, { game = 'ALL', highRating = 4 } = {}) {
  const rated = (flatEntries || []).filter(
    (e) => e && e.rating > 0 && (game === 'ALL' || e.game === game),
  );

  const gearRank = (field) => {
    const m = new Map();
    for (const e of rated) {
      const v = (e[field] || '').trim();
      if (!v) continue;
      const cur = m.get(v) || { name: v, count: 0, sum: 0 };
      cur.count++;
      cur.sum += e.rating;
      m.set(v, cur);
    }
    return [...m.values()]
      .map((g) => ({ ...g, avg: g.sum / g.count }))
      .sort((a, b) => b.avg - a.avg || b.count - a.count)
      .slice(0, 5);
  };

  const high = rated.filter((e) => e.rating >= highRating);
  const modeOf = (field) => {
    const m = new Map();
    for (const e of high) {
      const v = (e[field] || '').trim();
      if (v) m.set(v, (m.get(v) || 0) + 1);
    }
    let best = null;
    for (const [value, count] of m) if (!best || count > best.count) best = { value, count };
    return best;
  };

  return {
    ratedCount: rated.length,
    highCount: high.length,
    highRating,
    mouse: gearRank('mouse'),
    mousepad: gearRank('mousepad'),
    keyboard: gearRank('keyboard'),
    best: {
      dpi: modeOf('dpi'),
      sens: modeOf('sens'),
      pollingRate: modeOf('pollingRate'),
      lod: modeOf('lod'),
      kbAp: modeOf('kbAp'),
      kbRt: modeOf('kbRt'),
      kbPollingRate: modeOf('kbPollingRate'),
    },
  };
}

// ── シェアカード描画 ─────────────────────────────────────────────────────────

const PAPER = '#f6f6f4';
const INK = '#17171f';
const DIM = '#6e6e68';
const PLUM = '#4F0C28';
const PERI = '#C5D2F8';
const FONT = '"Gen Interface JP","Helvetica Neue","Segoe UI","Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif';

function drawLogo(x, px, py, size) {
  const r = size * 0.18;
  x.fillStyle = PLUM;
  x.beginPath();
  x.roundRect(px, py, size, size, r);
  x.fill();
  const f = [0.2, 0.4, 0.6, 0.8];
  const line = [
    [0.2, 0.83],
    [0.4, 0.43],
    [0.6, 0.63],
    [0.8, 0.23],
  ];
  x.fillStyle = 'rgba(246,246,244,0.35)';
  for (const fx of f) {
    for (const fy of [0.23, 0.43, 0.63, 0.83]) {
      x.beginPath();
      x.arc(px + fx * size, py + fy * size, size * 0.031, 0, Math.PI * 2);
      x.fill();
    }
  }
  x.strokeStyle = PAPER;
  x.lineWidth = size * 0.052;
  x.lineCap = 'round';
  x.lineJoin = 'round';
  x.beginPath();
  line.forEach(([fx, fy], i) => {
    if (i === 0) x.moveTo(px + fx * size, py + fy * size);
    else x.lineTo(px + fx * size, py + fy * size);
  });
  x.stroke();
  x.fillStyle = PERI;
  x.beginPath();
  x.arc(px + 0.8 * size, py + 0.23 * size, size * 0.062, 0, Math.PI * 2);
  x.fill();
}

function drawCardBase(x, label) {
  x.fillStyle = PAPER;
  x.fillRect(0, 0, 1200, 675);
  drawLogo(x, 64, 56, 60);
  x.fillStyle = INK;
  x.font = `600 28px ${FONT}`;
  try { x.letterSpacing = '8px'; } catch (e) {}
  x.fillText('VILDUP', 148, 84);
  x.fillStyle = DIM;
  x.font = `500 15px ${FONT}`;
  try { x.letterSpacing = '5px'; } catch (e) {}
  x.fillText('SETUP DIARY FOR GAMERS', 148, 112);
  x.font = `600 22px ${FONT}`;
  const w = x.measureText(label).width;
  x.fillText(label, 1136 - w, 95);
  try { x.letterSpacing = '0px'; } catch (e) {}
  x.strokeStyle = '#e2e2de';
  x.lineWidth = 2;
  x.beginPath();
  x.moveTo(64, 132);
  x.lineTo(1136, 132);
  x.stroke();
  x.fillStyle = DIM;
  x.font = `500 24px ${FONT}`;
  x.fillText('#VILDUP', 64, 627);
}

/** Record タブのシェアカード(1200x675 canvas を返す)。 */
export function drawRecordCard(stats) {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 675;
  const x = c.getContext('2d');
  drawCardBase(x, 'RECORD');

  x.fillStyle = PLUM;
  x.font = `300 230px ${FONT}`;
  const n = String(stats.totalDays);
  x.fillText(n, 64, 420);
  const nw = x.measureText(n).width;
  x.fillStyle = DIM;
  x.font = `500 30px ${FONT}`;
  try { x.letterSpacing = '6px'; } catch (e) {}
  x.fillText('DAYS LOGGED', 72 + nw, 414);
  try { x.letterSpacing = '0px'; } catch (e) {}

  x.fillStyle = INK;
  x.font = `400 34px ${FONT}`;
  x.fillText(`現在のストリーク ${stats.currentStreak} 日 / 自己最長 ${stats.longestStreak} 日`, 64, 508);

  // 称号バッジ
  const tier = stats.tier;
  const bx = 850;
  const by = 196;
  const bs = 190;
  if (tier) {
    if (tier.color2) {
      const g = x.createLinearGradient(bx, by, bx + bs, by + bs);
      g.addColorStop(0, tier.color);
      g.addColorStop(1, tier.color2);
      x.fillStyle = g;
    } else {
      x.fillStyle = tier.color;
    }
    x.beginPath();
    x.roundRect(bx, by, bs, bs, 18);
    x.fill();
    x.fillStyle = INK;
    x.font = `500 44px ${FONT}`;
    const tw = x.measureText(tier.name).width;
    x.fillText(tier.name, bx + bs / 2 - tw / 2, by + bs + 62);
    if (stats.next) {
      x.fillStyle = DIM;
      x.font = `400 22px ${FONT}`;
      const nt = `次の ${stats.next.name} まであと ${stats.next.days - stats.totalDays} 日`;
      const ntw = x.measureText(nt).width;
      x.fillText(nt, bx + bs / 2 - ntw / 2, by + bs + 100);
    }
  }
  return c;
}

const trunc = (x, s, max) => {
  let t = s;
  while (t.length > 1 && x.measureText(t).width > max) t = t.slice(0, -1);
  return t === s ? s : t.slice(0, -1) + '…';
};

/** Analysis タブのシェアカード(1200x675 canvas を返す)。 */
export function drawAnalysisCard(an, game) {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 675;
  const x = c.getContext('2d');
  drawCardBase(x, game && game !== 'ALL' ? `ANALYSIS — ${game}` : 'ANALYSIS');

  x.fillStyle = DIM;
  x.font = `600 22px ${FONT}`;
  try { x.letterSpacing = '4px'; } catch (e) {}
  x.fillText('BEST GEAR', 64, 196);
  x.fillText(`BEST SETTINGS (★${an.highRating.toFixed(1)}+)`, 660, 196);
  try { x.letterSpacing = '0px'; } catch (e) {}

  const rows = [
    ['M', an.mouse[0]],
    ['P', an.mousepad[0]],
    ['K', an.keyboard[0]],
  ];
  let y = 268;
  for (const [tag, g] of rows) {
    x.fillStyle = PLUM;
    x.font = `600 28px ${FONT}`;
    x.fillText(tag, 64, y);
    x.fillStyle = INK;
    x.font = `400 34px ${FONT}`;
    x.fillText(g ? trunc(x, g.name, 420) : '—', 110, y);
    if (g) {
      x.fillStyle = DIM;
      x.font = `400 26px ${FONT}`;
      x.fillText(`★${g.avg.toFixed(1)} / ${g.count}回`, 110, y + 36);
    }
    y += 110;
  }

  const settings = [
    ['DPI', an.best.dpi],
    ['SENS', an.best.sens],
    ['POLLING', an.best.pollingRate],
  ];
  let sy = 268;
  for (const [label, v] of settings) {
    x.fillStyle = DIM;
    x.font = `600 22px ${FONT}`;
    x.fillText(label, 660, sy);
    x.fillStyle = PLUM;
    x.font = `300 64px ${FONT}`;
    x.fillText(v ? v.value : '—', 660, sy + 70);
    sy += 110;
  }
  return c;
}

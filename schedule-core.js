// べんきょうクエスト スケジュールの共通ロジック（schedule.html と index.html の両方で読み込む）
//
// 保存先は RPG 本体（study-rpg-v1）とは別キー。スケジュールで得たゴールドは ledger（累計）に積み、
// RPG 側が「ledger − 受け取りずみ」の差分を自分のゴールドに足す。
// RPG 側は勉強中に何度もセーブするので、こちらから本体のキーに直接書くと上書きし合ってゴールドが消えるため。
const SchCore = (() => {
  const KEY = 'study-rpg-schedule-v1';

  const SUBJ = {
    math:     { name: '算数',     color: '#ea580c' },
    japanese: { name: '国語',     color: '#16a34a' },
    science:  { name: '理科',     color: '#0284c7' },
    social:   { name: '社会',     color: '#9333ea' },
    review:   { name: 'やり直し', color: '#ca8a04' },
  };
  const NONSTUDY_COLOR = '#94a3b8';

  // subj = RPG の教科（タイマーの経験値の行き先）。null は勉強以外（ポイント対象外）
  const TASKS = [
    { id: 'keisan',      name: '計算',              emoji: '🔢', subj: 'math',     def: 15 },
    { id: 'kanji',       name: '漢字',              emoji: '✍️', subj: 'japanese', def: 15 },
    { id: 'yoshu_m',     name: '予習シリーズ 算数', emoji: '📘', subj: 'math',     def: 40 },
    { id: 'yoshu_j',     name: '予習シリーズ 国語', emoji: '📗', subj: 'japanese', def: 40 },
    { id: 'yoshu_s',     name: '予習シリーズ 理科', emoji: '📙', subj: 'science',  def: 40 },
    { id: 'yoshu_h',     name: '予習シリーズ 社会', emoji: '📕', subj: 'social',   def: 40 },
    { id: 'ensyu_m',     name: '演習問題 算数',     emoji: '📝', subj: 'math',     def: 40 },
    { id: 'ensyu_s',     name: '演習問題 理科',     emoji: '📝', subj: 'science',  def: 30 },
    { id: 'ensyu_h',     name: '演習問題 社会',     emoji: '📝', subj: 'social',   def: 30 },
    { id: 'fukushu',     name: '復習',              emoji: '🔁', subj: 'review',   def: 30 },
    { id: 'testnaoshi',  name: '週テスト直し',      emoji: '🩹', subj: 'review',   def: 40 },
    { id: 'rika_anki',   name: '理科暗記',          emoji: '🧪', subj: 'science',  def: 20 },
    { id: 'shakai_anki', name: '社会暗記',          emoji: '🗾', subj: 'social',   def: 20 },
    { id: 'school',      name: '学校',              emoji: '🎒', subj: null, def: 60 },
    { id: 'juku',        name: '塾',                emoji: '🏫', subj: null, def: 180 },
    { id: 'meal',        name: 'ごはん',            emoji: '🍚', subj: null, def: 30 },
    { id: 'bath',        name: 'おふろ',            emoji: '🛁', subj: null, def: 30 },
    { id: 'rest',        name: 'きゅうけい',        emoji: '☕', subj: null, def: 10 },
    { id: 'free',        name: '自由時間',          emoji: '🎮', subj: null, def: 30 },
  ];
  const TASK_MAP = Object.fromEntries(TASKS.map(t => [t.id, t]));

  const DAY_TYPES = {
    weekday: { name: '平日', emoji: '🏫' },
    holiday: { name: '休日', emoji: '🌈' },
  };

  const STAR_BONUS = [0, 30, 80, 200];        // ★0〜★3 の日ボーナス
  const STAR_RATES = [0.5, 0.8, 1];           // ★1/★2/★3 に必要な達成率（予定時間ベース）
  const PLAN_BONUS = 30;
  const STREAK_REWARDS = { 3: 100, 7: 300, 14: 700, 21: 1000, 30: 2000, 50: 3000, 100: 10000 };
  const REST_TICKET_MAX = 3;
  const STAMPS_PER_CARD = 10;
  const WEEK_BOSS_HP = 12;
  const WEEK_BOSS_GOLD = 500;
  const WEEK_BOSSES = [
    { name: 'なまけスライム',       emoji: '🟢' },
    { name: 'あとまわしゴブリン',   emoji: '👺' },
    { name: 'ねむけのバク',         emoji: '😪' },
    { name: 'スマホのまもの',       emoji: '📱' },
    { name: 'だらだらドラゴン',     emoji: '🐉' },
    { name: 'サボりのまおう',       emoji: '😈' },
  ];

  // サンプル（最初の1回だけ入る。親子で直して使う前提）。勉強コマは40分以内＝タイマーの自動ストップと合わせる
  const SAMPLE_TEMPLATES = {
    weekday: [
      ['keisan', 960, 15], ['kanji', 975, 15], ['rest', 990, 15],
      ['yoshu_m', 1005, 40], ['free', 1045, 65], ['meal', 1110, 30],
      ['yoshu_j', 1140, 40], ['rest', 1180, 10], ['rika_anki', 1190, 20],
      ['bath', 1210, 30], ['free', 1240, 40],
    ],
    holiday: [
      ['keisan', 480, 15], ['kanji', 495, 15], ['testnaoshi', 540, 40],
      ['rest', 580, 20], ['ensyu_m', 600, 40], ['free', 640, 80],
      ['meal', 720, 60], ['yoshu_s', 780, 40], ['rest', 820, 20],
      ['yoshu_h', 840, 40], ['free', 880, 110], ['fukushu', 990, 30],
      ['meal', 1110, 30], ['bath', 1140, 30],
    ],
  };

  // ---- 日付 ----
  function pad2(n) { return String(n).padStart(2, '0'); }
  function keyOf(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function dateOf(key) { return new Date(key + 'T00:00:00'); }
  function today() { return keyOf(new Date()); }
  function addDays(key, n) { const d = dateOf(key); d.setDate(d.getDate() + n); return keyOf(d); }
  function weekStart(key) { const d = dateOf(key); const dow = d.getDay(); d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow)); return keyOf(d); }
  function wdJa(key) { return '日月火水木金土'[dateOf(key).getDay()]; }
  function fmtJa(key) { const d = dateOf(key); return `${d.getMonth() + 1}月${d.getDate()}日(${wdJa(key)})`; }
  function hm(min) { return `${Math.floor(min / 60)}:${pad2(min % 60)}`; }

  // ---- タスク ----
  function task(id) { return TASK_MAP[id] || { id, name: id, emoji: '❓', subj: null, def: 30 }; }
  function isStudy(id) { return !!task(id).subj; }
  function color(id) { const t = task(id); return t.subj ? SUBJ[t.subj].color : NONSTUDY_COLOR; }
  function newId() { return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---- 保存 ----
  function sampleTemplate(type) {
    return SAMPLE_TEMPLATES[type].map(([t, start, dur]) => ({ id: newId(), task: t, start, dur }));
  }
  function defaultSch() {
    const templates = {};
    for (const type of Object.keys(SAMPLE_TEMPLATES)) templates[type] = sampleTemplate(type);
    return {
      version: 2,
      templates,
      days: {},              // 'YYYY-MM-DD': { type, goal, blocks[], paid, planBonus, settled, stars }
      streak: 0, bestStreak: 0, lastSettled: null,
      restTickets: 1,
      stamps: 0,
      bossDmg: {}, bossDefeated: {},   // 週の月曜キーごと
      ledger: 0,             // スケジュールで得たゴールドの累計（取り消しで減ることもある）
      pendingResults: null,  // まだ見せていない「きのうのけっか」
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultSch();
      return migrate({ ...defaultSch(), ...JSON.parse(raw) });
    } catch (e) {
      return defaultSch();
    }
  }
  // 読むたびに通す（何度通しても同じ結果）。保存は次の update で行われる
  function migrate(s) {
    // v2: 日の種類を「塾の日／塾なし平日／休日」→「平日／休日」に。平日テンプレは「塾なし平日」を引き継ぐ
    if ((s.version || 1) < 2) {
      const t = s.templates;
      t.weekday = t.free || t.juku || t.weekday || sampleTemplate('weekday');
      if (!t.holiday) t.holiday = sampleTemplate('holiday');
      delete t.free;
      delete t.juku;
      for (const day of Object.values(s.days)) {
        if (day.type === 'juku' || day.type === 'free') day.type = 'weekday';
      }
      delete s.jukuDays;
      s.version = 2;
    }
    return s;
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  }
  // 別ページ・別タブとぶつからないよう、変更のたびに最新を読み直してから書く
  function update(fn) {
    const s = load();
    const r = fn(s);
    save(s);
    return { s, r };
  }

  // ---- 1日ぶん ----
  function suggestType(s, key) {
    const dow = dateOf(key).getDay();
    return dow === 0 || dow === 6 ? 'holiday' : 'weekday';
  }
  function newDay(s, key) {
    return { type: suggestType(s, key), goal: '', blocks: [], paid: 0, planBonus: false, settled: false, stars: 0 };
  }
  function ensureDay(s, key) {
    if (!s.days[key]) s.days[key] = newDay(s, key);
    return s.days[key];
  }
  function studyBlocks(day) { return (day && day.blocks || []).filter(b => isStudy(b.task)); }
  function actualMin(b) { return b.actualSec > 0 ? Math.round(b.actualSec / 60) : (b.done ? b.dur : 0); }
  function points(b) { return 20 + Math.round(b.dur / 2); }
  function stats(day) {
    const sb = studyBlocks(day);
    const planMin = sb.reduce((n, b) => n + b.dur, 0);
    const doneMin = sb.filter(b => b.done).reduce((n, b) => n + b.dur, 0);
    const rate = planMin > 0 ? doneMin / planMin : 0;
    let stars = 0;
    if (planMin > 0) for (let i = 0; i < 3; i++) if (rate >= STAR_RATES[i]) stars = i + 1;
    return {
      planMin, doneMin, rate, stars,
      actualMin: sb.reduce((n, b) => n + actualMin(b), 0),
      doneCount: sb.filter(b => b.done).length,
      count: sb.length,
    };
  }
  function earned(day) {
    return studyBlocks(day).filter(b => b.done).reduce((n, b) => n + points(b), 0) + STAR_BONUS[stats(day).stars];
  }
  // その日の「いま得ているべきゴールド」と支払いずみの差分だけ ledger を動かす（完了の取り消しにも対応）
  function syncDay(s, day) {
    if (!day || day.settled) return 0;
    const delta = earned(day) - (day.paid || 0);
    if (delta) { s.ledger += delta; day.paid = (day.paid || 0) + delta; }
    return delta;
  }
  function findBlock(s, key, id) {
    const day = s.days[key];
    return day ? { day, b: day.blocks.find(x => x.id === id) } : { day: null, b: null };
  }
  function markDone(s, key, id, via) {
    const { day, b } = findBlock(s, key, id);
    if (!b || b.done || !isStudy(b.task) || day.settled) return null;
    const before = stats(day).stars;
    b.done = true; b.via = via; b.doneAt = Date.now();
    syncDay(s, day);
    const after = stats(day).stars;
    return { pts: points(b), before, after, starGold: STAR_BONUS[after] - STAR_BONUS[before] };
  }
  function undoDone(s, key, id) {
    const { day, b } = findBlock(s, key, id);
    if (!b || !b.done || day.settled) return;
    b.done = false; b.via = null; b.doneAt = null;
    syncDay(s, day);
  }
  // 勉強以外の予定（ごはん・塾など）のチェック。ゴールドや★には関係しない
  function toggleOther(s, key, id) {
    const { day, b } = findBlock(s, key, id);
    if (!b || isStudy(b.task) || day.settled) return null;
    b.done = !b.done;
    b.doneAt = b.done ? Date.now() : null;
    return b.done;
  }
  function addActual(s, key, id, sec) {
    const { b } = findBlock(s, key, id);
    if (b && sec > 0) b.actualSec = (b.actualSec || 0) + sec;
  }
  // できなかったコマを翌日に回す（今日の予定からは消さない＝達成率は変わらない）
  function carry(s, key, id) {
    const { b } = findBlock(s, key, id);
    if (!b || b.done || b.carried) return null;
    const next = ensureDay(s, addDays(key, 1));
    next.blocks.push({ id: newId(), task: b.task, start: b.start, dur: b.dur, done: false, via: null, actualSec: 0, createdOn: today() });
    b.carried = true;
    return b;
  }
  // 前の日までに決めた勉強コマは、当日は消したり短くしたりできない（やらないコマを消して達成率を上げる抜け道を防ぐ）。
  // createdOn が無いコマ（この仕組みより前に作ったもの）も前の日に決めた扱い
  function isLocked(key, b) {
    return key === today() && isStudy(b.task) && (b.createdOn || '') < key;
  }
  function minDur(b) { return b.base != null ? b.base : b.dur; }

  // 計画ボーナスは「あした」の計画だけ（先の日まで作ってためるのを防ぐ）
  function maybePlanBonus(s, key) {
    const day = s.days[key];
    if (!day || day.planBonus || key !== addDays(today(), 1) || !studyBlocks(day).length) return 0;
    day.planBonus = true;
    s.ledger += PLAN_BONUS;
    return PLAN_BONUS;
  }

  // ---- 週ボス ----
  function weekBoss(wk) {
    const idx = Math.floor(dateOf(wk).getTime() / (7 * 86400000));
    return WEEK_BOSSES[((idx % WEEK_BOSSES.length) + WEEK_BOSSES.length) % WEEK_BOSSES.length];
  }

  // ---- 日のしめ（きのうまでを確定）。れんぞく・スタンプ・週ボスはここで決まる ----
  function settle(s) {
    const yesterday = addDays(today(), -1);
    let start;
    if (s.lastSettled) start = addDays(s.lastSettled, 1);
    else {
      const keys = Object.keys(s.days).filter(k => studyBlocks(s.days[k]).length).sort();
      if (!keys.length) return null;
      start = keys[0];
    }
    if (start > yesterday) return null;

    const res = { days: [], streakBefore: s.streak, streakAfter: 0, ticketsUsed: 0, ticketsGot: 0,
                  stamps: 0, chests: [], streakRewards: [], bossKills: [] };
    for (let k = start, guard = 0; k <= yesterday && guard < 400; k = addDays(k, 1), guard++) {
      const day = s.days[k];
      const planned = studyBlocks(day).length > 0;
      let stars = 0;
      if (day) {
        syncDay(s, day);
        const st = stats(day);
        stars = st.stars;
        day.stars = stars;
        day.settled = true;
        if (planned) res.days.push({ key: k, stars, actualMin: st.actualMin, doneCount: st.doneCount, count: st.count });
      }
      if (!planned) res.days.push({ key: k, noPlan: true });

      if (stars >= 1) {
        s.streak++;
        s.bestStreak = Math.max(s.bestStreak, s.streak);
        const r = STREAK_REWARDS[s.streak];
        if (r) { s.ledger += r; res.streakRewards.push({ days: s.streak, gold: r }); }
        if (s.streak % 7 === 0 && s.restTickets < REST_TICKET_MAX) { s.restTickets++; res.ticketsGot++; }
        s.stamps++; res.stamps++;
        if (s.stamps >= STAMPS_PER_CARD) {
          s.stamps -= STAMPS_PER_CARD;
          const g = 300 + Math.floor(Math.random() * 6) * 100;
          s.ledger += g; res.chests.push(g);
        }
        const wk = weekStart(k);
        s.bossDmg[wk] = (s.bossDmg[wk] || 0) + stars;
        if (!s.bossDefeated[wk] && s.bossDmg[wk] >= WEEK_BOSS_HP) {
          s.bossDefeated[wk] = true;
          s.ledger += WEEK_BOSS_GOLD;
          res.bossKills.push({ wk, boss: weekBoss(wk) });
        }
      } else if (s.streak > 0 && s.restTickets > 0) {
        s.restTickets--; res.ticketsUsed++;
      } else {
        s.streak = 0;
      }
    }
    s.lastSettled = yesterday;
    res.streakAfter = s.streak;
    s.pendingResults = mergeResults(s.pendingResults, res);
    return res;
  }
  function mergeResults(a, b) {
    if (!a) return b;
    return {
      days: [...a.days, ...b.days],
      streakBefore: a.streakBefore, streakAfter: b.streakAfter,
      ticketsUsed: a.ticketsUsed + b.ticketsUsed, ticketsGot: a.ticketsGot + b.ticketsGot,
      stamps: a.stamps + b.stamps,
      chests: [...a.chests, ...b.chests],
      streakRewards: [...a.streakRewards, ...b.streakRewards],
      bossKills: [...a.bossKills, ...b.bossKills],
    };
  }

  // ---- 集計（日・週・月） ----
  function aggregate(s, keys) {
    const byTask = {};
    let plan = 0, actual = 0, stars = 0, plannedDays = 0, rateSum = 0;
    for (const k of keys) {
      const day = s.days[k];
      const sb = studyBlocks(day);
      if (!sb.length) continue;
      const st = stats(day);
      plannedDays++; rateSum += Math.min(1, st.rate); stars += st.stars;
      plan += st.planMin; actual += st.actualMin;
      for (const b of sb) {
        const r = byTask[b.task] || (byTask[b.task] = { plan: 0, actual: 0 });
        r.plan += b.dur; r.actual += actualMin(b);
      }
    }
    return { byTask, plan, actual, stars, plannedDays, avgRate: plannedDays ? rateSum / plannedDays : 0 };
  }

  return {
    KEY, SUBJ, TASKS, DAY_TYPES, STAR_BONUS, STAR_RATES, PLAN_BONUS, STREAK_REWARDS,
    REST_TICKET_MAX, STAMPS_PER_CARD, WEEK_BOSS_HP, WEEK_BOSS_GOLD,
    pad2, keyOf, dateOf, today, addDays, weekStart, wdJa, fmtJa, hm,
    task, isStudy, color, newId,
    load, save, update,
    suggestType, newDay, ensureDay, studyBlocks, actualMin, points, stats, earned, syncDay,
    findBlock, markDone, undoDone, toggleOther, addActual, carry, isLocked, minDur, maybePlanBonus,
    weekBoss, settle, aggregate,
  };
})();

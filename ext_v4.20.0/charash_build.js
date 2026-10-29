// キャラッシュ(charash.jp)エモクロア・ガイアケア・10_st: API応答 `/api/sheets/{token}` から、サイト本体と同じ駒データ文字列を組み立てる。
// 移植元: サイト本体の chunk 1cnqw1jh992gk.js module 8658 の W(駒出力)・w(10_st)/c(コマンド)/o(技能行・オリジン行)、
//         chunk 34py9azdryqo6.js module 53495/12098/90309(技能表 N・V・H・p、正規化 er、HP/MP、ラベル Tz、融化 sl)。
//         出力設定は本体の駒ボタンと同じ(全技能出力なし・DAなし)。
// 当てはまらない形(version≠3、未対応システム)は停止する(推測しない)。オリジナル(none)はサイト本体に駒ボタンが無いため未対応。
// 【サイト本体との意図的な差(ユーザー指示 v4.9.0)】コマの name=「名前 (ふりがな)」、memo の1行目=同じ表示名で「ふりがな: …」行は無し。それ以外は本体とバイト一致。
(function (root) {
  'use strict';
  const fail = m => { throw new Error('キャラッシュ: ' + m); };
  const SUPPORTED = ['emoklore', 'gaiacare', '10_st'];

  // ---- 共鳴感情の分類(module 71134)----
  const EMO = [
    ['欲望', ['自己顕示', '所有', '本能', '破壊', '優越感', '怠惰', '逃避', '好奇心', 'スリル']],
    ['情念', ['喜び', '怒り', '哀しみ', '幸福', '不安', '嫌悪', '恐怖', '嫉妬', '恨み']],
    ['理想', ['正義', '崇拝', '善悪', '希望', '向上', '理性', '勝利', '秩序', '憧憬', '無我']],
    ['関係', ['友情', '愛', '恋', '依存', '尊敬', '軽蔑', '庇護', '支配', '奉仕', '甘え']],
    ['傷', ['後悔', '孤独', '諦観', '絶望', '否定', '疑念', '罪悪感', '狂気', '劣等感']]
  ];
  const groupOf = e => { for (const [n, l] of EMO) if (l.includes(e)) return n; return null; };

  // ---- 能力値 ----
  const G7 = ['body', 'dexterity', 'mind', 'senses', 'intellect', 'charm', 'social'];
  const J8 = G7.concat(['fortune']);
  const LABEL = { body: '身体', dexterity: '器用', mind: '精神', senses: '五感', intellect: '知力', charm: '魅力', social: '社会', fortune: '運勢' };
  const labelOf = (k, sys) => (k === 'fortune' && sys === 'gaiacare') ? '真価' : LABEL[k];   // Tz
  const FUSE_SPECIES = ['亜獣', '付喪', '越境者'];   // 融化できる種別(w)

  // ---- 技能表(module 53495 の o。エモクロア・ガイアケア共通。ガイアケアはオリジンが加わるが、コマンドでは別行で出す)----
  const S = (id, name, marker, refs, x) => Object.assign({ id, name, marker, abilityRefs: refs }, x || {});
  const F = { hasFreeField: true };
  const TABLE = [
    [S('investigation_base', '〈＊調査〉', 'base', ['dexterity']), S('search', '〈検索〉', 'normal', ['intellect']), S('insight', '〈洞察〉', 'normal', ['intellect']), S('mapping', '〈マッピング〉', 'normal', ['dexterity', 'senses']), S('intuition', '〈直感〉', 'normal', ['mind', 'fortune']), S('appraisal', '〈鑑定〉', 'normal', ['senses', 'intellect'])],
    [S('perception_base', '〈＊知覚〉', 'base', ['senses']), S('keen_eye', '〈観察眼〉', 'normal', ['senses']), S('listen', '〈聞き耳〉', 'normal', ['senses']), S('taste_test', '〈毒見〉', 'normal', ['senses']), S('danger_sense', '〈危機察知〉', 'normal', ['senses', 'fortune']), S('sixth_sense', '〈★霊感〉', 'ex', ['mind', 'fortune'])],
    [S('negotiation_base', '〈＊交渉〉', 'base', ['charm']), S('socializing', '〈社交術〉', 'normal', ['social']), S('debate', '〈ディベート〉', 'normal', ['intellect']), S('fascination', '〈魅了〉', 'normal', ['charm']), S('psychology', '〈心理〉', 'normal', ['mind', 'intellect'])],
    [S('knowledge_base', '〈＊知識〉', 'base', ['intellect']), S('expertise', '〈専門知識：○○〉', 'normal', ['intellect'], F), S('news_base', '〈＊ニュース〉', 'base', ['social']), S('well_informed', '〈事情通〉', 'normal', ['senses', 'social']), S('industry', '〈業界：○○〉', 'normal', ['social', 'charm'], F)],
    [S('athletics_base', '〈＊運動〉', 'base', ['body']), S('speed', '〈スピード〉', 'normal', ['body']), S('strength', '〈ストレングス〉', 'normal', ['body']), S('acrobat', '〈アクロバット〉', 'normal', ['body', 'dexterity']), S('dive', '〈ダイブ〉', 'normal', ['body']), S('melee_base', '〈＊格闘〉', 'base', ['body']), S('martial_art', '〈武術：○○〉', 'normal', ['body'], F), S('secret_art', '〈★奥義：○○〉', 'ex', ['body', 'mind', 'dexterity'], F), S('throw_base', '〈＊投擲〉', 'base', ['dexterity']), S('shooting', '〈★射撃：○○〉', 'ex', ['dexterity', 'senses'], F)],
    [S('survival_base', '〈＊生存〉', 'base', ['body']), S('endurance', '〈耐久〉', 'normal', ['body']), S('ego_base', '〈＊自我〉', 'base', ['mind']), S('guts', '〈根性〉', 'normal', ['mind']), S('first_aid_base', '〈＊手当て〉', 'base', ['intellect'], { special: 'half' }), S('medicine', '〈医術〉', 'normal', ['dexterity', 'intellect']), S('resuscitation', '〈★蘇生〉', 'ex', ['intellect', 'mind'], { special: 'halfNoLevel' })],
    [S('craft_base', '〈＊細工〉', 'base', ['dexterity']), S('technique', '〈技巧：○○〉', 'normal', ['dexterity'], F), S('art', '〈芸術：○○〉', 'normal', ['dexterity', 'mind', 'senses'], F), S('pilot', '〈操縦：○○〉', 'normal', ['dexterity', 'senses', 'intellect'], F), S('cipher', '〈暗号〉', 'normal', ['intellect']), S('cyber', '〈電脳〉', 'normal', ['intellect']), S('concealment', '〈隠匿〉', 'normal', ['dexterity', 'social', 'fortune']), S('luck_base', '〈＊幸運〉', 'base', ['fortune']), S('great_luck', '〈★強運〉', 'ex', ['fortune']), S('resonance', '〈∞共鳴〉', 'resonance', [])]
  ];

  // ---- 正規化(module 12098 の er。駒出力に関わる項目だけ)----
  const isStr = v => typeof v === 'string';
  const K = (v, d) => isStr(v) ? v : (d === undefined ? '' : d);
  const q = (v, lo, hi, d) => Math.min(hi, Math.max(lo, typeof v === 'number' && isFinite(v) ? Math.round(v) : d));
  const validAb = a => isStr(a) && J8.includes(a);
  function normSkill(e) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    const t = { level: q(e.level, 0, 3, 0) };
    if (isStr(e.freeField)) t.freeField = e.freeField;
    if (e.fused === true) t.fused = true;
    if (validAb(e.ability)) t.ability = e.ability;
    return t;
  }
  function overrideOf(ov, v, d) {   // ea
    let n = '';
    if (isStr(ov) || typeof ov === 'number') { const s = String(ov).trim(); n = /^\d{1,3}$/.test(s) ? String(Number(s)) : ''; }
    if (n !== '') return n;
    const i = q(v, 0, 999, d);
    return i !== d && i !== 0 ? String(i) : '';
  }
  function normalize(e) {
    const dd = e.abilities && typeof e.abilities === 'object' ? e.abilities : {};
    const ab = {};
    for (const k of J8) ab[k] = q(dd[k], 1, 99, 1);
    const skills = {};
    if (e.skills && typeof e.skills === 'object' && !Array.isArray(e.skills)) {
      for (const [id, n] of Object.entries(e.skills)) {
        const a = (Array.isArray(n) ? n : [n]).map(normSkill).filter(x => x !== null);
        if (a.length > 0) skills[id] = a;
      }
    }
    const hpD = ab.body + 10, mpD = ab.mind + ab.intellect;
    const rs = e.resonance && typeof e.resonance === 'object' ? e.resonance : {};
    return {
      name: K(e.name), nameKana: K(e.nameKana),
      paletteOverride: K(e.paletteOverride),
      abilities: ab,
      hpOverride: overrideOf(e.hpOverride, e.hp, hpD), mpOverride: overrideOf(e.mpOverride, e.mp, mpD),
      skills,
      customSkills: Array.isArray(e.customSkills) ? e.customSkills.filter(x => x && typeof x === 'object').map(x => ({ name: K(x.name), level: q(x.level, 0, 3, 0), ability: validAb(x.ability) ? x.ability : 'body' })) : [],
      resonancePermanent: typeof e.resonancePermanent === 'number' && isFinite(e.resonancePermanent) ? Math.round(e.resonancePermanent) : 0,
      resonance: { surface: K(rs.surface), hidden: K(rs.hidden), roots: K(rs.roots) },
      imageColor: K(e.imageColor),
      gcSpecies: K(e.gcSpecies)
    };
  }

  // ---- 駒出力(module 8658 / 53495)----
  const hpOf = e => e.hpOverride !== '' ? Number(e.hpOverride) : e.abilities.body + 10;
  const mpOf = e => e.mpOverride !== '' ? Number(e.mpOverride) : e.abilities.mind + e.abilities.intellect;
  const resonanceOf = e => Math.max(1, (e.skills.resonance && e.skills.resonance[0] && e.skills.resonance[0].level) != null ? e.skills.resonance[0].level : 1) + e.resonancePermanent;

  function refsOf(sk, lv, ab, fused) {   // V。fused=true(ガイアケアの融化)のときは「運勢」だけを参照する
    if (sk.abilityRefs.length === 0) return [];
    return (fused ? ['fortune'] : sk.abilityRefs).map(n => {
      const i = ab[n];
      const a = sk.special === 'half' || sk.special === 'halfNoLevel' ? Math.ceil(i / 2) : i;
      return { ability: n, abilityVal: a, value: a + (sk.marker !== 'base' && sk.special !== 'halfNoLevel' ? lv : 0) };
    });
  }
  const plainName = sk => {
    let t = sk.name.replace('〈', '').replace('〉', '').replace('＊', '').replace('★', '').replace('∞', '');
    if (sk.hasFreeField) t = t.replace('○○', '').replace('：', '');
    return t;
  };
  function skillLine(sk, lv, e, entry, sys) {   // o
    const fused = sys === 'gaiacare' && FUSE_SPECIES.includes(e.gcSpecies) && !!entry && entry.fused === true;   // sl
    const p = refsOf(sk, lv, e.abilities, fused);
    if (p.length === 0) return null;
    const f = fused ? undefined : (entry ? entry.ability : undefined);
    const m = p.find(x => x.ability === f) || p.reduce((a, b) => b.value > a.value ? b : a);
    const free = entry ? entry.freeField : undefined;
    const x = sk.hasFreeField && free ? '（' + free + '）' : '';
    return lv + 'DM<=' + m.value + ' 〈' + (sk.marker === 'base' ? '＊' : '') + plainName(sk) + x + '〉';
  }
  function originLine(e) {   // o(e)(ガイアケアのみ)
    const o = e.skills.origin_gc && e.skills.origin_gc[0] && e.skills.origin_gc[0].level != null ? e.skills.origin_gc[0].level : 1;
    const s = Math.max(1, o);
    return '(' + s + '+{共鳴})DM<=' + (e.abilities.fortune + s) + ' 〈オリジン〉';
  }
  function commands(e, sys) {   // c(includeAll=false, useDA=false)
    if (e.paletteOverride.trim() !== '') return e.paletteOverride;
    const head = ['{共鳴}DM<={強度} 〈∞共鳴〉', '({共鳴}+1)DM<={強度} 〈∞共鳴〉ルーツ属性一致', '({共鳴}*2)DM<={強度} 〈∞共鳴〉完全一致'];
    if (sys === 'gaiacare') head.push(originLine(e));
    const r = [], c = [];
    for (const g of TABLE) for (const t of g) {
      if (t.marker === 'resonance' || t.marker === 'origin') continue;
      if (t.marker === 'base') { const l = skillLine(t, 1, e, undefined, sys); if (l) c.push(l); continue; }
      const arr = e.skills[t.id] || [];
      if (arr.length === 0) continue;
      for (const a of arr) { if (a.level <= 0) continue; const l = skillLine(t, a.level, e, a, sys); if (l) r.push(l); }
    }
    for (const t of e.customSkills) {
      if (t.level <= 0) continue;
      if (t.name === '') continue;
      r.push(t.level + 'DM<=' + (e.abilities[t.ability] + t.level) + ' 〈' + t.name + '〉');
    }
    return head.concat(r, c).join('\n');
  }
  // コマの名前・メモ1行目に使う表示名: 「名前 (ふりがな)」(いあきゃらのコマと同じ形式。ふりがなが空なら名前のみ)
  const displayName = e => { const n = e.name || '名前未設定', k = e.nameKana.trim(); return k ? n + ' (' + k + ')' : n; };
  // メモ: 1行目=表示名、続けて共鳴感情(表・裏・ルーツのうち記入のあるもの)。「ふりがな: …」の行は出さない。
  function memoOf(e) {
    const t = [displayName(e)];
    for (const [s, n] of [['表', e.resonance.surface], ['裏', e.resonance.hidden], ['ルーツ', e.resonance.roots]]) {
      if (!n) continue;
      const g = groupOf(n);
      t.push('共鳴感情・' + s + ': ' + n + (g ? '(' + g + ')' : ''));
    }
    return t.join('\n');
  }

  // ---- 10_st(module 8658 の w。コマンド・ステータス・パラメータなし)----
  const LAYERS = ['B10_ck[1]', 'B10_ck[2]', 'B10_ck[3]', 'B10_ck[4]', 'B10_ck[5]', 'B10_ck[6]', 'B10_ck[7]'];
  function buildMinimal(d, opts, sys) {
    const e = normalize(d.shared);
    const s = d.systems[sys] || {};
    const dn = K(s.demonName), dnat = K(s.demonNature), dap = K(s.demonAppearance), xn = K(s.exp10deName), xa = K(s.exp10deAbility);
    const lay = K(s.demonLayer).trim(), dl = LAYERS.includes(lay) ? lay : '';
    const l = [displayName(e)];
    if (dn.trim()) l.push('契約悪魔: ' + dn);
    if (dnat.trim()) l.push('性格: ' + dnat);
    if (dl.trim()) l.push('階層: ' + dl);
    if (dap.trim()) l.push('見た目: ' + dap);
    if (xn.trim()) l.push(xn);
    if (xa.trim()) l.push(xa);
    const data = {
      name: displayName(e), memo: l.join('\n'), initiative: 0, externalUrl: opts.viewUrl || '', iconUrl: null, commands: '', status: [], params: [],
      faces: (opts.labels || []).filter(x => x !== '').map(x => ({ label: x, iconUrl: '' }))
    };
    if (e.imageColor) data.color = e.imageColor;
    return { koma: JSON.stringify({ kind: 'character', data }), warnings: [], name: e.name || '名前未設定' };
  }

  // resp: `/api/sheets/{token}` の JSON(オブジェクト)。opts: { system, viewUrl, labels:[差分画像のlabel(全画像の順)] }
  function buildEx(resp, opts) {
    const d = resp && resp.data;
    if (!d || d.version !== 3 || !d.shared || !d.systems) fail('データ形式(version 3)ではありません。未対応');
    const sys = opts.system || resp.system;
    if (!SUPPORTED.includes(sys)) fail('このシステム(' + sys + ')は駒に未対応です');
    if (sys === '10_st') return buildMinimal(d, opts, sys);
    const e = normalize(Object.assign({}, d.shared, d.systems[sys] || {}));
    const hp = hpOf(e), mp = mpOf(e);
    const sp = e.skills.speed && e.skills.speed[0] ? e.skills.speed[0].level : 0;
    const data = {
      name: displayName(e),
      memo: memoOf(e),
      initiative: e.abilities.body + sp,
      externalUrl: opts.viewUrl || '',
      iconUrl: null,
      commands: commands(e, sys),
      status: [{ label: 'HP', value: hp, max: hp }, { label: 'MP', value: mp, max: mp }, { label: '共鳴', value: resonanceOf(e), max: 9 }],
      params: J8.map(k => ({ label: labelOf(k, sys), value: String(e.abilities[k]) })),
      faces: (opts.labels || []).filter(x => x !== '').map(x => ({ label: x, iconUrl: '' }))
    };
    if (e.imageColor) data.color = e.imageColor;
    return { koma: JSON.stringify({ kind: 'character', data }), warnings: [], name: e.name || '名前未設定' };   // name は待機列の表示・画像名用(ふりがななしの名前)
  }
  const build = (resp, opts) => buildEx(resp, opts).koma;

  root.CharashBuild = { build, buildEx, SUPPORTED };
  if (typeof module !== 'undefined' && module.exports) module.exports = { build, buildEx, SUPPORTED };
})(typeof globalThis !== 'undefined' ? globalThis : this);

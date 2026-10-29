// いあきゃらのAPI応答(/v3/charasheet/{id})から、サイトの「すべての技能を出力 → ココフォリア駒出力」と
// 同じ文字列を再現する。DOMは読まない。
//
// v4.2: サイト本体(iachara.com)の処理を、そのまま移植した版。推測する規則はない。
//  ・正規化(本体の make6th): 能力値は Number(x)||0、技能は「位置」で読む(名前・初期値は本体の表で決まり、APIの値は使わない)、
//    名前が空なら「新たな探索者」、アイコン・追加技能は素通し。
//  ・計算(本体の calcAbility6thPoint / calcSkillSum6 / calDB6)と、出力(exportCharasheet 6版・全技能)を同じ式で移植。
//  ・値が数値でない場合も、本体と同じ演算(JavaScript の + )で、本体と同じ文字列(NaN など)を出す。その場合は warnings に載せる。
//  ・止まるのは、本体自身も処理できないデータ(API応答の形・6版/7版でない・能力値の入れ物がない 等)だけ。
// v4.3: 7版対応。本体の make7th / v1_0_0_make7th / update / calcAbility7thPoint / calcSkillSum7 / exportCharasheet(7版)を移植(下の「7版」節)。
//  6版の関数・出力は v4.2 から変更していない。
(function (root) {
  'use strict';

  const fail = m => { throw new Error('6版データを処理できません: ' + m); };

  // 本体 make6th が持つ技能表(区分ごと、API の static 配列の「位置」順)。[名前, 初期値]。
  //  'dex2' = DEX×2(回避)、'edu5' = EDU×5(母国語)。本体は API の defaultPoint を使わない。
  const SK = [
    ['battleSkills', [['回避', 'dex2'], ['キック', 25], ['組み付き', 25], ['こぶし（パンチ）', 50], ['頭突き', 10], ['投擲', 25],
      ['マーシャルアーツ', 1], ['拳銃', 20], ['サブマシンガン', 15], ['ショットガン', 30], ['マシンガン', 15], ['ライフル', 25]]],
    ['searchSkills', [['応急手当', 30], ['鍵開け', 1], ['隠す', 15], ['隠れる', 10], ['聞き耳', 25], ['忍び歩き', 10], ['写真術', 10],
      ['精神分析', 1], ['追跡', 10], ['登攀', 40], ['図書館', 25], ['目星', 25]]],
    ['actionSkills', [['運転', 20], ['機械修理', 20], ['重機械操作', 1], ['乗馬', 5], ['水泳', 25], ['製作', 5], ['操縦', 1],
      ['跳躍', 25], ['電気修理', 10], ['ナビゲート', 10], ['変装', 1]]],
    ['negotiationSkills', [['言いくるめ', 5], ['信用', 15], ['説得', 15], ['値切り', 5], ['母国語', 'edu5']]],
    ['knowledgeSkills', [['医学', 5], ['オカルト', 5], ['化学', 1], ['クトゥルフ神話', 0], ['芸術', 5], ['経理', 10], ['考古学', 1],
      ['コンピューター', 1], ['心理学', 5], ['人類学', 1], ['生物学', 1], ['地質学', 1], ['電子工学', 1], ['天文学', 1],
      ['博物学', 10], ['物理学', 1], ['法律', 5], ['薬学', 1], ['歴史', 20]]]
  ];
  // 技能名の後ろに追加名(additionalName)を付けるのは、この5技能だけ(本体の仕様)
  const NAMEABLE = ['運転', '製作', '操縦', '母国語', '芸術'];
  // 先頭にまとめて出す技能(本体の O)。区分ごとの一覧からは除く
  const TOP = ['目星', '聞き耳', '図書館', 'こぶし（パンチ）', '回避'];

  const ABILITY_KEYS = ['str', 'con', 'pow', 'dex', 'app', 'siz', 'int', 'edu'];
  const DIFF_KEYS = ['hp', 'mp', 'ide', 'luck', 'know', 'san'];
  const LABEL = k => k.toUpperCase();

  // 本体 calDB6(STR合計, SIZ合計 の和)
  const dbText = s =>
    s < 13 ? '-1D6' : s < 17 ? '-1D4' : s < 25 ? '+0' : s < 33 ? '+1D4' : s < 41 ? '+1D6' : s < 57 ? '+2D6' :
    s < 73 ? '+3D6' : s < 89 ? '+4D6' : s < 105 ? '+5D6' : s < 121 ? '+6D6' : '+' + Number(Math.ceil((s - 40) / 16) + 1) + 'D6';

  // build の本体。{ koma: 文字列, warnings: [] } を返す。opts.id = いあきゃらのページのID(なければ API の id)
  function buildEx(resp, opts) {
    opts = opts || {};
    if (!resp || resp.success !== true || !resp.data) fail('API応答の形式(success/data)');
    const top = resp.data;
    const d = top.data;
    if (!d) fail('data.data がない');
    if (d.version === '7th') return buildEx7(resp, opts);
    if (d.version !== '6th') fail('ルール版が 6th / 7th ではない(' + d.version + ')。このツールは6版・7版のみ対応です');
    const warnings = [];

    // ---- 正規化(本体 make6th)----
    const prof = d.profile || {};
    const name = prof.name || '新たな探索者';
    const furi = prof.furi || '';
    const icons = prof.icons || [];
    const ic0 = icons[0];
    const iconUrl = (ic0 == null ? undefined : ic0.url) || '';

    // テーマ色: jsonVersion が 1.0.0 / 1.0.1 以外なら、旧形式の外部プロフィール「テーマカラー」を優先(本体 update)
    let color;
    if (d.jsonVersion !== '1.0.1' && d.jsonVersion !== '1.0.0' && Array.isArray(prof.externalProfiles)) {
      const tc = prof.externalProfiles.find(x => x && x.name === 'テーマカラー');
      if (tc) color = tc.value || '';
    }
    if (color === undefined) color = (d.theme && d.theme.themeColor) || '';

    // 能力値: Number(x)||0。abilities 自体が無ければ全て 0。個別の入れ物が無いと本体も処理できない
    const ab0 = d.abilities == null ? null : d.abilities;
    const slot = k => {
      if (ab0 == null) return {};
      if (ab0[k] == null) fail('abilities.' + k + ' がない(本体でも処理できない形式)');
      return ab0[k];
    };
    const A = {};
    for (const k of ABILITY_KEYS) {
      const o = slot(k);
      const v = Number(o.value) || 0, f = Number(o.fixedDiff) || 0, t = Number(o.tmpFixedDiff) || 0;
      A[k] = { fixedDiff: f, tmpFixedDiff: t, sum: v + f + t };
    }
    const X = {};   // hp/mp/ide/luck/know/san の補正
    for (const k of DIFF_KEYS) { const o = slot(k); X[k] = (Number(o.fixedDiff) || 0) + (Number(o.tmpFixedDiff) || 0); }
    const userDB = ab0 == null ? '' : (ab0.userDB || '');
    const sanCurrent = ab0 == null ? 0 : (ab0.sanCurrent || 0);

    // ---- 計算(本体 calcAbility6thPoint)----
    const hp = Math.ceil((A.con.sum + A.siz.sum) / 2) + X.hp;
    const mp = A.pow.sum + X.mp;
    const ide = A.int.sum * 5 + X.ide;
    const luck = A.pow.sum * 5 + X.luck;
    const know = A.edu.sum * 5 + X.know;
    const db = dbText(A.str.sum + A.siz.sum);

    // ---- 技能(本体 make6th の位置読み + calcSkillSum6)----
    const skills = {};
    for (const [cat, tbl] of SK) {
      const sk = d[cat];
      let st = [];
      if (sk != null) { if (sk.static == null) fail(cat + '.static がない(本体でも処理できない形式)'); st = sk.static; }
      const add = (sk == null ? undefined : sk.additional) || [];
      if (!Array.isArray(add)) fail(cat + '.additional が配列ではない');
      const S = tbl.map(([nm, df], i) => {
        const it = st[i] == null ? {} : st[i];
        const def = df === 'dex2' ? 2 * A.dex.sum : df === 'edu5' ? 5 * A.edu.sum : df;
        return {
          name: nm,
          additionalName: NAMEABLE.includes(nm) ? (it.additionalName || '') : '',
          sumPoint: def + (it.professionPoint || 0) + (it.interestPoint || 0) + (it.growthPoint || 0) + (it.otherPoint || 0)
        };
      });
      // 追加技能は正規化されずに素通し。合計は本体と同じく、値をそのまま足す(欠けていれば NaN)
      const AD = add.map(x => {
        if (x == null) fail(cat + ' の追加技能に空の項目がある(本体でも処理できない形式)');
        return { name: x.name, sumPoint: x.defaultPoint + x.professionPoint + x.interestPoint + x.growthPoint + x.otherPoint };
      });
      skills[cat] = { static: S, additional: AD };
    }
    const byIdx = (cat, i) => skills[cat].static[i].sumPoint || 0;

    // ---- 出力(本体 exportCharasheet。6版・全技能・CCB)----
    const lines = [];
    const odd = (label, v) => { if (typeof v !== 'number' || !isFinite(v)) warnings.push(label + ' の値が数値ではありません(本体の出力と同じく ' + String(v) + ' になります)'); };
    lines.push('1d100<={SAN} 【正気度ロール】');
    lines.push('CCB<=' + (ide || 0) + ' 【アイデア】');
    lines.push('CCB<=' + (luck || 0) + ' 【幸運】');
    lines.push('CCB<=' + (know || 0) + ' 【知識】');
    lines.push('CCB<=' + byIdx('searchSkills', 11) + ' 【目星】');
    lines.push('CCB<=' + byIdx('searchSkills', 4) + ' 【聞き耳】');
    lines.push('CCB<=' + byIdx('searchSkills', 10) + ' 【図書館】');
    lines.push('CCB<=' + byIdx('battleSkills', 0) + ' 【回避】');
    lines.push('CCB<=' + byIdx('battleSkills', 3) + ' 【こぶし（パンチ）】');
    for (const [cat] of SK) {
      for (const e of skills[cat].static) {
        if (TOP.includes(e.name)) continue;
        odd(e.name, e.sumPoint);
        lines.push('CCB<=' + e.sumPoint + ' 【' + e.name + ('' == e.additionalName ? '' : '（' + e.additionalName + '）') + '】');
      }
      for (const e of skills[cat].additional) {
        odd(String(e.name), e.sumPoint);
        lines.push('CCB<=' + e.sumPoint + ' 【' + e.name + '】');
      }
    }

    // ダメージボーナス: 手入力があれば、先頭が数字(または空白)のとき + を付けて使う。なければ計算値
    let U = '';
    if (userDB) {
      const s = userDB.toString();
      U = !isNaN(Number(s.charAt(0))) ? '+' + s : s;
    }
    const dbLine = U || db || '+0';
    for (const dice of ['1d3', '1d4', '1d6']) lines.push(dice + dbLine + ' 【ダメージ判定】');
    for (const k of ABILITY_KEYS) lines.push('CCB<={' + LABEL(k) + '}*5 【' + LABEL(k) + ' × 5】');

    const data = {
      name: furi ? name + ' (' + furi + ')' : name,
      initiative: A.dex.sum || 0,
      externalUrl: 'https://iachara.com/view/' + (opts.id || top.id || fail('ページのIDが分からない')),
      iconUrl,
      commands: lines.join('\n') + '\n',
      status: [
        { label: 'HP', value: hp || 0, max: hp || 0 },
        { label: 'MP', value: mp || 0, max: mp || 0 },
        { label: 'SAN', value: sanCurrent || 0, max: sanCurrent || 0 }
      ],
      params: ABILITY_KEYS.map(k => ({ label: LABEL(k), value: A[k].sum.toString() || '0' }))
    };
    if (color) data.color = color;
    return { koma: JSON.stringify({ kind: 'character', data }), warnings };
  }

  // =====================================================================================
  // 7版(v4.3)。サイト本体 iachara.com v3.10.1 の _app-*.js から移植。
  //  make7th(正規化)/ v1_0_0_make7th + update(jsonVersion が 1.0.1 でない旧形式の変換)/ calcAbility7thPoint / calcSkillSum7 /
  //  calcDB7 / calcBLD7 / calcMOV7 / exportCharasheet(7版・全技能・CCB・幸運ダイスあり=サイト既定)。
  //  6版との違い: 技能の名前と初期値は本体の固定値(API の defaultPoint は、射撃・近接戦闘・追加技能でのみ使う)。
  //  値の読み方(||0 / ??25 / ||'')と、値が数値でないときの演算(+ による連結や NaN)も本体と同じ。
  // =====================================================================================
  const fail7 = m => { throw new Error('7版データを処理できません: ' + m); };

  // [名前, 初期値の読み方, additionalName を持つか]
  //  初期値: 数値=固定 / 'none'=キー無し(回避・母国語。合計の計算側で決まる) / 'raw0'=API値||0(射撃) / 'q25'=API値??25(近接戦闘)
  const SK7 = [
    ['battleSkills', [['回避', 'none', false], ['近接戦闘', 'q25', true], ['投擲', 20, false], ['射撃', 'raw0', true]]],
    ['searchSkills', [['応急手当', 30], ['鍵開け', 1], ['手さばき', 10], ['聞き耳', 20], ['隠密', 20], ['精神分析', 1], ['追跡', 10],
      ['登攀', 20], ['図書館', 20], ['目星', 25], ['鑑定', 5]]],
    ['actionSkills', [['運転', 20, true], ['機械修理', 10], ['重機械操作', 1], ['乗馬', 5], ['水泳', 20], ['芸術/製作', 5, true],
      ['操縦', 1, true], ['跳躍', 20], ['電気修理', 10], ['ナビゲート', 10], ['変装', 5]]],
    ['negotiationSkills', [['言いくるめ', 5], ['信用', 0], ['説得', 10], ['母国語', 'none', true], ['威圧', 15], ['魅惑', 15], ['言語', 1, true]]],
    ['knowledgeSkills', [['医学', 1], ['オカルト', 5], ['クトゥルフ神話', 0], ['経理', 5], ['考古学', 1], ['コンピューター', 5],
      ['科学', 1, true], ['心理学', 10], ['人類学', 1], ['電子工学', 1], ['自然', 10], ['法律', 5], ['歴史', 5], ['サバイバル', 10, true]]]
  ];
  // 旧形式(jsonVersion 1.0.0 以前。本体 v1_0_0_make7th)の技能表: 行動[5]=製作、知識[3]=芸術(計15)
  const SK7_OLD = SK7.map(([cat, list]) => [cat, list.map(x => x.slice())]);
  SK7_OLD[2][1][5] = ['製作', 5, true];
  SK7_OLD[4][1].splice(3, 0, ['芸術', 5, true]);

  const PIGO = ['professionPoint', 'interestPoint', 'growthPoint', 'otherPoint'];
  const AB7 = ['str', 'con', 'pow', 'dex', 'app', 'siz', 'int', 'edu'];
  const DIFF7 = ['hp', 'mp', 'ide', 'know', 'san'];

  // 技能の別名テーブル(本体 calcSkillSum7 の k)
  const TABLE7 = {
    拳銃: 20, 'ライフル/ショットガン': 25, 弓: 15, マシンガン: 15, 重火器: 10, サブマシンガン: 15, 火炎放射器: 10, 斧: 15, 格闘: 25,
    絞殺ひも: 15, チェーンソー: 10, 刀剣: 20, フレイル: 10, むち: 5, 槍: 20, 暗号学: 1, 化学: 1, 気象学: 1, 工学: 1, 植物学: 1,
    数学: 10, 生物学: 1, 地質学: 1, 天文学: 1, 動物学: 1, 物理学: 1, 法医学: 1, 薬学: 1
  };
  const NAMEHOLD7 = ['射撃', '運転', '芸術/製作', '操縦', '母国語', '言語', '科学', 'サバイバル', '近接戦闘'];

  // 能力値の読み方(本体 make7th / v1_0_0_make7th): Number(x)||0。abilities が無ければ全て 0、個別の入れ物が無いと本体も処理できない
  function readAbilities7(w, withMov) {
    const ab = w.abilities == null ? null : w.abilities;
    const slot = k => {
      if (ab == null) return {};
      if (ab[k] == null) fail7('abilities.' + k + ' がない(本体でも処理できない形式)');
      return ab[k];
    };
    const N = v => Number(v) || 0;
    const out = {};
    for (const k of AB7) { const o = slot(k); out[k] = { value: N(o.value), fixedDiff: N(o.fixedDiff), tmpFixedDiff: N(o.tmpFixedDiff) }; }
    for (const k of ['hp', 'mp', 'ide']) { const o = slot(k); out[k] = { fixedDiff: N(o.fixedDiff), tmpFixedDiff: N(o.tmpFixedDiff) }; }
    { const o = slot('luck'); out.luck = { value: N(o.value), fixedDiff: N(o.fixedDiff), tmpFixedDiff: N(o.tmpFixedDiff) }; }
    for (const k of ['know', 'san']) { const o = slot(k); out[k] = { fixedDiff: N(o.fixedDiff), tmpFixedDiff: N(o.tmpFixedDiff) }; }
    out.userDB = (ab == null ? undefined : ab.userDB) || '';
    out.sanCurrent = (ab == null ? undefined : ab.sanCurrent) || 0;
    if (withMov) out.userMOV = (ab == null ? undefined : ab.userMOV) || 0;   // 旧形式(v1)には userMOV が無い
    return out;
  }

  // 技能の読み方(本体 make7th): 位置で読み、名前と初期値は固定。職業・興味・成長・その他は ||0
  function readSkills7(w, tbl) {
    const R = {};
    for (const [cat, list] of tbl) {
      const sk = w[cat] == null ? null : w[cat];
      if (sk != null && sk.static == null) fail7(cat + '.static がない(本体でも処理できない形式)');
      const st = sk == null ? null : sk.static;
      const f = (i, key) => { if (st == null) return undefined; const o = st[i]; return o == null ? undefined : o[key]; };
      const stat = list.map(([name, def, adn], i) => {
        const r = { isGrow: f(i, 'isGrow') || false, name };
        if (adn) r.additionalName = f(i, 'additionalName') || '';
        if (def === 'raw0') r.defaultPoint = f(i, 'defaultPoint') || 0;
        else if (def === 'q25') { const v = f(i, 'defaultPoint'); r.defaultPoint = v == null ? 25 : v; }
        else if (def !== 'none') r.defaultPoint = def;
        for (const k of PIGO) r[k] = f(i, k) || 0;
        return r;
      });
      R[cat] = { static: stat, additional: sk == null ? [] : (sk.additional || []) };
    }
    return R;
  }

  function readCore7(w, tbl, main) {
    const prof = w.profile == null ? null : w.profile;
    const P = k => (prof == null ? undefined : prof[k]);
    return {
      name: P('name') || '新たな探索者',
      furi: P('furi') || '',
      icons: P('icons') || [],
      externalProfiles: P('externalProfiles'),
      ab: readAbilities7(w, main),
      sk: readSkills7(w, tbl)
    };
  }

  // 本体 update(= v1_0_0_make7th + 芸術/製作の整理)。jsonVersion が 1.0.1 でないデータを 1.0.1 の形にする
  function update7(w) {
    // v1_0_0_make7th: 1.0.0 でなければ、旧形式の外部プロフィール「テーマカラー」をテーマ色にする
    let uT, uI;
    if (w.jsonVersion !== '1.0.0') {
      const ep = (w.profile == null ? undefined : w.profile.externalProfiles) || [];
      if (!Array.isArray(ep)) fail7('profile.externalProfiles が配列ではない(本体でも処理できない形式)');
      const tc = ep.find(x => { if (x == null) fail7('profile.externalProfiles に空の項目がある(本体でも処理できない形式)'); return 'テーマカラー' === x.name; });
      if (tc) { uT = { themeColor: tc.value }; uI = ep.filter(x => 'テーマカラー' !== x.name); }
    }
    const k = readCore7(w, SK7_OLD, false);
    const th = (uT == null ? undefined : uT.themeColor) ?? (w.theme == null ? undefined : w.theme.themeColor);
    const theme = th != null ? th : '';
    void uI;   // 外部プロフィールの残りは出力に使わない

    // update: 知識[3](芸術)を行動[5](製作)へ移すか、知識の追加技能にして、知識[3]を取り除く
    const kn = k.sk.knowledgeSkills, ac = k.sk.actionSkills;
    const art = kn.static[3], mk = ac.static[5];
    const empty = s => !s.isGrow && '' === s.additionalName && 0 === s.professionPoint && 0 === s.interestPoint && 0 === s.growthPoint && 0 === s.otherPoint;
    const ee = empty(art), ei = empty(mk);
    if (!ee && ei) {
      mk.isGrow = art.isGrow; mk.additionalName = art.additionalName;
      for (const p of PIGO) mk[p] = art[p];
    } else if (!(ee || ei)) {
      if (!Array.isArray(kn.additional)) fail7('knowledgeSkills.additional が配列ではない(本体でも処理できない形式)');
      kn.additional = kn.additional.concat([{
        id: undefined, isGrow: art.isGrow, name: '芸術'.concat(art.additionalName ? '('.concat(art.additionalName, ')') : ''),
        defaultPoint: 5, professionPoint: art.professionPoint, interestPoint: art.interestPoint, growthPoint: art.growthPoint, otherPoint: art.otherPoint
      }]);
    }
    kn.static = kn.static.slice(); kn.static.splice(3, 1);
    // make7th が読む形に戻す
    return {
      jsonVersion: '1.0.1',
      profile: { name: k.name, furi: k.furi, icons: k.icons },
      abilities: k.ab,
      theme: { themeColor: theme },
      battleSkills: k.sk.battleSkills, searchSkills: k.sk.searchSkills, actionSkills: k.sk.actionSkills,
      negotiationSkills: k.sk.negotiationSkills, knowledgeSkills: k.sk.knowledgeSkills
    };
  }

  // 本体 make7th(正規化)
  function make7th(w) {
    if (w.jsonVersion !== '1.0.1') w = update7(w);
    const c = readCore7(w, SK7, true);
    const th = w.theme == null ? undefined : w.theme.themeColor;
    c.themeColor = th ?? '';
    return c;
  }

  // 本体 calcDB7 / calcBLD7 / calcMOV7(w=STR合計, k=DEX合計, $=SIZ合計)
  const db7 = s => s <= 64 ? '-2' : s <= 84 ? '-1' : s <= 124 ? '+0' : s <= 164 ? '+1D4' : s <= 204 ? '+1D6' : s <= 284 ? '+2D6' :
    s <= 364 ? '+3D6' : s <= 444 ? '+4D6' : ''.concat((s - 204) / 80 + 1, 'D6');
  const bld7 = s => s <= 64 && s >= 2 ? '-2' : s <= 84 ? '-1' : s <= 124 ? '0' : s <= 164 ? '+1' : s <= 204 ? '+2' : s <= 284 ? '+3' :
    s <= 364 ? '+4' : s <= 444 ? '+5' : ''.concat(Math.floor((s - 204) / 80 + 1));
  const mov7 = (w, k, $, ee) => k < $ && w < $ ? ''.concat(7 + ee) : k > $ && w > $ ? ''.concat(9 + ee) : ''.concat(8 + ee);

  // 本体 calcAbility7thPoint
  function calcAbility7(a) {
    const S = {};
    for (const k of AB7) S[k] = a[k].value + a[k].fixedDiff + a[k].tmpFixedDiff;
    S.luck = a.luck.value + a.luck.fixedDiff + a.luck.tmpFixedDiff;
    return {
      S,
      hp: Math.floor((S.con + S.siz) / 10) + a.hp.fixedDiff + a.hp.tmpFixedDiff,
      mp: Math.floor(S.pow / 5) + a.mp.fixedDiff + a.mp.tmpFixedDiff,
      ide: Math.floor(S.int) + a.ide.fixedDiff + a.ide.tmpFixedDiff,
      know: S.edu + a.know.fixedDiff + a.know.tmpFixedDiff,
      luck: S.luck,
      db: db7(S.str + S.siz),
      bld: bld7(S.str + S.siz),
      mov: mov7(S.str, S.dex, S.siz, a.userMOV)
    };
  }

  // 本体 calcSkillSum7(区分ごと)。合計は本体と同じく、値をそのまま + で足す
  function calcSkill7(cat, edu, dex) {
    const S = cat.static.map(w => {
      if (NAMEHOLD7.includes(w.name)) {
        if ('母国語' === w.name) {
          return { name: w.name, additionalName: w.additionalName, sumPoint: edu + w.professionPoint + w.interestPoint + w.growthPoint + w.otherPoint };
        }
        if ('射撃' !== w.name && '近接戦闘' !== w.name && '科学' !== w.name) {
          return { name: w.name, additionalName: w.additionalName, sumPoint: w.defaultPoint + w.professionPoint + w.interestPoint + w.growthPoint + w.otherPoint };
        }
        const d = TABLE7[w.additionalName] || w.defaultPoint;
        return { name: w.name, additionalName: w.additionalName, sumPoint: d + w.professionPoint + w.interestPoint + w.growthPoint + w.otherPoint };
      }
      if ('回避' === w.name) {
        return { name: w.name, additionalName: '', sumPoint: Math.floor(dex / 2) + w.professionPoint + w.interestPoint + w.growthPoint + w.otherPoint };
      }
      return { name: w.name, additionalName: '', sumPoint: w.defaultPoint + w.professionPoint + w.interestPoint + w.growthPoint + w.otherPoint };
    });
    if (!Array.isArray(cat.additional)) fail7('技能の additional が配列ではない(本体でも処理できない形式)');
    const AD = cat.additional.map(w => {
      if (w == null) fail7('追加技能に空の項目がある(本体でも処理できない形式)');
      return { name: w.name, sumPoint: w.defaultPoint + w.professionPoint + w.interestPoint + w.growthPoint + w.otherPoint };
    });
    return { static: S, additional: AD };
  }

  function buildEx7(resp, opts) {
    const top = resp.data;
    const warnings = [];
    const c = make7th(top.data);
    const m = calcAbility7(c.ab);
    const S = m.S;
    const sk = {};
    for (const [cat] of SK7) sk[cat] = calcSkill7(c.sk[cat], S.edu, S.dex);

    // ---- 出力(本体 exportCharasheet。7版・全技能・CCB・幸運ダイスあり)----
    const lines = [];
    const odd = (label, v) => { if (typeof v !== 'number' || !isFinite(v)) warnings.push(label + ' の値が数値ではありません(本体の出力と同じく ' + String(v) + ' になります)'); };
    const at = (cat, i) => sk[cat].static[i].sumPoint || 0;
    lines.push('CC<={SAN} 【正気度ロール】');
    lines.push('CCB<=' + (m.ide || 0) + ' 【アイデア】');
    lines.push('CCB<={幸運} 【幸運】');
    lines.push('CCB<=' + (m.know || 0) + ' 【知識】');
    lines.push('CCB<=' + at('searchSkills', 9) + ' 【目星】');
    lines.push('CCB<=' + at('searchSkills', 3) + ' 【聞き耳】');
    lines.push('CCB<=' + at('searchSkills', 8) + ' 【図書館】');
    lines.push('CCB<=' + at('battleSkills', 0) + ' 【回避】');
    const label = e => e.name + ('' == e.additionalName ? '' : '（' + e.additionalName + '）');
    for (const [cat] of SK7) {
      const filtered = cat === 'negotiationSkills' || cat === 'knowledgeSkills' ? sk[cat].static : sk[cat].static.filter(e => !TOP.includes(e.name));
      for (const e of filtered) { odd(label(e), e.sumPoint); lines.push('CCB<=' + e.sumPoint + ' 【' + label(e) + '】'); }
      for (const e of sk[cat].additional) { odd(String(e.name), e.sumPoint); lines.push('CCB<=' + e.sumPoint + ' 【' + e.name + '】'); }
    }

    let U = '';
    if (c.ab.userDB) {
      const s = c.ab.userDB.toString();
      U = !isNaN(Number(s.charAt(0))) ? '+' + s : s;
    }
    const dbLine = U || m.db || '+0';
    for (const dice of ['1d3', '1d4', '1d6']) lines.push(dice + dbLine + ' 【ダメージ判定】');
    for (const k of AB7) lines.push('CCB<={' + LABEL(k) + '}　【' + LABEL(k) + '】');

    const ic0 = c.icons[0];
    const data = {
      name: c.furi ? c.name + ' (' + c.furi + ')' : c.name,
      initiative: S.dex || 0,
      externalUrl: 'https://iachara.com/view/' + (opts.id || top.id || fail7('ページのIDが分からない')),
      iconUrl: (ic0 == null ? undefined : ic0.url) || '',
      commands: lines.join('\n') + '\n',
      status: [
        { label: 'HP', value: m.hp || 0, max: m.hp || 0 },
        { label: 'MP', value: m.mp || 0, max: m.mp || 0 },
        { label: 'SAN', value: c.ab.sanCurrent || 0, max: c.ab.sanCurrent || 0 }
      ],
      params: AB7.map(k => ({ label: LABEL(k), value: S[k].toString() || '0' }))
    };
    data.params.push({ label: 'BLD', value: m.bld || '0' });
    data.params.push({ label: 'MOV', value: m.mov || '0' });
    data.status.push({ label: '幸運', value: m.luck || 0, max: m.luck || 0 });
    if (c.themeColor) data.color = c.themeColor;
    return { koma: JSON.stringify({ kind: 'character', data }), warnings };
  }

  // 文字列だけが欲しいとき
  const build = (resp, opts) => buildEx(resp, opts).koma;

  root.KomaBuild = { build, buildEx };
  if (typeof module !== 'undefined' && module.exports) module.exports = { build, buildEx };
})(typeof globalThis !== 'undefined' ? globalThis : this);

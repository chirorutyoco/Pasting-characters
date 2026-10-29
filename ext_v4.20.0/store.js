// 保存データの出し入れ。いあきゃら側(ia_content.js)と background.js の両方から使う。保存先は拡張機能内の chrome.storage.local(ウェブには送らない)。
//  iaQueue: 待機列。今回ココフォリアに貼るキャラ。保存順。同じidは上書き。保存から3時間を過ぎたものは対象外(次の操作で削除)。貼り付けに成功したら列から消える。
//  iaFavs : お気に入り。期限なし。貼っても消えない。いあきゃらで同じidを保存し直すと中身も更新される。
// 1件 = { id, name, koma(駒JSON文字列), warnings[], images[{name,type,dataUrl,label}], savedAt }
(function (root) {
  'use strict';
  const EXPIRE = 3 * 60 * 60 * 1000;
  const valid = e => !!e && typeof e.id === 'string' && e.id !== '' && typeof e.koma === 'string';
  const alive = (e, now) => valid(e) && now - (e.savedAt || 0) < EXPIRE;

  let chain = Promise.resolve();   // 書き込みを1件ずつ処理する(同じコンテキスト内)
  const lock = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

  async function read() {
    const r = await chrome.storage.local.get(['iaQueue', 'iaFavs']);
    const rawQ = Array.isArray(r.iaQueue) ? r.iaQueue : [];
    const now = Date.now();
    const queue = rawQ.filter(e => alive(e, now));
    const favs = (Array.isArray(r.iaFavs) ? r.iaFavs : []).filter(valid);
    return { queue, favs, expired: queue.length !== rawQ.length };
  }
  const upsertLast = (list, e) => list.filter(x => x.id !== e.id).concat([e]);

  // 表示用の名前: 「名前 > CoC6版」「名前 > CoC7版」「名前 > エモクロア」。保存データの印(sys)は旧表記('6版' '7版' 'エモ')のままでも、表示のときにここで変換する。
  // 印が無い旧い保存データは、id が cs- で始まるものだけ「エモクロア」と判定(いあきゃらの旧データは印なし=保存し直すと付く。推測はしない)。
  const SYS_NAME = { '6版': 'CoC6版', '7版': 'CoC7版', 'エモ': 'エモクロア', 'ガイア': 'ガイアケア' };
  const sysOf = e => { const s = e.sys || (String(e.id).startsWith('cs-') ? 'エモクロア' : ''); return SYS_NAME[s] || s; };
  const labelOf = e => (e.name || e.id) + (sysOf(e) ? ' > ' + sysOf(e) : '');
  // 一覧を表示名にする。同じ表示名(同名・同システム)が複数あるときだけ、id 末尾4文字を ' #xxxx' として足す。
  const labelsOf = list => {
    const base = list.map(labelOf), cnt = {};
    base.forEach(b => { cnt[b] = (cnt[b] || 0) + 1; });
    return list.map((e, i) => (cnt[base[i]] > 1 ? base[i] + ' #' + String(e.id).slice(-4) : base[i]));
  };

  const api = {
    EXPIRE, sysOf, labelOf, labelsOf,
    // 結果表示の省略(画面からはみ出さないため): 5人以上は名前を並べない。失敗は4件まで・1件60字まで。
    listText: names => (names.length >= 5 || !names.length ? '' : ': ' + names.join('、')),
    ngText: ngs => (ngs.length ? '\n× ' + ngs.slice(0, 4).map(s => (String(s).length > 60 ? String(s).slice(0, 60) + '…' : String(s))).join('\n× ') + (ngs.length > 4 ? '\n…他' + (ngs.length - 4) + '件' : '') : ''),
    // 期限切れを除いた { queue, favs } を返す(期限切れがあれば保存データからも消す)
    getAll: () => lock(async () => {
      const s = await read();
      if (s.expired) await chrome.storage.local.set({ iaQueue: s.queue });
      return { queue: s.queue, favs: s.favs };
    }),
    // いあきゃらで保存: 待機列に追加(同じidは上書きして末尾へ)。お気に入りに同じidがあれば中身も更新
    saveChar: entry => lock(async () => {
      const s = await read();
      const queue = upsertLast(s.queue, entry);
      const isFav = s.favs.some(f => f.id === entry.id);
      const favs = isFav ? s.favs.map(f => (f.id === entry.id ? entry : f)) : s.favs;
      await chrome.storage.local.set({ iaQueue: queue, iaFavs: favs });
      return { queue, favs, isFav };
    }),
    // 貼り付けに成功した分を待機列から消す
    dropFromQueue: ids => lock(async () => {
      const s = await read();
      const queue = s.queue.filter(e => !ids.includes(e.id));
      await chrome.storage.local.set({ iaQueue: queue });
      return queue;
    }),
    // お気に入りから待機列へ
    addFavToQueue: id => lock(async () => {
      const s = await read();
      const fav = s.favs.find(f => f.id === id);
      if (!fav) return null;
      const entry = Object.assign({}, fav, { savedAt: Date.now() });
      const queue = upsertLast(s.queue, entry);
      await chrome.storage.local.set({ iaQueue: queue });
      return { queue, entry };
    }),
    // 待機中のキャラをお気に入りに登録(既にあれば同じ位置で更新)
    register: id => lock(async () => {
      const s = await read();
      const e = s.queue.find(x => x.id === id);
      if (!e) return null;
      const favs = s.favs.some(f => f.id === id) ? s.favs.map(f => (f.id === id ? e : f)) : s.favs.concat([e]);
      await chrome.storage.local.set({ iaQueue: s.queue, iaFavs: favs });
      return { entry: e, favs };
    }),
    unfav: id => lock(async () => {
      const s = await read();
      const e = s.favs.find(f => f.id === id);
      if (!e) return null;
      await chrome.storage.local.set({ iaFavs: s.favs.filter(f => f.id !== id) });
      return e;
    }),
    clearQueue: () => lock(async () => {
      const s = await read();
      await chrome.storage.local.set({ iaQueue: [] });
      return s.queue.length;
    })
  };
  root.IaStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

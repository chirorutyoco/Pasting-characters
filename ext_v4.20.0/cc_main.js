// ココフォリアのページ本体の世界(MAIN)で動く自己完結の関数。background.js が importScripts で読み込み、
// chrome.scripting.executeScript({ world: 'MAIN', func: ccMain, args: [koma文字列, 画像の配列] }) で実行する。
// 画面の操作(クリック・右クリック・編集画面・画像選択画面)は一切しない。盤面の状態にも依存しない。
//  1) 画像: ココフォリア自身のアップロード関数 addCurrentUserFile(file,'characters') を、本体の redux store に dispatch する
//          → 戻りの CDN URL を使う(外部URLは使えないため)。1枚目=iconUrl。2枚以上あるときは、全枚(1枚目を含む)を faces(立ち絵 {iconUrl,label})にも入れる。
//  2) 貼り付け: 盤面を包む最外コンテナの onPaste(本体の「貼り付け」処理)へ合成 paste イベントを送る。
//          本体が呼ぶ navigator.clipboard.read を、その1回だけコマJSONを返すものに差し替える(呼ばれた直後に元へ戻す)。
//  3) 成否: store の roomCharacters に新しいコマが増えたことで判定する(DOMは見ない)。
// 内部構造が見つからない場合は、理由を返して止まる(別方式への切り替えはしない)。
async function ccMain(komaText, images) {
  const T0 = performance.now();
  const t = {};
  const mark = k => { t[k] = Math.round(performance.now() - T0); };
  const ng = msg => ({ ok: false, msg, t });
  let restore = () => {};
  const LIM = 4 * 1024 * 1024;
  try {
    if (!/^\/rooms\//.test(location.pathname)) return ng('ココフォリアのルーム画面で押してください');
    if (!window.webpackChunkccfolia) return ng('ココフォリアの画面を読み取れません。ページを再読み込み(F5)してください');
    const C = window.__iaextC = window.__iaextC || {};

    // 本体モジュール(アップロード関数)。このビルドの番号に依存せず、export名で探す。
    if (!C.up) {
      let req = null;
      window.webpackChunkccfolia.push([[Symbol()], {}, r => { req = r; }]);
      if (!req) return ng('ココフォリアの画面を読み取れません。ページを再読み込み(F5)してください');
      for (const k of Object.keys(req.m)) {
        let s;
        try { s = req.m[k].toString(); } catch (e) { continue; }
        if (s.includes('addCurrentUserFile:()=>')) { C.up = req(k); break; }
      }
      if (!C.up || typeof C.up.addCurrentUserFile !== 'function') { C.up = null; return ng('画像を登録する機能が見つかりません。ココフォリアが更新された可能性があります'); }
    }
    mark('module');

    // 貼り付け先(onPaste を持つ最外コンテナ)と、そこから辿る redux store
    const eq = [...document.querySelectorAll('div')].find(d => {
      const k = Object.keys(d).find(x => x.startsWith('__reactProps$'));
      return k && typeof d[k].onPaste === 'function';
    });
    if (!eq) return ng('ココフォリアの画面を読み取れません。ルームの読み込み完了後に押してください');
    const fk = Object.keys(eq).find(x => x.startsWith('__reactFiber$'));
    let f = fk ? eq[fk] : null, store = null;
    for (let i = 0; f && i < 300; i++, f = f.return) {
      const s = f.memoizedProps && f.memoizedProps.store;
      if (s && typeof s.dispatch === 'function' && typeof s.getState === 'function') { store = s; break; }
    }
    if (!store) return ng('ココフォリアの画面を読み取れません。ページを再読み込み(F5)してください');
    const rooms = () => store.getState().entities.roomCharacters;
    if (!rooms()) return ng('ココフォリアのコマ情報を読み取れません。ページを再読み込み(F5)してください');
    mark('store');

    const koma = JSON.parse(komaText);
    if (!koma || !koma.data) return ng('保存データの形式が不正です。いあきゃら側でもう一度ボタンを押してください');
    koma.data.width = 10; koma.data.height = 10;   // コマサイズ(マス数)は常に 10×10 で貼り付ける

    // 画像1枚を File にする(4MB以上は本体が確認ダイアログを出すため、先に縮める)
    const toFile = async image => {
      const bin = atob(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1));
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      let file = new File([u8], image.name || 'icon.png', { type: image.type || 'image/png' });
      if (file.size < LIM) return file;
      const bmp = await createImageBitmap(file);
      let w = Math.round(bmp.width * Math.min(1, 2560 / Math.max(bmp.width, bmp.height)));
      let h = Math.round(bmp.height * (w / bmp.width));
      let out = null;
      for (let i = 0; i < 8 && !out; i++) {
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
        let b = await new Promise(r => cv.toBlob(r, 'image/png'));
        if (!b || b.size >= LIM) {
          const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
          const x2 = c2.getContext('2d'); x2.fillStyle = '#fff'; x2.fillRect(0, 0, w, h); x2.drawImage(bmp, 0, 0, w, h);
          b = await new Promise(r => c2.toBlob(r, 'image/jpeg', 0.9));
          if (b && b.size < LIM) out = new File([b], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
        } else out = new File([b], file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' });
        w = Math.round(w * 0.8); h = Math.round(h * 0.8);
      }
      return out;
    };

    // 1) 画像のアップロード(全枚を並行)。1枚目=iconUrl。2枚以上なら全枚を faces にする(同じURLを再利用。再アップロードしない)
    const imgs = Array.isArray(images) ? images.filter(x => x && x.dataUrl) : [];
    let uploaded = 0, faceN = 0;
    const urlOnly = !imgs.length && /^https:\/\/storage\.ccfolia-cdn\.net\//.test(koma.data.iconUrl || '');   // ココフォリアから保存したコマ: 画像は本体の保存先URLのまま使う(標準のコピー&貼り付けと同じ。再アップロードしない)
    if (koma.data.iconUrl && !urlOnly) {
      if (!imgs.length) return ng('アイコン画像が保存されていません。いあきゃらのページでもう一度ボタンを押してください');
      const urls = await Promise.all(imgs.map(async im => {
        const file = await toFile(im);
        if (!file) throw new Error('画像を4MB未満にできませんでした');
        const up = await store.dispatch(C.up.addCurrentUserFile(file, 'characters'));
        if (!up || !up.url) throw new Error('画像のアップロードに失敗しました(ログイン状態とルームへの参加を確認してください)');
        return up.url;
      }));
      uploaded = urls.length;
      koma.data.iconUrl = urls[0];
      // faces: キャラッシュの画像は、各画像に face(立ち絵にするか)の印が付く(サイトの駒出力と同じく、ラベルのある画像だけが立ち絵)。印が無い(いあきゃら)ときは従来どおり、2枚以上なら全枚。
      const marked = imgs.some(im => typeof im.face === 'boolean');
      const fidx = urls.map((_, i) => i).filter(i => !marked || imgs[i].face === true);
      if (marked ? fidx.length > 0 : urls.length > 1) {
        koma.data.faces = fidx.map(i => ({ iconUrl: urls[i], label: String(imgs[i].label || '') }));
        faceN = koma.data.faces.length;
      }
    }
    mark('upload');

    // 2) 貼り付け(合成 paste。clipboard.read は1回だけ差し替える)
    const before = new Set(rooms().ids);
    const text = JSON.stringify(koma);
    const item = { types: ['text/plain'], getType: async () => new Blob([text], { type: 'text/plain' }) };
    restore = () => { try { delete navigator.clipboard.read; } catch (e) {} };
    navigator.clipboard.read = async () => { restore(); return [item]; };
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    const newId = await new Promise(res => {
      let done = false, un = null;
      const fin = v => { if (done) return; done = true; if (un) un(); clearTimeout(tm); res(v); };
      const chk = () => { const n = rooms().ids.find(i => !before.has(i)); if (n !== undefined) fin(n); };
      const tm = setTimeout(() => fin(null), 4000);
      un = store.subscribe(chk);
      eq.dispatchEvent(ev);
    });
    restore();
    mark('pasted');
    if (newId == null) return ng('貼り付けを実行しましたが、コマが作られませんでした(観戦者の場合は作成できません)');
    // 3) 配置: 貼り付けただけでは全員が同じ位置に重なる。空いている枠(横5人×縦)に並べる。座標の更新は本体の updateRoomCharacter(export名で探す)。
    let placeNote = '', placeNg = false;
    try {
      if (!C.upd) {
        let rq = null;
        window.webpackChunkccfolia.push([[Symbol()], {}, r => { rq = r; }]);
        for (const k of Object.keys(rq.m)) {
          let s;
          try { s = rq.m[k].toString(); } catch (e) { continue; }
          if (s.includes('updateRoomCharacter:()=>')) { C.upd = rq(k); break; }
        }
      }
      if (!C.upd || typeof C.upd.updateRoomCharacter !== 'function') { C.upd = null; throw new Error('座標の更新関数が見つかりません'); }
      const e0 = rooms().entities[newId], S0 = store.getState();
      const c0 = (S0.app && S0.app.state && S0.app.state.roomScreenCellSize) || 24, w0 = 10 * c0, step = w0 + c0;
      const others = rooms().ids.filter(i => i !== newId).map(i => rooms().entities[i]).filter(Boolean);
      const hit = (x, y) => others.some(o => { const ow = (o.width || 4) * c0, oh = (o.height || 4) * c0; return o.x < x + w0 && o.x + ow > x && o.y < y + w0 && o.y + oh > y; });
      let px = e0.x, py = e0.y;
      for (let k = 0; k < 400; k++) { px = e0.x + (k % 5) * step; py = e0.y + Math.floor(k / 5) * step; if (!hit(px, py)) break; }
      if (px !== e0.x || py !== e0.y) {
        await store.dispatch(C.upd.updateRoomCharacter(newId, { x: px, y: py }));
        for (let i = 0; i < 30; i++) { const cur = rooms().entities[newId]; if (cur && cur.x === px && cur.y === py) break; await new Promise(r => setTimeout(r, 50)); }
        const cur = rooms().entities[newId];
        if (!cur || cur.x !== px || cur.y !== py) throw new Error('座標が反映されませんでした');
      }
    } catch (e) { placeNg = true; placeNote = ' ※並べ替えはできませんでした'; }
    mark('placed');
    const ent = rooms().entities[newId] || {};
    const iconOk = !koma.data.iconUrl || ent.iconUrl === koma.data.iconUrl;
    const sizeOk = ent.width === 10 && ent.height === 10;
    const faces = Array.isArray(ent.faces) ? ent.faces : [];
    const facesOk = faceN === 0 || (faces.length === faceN && koma.data.faces.every((x, i) => faces[i] && faces[i].iconUrl === x.iconUrl));
    return { ok: true, warn: !iconOk || !facesOk || !sizeOk || placeNg, id: newId, iconOk, facesOk, faceN, ms: t.pasted, t, entFaces: faces,
      msg: (koma.data.name || 'コマ') + ' を作成しました' +
        (iconOk ? '' : ' ※アイコンを反映できませんでした') + (sizeOk ? '' : ' ※コマサイズを反映できませんでした') + (facesOk ? '' : ' ※立ち絵を反映できませんでした') + placeNote };
  } catch (e) {
    restore();
    return ng((e && e.message ? e.message : '失敗'));
  }
}

// ココフォリアで選択中のコマ(左クリックで選んだもの)を読む。MAIN world で実行する自己完結の関数。画面は操作しない(読むだけ)。
// 戻り値: { ok:true, items:[{id,name,koma}] }(選択中のキャラクターがある) / { ok:false }(選択なし。貼り付けを行う) / { ok:false, msg }(読めない)
function ccGrab() {
  try {
    const eq = [...document.querySelectorAll('div')].find(d => { const k = Object.keys(d).find(x => x.startsWith('__reactProps$')); return k && typeof d[k].onPaste === 'function'; });
    if (!eq) return { ok: false };
    const fk = Object.keys(eq).find(x => x.startsWith('__reactFiber$'));
    let f = eq[fk], store = null;
    for (let i = 0; f && i < 300; i++, f = f.return) { const t = f.memoizedProps && f.memoizedProps.store; if (t && t.getState) { store = t; break; } }
    if (!store) return { ok: false };
    const S = store.getState();
    const sel = (S.app && S.app.state && S.app.state.selectedObjects) || [];
    const ents = (S.entities && S.entities.roomCharacters && S.entities.roomCharacters.entities) || {};
    const keys = ['name', 'playerName', 'memo', 'initiative', 'externalUrl', 'status', 'params', 'iconUrl', 'faces', 'width', 'height', 'active', 'secret', 'invisible', 'hideStatus', 'color', 'commands', 'diceSkin'];
    const items = [];
    for (const o of sel) {
      const e = o && o.selectType === 'character' ? ents[o.id] : null;
      if (!e) continue;
      const data = {};
      for (const k of keys) if (e[k] !== undefined) data[k] = JSON.parse(JSON.stringify(e[k]));
      items.push({ id: String(o.id), name: String(e.name || ''), koma: JSON.stringify({ kind: 'character', data }) });
    }
    return items.length ? { ok: true, items } : { ok: false };
  } catch (e) { return { ok: false, msg: String((e && e.message) || e) }; }
}

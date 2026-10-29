// キャラッシュ(charash.jp)の対応システムのページ: ツールバーのボタンが押されたら、API応答から駒データ文字列を組み立てて、待機列(store.js)に追加する。
// 組み立ては charash_build.js(サイト本体の駒出力の移植)。画像は /api/sheets/{token}/image(位置0=アイコン、ラベルのある差分=立ち絵)。
(() => {
  'use strict';

  const toDataUrl = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  function sniffType(dataUrl) {
    try {
      const b = atob(dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 17));
      const c = i => b.charCodeAt(i);
      if (c(0) === 0x89 && b.slice(1, 4) === 'PNG') return 'image/png';
      if (c(0) === 0xFF && c(1) === 0xD8 && c(2) === 0xFF) return 'image/jpeg';
      if (b.slice(0, 4) === 'GIF8') return 'image/gif';
      if (b.slice(0, 4) === 'RIFF' && b.slice(8, 12) === 'WEBP') return 'image/webp';
    } catch (e) {}
    return null;
  }
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  async function webpToPng(dataUrl) {
    if (typeof createImageBitmap !== 'function') return null;
    const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u8], { type: 'image/webp' }));
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0);
    const out = await new Promise(res => cv.toBlob(res, 'image/png'));
    return out ? await toDataUrl(out) : null;
  }
  async function fetchImage(url, baseName, k, label, face) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const b = await res.blob();
    let dataUrl = await toDataUrl(b);
    let type = sniffType(dataUrl) || (/^image\//.test(b.type || '') ? b.type.split(';')[0] : 'image/png');
    if (type === 'image/webp') {   // ココフォリアの対応形式は JPG / PNG / GIF / APNG。WebP は PNG に変換する
      try { const p = await webpToPng(dataUrl); if (p) { dataUrl = p; type = 'image/png'; } } catch (e) {}
    }
    const ext = EXT[type] || (type.split('/')[1] || 'png').split('+')[0];
    return { name: baseName + '_' + (k + 1) + '.' + ext, type, dataUrl, label, face };
  }

  // URL: /view/{token}/{system}  または  /edit/{token}?system={system}
  const COC = (typeof CharashCoc !== 'undefined' && CharashCoc.SUPPORTED) || [];   // coc6・coc7 は charash_coc.js が組み立てる
  const SUPPORTED = ((typeof CharashBuild !== 'undefined' && CharashBuild.SUPPORTED) || ['emoklore']).concat(COC);
  const builderOf = sys => (COC.includes(sys) ? CharashCoc : CharashBuild);
  const SYS_LABEL = { emoklore: 'エモ', gaiacare: 'ガイア', '10_st': '10_st', coc6: '6版', coc7: '7版' };   // store.js の表示名に対応する印(6版→CoC6版、7版→CoC7版)
  function parseUrl() {
    const seg = location.pathname.split('/').filter(Boolean);
    const token = seg[1];
    if (!token || (seg[0] !== 'view' && seg[0] !== 'edit')) throw new Error('キャラクターのページで押してください');
    const system = seg[0] === 'view' ? seg[2] : new URLSearchParams(location.search).get('system');
    return { token, system: system || null };
  }

  // CoC の出力設定(技能の並び・お気に入り技能・全技能・CCB)はサイトのアカウント設定。ページ(RSC)に埋め込まれているので、同じページを取得して読む。
  // ログイン無しでも既定値(お気に入り6技能など)が必ず入っている。読めないのはサイトの形式が変わったときなので、既定値(空)で続行せず止める(続行するとサイトの駒出力とずれる)。
  async function cocSettings(token, system) {
    const bad = () => new Error('出力設定を読み取れませんでした。サイトが更新された可能性があります');
    const r = await fetch('/view/' + token + '/' + system, { credentials: 'same-origin' });
    if (!r.ok) throw bad();
    const u = (await r.text()).replace(/\\"/g, '"');
    const g = /"cocSkillGrouping":"(\w+)"/.exec(u), i = u.indexOf('"cocPalette":');
    if (!g || i < 0 || !['standard', 'functional', 'aiueo'].includes(g[1])) throw bad();
    const j = u.indexOf('{', i);
    let d = 0, e = -1;
    for (let k = j; j >= 0 && k < u.length; k++) { const c = u[k]; if (c === '{') d++; else if (c === '}' && --d === 0) { e = k; break; } }
    if (j < 0 || e < 0) throw bad();
    let o;
    try { o = JSON.parse(u.slice(j, e + 1)); } catch (x) { throw bad(); }
    if (!o || !Array.isArray(o.favorites) || typeof o.allSkills !== 'boolean') throw bad();
    // 技能は常に全技能を出力する(いあきゃらの「すべての技能を出力」と同じ)。アカウント設定の allSkills(既定 false)には従わない。並び・CCB・お気に入りは設定どおり。
    const s = { favorites: o.favorites, includeAll: true, ccb: o.ccb !== false };
    if (g[1] !== 'standard') s.skillGrouping = g[1];
    return s;
  }

  async function saveOne(token, urlSys) {
    const r = await fetch('/api/sheets/' + token, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('キャラのデータを取得できませんでした');
    const resp = await r.json();
    const system = urlSys || resp.system;
    if (!SUPPORTED.includes(system)) return { ok: false, warn: false, msg: 'このシステムは未対応です' };
    const ri = await fetch('/api/sheets/' + token + '/images', { credentials: 'same-origin' });
    if (!ri.ok) throw new Error('画像の一覧を取得できませんでした');
    const list = ((await ri.json()).images || []).slice().sort((a, b) => a.position - b.position);

    const { koma: komaText, warnings, name } = builderOf(system).buildEx(resp, {
      system, viewUrl: location.origin + '/view/' + token + '/' + system, labels: list.map(x => String(x.label || '')),
      settings: COC.includes(system) ? await cocSettings(token, system) : undefined
    });
    // 画像: position順(先頭=アイコン)。
    const url = im => '/api/sheets/' + token + '/image?v=' + im.version + (im.position > 0 ? '&p=' + im.position : '');
    // いあきゃらと同じ規則: 先頭の画像=アイコン。画像が2枚以上なら、アイコンを含む全画像を立ち絵にする(ラベルは設定されているときだけ入れる。無ければ空)。
    const want = list.map(im => ({ im, label: String(im.label || ''), face: list.length >= 2 }));
    const got = await Promise.all(want.map((w, k) => fetchImage(url(w.im), name || 'chara', k, w.label, w.face).then(v => ({ v }), e => ({ e }))));
    const images = got.filter(g => g.v).map(g => g.v);
    if (images.length !== want.length) {
      return { ok: false, warn: false, msg: name + ': 画像を取得できませんでした(保存していません)' };
    }
    // ココフォリア側(cc_main.js)はアイコンの有無を iconUrl の有無で判断する。画像があるときだけ印を付ける(貼り付け時に本物のURLへ置き換わる)
    const k = JSON.parse(komaText);
    if (list.length) k.data.iconUrl = 'pending';
    const entry = { id: 'cs-' + token, name, sys: SYS_LABEL[system] || '', koma: JSON.stringify(k), warnings, images, savedAt: Date.now() };
    const st = await IaStore.saveChar(entry);
    const faceN = images.filter(x => x.face).length;
    const msg = name + ' を保存しました' + (warnings.length ? ' ※一部の値は推定です' : '');
    return { ok: true, warn: warnings.length > 0, msg, name, queueLen: st.queue.length };
  }

  // キャラクターページ(view/edit)でその1体を待機列へ保存する(一覧ページからの一括保存はしない)。
  async function save() {
    const { token, system } = parseUrl();
    return saveOne(token, system);
  }

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg.cmd !== 'save') return;
    save().then(send).catch(e => send({ ok: false, msg: e.message }));
    return true;
  });
})();

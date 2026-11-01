(function () {
  'use strict';
  var IMG = window.EDO_IMAGE, SPOTS = window.SPOTS, LOTS = window.LOTS;
  var CALIBRATE = /[?&]calibrate=1/.test(location.search);

  /* ---------- 位置合わせ: 現代(緯度経度) <-> 江戸絵図(ピクセル) ---------- */
  // 緯度経度をメートル(複素数 x+iy)にし、複素数の一次式 w = a*z + b(相似変換)で絵図ピクセルに合わせる。
  // そのうえで基準点の残差を距離の逆二乗で補間して足す(基準点ではほぼ誤差ゼロになる)。
  var LAT0 = 35.675, LNG0 = 139.745, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 110574;
  function Z(lat, lng) { return { x: (lng - LNG0) * KX, y: (lat - LAT0) * KY }; }
  function unZ(z) { return { lat: z.y / KY + LAT0, lng: z.x / KX + LNG0 }; }
  function cmul(p, q) { return { x: p.x * q.x - p.y * q.y, y: p.x * q.y + p.y * q.x }; }
  function cdiv(p, q) { var d = q.x * q.x + q.y * q.y; return { x: (p.x * q.x + p.y * q.y) / d, y: (p.y * q.x - p.x * q.y) / d }; }

  var controls = SPOTS.concat(window.EXTRA_CONTROLS || []).filter(function (s) { return s.control || s.id === 'kisha'; })
    .map(function (s) { return { z: Z(s.lat, s.lng), w: { x: s.edo.x, y: -s.edo.y } }; });
  var A, B;
  (function fit() {
    var n = controls.length, zm = { x: 0, y: 0 }, wm = { x: 0, y: 0 };
    controls.forEach(function (c) { zm.x += c.z.x / n; zm.y += c.z.y / n; wm.x += c.w.x / n; wm.y += c.w.y / n; });
    var num = { x: 0, y: 0 }, den = 0;
    controls.forEach(function (c) {
      var dz = { x: c.z.x - zm.x, y: c.z.y - zm.y }, dw = { x: c.w.x - wm.x, y: c.w.y - wm.y };
      var t = cmul({ x: dz.x, y: -dz.y }, dw); num.x += t.x; num.y += t.y; den += dz.x * dz.x + dz.y * dz.y;
    });
    A = { x: num.x / den, y: num.y / den };
    var t = cmul(A, zm); B = { x: wm.x - t.x, y: wm.y - t.y };
    controls.forEach(function (c) { var p = cmul(A, c.z); c.r = { x: c.w.x - p.x - B.x, y: c.w.y - p.y - B.y }; });
  })();
  var PX_PER_M = Math.hypot(A.x, A.y);
  function corr(z) {
    var sx = 0, sy = 0, sw = 0;
    controls.forEach(function (c) {
      var wt = 1 / (Math.pow(z.x - c.z.x, 2) + Math.pow(z.y - c.z.y, 2) + 400);
      sx += wt * c.r.x; sy += wt * c.r.y; sw += wt;
    });
    return { x: sx / sw, y: sy / sw };
  }
  function toEdo(lat, lng) {
    var z = Z(lat, lng), p = cmul(A, z), c = corr(z);
    return { x: p.x + B.x + c.x, y: -(p.y + B.y + c.y) };
  }
  function toLatLng(x, y) {
    var w = { x: x, y: -y }, z = cdiv({ x: w.x - B.x, y: w.y - B.y }, A);
    for (var i = 0; i < 8; i++) { var c = corr(z); z = cdiv({ x: w.x - B.x - c.x, y: w.y - B.y - c.y }, A); }
    return unZ(z);
  }
  // 各スポットの絵図上の位置を確定
  SPOTS.forEach(function (s) {
    s.edoPos = s.edo ? { x: s.edo.x, y: s.edo.y } : toEdo(s.lat, s.lng);
    s.off = s.edoPos.x < 40 || s.edoPos.y < 40 || s.edoPos.x > IMG.w - 40 || s.edoPos.y > IMG.h - 40;
  });
  function edoLL(p) { return L.latLng(IMG.h - p.y, p.x); }
  function llToEdoPx(ll) { return { x: ll.lng, y: IMG.h - ll.lat }; }

  /* ---------- 地図 ---------- */
  var edoMap = L.map('map-edo', { crs: L.CRS.Simple, minZoom: -3, maxZoom: 2, zoomSnap: 0.25, zoomControl: false, attributionControl: false });
  var PAD = 700;
  L.imageOverlay(IMG.src, [[0, 0], [IMG.h, IMG.w]]).addTo(edoMap);
  edoMap.setMaxBounds([[-PAD, -PAD], [IMG.h + PAD, IMG.w + PAD]]);
  var nowMap = L.map('map-now', { zoomSnap: 0.25, zoomControl: false });
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>'
  }).addTo(nowMap);
  L.control.zoom({ position: 'bottomright' }).addTo(nowMap);
  L.control.zoom({ position: 'bottomright' }).addTo(edoMap);

  var GMapControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      var a = L.DomUtil.create('a', 'gmap-btn gmap-ctl');
      a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Googleマップで開く'; a.title = '表示中の中心地点をGoogleマップで開く';
      L.DomEvent.disableClickPropagation(a);
      this._a = a; this.update(); return a;
    },
    update: function () { if (!nowMap._loaded) return; var c = nowMap.getCenter(); this._a.href = gmapsUrl(c.lat, c.lng); }
  });
  var gmapCtl = new GMapControl().addTo(nowMap);
  nowMap.on('move', function () { gmapCtl.update(); });

  // 2つの地図を連動させる
  var syncing = false;
  function zoomOffset(lat) { return -Math.log2(156543.03 * Math.cos(lat * Math.PI / 180) * PX_PER_M); } // edoZoom = nowZoom + offset
  function syncFrom(src) {
    if (syncing) return; syncing = true;
    try {
      if (src === 'edo') {
        var ll = toLatLng(llToEdoPx(edoMap.getCenter()).x, llToEdoPx(edoMap.getCenter()).y);
        nowMap.setView([ll.lat, ll.lng], edoMap.getZoom() - zoomOffset(ll.lat), { animate: false });
      } else {
        var c = nowMap.getCenter(), p = toEdo(c.lat, c.lng);
        edoMap.setView(edoLL(p), nowMap.getZoom() + zoomOffset(c.lat), { animate: false });
      }
    } finally { setTimeout(function () { syncing = false; }, 0); }
  }
  edoMap.on('moveend', function () { syncFrom('edo'); });
  nowMap.on('moveend', function () { syncFrom('now'); });

  /* ---------- マーカー ---------- */
  var markers = {}, selectedId = null;
  function numIcon(i, cls) { return L.divIcon({ className: '', html: '<span class="num ' + (cls || '') + '">' + (i + 1) + '</span>', iconSize: [24, 24], iconAnchor: [12, 12] }); }
  SPOTS.forEach(function (s, i) {
    var cls = s.off ? 'off' : '';
    var me = L.marker(edoLL(s.edoPos), { icon: numIcon(i, cls), title: s.name, draggable: CALIBRATE }).addTo(edoMap).on('click', function () { select(s.id); });
    var mn = L.marker([s.lat, s.lng], { icon: numIcon(i, cls), title: s.name, draggable: CALIBRATE }).addTo(nowMap).on('click', function () { select(s.id); });
    markers[s.id] = { edo: me, now: mn, i: i, cls: cls };
  });
  function refreshMarkers() {
    SPOTS.forEach(function (s) {
      var m = markers[s.id], cls = (s.id === selectedId ? 'sel' : m.cls);
      m.edo.setIcon(numIcon(m.i, cls)); m.now.setIcon(numIcon(m.i, cls));
      m.edo.setZIndexOffset(s.id === selectedId ? 1000 : 0); m.now.setZIndexOffset(s.id === selectedId ? 1000 : 0);
    });
  }
  var meMarkers = null, pinMarkers = null;
  function placeMarkers(holder, lat, lng, cls, size) {
    var p = toEdo(lat, lng), icon = L.divIcon({ className: '', html: '<span class="' + cls + '"></span>', iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] });
    if (holder) { holder.edo.setLatLng(edoLL(p)); holder.now.setLatLng([lat, lng]); return holder; }
    return { edo: L.marker(edoLL(p), { icon: icon, interactive: false, zIndexOffset: 2000 }).addTo(edoMap), now: L.marker([lat, lng], { icon: icon, interactive: false, zIndexOffset: 2000 }).addTo(nowMap) };
  }

  /* ---------- 解説パネル ---------- */
  var panel = document.getElementById('panel');
  var here = null;          // {lat,lng} 現在地
  var searchResult = null;  // {lat,lng,label}
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Google マップ(APIキー不要の検索URL)。PCは新しいタブ、スマホは端末のユニバーサルリンクでアプリが開く
  function gmapsUrl(lat, lng) { return 'https://www.google.com/maps/search/?api=1&query=' + lat.toFixed(6) + ',' + lng.toFixed(6); }
  function gmapsBtn(lat, lng) { return '<a class="gmap-btn" href="' + gmapsUrl(lat, lng) + '" target="_blank" rel="noopener">Googleマップで開く</a>'; }
  function dist(a, b) {
    var R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtDist(m) { return m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1) + ' km'; }
  function spotList(items, withDist) {
    return '<ul class="list">' + items.map(function (s) {
      return '<li tabindex="0" data-id="' + s.id + '"><span class="num ' + (s.off ? 'off' : '') + '">' + (SPOTS.indexOf(s) + 1) + '</span><span>' + esc(s.name) + '</span>' +
        (withDist ? '<span class="dist">' + fmtDist(s.d) + '</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function nearby(pt, n) {
    return SPOTS.map(function (s) { return Object.assign({ d: dist(pt, s) }, s); }).sort(function (a, b) { return a.d - b.d; }).slice(0, n)
      .map(function (c) { return Object.assign(SPOTS.filter(function (s) { return s.id === c.id; })[0], { d: c.d }); });
  }
  function lotAnswer(pt) {
    var p = toEdo(pt.lat, pt.lng);
    if (p.x < 0 || p.y < 0 || p.x > IMG.w || p.y > IMG.h) return '<p class="note">この場所は、手元の江戸絵図の範囲の外です。近くの史跡を下に表示します。</p>';
    var best = null, bd = 1e9;
    LOTS.forEach(function (l) { var d = Math.hypot(l.edo.x - p.x, l.edo.y - p.y); if (d < bd) { bd = d; best = l; } });
    var reach = bd < 260;
    return reach
      ? '<p class="body"><b>江戸時代、この近くには「' + esc(best.name) + '」がありました。</b><br>' + esc(best.note) + '</p>'
      : '<p class="body">絵図の範囲内ですが、屋敷名を特定できる資料はまだ登録していません。絵図上の位置を確認してください。</p>';
  }
  function renderHome() {
    selectedId = null; refreshMarkers();
    var h = '<div class="card"><h2>' + esc(window.ABOUT.title) + '</h2><p class="lead">' + esc(window.ABOUT.text) + '</p></div>';
    if (searchResult) {
      h += '<div class="card"><h3>検索: ' + esc(searchResult.label) + '</h3>' + lotAnswer(searchResult) + gmapsBtn(searchResult.lat, searchResult.lng) +
        spotList(nearby(searchResult, 3), true) + '</div>';
    }
    if (here) h += '<div class="card"><h3>現在地の近くの史跡</h3>' + lotAnswer(here) + gmapsBtn(here.lat, here.lng) + spotList(nearby(here, 4), true) + '</div>';
    h += '<div class="card"><h3>散歩コース</h3>' + spotList(SPOTS, false) +
      '<p class="note">絵図上の位置は、基準点から計算した目安です(絵図は縮尺が一定ではありません)。点線の丸は、手元の絵図の範囲外にあたる場所です。</p></div>';
    panel.innerHTML = h; panel.scrollTop = 0;
  }
  function renderSpot(s) {
    var h = '<button class="back" type="button" id="back">← 一覧へ</button><div class="card">' +
      '<h2 class="title">' + esc(s.name) + '</h2><p class="kana">' + esc(s.kana) + '</p>' +
      '<ul class="tags">' + s.tags.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' + gmapsBtn(s.lat, s.lng) +
      '<h3 class="era edo">江戸時代</h3><p class="body">' + esc(s.edoText) + '</p>' +
      '<h3 class="era now">明治〜現在</h3><p class="body">' + esc(s.nowText) + '</p>' +
      (s.facts && s.facts.length ? '<ul class="facts">' + s.facts.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' : '') +
      (s.images && s.images.length ? '<div class="gallery">' + s.images.map(function (im) {
        return '<figure><img src="' + im.src + '" alt="' + esc(im.cap) + '" data-cap="' + esc(im.cap) + '"><figcaption>' + esc(im.cap) + '</figcaption></figure>';
      }).join('') + '</div>' : '') +
      (s.food && s.food.length ? '<div class="food"><h3>ゆかりの味・お土産</h3><ul>' + s.food.map(function (f) {
        var url = 'https://www.google.com/maps/search/' + encodeURIComponent(f.q) + '/@' + s.lat + ',' + s.lng + ',17z';
        return '<li><a href="' + url + '" target="_blank" rel="noopener">' + esc(f.name) + '</a> — ' + esc(f.note) + '</li>';
      }).join('') + '</ul><p class="note">営業時間などは地図アプリでご確認ください。</p></div>' : '') +
      '</div>';
    panel.innerHTML = h; panel.scrollTop = 0;
  }
  function select(id, noMove) {
    var s = SPOTS.filter(function (x) { return x.id === id; })[0]; if (!s) return;
    selectedId = id; refreshMarkers(); renderSpot(s);
    if (!noMove) { syncing = false; nowMap.setView([s.lat, s.lng], Math.max(nowMap.getZoom(), 16), { animate: true }); }
  }
  panel.addEventListener('click', function (e) {
    var li = e.target.closest('li[data-id]'); if (li) return select(li.dataset.id);
    if (e.target.id === 'back') return renderHome();
    if (e.target.tagName === 'IMG' && e.target.closest('.gallery')) openLightbox(e.target);
  });
  panel.addEventListener('keydown', function (e) { var li = e.target.closest('li[data-id]'); if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(li.dataset.id); } });

  var lb = document.getElementById('lightbox');
  function openLightbox(img) { lb.querySelector('img').src = img.src; lb.querySelector('p').textContent = img.dataset.cap || ''; lb.hidden = false; }
  lb.addEventListener('click', function () { lb.hidden = true; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') lb.hidden = true; });
  var toastEl = document.getElementById('toast'), toastT;
  function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { toastEl.hidden = true; }, 4000); }

  /* ---------- 住所検索(Nominatim) ---------- */
  document.getElementById('search').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = document.getElementById('q').value.trim(); if (!q) return;
    // 名前で登録済みのスポットを優先
    var hit = SPOTS.filter(function (s) { return s.name.indexOf(q) >= 0 || q.indexOf(s.name.split('(')[0]) >= 0; })[0];
    if (hit) return select(hit.id);
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=jp&accept-language=ja&viewbox=139.70,35.70,139.79,35.64&q=' + encodeURIComponent(q);
    toast('検索中…');
    fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.length) return toast('見つかりませんでした。別の表記でお試しください');
      showResult({ lat: +d[0].lat, lng: +d[0].lon, label: q });
    }).catch(function () { toast('検索に失敗しました。通信状況をご確認ください'); });
  });
  function showResult(r) {
    searchResult = r;
    pinMarkers = placeMarkers(pinMarkers, r.lat, r.lng, 'pin', [18, 18]);
    renderHome();
    nowMap.setView([r.lat, r.lng], 17); syncing = false; syncFrom('now');
  }

  /* ---------- 現在地 ---------- */
  var watchId = null, locBtn = document.getElementById('locate');
  locBtn.addEventListener('click', function () {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; locBtn.setAttribute('aria-pressed', 'false'); return; }
    if (!navigator.geolocation) return toast('この端末では位置情報を使えません');
    var first = true;
    locBtn.setAttribute('aria-pressed', 'true');
    watchId = navigator.geolocation.watchPosition(function (pos) {
      here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      meMarkers = placeMarkers(meMarkers, here.lat, here.lng, 'me-dot', [16, 16]);
      if (first) { first = false; nowMap.setView([here.lat, here.lng], 17); syncing = false; syncFrom('now'); }
      if (selectedId === null) renderHome();
    }, function () {
      toast('現在地を取得できませんでした'); locBtn.setAttribute('aria-pressed', 'false'); watchId = null;
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  });

  /* ---------- 位置合わせの確認用 (?calibrate=1) ---------- */
  if (CALIBRATE) {
    // 番号マーカーをドラッグして動かすと、spots.js に貼り付ける行を表示(クリップボードにもコピー)
    SPOTS.forEach(function (s) {
      var m = markers[s.id];
      function report(edoPx, ll) {
        var line = "// " + s.name + "\n    lat: " + ll.lat.toFixed(5) + ", lng: " + ll.lng.toFixed(5) + ", edo: { x: " + Math.round(edoPx.x) + ", y: " + Math.round(edoPx.y) + " },";
        console.log(line); toast(s.name + ' → x:' + Math.round(edoPx.x) + ' y:' + Math.round(edoPx.y) + ' / ' + ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5) + '(コピー済み)');
        if (navigator.clipboard) navigator.clipboard.writeText(line).catch(function () {});
      }
      m.edo.on('dragend', function () { var p = llToEdoPx(m.edo.getLatLng()), ll = toLatLng(p.x, p.y); m.now.setLatLng([ll.lat, ll.lng]); report(p, ll); });
      m.now.on('dragend', function () { var ll = m.now.getLatLng(), p = toEdo(ll.lat, ll.lng); m.edo.setLatLng(edoLL(p)); report(p, ll); });
    });
    edoMap.on('click', function (e) { var p = llToEdoPx(e.latlng), ll = toLatLng(p.x, p.y); toast('絵図 x:' + Math.round(p.x) + ' y:' + Math.round(p.y) + ' → 現代 ' + ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5)); console.log('edo', Math.round(p.x), Math.round(p.y), 'latlng', ll.lat, ll.lng); });
    nowMap.on('click', function (e) { var p = toEdo(e.latlng.lat, e.latlng.lng); toast('現代 ' + e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5) + ' → 絵図 x:' + Math.round(p.x) + ' y:' + Math.round(p.y)); console.log('latlng', e.latlng.lat, e.latlng.lng, 'edo', Math.round(p.x), Math.round(p.y)); });
  }

  /* ---------- 起動 ---------- */
  renderHome();
  var g = SPOTS.filter(function (s) { return s.id === 'gijido'; })[0];
  nowMap.setView([g.lat, g.lng], 16);
  gmapCtl.update();
  syncing = false; syncFrom('now');
  window.addEventListener('resize', function () { edoMap.invalidateSize(); nowMap.invalidateSize(); });
  window.__app = { toEdo: toEdo, toLatLng: toLatLng, SPOTS: SPOTS };
})();

/* tools/shot/page/sheet.js — contact sheets, composed in a blank page of the
   pool's Chrome (a canvas is the fastest PNG/JPEG encoder on this machine and
   needs no node image library). Defines window.__sheet(o) -> Promise<dataURL>.

     o = { title, cols, tileW, tileH, fmt, quality, put (POST the sheet here; else return a dataURL),
           tiles: [{ url, label, sub }]  (url null = an empty, labelled cell) } */
(function () {
  if (window.__sheet) return true;
  function load(url) {
    return new Promise(function (res) {
      if (!url) return res(null);
      var im = new Image();
      im.onload = function () { res(im); }; im.onerror = function () { res(null); };
      im.src = url;
    });
  }
  window.__sheet = function (o) {
    var tiles = o.tiles || [], cols = Math.max(1, o.cols || 1), rows = Math.ceil(tiles.length / cols);
    var tw = o.tileW || 480, th = o.tileH || 300, lab = 22, pad = 4, titleH = o.title ? 30 : 0;
    var W = cols * (tw + pad) + pad, H = titleH + rows * (th + lab + pad) + pad;
    return Promise.all(tiles.map(function (t) { return load(t.url); })).then(function (ims) {
      var c = document.createElement("canvas"); c.width = W; c.height = H;
      var x = c.getContext("2d");
      x.fillStyle = "#1b1c1f"; x.fillRect(0, 0, W, H);
      if (o.title) {
        x.fillStyle = "#e8e8ea"; x.font = "bold 17px Helvetica, Arial, sans-serif"; x.textBaseline = "middle";
        x.fillText(String(o.title).slice(0, 200), 10, titleH / 2 + 1);
      }
      for (var i = 0; i < tiles.length; i++) {
        var cx = pad + (i % cols) * (tw + pad), cy = titleH + pad + Math.floor(i / cols) * (th + lab + pad);
        x.fillStyle = tiles[i].tint || "#2a2c31"; x.fillRect(cx, cy, tw, lab);
        x.fillStyle = "#f2f2f2"; x.font = "13px Helvetica, Arial, sans-serif"; x.textBaseline = "middle";
        x.fillText(String(tiles[i].label || "").slice(0, 90), cx + 6, cy + lab / 2 + 1);
        if (ims[i]) x.drawImage(ims[i], cx, cy + lab, tw, th);
        else {
          x.fillStyle = "#3a1d1d"; x.fillRect(cx, cy + lab, tw, th);
          x.fillStyle = "#ffb4b4"; x.fillText(String(tiles[i].sub || "no frame").slice(0, 90), cx + 8, cy + lab + 20);
        }
      }
      if (!o.put) return c.toDataURL(o.fmt || "image/png", o.quality || 0.9);
      // hand the bytes back over http: a big sheet must not ride a CDP message
      return new Promise(function (res) { c.toBlob(res, o.fmt || "image/png", o.quality || 0.9); })
        .then(function (blob) { return fetch(o.put, { method: "POST", body: blob }); })
        .then(function (r) { return r.ok ? true : "put " + r.status; }, function (e) { return String(e); });
    });
  };
  return true;
})();

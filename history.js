/* ==========================================================================
   HISTORY.JS — FYNCOFFEE POS V10
   Riwayat transaksi: filter tanggal, pencarian, detail + struk, cetak ulang,
   PDF, batalkan, dan ekspor CSV.

   SUMBER DATA
   1) Penyimpanan lokal (localStorage)  -> selalu ada, lengkap dengan item & struk.
   2) Server (Apps Script: action=transaksi / detail) -> digabung bila tersedia,
      sehingga transaksi dari perangkat lain ikut tampil.
   Dua sumber digabung berdasarkan nomor invoice.
   ========================================================================== */
(function () {
  "use strict";

  const KEY = "fyncoffee_history_v1";
  const MAX_LOCAL = 2000;
  const SYNC_TTL_MS = 60 * 1000;
  const MAX_HARI_PER_HARI_FETCH = 7;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => escapeHTML(v);

  /* ------------------------------------------------------------------
     STATE
     ------------------------------------------------------------------ */
  const state = {
    all: [],
    from: "",
    to: "",
    q: "",
    metode: "",
    status: "",
    syncing: false,
    syncOk: null, // null = belum, true = berhasil, false = gagal
    lastSync: 0,
    hariDisinkron: new Set(),
    aktif: null,
  };

  /* ------------------------------------------------------------------
     TANGGAL
     ------------------------------------------------------------------ */
  const pad = (n) => String(n).padStart(2, "0");
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const keyToDate = (k) => {
    const m = String(k).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  function rentangPreset(nama) {
    const hariIni = new Date();
    switch (nama) {
      case "today": return [dateKey(hariIni), dateKey(hariIni)];
      case "yesterday": { const k = dateKey(addDays(hariIni, -1)); return [k, k]; }
      case "7d": return [dateKey(addDays(hariIni, -6)), dateKey(hariIni)];
      case "month": return [dateKey(new Date(hariIni.getFullYear(), hariIni.getMonth(), 1)), dateKey(hariIni)];
      default: return ["", ""];
    }
  }

  function fmtTanggalPanjang(k) {
    const d = keyToDate(k);
    if (!d) return k;
    const teks = d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const hariIni = dateKey(new Date());
    if (k === hariIni) return "Hari ini · " + teks;
    if (k === dateKey(addDays(new Date(), -1))) return "Kemarin · " + teks;
    return teks;
  }
  const fmtTanggalPendek = (k) => {
    const d = keyToDate(k);
    return d ? d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : k;
  };
  const fmtJam = (ts) => new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false }).replace(".", ":");
  const fmtTanggalWaktu = (ts) => {
    const d = new Date(ts);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  /* ------------------------------------------------------------------
     NORMALISASI DATA (toleran terhadap nama kolom yang berbeda)
     ------------------------------------------------------------------ */
  const normKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");

  function pick(obj, daftar) {
    if (!obj || typeof obj !== "object") return undefined;
    const peta = {};
    Object.keys(obj).forEach((k) => { peta[normKey(k)] = obj[k]; });
    for (const nama of daftar) {
      const v = peta[nama];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  }

  function num(v) {
    return typeof toNumber === "function" ? toNumber(v) : Number(v) || 0;
  }

  function normalisasiMetode(v) {
    const m = String(v || "").toUpperCase().trim();
    if (!m) return "";
    if (/QRIS|QR/.test(m)) return "QRIS";
    if (/CASH|TUNAI/.test(m)) return "CASH";
    return m;
  }

  function normalisasiStatus(v) {
    const s = String(v || "").trim();
    if (!s) return "Lunas";
    if (/batal|cancel|void/i.test(s)) return "Batal";
    if (/pending|belum|unpaid/i.test(s)) return "Pending";
    return "Lunas";
  }

  // Server menyimpan "Dine In | Pelanggan: X | Catatan: Y" di kolom catatan
  function uraiCatatan(teks) {
    const hasil = { tipe: "", pelanggan: "", catatan: "" };
    const t = String(teks || "").trim();
    if (!t) return hasil;
    const bagian = t.split("|").map((b) => b.trim()).filter(Boolean);
    bagian.forEach((b, i) => {
      let m;
      if ((m = b.match(/^pelanggan\s*:\s*(.*)$/i))) hasil.pelanggan = m[1];
      else if ((m = b.match(/^catatan\s*:\s*(.*)$/i))) hasil.catatan = m[1];
      else if (i === 0 && /^(dine in|take away|delivery)$/i.test(b)) hasil.tipe = b;
      else if (!hasil.catatan) hasil.catatan = b;
    });
    return hasil;
  }

  function normalisasiItem(it) {
    const qty = num(pick(it, ["qty", "jumlah", "quantity"]));
    const harga = num(pick(it, ["hargajual", "harga", "hargasatuan", "price"]));
    const sub = pick(it, ["subtotal", "total"]);
    return {
      id_produk: String(pick(it, ["idproduk", "id"]) ?? ""),
      nama_produk: String(pick(it, ["namaproduk", "nama", "produk", "name"]) ?? "-"),
      harga_modal: num(pick(it, ["hargamodal", "modal"])),
      harga_jual: harga,
      qty,
      subtotal: sub !== undefined ? num(sub) : harga * qty,
    };
  }

  // Bentuk standar sebuah transaksi, dari sumber apa pun
  function normalisasi(raw, sumber) {
    const invoice = String(
      pick(raw, ["invoice", "idtransaksi", "notransaksi", "noinvoice", "id", "nomor"]) ?? "",
    ).trim();
    if (!invoice) return null;

    const waktuMentah = pick(raw, ["tanggalIso", "tanggaliso", "waktu", "tanggalwaktu", "tanggal", "datetime", "createdat", "timestamp", "tgl", "date"]);
    let d = typeof parseWaktuServer === "function" ? parseWaktuServer(waktuMentah) : new Date(waktuMentah);
    if (!d || isNaN(d.getTime())) {
      // format tampilan "20/11/2026 14:05:09"
      const m = String(waktuMentah || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{1,2})[.:](\d{2})(?:[.:](\d{2}))?/);
      d = m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)) : null;
    }
    if (!d || isNaN(d.getTime())) d = new Date(0);

    const rawItems = pick(raw, ["items", "detail", "produk"]);
    const items = Array.isArray(rawItems) ? rawItems.map(normalisasiItem) : [];

    const info = uraiCatatan(pick(raw, ["catatan", "note", "keterangan"]));
    const tipe = pick(raw, ["tipepesanan"]) || info.tipe;
    const pelanggan = pick(raw, ["pelanggan", "customer"]) ?? info.pelanggan;
    const catatanUser = pick(raw, ["tipepesanan", "pelanggan"]) !== undefined ? pick(raw, ["catatan"]) || "" : info.catatan;

    const total = num(pick(raw, ["total", "grandtotal", "totalbayar", "totalharga"]));
    const metode = normalisasiMetode(pick(raw, ["metodepembayaran", "metode", "payment", "pembayaran"]));
    const uang = num(pick(raw, ["uangditerima", "bayar", "tunai"]));
    const kembali = pick(raw, ["kembalian", "kembali"]);
    const totalItem = num(pick(raw, ["totalitem", "jumlahitem"])) || items.reduce((s, i) => s + i.qty, 0);

    return {
      invoice,
      id: invoice,
      ts: d.getTime(),
      tanggal_iso: d.getTime() ? d.toISOString() : "",
      tanggal: d.getTime() ? fmtTanggalWaktu(d.getTime()) : "-",
      dateKey: d.getTime() ? dateKey(d) : "",
      kasir: String(pick(raw, ["kasir", "cashier"]) ?? "Admin"),
      tipe_pesanan: String(tipe || ""),
      pelanggan: String(pelanggan || ""),
      catatan: String(catatanUser || ""),
      items,
      total_item: totalItem,
      subtotal: total,
      total,
      diskon: num(pick(raw, ["diskon"])),
      pajak: num(pick(raw, ["pajak"])),
      metode,
      metode_pembayaran: metode,
      uang_diterima: uang,
      bayar: uang,
      kembalian: kembali !== undefined ? num(kembali) : metode === "CASH" ? Math.max(0, uang - total) : 0,
      kembali: kembali !== undefined ? num(kembali) : metode === "CASH" ? Math.max(0, uang - total) : 0,
      status: normalisasiStatus(pick(raw, ["status", "statustransaksi"])),
      sumber,
    };
  }

  /* ------------------------------------------------------------------
     PENYIMPANAN LOKAL
     ------------------------------------------------------------------ */
  function bacaLokal() {
    try {
      const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function tulisLokal(daftar) {
    const urut = daftar.slice().sort((a, b) => b.ts - a.ts).slice(0, MAX_LOCAL);
    try {
      localStorage.setItem(KEY, JSON.stringify(urut));
    } catch (e) {
      // kuota penuh: buang separuh yang paling lama lalu coba lagi
      try { localStorage.setItem(KEY, JSON.stringify(urut.slice(0, Math.floor(urut.length / 2)))); } catch (e2) { /* menyerah */ }
    }
  }

  function simpanLokal(rec) {
    const daftar = bacaLokal().filter((r) => r.invoice !== rec.invoice);
    daftar.push(rec);
    tulisLokal(daftar);
  }

  // Dipanggil script.js tepat setelah pembayaran berhasil
  function riwayatSimpan(transaksi) {
    const rec = normalisasi(transaksi, "local");
    if (!rec) return;
    simpanLokal(rec);
    gabungkan([rec]);
    if (document.body.dataset.view === "riwayat") render();
  }
  window.riwayatSimpan = riwayatSimpan;

  // Gabungkan rekaman baru ke state (kunci: invoice)
  function gabungkan(daftarBaru) {
    const peta = new Map(state.all.map((r) => [r.invoice, r]));
    daftarBaru.forEach((baru) => {
      const lama = peta.get(baru.invoice);
      if (!lama) { peta.set(baru.invoice, baru); return; }
      // data lokal (lengkap dengan item/struk) menang; server memperbarui status/total bila lokal kosong
      const lengkap = lama.items.length >= baru.items.length ? lama : baru;
      const lain = lengkap === lama ? baru : lama;
      const gabung = { ...lain, ...lengkap };
      gabung.status = baru.sumber === "server" ? baru.status : lama.status;
      if (!gabung.total) gabung.total = lain.total;
      if (!gabung.ts && lain.ts) { gabung.ts = lain.ts; gabung.dateKey = lain.dateKey; gabung.tanggal = lain.tanggal; }
      gabung.sumber = lama.sumber === baru.sumber ? lama.sumber : "both";
      peta.set(baru.invoice, gabung);
    });
    state.all = [...peta.values()].sort((a, b) => b.ts - a.ts);
  }

  /* ------------------------------------------------------------------
     SINKRON DARI SERVER
     ------------------------------------------------------------------ */
  async function ambilDariServer(params) {
    const hasil = await apiGet({ action: "transaksi", ...params });
    const data = Array.isArray(hasil.data) ? hasil.data : Array.isArray(hasil) ? hasil : [];
    return data.map((r) => normalisasi(r, "server")).filter(Boolean);
  }

  function hariDalamRentang() {
    const a = keyToDate(state.from), b = keyToDate(state.to);
    if (!a || !b) return [];
    const hari = [];
    for (let d = a; d <= b && hari.length <= MAX_HARI_PER_HARI_FETCH; d = addDays(d, 1)) hari.push(dateKey(d));
    return hari.length <= MAX_HARI_PER_HARI_FETCH ? hari : [];
  }

  async function sinkron(paksa) {
    if (state.syncing) return;
    if (!paksa && Date.now() - state.lastSync < SYNC_TTL_MS) return;
    if (!navigator.onLine) { state.syncOk = false; render(); return; }

    state.syncing = true;
    render();

    try {
      const baru = await ambilDariServer({});
      gabungkan(baru);

      // Filter tanggal ke server: ambil juga per-hari untuk rentang pendek
      const hari = hariDalamRentang().filter((h) => paksa || !state.hariDisinkron.has(h));
      for (let i = 0; i < hari.length; i += 3) {
        const grup = hari.slice(i, i + 3);
        const hasil = await Promise.all(grup.map((h) => ambilDariServer({ tanggal: h }).catch(() => [])));
        hasil.forEach((r, j) => { gabungkan(r); state.hariDisinkron.add(grup[j]); });
      }

      state.syncOk = true;
      state.lastSync = Date.now();
    } catch (err) {
      console.warn("[RIWAYAT] Sinkron server gagal:", err.message);
      state.syncOk = false;
    } finally {
      state.syncing = false;
      render();
    }
  }

  /* ------------------------------------------------------------------
     FILTER & RINGKASAN
     ------------------------------------------------------------------ */
  function terfilter() {
    const q = state.q.trim().toLowerCase();
    return state.all.filter((r) => {
      if (state.from && r.dateKey < state.from) return false;
      if (state.to && r.dateKey > state.to) return false;
      if (state.metode && r.metode !== state.metode) return false;
      if (state.status && r.status !== state.status) return false;
      if (q) {
        const gudang = [
          r.invoice, r.pelanggan, r.catatan, r.kasir, r.tipe_pesanan, r.metode, String(r.total),
          ...r.items.map((i) => i.nama_produk),
        ].join(" ").toLowerCase();
        if (!gudang.includes(q)) return false;
      }
      return true;
    });
  }

  function ringkas(daftar) {
    const sah = daftar.filter((r) => r.status !== "Batal");
    const omzet = sah.reduce((s, r) => s + r.total, 0);
    const item = sah.reduce((s, r) => s + r.total_item, 0);
    const per = (m) => sah.filter((r) => r.metode === m).reduce((s, r) => s + r.total, 0);
    return {
      jumlah: sah.length,
      batal: daftar.length - sah.length,
      omzet,
      item,
      rata: sah.length ? omzet / sah.length : 0,
      cash: per("CASH"),
      qris: per("QRIS"),
    };
  }

  /* ------------------------------------------------------------------
     RENDER
     ------------------------------------------------------------------ */
  const ikon = (nama) => `<svg class="i"><use href="#i-${nama}"/></svg>`;

  function labelRentang() {
    if (!state.from && !state.to) return "Semua tanggal";
    if (state.from && state.from === state.to) return fmtTanggalPendek(state.from);
    return `${state.from ? fmtTanggalPendek(state.from) : "…"} – ${state.to ? fmtTanggalPendek(state.to) : "…"}`;
  }

  function renderStats(daftar) {
    const r = ringkas(daftar);
    const kartu = [
      { hero: true, ico: "trend", label: "Total omzet", nilai: formatRupiah(r.omzet), sub: `Cash ${formatRupiah(r.cash)} · QRIS ${formatRupiah(r.qris)}` },
      { ico: "receipt", label: "Transaksi", nilai: angkaID(r.jumlah), sub: r.batal ? `${r.batal} dibatalkan` : "Tidak ada pembatalan" },
      { ico: "box", label: "Item terjual", nilai: angkaID(r.item), sub: "Total qty semua produk" },
      { ico: "cash", label: "Rata-rata / transaksi", nilai: formatRupiah(r.rata), sub: "Rata-rata nilai belanja" },
    ];
    $("hStats").innerHTML = kartu
      .map((k) => `
        <div class="stat-card ${k.hero ? "hero" : ""}">
          <div class="stat-ico">${ikon(k.ico)}</div>
          <div class="stat-label">${esc(k.label)}</div>
          <div class="stat-value">${esc(k.nilai)}</div>
          <div class="stat-sub">${esc(k.sub)}</div>
        </div>`)
      .join("");
  }

  function barisHTML(r) {
    const batal = r.status === "Batal";
    const namaItem = r.items.length ? r.items.map((i) => `${i.qty}× ${i.nama_produk}`).join(", ") : "";
    const sub = [
      fmtJam(r.ts),
      `${r.total_item} item`,
      r.pelanggan ? r.pelanggan : "",
      namaItem,
    ].filter(Boolean).join(" · ");

    return `
      <button type="button" class="h-row" data-inv="${esc(r.invoice)}" aria-label="Buka detail ${esc(r.invoice)}">
        <span class="h-row-ico ${batal ? "batal" : r.metode === "QRIS" ? "qris" : ""}">${ikon(batal ? "ban" : r.metode === "QRIS" ? "qr" : "cash")}</span>
        <span class="h-row-main">
          <span class="h-row-title">${esc(r.invoice)}
            ${r.metode ? `<span class="badge ${r.metode === "QRIS" ? "qris" : "cash"}">${esc(r.metode)}</span>` : ""}
            ${r.tipe_pesanan ? `<span class="badge tipe">${esc(r.tipe_pesanan)}</span>` : ""}
            ${r.status !== "Lunas" ? `<span class="badge ${r.status === "Batal" ? "batal" : "pending"}">${esc(r.status)}</span>` : ""}
          </span>
          <span class="h-row-sub" style="display:block">${esc(sub)}</span>
        </span>
        <span class="h-row-right"><span class="h-row-total ${batal ? "batal" : ""}">${formatRupiah(r.total)}</span></span>
        <span class="h-row-chev">${ikon("chevron")}</span>
      </button>`;
  }

  function renderList(daftar) {
    const wadah = $("hList");

    if (state.syncing && !daftar.length) {
      wadah.innerHTML = Array.from({ length: 5 }, () => '<div class="skeleton" style="height:72px;margin-bottom:10px"></div>').join("");
      return;
    }

    if (!daftar.length) {
      const adaFilter = state.from || state.to || state.q || state.metode || state.status;
      wadah.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${ikon(adaFilter ? "search" : "receipt")}</div>
          <h3>${adaFilter ? "Tidak ada transaksi yang cocok" : "Belum ada transaksi"}</h3>
          <p>${adaFilter ? "Coba ubah rentang tanggal atau hapus filter lain. Gunakan “Semua” untuk melihat seluruh riwayat." : "Transaksi yang sudah dibayar akan muncul di sini lengkap dengan struknya."}</p>
          ${adaFilter ? '<button type="button" class="btn btn-ghost" id="hResetFilter" style="margin:16px auto 0">Reset filter</button>' : ""}
        </div>`;
      return;
    }

    const grup = new Map();
    daftar.forEach((r) => {
      if (!grup.has(r.dateKey)) grup.set(r.dateKey, []);
      grup.get(r.dateKey).push(r);
    });

    wadah.innerHTML = [...grup.entries()]
      .map(([k, baris]) => {
        const sah = baris.filter((r) => r.status !== "Batal");
        const totalHari = sah.reduce((s, r) => s + r.total, 0);
        return `
          <div class="h-group">
            <div class="h-group-head">
              <h3>${esc(k ? fmtTanggalPanjang(k) : "Tanggal tidak diketahui")}</h3>
              <span>${sah.length} transaksi · ${formatRupiah(totalHari)}</span>
            </div>
            <div class="h-card">${baris.map(barisHTML).join("")}</div>
          </div>`;
      })
      .join("");
  }

  function render() {
    if (!$("hList")) return;
    const daftar = terfilter();

    // sinkron kontrol dengan state
    if ($("hFrom").value !== state.from) $("hFrom").value = state.from;
    if ($("hTo").value !== state.to) $("hTo").value = state.to;
    $("hMetode").value = state.metode;
    $("hStatus").value = state.status;

    document.querySelectorAll("#hPresets .chip").forEach((c) => {
      const [a, b] = rentangPreset(c.dataset.preset);
      c.classList.toggle("active", a === state.from && b === state.to);
    });

    const status = state.syncing
      ? "Menyinkronkan dengan server…"
      : state.syncOk === true
        ? "Tersinkron dengan server"
        : state.syncOk === false
          ? "Server tidak terjangkau — menampilkan data di perangkat ini"
          : "";
    $("hSubtitle").textContent = `${labelRentang()} · ${daftar.length} transaksi${status ? " · " + status : ""}`;

    const ic = $("hRefreshIcon");
    if (ic) ic.classList.toggle("spinning", state.syncing);

    renderStats(daftar);
    renderList(daftar);
  }

  /* ------------------------------------------------------------------
     FILTER: INTERAKSI
     ------------------------------------------------------------------ */
  function setRentang(from, to) {
    if (from && to && from > to) [from, to] = [to, from];
    state.from = from;
    state.to = to;
    render();
    // rentang baru -> ambil data harian dari server bila perlu
    sinkron(false);
  }

  function resetFilter() {
    state.q = ""; state.metode = ""; state.status = "";
    $("hSearch").value = "";
    const [a, b] = rentangPreset("all");
    setRentang(a, b);
  }

  /* ------------------------------------------------------------------
     DETAIL TRANSAKSI
     ------------------------------------------------------------------ */
  function cariRekaman(inv) {
    return state.all.find((r) => r.invoice === inv);
  }

  function renderDetail(r) {
    $("detailTitle").textContent = r.invoice;
    $("detailSub").textContent = `${fmtTanggalPanjang(r.dateKey).replace(/^(Hari ini|Kemarin) · /, "")} · ${fmtJam(r.ts)}`;

    $("detailMeta").innerHTML = [
      r.metode ? `<span class="badge ${r.metode === "QRIS" ? "qris" : "cash"}">${esc(r.metode)}</span>` : "",
      `<span class="badge ${r.status === "Batal" ? "batal" : r.status === "Pending" ? "pending" : "lunas"}">${esc(r.status)}</span>`,
      r.tipe_pesanan ? `<span class="badge tipe">${esc(r.tipe_pesanan)}</span>` : "",
      `<span class="badge tipe">Kasir ${esc(r.kasir)}</span>`,
    ].join("");

    const loading = !r.items.length && r.sumber === "server" && !r.detailGagal;
    $("detailReceipt").innerHTML = loading
      ? '<div class="skeleton" style="height:260px"></div>'
      : buatHTMLStruk(r) +
        (!r.items.length ? '<p class="drawer-sub" style="text-align:center;margin-top:10px">Rincian item tidak tersedia dari server.</p>' : "");

    $("dBtnBatal").hidden = r.status === "Batal";
    $("dBtnBatal").disabled = false;
  }

  async function bukaDetail(inv) {
    const r = cariRekaman(inv);
    if (!r) return;
    state.aktif = inv;

    renderDetail(r);
    $("detailDrawer").classList.add("active");
    $("detailDrawer").setAttribute("aria-hidden", "false");

    // data dari server biasanya tanpa item -> ambil detailnya
    if (!r.items.length && r.sumber === "server") {
      try {
        const hasil = await apiGet({ action: "detail", id: r.invoice });
        const rows = Array.isArray(hasil.data) ? hasil.data : [];
        r.items = rows.map(normalisasiItem);
        r.total_item = r.total_item || r.items.reduce((s, i) => s + i.qty, 0);
        if (r.items.length) simpanLokal({ ...r }); // simpan agar bisa dibuka offline
      } catch (err) {
        r.detailGagal = true;
      }
      if (state.aktif === inv) renderDetail(r);
      render();
    }
  }

  function tutupDetail() {
    const d = $("detailDrawer");
    if (!d) return;
    d.classList.remove("active");
    d.setAttribute("aria-hidden", "true");
    state.aktif = null;
  }
  window.riwayatTutupDetail = tutupDetail;

  async function batalkanAktif() {
    const r = cariRekaman(state.aktif);
    if (!r) return;
    const tombol = $("dBtnBatal");
    tombol.disabled = true;
    const hasil = await batalkanTransaksi(r.invoice); // konfirmasi + panggilan API ada di script.js
    if (hasil) {
      r.status = "Batal";
      simpanLokal({ ...r });
      renderDetail(r);
      render();
    } else {
      tombol.disabled = false;
    }
  }

  /* ------------------------------------------------------------------
     EKSPOR CSV
     ------------------------------------------------------------------ */
  function csvSel(v) {
    let t = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // cegah formula injection di Excel/Sheets
    return `"${t.replace(/"/g, '""')}"`;
  }

  function ekspor() {
    const daftar = terfilter();
    if (!daftar.length) { toast("Tidak ada data untuk diekspor", "error"); return; }

    const kepala = ["Invoice", "Tanggal", "Jam", "Kasir", "Tipe", "Pelanggan", "Metode", "Status", "Total Item", "Total", "Tunai", "Kembalian", "Item", "Catatan"];
    const baris = daftar.slice().sort((a, b) => a.ts - b.ts).map((r) => [
      r.invoice, r.dateKey, fmtJam(r.ts), r.kasir, r.tipe_pesanan, r.pelanggan, r.metode, r.status,
      r.total_item, r.total, r.metode === "CASH" ? r.uang_diterima : "", r.metode === "CASH" ? r.kembalian : "",
      r.items.map((i) => `${i.qty}x ${i.nama_produk}`).join("; "), r.catatan,
    ]);

    // titik koma = pemisah bawaan Excel versi Indonesia; BOM agar huruf tampil benar
    const csv = "\uFEFF" + [kepala, ...baris].map((b) => b.map(csvSel).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    const nama = state.from || state.to ? `${state.from || "awal"}_${state.to || "sekarang"}` : "semua";
    a.href = url;
    a.download = `riwayat-fyncoffee-${nama}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast(`${daftar.length} transaksi diekspor ke CSV`, "success");
  }

  /* ------------------------------------------------------------------
     INISIALISASI
     ------------------------------------------------------------------ */
  function muatLokal() {
    state.all = [];
    gabungkan(bacaLokal().map((r) => normalisasi(r, "local")).filter(Boolean));
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  let sudahInit = false;
  function riwayatBuka() {
    if (!sudahInit) return;
    muatLokal();
    render();
    sinkron(false);
  }
  window.riwayatBuka = riwayatBuka;

  function init() {
    if (!$("viewRiwayat")) return;
    sudahInit = true;

    // bawaan: transaksi hari ini
    const [a, b] = rentangPreset("today");
    state.from = a;
    state.to = b;

    muatLokal();

    $("hPresets").addEventListener("click", (e) => {
      const c = e.target.closest(".chip");
      if (!c) return;
      const [x, y] = rentangPreset(c.dataset.preset);
      setRentang(x, y);
    });
    $("hFrom").addEventListener("change", (e) => setRentang(e.target.value, state.to));
    $("hTo").addEventListener("change", (e) => setRentang(state.from, e.target.value));
    $("hSearch").addEventListener("input", debounce((e) => { state.q = e.target.value; render(); }, 150));
    $("hMetode").addEventListener("change", (e) => { state.metode = e.target.value; render(); });
    $("hStatus").addEventListener("change", (e) => { state.status = e.target.value; render(); });
    $("hBtnRefresh").addEventListener("click", () => sinkron(true));
    $("hBtnExport").addEventListener("click", ekspor);

    $("hList").addEventListener("click", (e) => {
      if (e.target.closest("#hResetFilter")) { resetFilter(); return; }
      const row = e.target.closest(".h-row");
      if (row) bukaDetail(row.dataset.inv);
    });

    $("dBtnCetak").addEventListener("click", () => { const r = cariRekaman(state.aktif); if (r) cetakStruk(r); });
    $("dBtnPdf").addEventListener("click", () => {
      const r = cariRekaman(state.aktif);
      if (r) unduhStrukPDF(buatHTMLStruk(r), namaFilePDF(r), $("dBtnPdf"));
    });
    $("dBtnBuka").addEventListener("click", () => {
      const r = cariRekaman(state.aktif);
      if (!r) return;
      simpanLokal({ ...r }); // pastikan halaman struk bisa membaca datanya
      bukaStruk(r.invoice);
    });
    $("dBtnBatal").addEventListener("click", batalkanAktif);

    // Perubahan dari tab lain (mis. transaksi baru di kasir lain tab)
    window.addEventListener("storage", (e) => {
      if (e.key !== KEY) return;
      muatLokal();
      if (document.body.dataset.view === "riwayat") render();
    });

    window.addEventListener("online", () => { if (document.body.dataset.view === "riwayat") sinkron(true); });

    if (document.body.dataset.view === "riwayat") riwayatBuka();
  }

  window.__riwayatTest = { normalisasi, gabungkan, terfilter, ringkas, state, rentangPreset, csvSel, uraiCatatan };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

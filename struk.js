/* ==========================================================================
   STRUK.JS — FYNCOFFEE POS
   Mengisi data struk dari localStorage / query string / window.opener
   Kompatibel dengan struk.html (V2 — Thermal Realistic)
   ========================================================================== */

(function () {
  "use strict";

  /* ======================================================================
     1. KONFIGURASI TOKO
     ====================================================================== */
  const STORE = {
    name: "FYNCOFFEE",
    tagline: "Coffee · Milk · Good Mood",
    address: "Jl. Kesawan No. 12, Medan",
    phone: "0812-6944-1924",
    cashier: "Admin",
    taxRate: 0, // 0.11 = 11% (isi 0 kalau tidak ada pajak)
    serviceRate: 0, // service charge opsional
  };

  /* ======================================================================
     2. HELPER
     ====================================================================== */

  /**
   * Ambil elemen by id dengan aman.
   */
  function $(id) {
    return document.getElementById(id);
  }

  /**
   * Set textContent kalau elemen ada.
   */
  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  /**
   * Format angka jadi Rupiah tanpa "Rp".
   */
  function formatRupiah(angka) {
    const n = Number(angka) || 0;
    return n.toLocaleString("id-ID");
  }

  /**
   * Format tanggal + jam.
   */
  function formatTanggal(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return "-";

    const hari = [
      "Minggu",
      "Senin",
      "Selasa",
      "Rabu",
      "Kamis",
      "Jumat",
      "Sabtu",
    ];
    const bulan = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "Mei",
      "Jun",
      "Jul",
      "Agu",
      "Sep",
      "Okt",
      "Nov",
      "Des",
    ];

    const dd = String(d.getDate()).padStart(2, "0");
    const mm = bulan[d.getMonth()];
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");

    return `${dd} ${mm} ${yyyy} ${hh}:${mi}:${ss}`;
  }

  /**
   * Escape HTML untuk cegah XSS dari nama produk / catatan.
   */
  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Normalisasi nomor: buang semua karakter non-digit.
   */
  function toNumber(value) {
    if (typeof value === "number") return value;
    if (value == null) return 0;
    return Number(String(value).replace(/[^\d.-]/g, "")) || 0;
  }

  /**
   * Baca query string → object.
   */
  function getQueryParams() {
    const out = {};
    try {
      const params = new URLSearchParams(window.location.search);
      params.forEach((v, k) => (out[k] = v));
    } catch (e) {}
    return out;
  }

  /**
   * Ambil data dari localStorage dengan aman.
   */
  function getLocal(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /* ======================================================================
     3. SUMBER DATA
     ======================================================================
     Prioritas:
       1) window.opener.strukData / lastTransaction
       2) localStorage "fyncoffee_last_struk"
       3) query string (?data=base64 atau field tunggal)
       4) localStorage "fyncoffee_cart" (fallback)
     ====================================================================== */

  function ambilDataStruk() {
    /* --- 1. Dari window.opener (popup dari POS) --- */
    try {
      if (window.opener && !window.opener.closed) {
        const o = window.opener;
        const candidates = [
          o.strukData,
          o.lastTransaction,
          o.lastStruk,
          o.currentTransaction,
        ];
        for (const c of candidates) {
          if (c && typeof c === "object") return c;
        }
      }
    } catch (e) {
      console.warn("[STRUK] Tidak bisa akses window.opener:", e);
    }

    /* --- 2. Dari localStorage key utama --- */
    const fromLS = getLocal("fyncoffee_last_struk");
    if (fromLS && typeof fromLS === "object") return fromLS;

    /* --- 3. Dari query string --- */
    const q = getQueryParams();
    if (q.data) {
      try {
        const decoded = decodeURIComponent(escape(atob(q.data)));
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed === "object") return parsed;
      } catch (e) {
        console.warn("[STRUK] Gagal decode query ?data:", e);
      }
    }

    /* --- 4. Fallback: cart + info dari localStorage --- */
    const cart = getLocal("fyncoffee_cart");
    if (Array.isArray(cart) && cart.length) {
      return {
        id: getLocal("fyncoffee_last_id") || generateInvoiceId(),
        tanggal: new Date().toISOString(),
        kasir: STORE.cashier,
        items: cart,
        subtotal: cart.reduce(
          (s, it) => s + toNumber(it.harga) * toNumber(it.qty || it.qty || 1),
          0,
        ),
        metode: "CASH",
        status: "LUNAS",
      };
    }

    return null;
  }

  /**
   * Generate invoice id (fallback).
   */
  function generateInvoiceId() {
    const d = new Date();
    const ymd =
      d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, "0") +
      String(d.getDate()).padStart(2, "0");
    const rand = Math.floor(Math.random() * 9000 + 1000);
    return `FYN-${ymd}-${rand}`;
  }

  /* ======================================================================
     4. RENDER ITEM
     ====================================================================== */

  function renderItems(items) {
    const tbody = $("detail");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!Array.isArray(items) || items.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td colspan="3" style="text-align:center;padding:8px 0;color:#666;">
          (Tidak ada item)
        </td>
      `;
      tbody.appendChild(tr);
      return;
    }

    items.forEach((it) => {
      const nama = escapeHtml(it.nama || it.name || "Produk");
      const qty = toNumber(it.qty || it.jumlah || it.quantity || 1);
      const harga = toNumber(it.harga || it.price || it.hargaSatuan || 0);
      const subtotal = harga * qty;

      const note = it.catatan || it.note || "";
      const noteHtml = note
        ? `<div class="product-price" style="font-style:italic;">${escapeHtml(note)}</div>`
        : "";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="col-item">
          <span class="product-name">${nama}</span>
          <span class="product-price">@ ${formatRupiah(harga)}${noteHtml ? " · " + escapeHtml(note) : ""}</span>
        </td>
        <td class="col-qty">${qty}</td>
        <td class="col-price">${formatRupiah(subtotal)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  /* ======================================================================
     5. HITUNG TOTAL
     ====================================================================== */

  function hitungRingkasan(data) {
    const items = Array.isArray(data.items) ? data.items : [];

    let subtotal = toNumber(data.subtotal);
    if (!subtotal && items.length) {
      subtotal = items.reduce((s, it) => {
        const qty = toNumber(it.qty || it.jumlah || 1);
        const harga = toNumber(it.harga || it.price || 0);
        return s + qty * harga;
      }, 0);
    }

    const diskon = toNumber(data.diskon || data.discount || 0);

    let pajak = toNumber(data.pajak || data.tax || 0);
    if (!pajak && STORE.taxRate > 0) {
      pajak = Math.round((subtotal - diskon) * STORE.taxRate);
    }

    const service = STORE.serviceRate
      ? Math.round((subtotal - diskon) * STORE.serviceRate)
      : 0;

    const total = toNumber(data.total) || subtotal - diskon + pajak + service;

    const bayar = toNumber(
      data.bayar || data.paid || data.uangDiterima || total,
    );
    const kembali = toNumber(
      data.kembali || data.change || Math.max(0, bayar - total),
    );

    return { subtotal, diskon, pajak, service, total, bayar, kembali };
  }

  /* ======================================================================
     6. STATUS BADGE
     ====================================================================== */

  function renderStatus(data) {
    const el = $("status");
    if (!el) return;

    let raw = String(data.status || "LUNAS").toUpperCase();
    if (data.metode && /qris/i.test(data.metode) && !data.status) {
      raw = "LUNAS";
    }

    el.classList.remove("lunas", "pending", "batal");

    if (/BATAL|CANCEL|VOID/i.test(raw)) {
      el.textContent = "Batal";
      el.classList.add("batal");
    } else if (/PENDING|BELUM|UNPAID/i.test(raw)) {
      el.textContent = "Pending";
      el.classList.add("pending");
    } else {
      el.textContent = "Lunas";
      el.classList.add("lunas");
    }
  }

  /* ======================================================================
     7. METODE PEMBAYARAN + QRIS NOTE
     ====================================================================== */

  function renderMetode(data) {
    const el = $("metode");
    if (!el) return;

    const m = String(data.metode || data.payment || "CASH")
      .toUpperCase()
      .trim();

    let label = m;
    if (/QRIS|QR/i.test(m)) label = "QRIS";
    else if (/CASH|TUNAI/i.test(m)) label = "CASH";
    else if (/TRANSFER|BANK/i.test(m)) label = "TRANSFER";
    else if (/EWALLET|E-WALLET|GOPAY|OVO|DANA|SHOPEEPAY/i.test(m))
      label = "E-WALLET";
    else if (/DEBIT|KREDIT|CARD/i.test(m)) label = "KARTU";

    el.textContent = label;

    const qrisNote = $("qrisNote");
    if (qrisNote) {
      qrisNote.style.display = label === "QRIS" ? "block" : "none";
    }
  }

  /* ======================================================================
     8. RENDER UTAMA
     ====================================================================== */

  function renderStruk(data) {
    if (!data) {
      tampilkanState(
        "Data Tidak Ditemukan",
        "Struk tidak bisa dimuat. Silakan buka ulang dari aplikasi POS.",
        "⚠️",
      );
      return;
    }

    /* --- Info header --- */
    const invoiceId =
      data.id || data.invoice || data.noTransaksi || generateInvoiceId();
    setText("id", invoiceId);
    setText("tanggal", formatTanggal(data.tanggal || data.date || Date.now()));
    setText("kasir", data.kasir || data.cashier || STORE.cashier);

    /* --- Status badge --- */
    renderStatus(data);

    /* --- Item --- */
    renderItems(data.items || data.produk || []);

    /* --- Ringkasan --- */
    const r = hitungRingkasan(data);

    setText("subtotal", formatRupiah(r.subtotal));
    setText("diskon", formatRupiah(r.diskon));
    setText("pajak", formatRupiah(r.pajak + r.service));
    setText("total", formatRupiah(r.total));
    setText("bayar", formatRupiah(r.bayar));
    setText("kembali", formatRupiah(r.kembali));

    /* --- Metode + QRIS --- */
    renderMetode(data);

    /* --- Update title halaman --- */
    document.title = `Struk ${invoiceId} — ${STORE.name}`;

    /* --- Event sinkronisasi tambahan --- */
    document.dispatchEvent(
      new CustomEvent("struk:rendered", { detail: { data, ringkasan: r } }),
    );
  }

  /* ======================================================================
     9. STATE (loading / kosong / error)
     ====================================================================== */

  function tampilkanState(title, message, icon) {
    const struk = $("struk");
    if (!struk) return;

    struk.innerHTML = `
      <div class="state">
        <div class="icon">${escapeHtml(icon || "🧾")}</div>
        <strong>${escapeHtml(title || "Memuat...")}</strong>
        <div>${escapeHtml(message || "Mohon tunggu sebentar...")}</div>
      </div>
    `;
  }

  /* ======================================================================
     10. AUTO-READY: tunggu DOM siap
     ====================================================================== */

  function init() {
    try {
      const data = ambilDataStruk();

      if (!data) {
        // Coba tunggu sedikit — mungkin opener belum siap
        setTimeout(() => {
          const retry = ambilDataStruk();
          if (retry) renderStruk(retry);
          else
            tampilkanState(
              "Data Tidak Ditemukan",
              "Struk tidak bisa dimuat. Silakan buka ulang dari aplikasi POS.",
              "⚠️",
            );
        }, 500);
        return;
      }

      renderStruk(data);
    } catch (e) {
      console.error("[STRUK] Error render:", e);
      tampilkanState(
        "Gagal Memuat Struk",
        "Terjadi kesalahan saat memuat data. Coba buka ulang.",
        "❌",
      );
    }
  }

  /* ======================================================================
     11. EXPORT GLOBAL (untuk dipanggil dari luar / console)
     ====================================================================== */

  window.Struk = {
    render: renderStruk,
    reload: init,
    formatRupiah,
    formatTanggal,
    getData: ambilDataStruk,
    STORE,
  };

  /* ======================================================================
     12. JALANKAN
     ====================================================================== */

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* ======================================================================
     13. SINKRONISASI NOMOR INVOICE KE FOOTER + BARCODE
     (kompatibel dengan struk.html V2)
     ====================================================================== */
  document.addEventListener("struk:rendered", function (e) {
    const inv = e.detail?.data?.id || $("id")?.textContent || "-";

    const footer = $("invoiceFooter");
    if (footer && inv && inv !== "-") {
      footer.textContent = "NO. " + inv;
    }

    // Trigger barcode render kalau fungsi tersedia
    if (typeof window.renderBarcode === "function") {
      try {
        window.renderBarcode();
      } catch (err) {}
    }
  });

  console.log(
    "%c STRUK.JS ",
    "background:#111;color:#fff;padding:6px 10px;border-radius:4px;font-weight:900;",
    "loaded ✓",
  );
})();

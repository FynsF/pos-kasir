/* =========================================================
   FYNCOFFEE POS
   STRUK.JS V2 - THERMAL RECEIPT SYSTEM
   Kompatibel dengan Struk.html V2
   ========================================================= */

/* =========================================================
   KONFIGURASI
   ========================================================= */

const AUTO_PRINT = false;
// true  = otomatis membuka dialog print setelah data dimuat
// false = tidak otomatis print

/* =========================================================
   AMBIL DATA TRANSAKSI
   ========================================================= */

const transaksiData = localStorage.getItem("transaksi");

if (!transaksiData) {
  tampilkanError(
    "Transaksi Tidak Ditemukan",
    "Silakan kembali ke halaman kasir dan lakukan transaksi terlebih dahulu.",
  );

  throw new Error("Data transaksi kosong.");
}

let transaksi;

try {
  transaksi = JSON.parse(transaksiData);
} catch (error) {
  console.error("Gagal membaca transaksi:", error);

  tampilkanError(
    "Data Transaksi Rusak",
    "Data transaksi tidak dapat dibaca. Silakan ulangi transaksi.",
  );

  throw new Error("JSON transaksi tidak valid.");
}

/* =========================================================
   VALIDASI DATA TRANSAKSI
   ========================================================= */

if (!transaksi || typeof transaksi !== "object") {
  tampilkanError(
    "Transaksi Tidak Valid",
    "Data transaksi tidak dapat diproses.",
  );

  throw new Error("Object transaksi tidak valid.");
}

/* =========================================================
   HEADER STRUK
   ========================================================= */

const invoice = transaksi.id || transaksi.invoice || generateInvoice();

const tanggal = transaksi.tanggal || transaksi.waktu || formatTanggal();

const kasir = transaksi.kasir || transaksi.nama_kasir || "Admin";

setText("id", invoice);
setText("tanggal", tanggal);
setText("kasir", kasir);

/* =========================================================
   STATUS TRANSAKSI (BARU)
   ========================================================= */

const statusRaw = String(
  transaksi.status || transaksi.status_transaksi || "Lunas",
)
  .trim()
  .toLowerCase();

/*
 * Mapping status ke class CSS:
 * - lunas   → .status-badge.lunas
 * - pending → .status-badge.pending
 * - batal   → .status-badge.batal
 */
const statusMap = {
  lunas: { label: "Lunas", class: "lunas" },
  paid: { label: "Lunas", class: "lunas" },
  success: { label: "Lunas", class: "lunas" },
  berhasil: { label: "Lunas", class: "lunas" },

  pending: { label: "Pending", class: "pending" },
  menunggu: { label: "Pending", class: "pending" },
  belum: { label: "Pending", class: "pending" },
  "belum lunas": { label: "Pending", class: "pending" },
  unpaid: { label: "Pending", class: "pending" },

  batal: { label: "Batal", class: "batal" },
  cancel: { label: "Batal", class: "batal" },
  cancelled: { label: "Batal", class: "batal" },
  canceled: { label: "Batal", class: "batal" },
  void: { label: "Batal", class: "batal" },
};

const statusInfo = statusMap[statusRaw] || {
  label: transaksi.status || "Lunas",
  class: "lunas",
};

const statusEl = document.getElementById("status");

if (statusEl) {
  statusEl.textContent = statusInfo.label;
  statusEl.className = "status-badge " + statusInfo.class;
}

/* =========================================================
   METODE PEMBAYARAN
   ========================================================= */

const metodeRaw =
  transaksi.metode ||
  transaksi.metode_pembayaran ||
  transaksi.paymentMethod ||
  transaksi.payment_method ||
  "QRIS";

const metode = formatMetodePembayaran(metodeRaw);

setText("metode", metode);

/* =========================================================
   QRIS NOTE (BARU)
   Tampilkan hanya jika metode QRIS dan status Lunas
   ========================================================= */

const qrisNote = document.getElementById("qrisNote");

if (qrisNote) {
  const isQRIS = String(metodeRaw).trim().toUpperCase() === "QRIS";
  const isLunas = statusInfo.class === "lunas";

  if (isQRIS && isLunas) {
    qrisNote.style.display = "block";
    qrisNote.textContent = "✓ Pembayaran QRIS terverifikasi";
  } else if (isQRIS && !isLunas) {
    qrisNote.style.display = "block";
    qrisNote.textContent = "⏳ Menunggu konfirmasi QRIS";
  } else {
    qrisNote.style.display = "none";
  }
}

/* =========================================================
   DETAIL PRODUK
   ========================================================= */

const detail = document.getElementById("detail");

let subtotal = 0;

if (detail) {
  detail.innerHTML = "";
}

/* Ambil items dari berbagai kemungkinan key */
const items = Array.isArray(transaksi.items)
  ? transaksi.items
  : Array.isArray(transaksi.detail)
    ? transaksi.detail
    : Array.isArray(transaksi.keranjang)
      ? transaksi.keranjang
      : [];

if (items.length > 0) {
  items.forEach((item) => {
    if (!item) return;

    /* -----------------------------------------------------
       NAMA PRODUK
    ----------------------------------------------------- */
    const nama =
      item.nama_produk ||
      item.nama ||
      item.name ||
      item.product_name ||
      "Produk";

    /* -----------------------------------------------------
       QTY
    ----------------------------------------------------- */
    const qty = toNumber(
      item.qty ?? item.quantity ?? item.jumlah ?? item.amount ?? 0,
    );

    /* -----------------------------------------------------
       HARGA SATUAN
    ----------------------------------------------------- */
    const harga = toNumber(
      item.harga_jual ??
        item.harga ??
        item.price ??
        item.harga_satuan ??
        item.unit_price ??
        0,
    );

    /* -----------------------------------------------------
       SUBTOTAL PER ITEM
       Pakai subtotal dari backend kalau tersedia
    ----------------------------------------------------- */
    const jumlah =
      item.subtotal !== undefined && item.subtotal !== null
        ? toNumber(item.subtotal)
        : qty * harga;

    subtotal += jumlah;

    /* -----------------------------------------------------
       RENDER BARIS
    ----------------------------------------------------- */
    if (detail) {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td class="col-item">
          <div class="product-name">
            ${escapeHTML(nama)}
          </div>
          <span class="product-price">
            Rp ${formatRupiah(harga)} / item
          </span>
        </td>

        <td class="col-qty">
          ${formatQty(qty)}
        </td>

        <td class="col-price">
          Rp ${formatRupiah(jumlah)}
        </td>
      `;

      detail.appendChild(row);
    }
  });
} else {
  /* -----------------------------------------------------
     TIDAK ADA PRODUK
  ----------------------------------------------------- */
  if (detail) {
    detail.innerHTML = `
      <tr>
        <td
          colspan="3"
          style="
            text-align:center;
            padding:8px 0;
            font-size:8px;
            color:#666;
          "
        >
          Tidak ada item transaksi
        </td>
      </tr>
    `;
  }
}

/* =========================================================
   DISKON
   ========================================================= */

const diskon = Math.max(
  0,
  toNumber(transaksi.diskon ?? transaksi.discount ?? 0),
);

/* =========================================================
   PAJAK
   ========================================================= */

const pajak = Math.max(
  0,
  toNumber(transaksi.pajak ?? transaksi.tax ?? transaksi.ppn ?? 0),
);

/* =========================================================
   HITUNG TOTAL
   ========================================================= */

let total = subtotal - diskon + pajak;

/*
 * Kalau backend sudah kirim total final,
 * pakai total dari backend.
 */
if (
  transaksi.total !== undefined &&
  transaksi.total !== null &&
  transaksi.total !== ""
) {
  total = toNumber(transaksi.total);
}

total = Math.max(0, total);

/* =========================================================
   TAMPILKAN SUMMARY
   ========================================================= */

setText("subtotal", formatRupiah(subtotal));
setText("diskon", formatRupiah(diskon));
setText("pajak", formatRupiah(pajak));
setText("total", formatRupiah(total));

/* =========================================================
   PEMBAYARAN — BAYAR
   ========================================================= */

let bayar;

if (
  transaksi.bayar !== undefined &&
  transaksi.bayar !== null &&
  transaksi.bayar !== ""
) {
  bayar = toNumber(transaksi.bayar);
} else if (
  transaksi.uang_diterima !== undefined &&
  transaksi.uang_diterima !== null
) {
  bayar = toNumber(transaksi.uang_diterima);
} else if (
  transaksi.uangDiterima !== undefined &&
  transaksi.uangDiterima !== null
) {
  bayar = toNumber(transaksi.uangDiterima);
} else {
  /* QRIS / non-cash: anggap bayar = total */
  bayar = total;
}

/* =========================================================
   KEMBALIAN
   ========================================================= */

let kembali;

if (
  transaksi.kembali !== undefined &&
  transaksi.kembali !== null &&
  transaksi.kembali !== ""
) {
  kembali = toNumber(transaksi.kembali);
} else if (transaksi.kembalian !== undefined && transaksi.kembalian !== null) {
  kembali = toNumber(transaksi.kembalian);
} else {
  kembali = bayar - total;
}

kembali = Math.max(0, kembali);

/* =========================================================
   TAMPILKAN PEMBAYARAN
   ========================================================= */

setText("bayar", formatRupiah(bayar));
setText("kembali", formatRupiah(kembali));

/* =========================================================
   SIMPAN DATA TERBARU (untuk cetak ulang)
   ========================================================= */

transaksi.id = invoice;
transaksi.invoice = transaksi.invoice || invoice;
transaksi.tanggal = tanggal;
transaksi.kasir = kasir;
transaksi.status = statusInfo.label;
transaksi.metode = metodeRaw;
transaksi.subtotal = subtotal;
transaksi.diskon = diskon;
transaksi.pajak = pajak;
transaksi.total = total;
transaksi.bayar = bayar;
transaksi.kembali = kembali;
transaksi.kembalian = kembali;
transaksi.items = items;

try {
  localStorage.setItem("transaksi", JSON.stringify(transaksi));
} catch (error) {
  console.warn("Gagal menyimpan transaksi ke localStorage:", error);
}

/* =========================================================
   UPDATE TITLE DOKUMEN (biar nama window / tab rapi)
   ========================================================= */

try {
  document.title = "Struk " + invoice + " — FYNCOFFEE";
} catch (e) {
  /* ignore */
}

/* =========================================================
   HELPER: SET TEXT
   ========================================================= */

function setText(id, value) {
  const element = document.getElementById(id);

  if (!element) return;

  element.textContent = value ?? "";
}

/* =========================================================
   FORMAT RUPIAH (tanpa "Rp", karena "Rp" ada di HTML)
   ========================================================= */

function formatRupiah(angka) {
  const nilai = toNumber(angka);

  return nilai.toLocaleString("id-ID", {
    maximumFractionDigits: 0,
  });
}

/* =========================================================
   FORMAT QTY
   ========================================================= */

function formatQty(qty) {
  const nilai = toNumber(qty);

  if (Number.isInteger(nilai)) {
    return String(nilai);
  }

  return nilai.toLocaleString("id-ID", {
    maximumFractionDigits: 2,
  });
}

/* =========================================================
   TO NUMBER (parsing angka pintar)
   Support: "Rp 15.000", "15,000", "15000", "15.000,50"
   ========================================================= */

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  let text = String(value).trim().replace(/Rp/gi, "").replace(/\s/g, "");

  /* Format Indonesia: 15.000,50 */
  if (text.includes(".") && text.includes(",")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",")) {
    /* Hanya koma: 15000,50 */
    const parts = text.split(",");

    if (parts[1] && parts[1].length <= 2) {
      text = parts[0] + "." + parts[1];
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (text.includes(".")) {
    /* Hanya titik: 15.000 */
    const parts = text.split(".");

    if (parts.length === 2 && parts[1].length === 3) {
      text = parts[0] + parts[1];
    }
  }

  /* Buang karakter selain angka, titik, minus */
  text = text.replace(/[^\d.-]/g, "");

  const number = Number(text);

  return Number.isFinite(number) ? number : 0;
}

/* =========================================================
   FORMAT TANGGAL
   ========================================================= */

function formatTanggal() {
  const now = new Date();

  return now.toLocaleString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/* =========================================================
   FORMAT METODE PEMBAYARAN
   ========================================================= */

function formatMetodePembayaran(metode) {
  const value = String(metode || "QRIS")
    .trim()
    .toUpperCase();

  const mapping = {
    QRIS: "QRIS",
    QR: "QRIS",

    CASH: "TUNAI",
    TUNAI: "TUNAI",
    CASH_PAYMENT: "TUNAI",

    TRANSFER: "TRANSFER",
    BANK: "TRANSFER",

    DEBIT: "DEBIT",
    CREDIT: "KARTU",
    CARD: "KARTU",

    "E-WALLET": "E-WALLET",
    EWALLET: "E-WALLET",
    GOPAY: "E-WALLET",
    OVO: "E-WALLET",
    DANA: "E-WALLET",
    SHOPEEPAY: "E-WALLET",
  };

  return mapping[value] || value;
}

/* =========================================================
   GENERATE INVOICE (fallback)
   ========================================================= */

function generateInvoice() {
  const now = new Date();

  const tahun = now.getFullYear();
  const bulan = String(now.getMonth() + 1).padStart(2, "0");
  const tanggal = String(now.getDate()).padStart(2, "0");
  const jam = String(now.getHours()).padStart(2, "0");
  const menit = String(now.getMinutes()).padStart(2, "0");
  const detik = String(now.getSeconds()).padStart(2, "0");
  const random = String(Math.floor(Math.random() * 100)).padStart(2, "0");

  return "INV-" + tahun + bulan + tanggal + "-" + jam + menit + detik + random;
}

/* =========================================================
   ESCAPE HTML
   ========================================================= */

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* =========================================================
   HALAMAN ERROR
   ========================================================= */

function tampilkanError(judul, pesan) {
  document.body.innerHTML = `
    <div
      style="
        width:100%;
        min-height:100vh;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:25px;
        background:#f4f4f4;
        font-family: Arial, Helvetica, sans-serif;
        color:#111;
      "
    >
      <div
        style="
          width:100%;
          max-width:360px;
          background:#fff;
          padding:30px 22px;
          border-radius:14px;
          text-align:center;
          box-shadow: 0 8px 30px rgba(0,0,0,.10);
        "
      >
        <div
          style="
            width:48px;
            height:48px;
            margin:0 auto 15px;
            border-radius:50%;
            display:flex;
            align-items:center;
            justify-content:center;
            background:#111;
            color:#fff;
            font-size:22px;
            font-weight:bold;
          "
        >!</div>

        <h2 style="margin:0 0 8px; font-size:18px;">
          ${escapeHTML(judul)}
        </h2>

        <p
          style="
            margin:0;
            color:#666;
            font-size:13px;
            line-height:1.5;
          "
        >
          ${escapeHTML(pesan)}
        </p>

        <button
          type="button"
          onclick="window.close()"
          style="
            margin-top:18px;
            width:100%;
            padding:11px 14px;
            border:0;
            border-radius:8px;
            background:#111;
            color:#fff;
            font-size:12px;
            font-weight:700;
            cursor:pointer;
          "
        >
          ✕ TUTUP
        </button>
      </div>
    </div>
  `;
}

/* =========================================================
   AUTO PRINT
   ========================================================= */

window.addEventListener("load", function () {
  if (!AUTO_PRINT) return;

  /* Pastikan data sudah terisi sebelum print */
  const invoiceEl = document.getElementById("id");
  const invoiceText = invoiceEl ? invoiceEl.textContent.trim() : "";

  if (!invoiceText || invoiceText === "-") {
    console.warn("Auto-print dibatalkan: data belum siap.");
    return;
  }

  setTimeout(function () {
    window.print();
  }, 800);
});

/* =========================================================
   DEBUG
   ========================================================= */

console.log(
  "%c FYNCOFFEE STRUK V2 ",
  "background:#111827;color:white;padding:6px 10px;border-radius:6px;font-weight:bold;",
);
console.log("Invoice:", invoice);
console.log("Metode :", metode);
console.log("Status :", statusInfo.label);
console.log("Total  :", formatRupiah(total));

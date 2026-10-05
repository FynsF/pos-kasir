// ============================================================
// FYNCOFFEE POS KASIR
// SCRIPT.JS V7
// FRONTEND <-> GOOGLE APPS SCRIPT <-> GOOGLE SPREADSHEET
// + MODAL QRIS + MODAL STRUK + CETAK THERMAL 58MM
// ============================================================

const API =
  "https://script.google.com/macros/s/AKfycbxM00fAkiSzUzWyKc92vSBk2Yn2RSCHb71ditacJxJaWX8wpbksHTwRzTjMMlTBFm_WkQ/exec";

// ============================================================
// KONFIGURASI TOKO (dipakai di struk)
// ============================================================
const NAMA_TOKO = "FYNCOFFEE";
const ALAMAT_TOKO = "Jl. Kesawan, Sumatera Utara, Indonesia";
const TELP_TOKO = "0812-6944-1924";
const FOOTER_STRUK = "Terima kasih atas kunjungan Anda";
const CATATAN_STRUK = "Barang yang sudah dibeli tidak dapat ditukar";

// ============================================================
// STATE
// ============================================================
let produk = [];
let keranjang = [];
let idTransaksiAktif = "";
let namaKasir = "Admin";
let kategoriAktif = "Semua";
let searchQuery = "";
let sedangMemproses = false;
let sedangMemuatProduk = false;
let lastTransaksi = null; // untuk cetak ulang dari modal struk

// ============================================================
// DOM READY
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  setupSearch();
  setupCashInput();
  setupNetworkStatus();
  setupModalEvents();
  setupKeyboard();

  renderCart();
  updateClock();

  setInterval(updateClock, 1000);

  ambilProduk();
});

// ============================================================
// API GET
// ============================================================
async function apiGet(params = {}) {
  const query = new URLSearchParams();

  Object.keys(params).forEach((key) => {
    if (
      params[key] !== undefined &&
      params[key] !== null &&
      params[key] !== ""
    ) {
      query.append(key, params[key]);
    }
  });

  const url = `${API}?${query.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const result = await response.json();

  if (result && result.status === "error") {
    throw new Error(result.message || "API mengembalikan error");
  }

  return result;
}

// ============================================================
// API POST
// ============================================================
async function apiPost(payload = {}) {
  const response = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const result = await response.json();

  if (result && result.status === "error") {
    throw new Error(result.message || "API mengembalikan error");
  }

  return result;
}

// ============================================================
// NETWORK
// ============================================================
function setupNetworkStatus() {
  updateNetworkStatus();

  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);
}

function updateNetworkStatus() {
  const dot = document.getElementById("connectionDot");
  const text = document.getElementById("connectionText");

  if (!dot || !text) return;

  if (navigator.onLine) {
    dot.classList.add("online");
    dot.classList.remove("offline", "loading");
    text.textContent = "Online";
  } else {
    dot.classList.add("offline");
    dot.classList.remove("online", "loading");
    text.textContent = "Offline";
  }
}

function setConnectionLoading() {
  const dot = document.getElementById("connectionDot");
  const text = document.getElementById("connectionText");
  if (!dot || !text) return;
  dot.classList.remove("online", "offline");
  dot.classList.add("loading");
  text.textContent = "Memuat…";
}

// ============================================================
// CLOCK
// ============================================================
function updateClock() {
  const clock = document.getElementById("clock");
  if (!clock) return;

  clock.textContent = new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ============================================================
// PRODUK
// ============================================================
async function ambilProduk() {
  if (sedangMemuatProduk) return;

  sedangMemuatProduk = true;
  tampilLoading(true);
  setConnectionLoading();

  try {
    const result = await apiGet({ action: "produk" });

    const data = Array.isArray(result.data) ? result.data : [];

    produk = data.map(normalizeProduk).filter((item) => item.id);

    renderKategori();
    renderProduk();

    sinkronkanKeranjangDenganStok();

    updateNetworkStatus();
  } catch (error) {
    console.error("GAGAL LOAD PRODUK:", error);

    toast(
      error.message || "Gagal mengambil produk dari Google Spreadsheet",
      "error",
    );

    // tetap tandai offline
    const dot = document.getElementById("connectionDot");
    const text = document.getElementById("connectionText");
    if (dot && text) {
      dot.classList.remove("online", "loading");
      dot.classList.add("offline");
      text.textContent = "Offline";
    }
  } finally {
    sedangMemuatProduk = false;
    tampilLoading(false);
  }
}

// ============================================================
// NORMALIZE PRODUK
// ============================================================
function normalizeProduk(item) {
  return {
    id: String(
      item.id_produk ?? item.ID_Produk ?? item["ID Produk"] ?? item.id ?? "",
    ),

    nama: String(
      item.nama_produk ??
        item.Nama_Produk ??
        item["Nama Produk"] ??
        item.nama ??
        "",
    ),

    kategori: String(item.kategori ?? item.Kategori ?? "Lainnya"),

    hargaModal: toNumber(
      item.harga_modal ?? item.Harga_Modal ?? item["Harga Modal"] ?? 0,
    ),

    harga: toNumber(
      item.harga_jual ??
        item.Harga_Jual ??
        item["Harga Jual"] ??
        item.harga ??
        0,
    ),

    stok: toNumber(item.stok ?? item.Stok ?? 0),

    stokMinimum: toNumber(
      item.stok_minimum ?? item.Stok_Minimum ?? item["Stok Minimum"] ?? 0,
    ),

    satuan: String(item.satuan ?? item.Satuan ?? "Pcs"),

    status: String(item.status ?? item.Status ?? "Aktif"),
  };
}

// ============================================================
// KATEGORI
// ============================================================
function renderKategori() {
  const container = document.getElementById("kategoriProduk");
  if (!container) return;

  const kategori = [
    "Semua",
    ...new Set(produk.map((item) => item.kategori).filter(Boolean)),
  ];

  container.innerHTML = kategori
    .map(
      (item) => `
        <button
          type="button"
          class="category-btn ${item === kategoriAktif ? "active" : ""}"
          onclick='pilihKategori(${JSON.stringify(item)})'
        >
          ${escapeHTML(item)}
        </button>
      `,
    )
    .join("");
}

function pilihKategori(kategori) {
  kategoriAktif = kategori;
  renderKategori();
  renderProduk();
}

// ============================================================
// RENDER PRODUK
// ============================================================
function renderProduk() {
  const container = document.getElementById("produk");
  if (!container) return;

  let data = produk.filter(
    (item) => String(item.status).toLowerCase() === "aktif",
  );

  if (kategoriAktif !== "Semua") {
    data = data.filter((item) => item.kategori === kategoriAktif);
  }

  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    data = data.filter(
      (item) =>
        item.nama.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        item.kategori.toLowerCase().includes(q),
    );
  }

  // update info "X dari Y produk"
  const info = document.getElementById("produkInfo");
  if (info) info.textContent = `${data.length} dari ${produk.length} produk`;

  if (!data.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">☕</div>
        <h3>Produk tidak ditemukan</h3>
        <p>Coba gunakan kata kunci atau kategori lain.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = data.map(renderProductCard).join("");
}

// ============================================================
// PRODUCT CARD
// ============================================================
function renderProductCard(item) {
  const stok = Number(item.stok) || 0;
  const stokMinimum = Number(item.stokMinimum) || 0;

  const habis = stok <= 0;
  const stokRendah = !habis && stok <= stokMinimum;

  let stockText = "";
  let stockClass = "";

  if (habis) {
    stockText = "Stok habis";
    stockClass = "empty";
  } else if (stokRendah) {
    stockText = `Stok ${stok} • Menipis`;
    stockClass = "low";
  } else {
    stockText = `Stok ${stok}`;
  }

  return `
    <div
      class="product-card ${habis ? "out-of-stock" : ""}"
      ${habis ? "" : `onclick="tambahProduk('${escapeAttr(item.id)}')"`}
      tabindex="0"
      role="button"
      aria-label="${escapeHTML(item.nama)}"
    >
      <div class="product-info">
        <div class="product-category">
          ${escapeHTML(item.kategori)}
        </div>

        <h3 class="product-name">
          ${escapeHTML(item.nama)}
        </h3>

        <div class="product-price">
          ${formatRupiah(item.harga)}
        </div>

        <div class="stock-label ${stockClass}">
          ${escapeHTML(stockText)}
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// TAMBAH KE KERANJANG
// ============================================================
function tambahProduk(id) {
  const itemProduk = produk.find((item) => String(item.id) === String(id));

  if (!itemProduk) {
    toast("Produk tidak ditemukan", "error");
    return;
  }

  if (String(itemProduk.status).toLowerCase() !== "aktif") {
    toast("Produk tidak aktif", "error");
    return;
  }

  if (Number(itemProduk.stok) <= 0) {
    toast(`${itemProduk.nama} sedang habis`, "error");
    return;
  }

  const existing = keranjang.find(
    (item) => String(item.id_produk) === String(id),
  );

  if (existing) {
    if (Number(existing.qty) >= Number(itemProduk.stok)) {
      toast(`Stok ${itemProduk.nama} hanya ${itemProduk.stok}`, "error");
      return;
    }
    existing.qty = Number(existing.qty) + 1;
  } else {
    keranjang.push({
      id_produk: itemProduk.id,
      nama_produk: itemProduk.nama,
      harga_modal: Number(itemProduk.hargaModal) || 0,
      harga_jual: Number(itemProduk.harga) || 0,
      qty: 1,
      stok: Number(itemProduk.stok) || 0,
    });
  }

  renderCart();
  pushToCustomerDisplay();
}

// ============================================================
// SINKRON KERANJANG
// ============================================================
function sinkronkanKeranjangDenganStok() {
  keranjang = keranjang
    .map((item) => {
      const p = produk.find(
        (product) => String(product.id) === String(item.id_produk),
      );

      if (!p) return null;

      const stok = Number(p.stok) || 0;

      if (stok <= 0) return null;

      return {
        ...item,
        nama_produk: p.nama,
        harga_modal: Number(p.hargaModal) || 0,
        harga_jual: Number(p.harga) || 0,
        stok,
        qty: Math.min(Number(item.qty) || 1, stok),
      };
    })
    .filter(Boolean);

  renderCart();
}

// ============================================================
// CART
// ============================================================
function renderCart() {
  const container = document.getElementById("keranjang");
  const empty = document.getElementById("cartEmpty");

  if (!container) return;

  if (!keranjang.length) {
    container.innerHTML = "";
    if (empty) empty.style.display = "flex";
    updateCartSummary();
    pushToCustomerDisplay();
    return;
  }

  if (empty) empty.style.display = "none";

  container.innerHTML = keranjang.map(renderCartItem).join("");

  updateCartSummary();
  pushToCustomerDisplay();
}

// ============================================================
// CART ITEM
// ============================================================
function renderCartItem(item) {
  const subtotal = Number(item.harga_jual) * Number(item.qty);

  return `
    <div class="cart-item">
      <div class="cart-item-top">
        <div>
          <div class="cart-item-name">
            ${escapeHTML(item.nama_produk)}
          </div>
          <div class="cart-item-price">
            ${formatRupiah(item.harga_jual)} / pcs
          </div>
        </div>

        <button
          type="button"
          class="cart-item-remove"
          onclick="hapusItem('${escapeAttr(item.id_produk)}')"
          aria-label="Hapus item"
        >×</button>
      </div>

      <div class="cart-item-bottom">
        <div class="qty-control">
          <button
            type="button"
            class="qty-btn"
            onclick="ubahQty('${escapeAttr(item.id_produk)}', -1)"
            aria-label="Kurangi"
          >−</button>

          <span class="qty-value">${Number(item.qty)}</span>

          <button
            type="button"
            class="qty-btn"
            onclick="ubahQty('${escapeAttr(item.id_produk)}', 1)"
            aria-label="Tambah"
          >+</button>
        </div>

        <div class="cart-item-subtotal">
          ${formatRupiah(subtotal)}
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// HAPUS ITEM
// ============================================================
function hapusItem(id) {
  keranjang = keranjang.filter((item) => String(item.id_produk) !== String(id));
  renderCart();
}

// ============================================================
// UBAH QTY
// ============================================================
function ubahQty(id, perubahan) {
  const item = keranjang.find(
    (cartItem) => String(cartItem.id_produk) === String(id),
  );

  if (!item) return;

  const itemProduk = produk.find(
    (product) => String(product.id) === String(id),
  );

  if (!itemProduk) return;

  const qtyBaru = Number(item.qty) + Number(perubahan);

  if (qtyBaru <= 0) {
    keranjang = keranjang.filter(
      (cartItem) => String(cartItem.id_produk) !== String(id),
    );
    renderCart();
    return;
  }

  if (qtyBaru > Number(itemProduk.stok)) {
    toast(`Stok ${itemProduk.nama} hanya ${itemProduk.stok}`, "error");
    return;
  }

  item.qty = qtyBaru;
  renderCart();
}

// ============================================================
// TOTAL
// ============================================================
function hitungTotal() {
  return keranjang.reduce(
    (total, item) =>
      total + (Number(item.harga_jual) || 0) * (Number(item.qty) || 0),
    0,
  );
}

function hitungTotalItem() {
  return keranjang.reduce((total, item) => total + (Number(item.qty) || 0), 0);
}

function updateCartSummary() {
  const total = hitungTotal();
  const totalItem = hitungTotalItem();

  const totalElement = document.getElementById("total");
  const totalItemElement = document.getElementById("totalItem");
  const badge = document.getElementById("cartBadge");
  const mobileBadge = document.getElementById("mobileCartBadge");

  if (totalElement) totalElement.textContent = formatRupiah(total);
  if (totalItemElement) totalItemElement.textContent = `${totalItem} item`;

  if (badge) {
    badge.textContent = totalItem;
    badge.style.display = totalItem > 0 ? "flex" : "none";
  }

  if (mobileBadge) {
    mobileBadge.textContent = totalItem;
    mobileBadge.style.display = totalItem > 0 ? "flex" : "none";
  }
}

// ============================================================
// SEARCH
// ============================================================
function setupSearch() {
  const input = document.getElementById("searchProduk");
  const clear = document.getElementById("clearSearch");

  if (!input) return;

  input.addEventListener("input", (event) => {
    searchQuery = event.target.value;
    renderProduk();

    if (clear) {
      clear.style.display = searchQuery ? "flex" : "none";
    }
  });

  if (clear) {
    clear.addEventListener("click", () => {
      input.value = "";
      searchQuery = "";
      clear.style.display = "none";
      renderProduk();
      input.focus();
    });
  }
}

// ============================================================
// QRIS MODAL (BARU)
// ============================================================
function bayarQRIS() {
  if (!keranjang.length) {
    toast("Keranjang masih kosong", "error");
    return;
  }

  const modal = document.getElementById("qrisModal");
  const totalEl = document.getElementById("qrisTotal");

  if (totalEl) totalEl.textContent = formatRupiah(hitungTotal());

  if (modal) modal.classList.add("active");
}

function tutupQrisModal() {
  const modal = document.getElementById("qrisModal");
  if (modal) modal.classList.remove("active");
}

function konfirmasiQRIS() {
  tutupQrisModal();
  prosesPembayaran("QRIS");
}

// ============================================================
// CASH MODAL
// ============================================================
function bukaCashModal() {
  if (!keranjang.length) {
    toast("Keranjang masih kosong", "error");
    return;
  }

  const modal = document.getElementById("cashModal");
  const total = hitungTotal();

  const cashTotal = document.getElementById("cashTotal");
  const input = document.getElementById("uangDiterima");
  const kembalian = document.getElementById("kembalian");
  const error = document.getElementById("cashInputError");
  const changeBox = document.getElementById("changeBox");

  if (cashTotal) cashTotal.textContent = formatRupiah(total);

  if (input) {
    input.value = "";
    input.classList.remove("invalid");
  }

  if (kembalian) kembalian.textContent = formatRupiah(0);
  if (changeBox) changeBox.classList.remove("negative");

  if (error) {
    error.textContent = "";
    error.classList.remove("visible");
    error.style.display = "none";
  }

  if (modal) {
    modal.classList.add("active");
    setTimeout(() => {
      if (input) input.focus();
    }, 100);
  }
}

function tutupCashModal() {
  const modal = document.getElementById("cashModal");
  if (!modal) return;
  modal.classList.remove("active");
}

// ============================================================
// CASH INPUT
// ============================================================
function setupCashInput() {
  const input = document.getElementById("uangDiterima");
  if (!input) return;

  input.addEventListener("input", hitungKembalian);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      konfirmasiCash();
    }
  });
}

function hitungKembalian() {
  const input = document.getElementById("uangDiterima");
  const display = document.getElementById("kembalian");
  const error = document.getElementById("cashInputError");
  const changeBox = document.getElementById("changeBox");

  if (!input || !display) return;

  const uang = parseMoneyInput(input.value);
  const total = hitungTotal();
  const kembali = uang - total;

  display.textContent = formatRupiah(kembali > 0 ? kembali : 0);

  if (changeBox) changeBox.classList.toggle("negative", kembali < 0);

  if (error) {
    if (uang > 0 && uang < total) {
      error.textContent = `Uang kurang ${formatRupiah(total - uang)}`;
      error.classList.add("visible");
      error.style.display = "block";
      input.classList.add("invalid");
    } else {
      error.textContent = "";
      error.classList.remove("visible");
      error.style.display = "none";
      input.classList.remove("invalid");
    }
  }
}

function setUangCash(value) {
  const input = document.getElementById("uangDiterima");
  if (!input) return;
  input.value = Number(value) || 0;
  hitungKembalian();
}

function quickCash(value) {
  if (value === "pas") {
    setUangCash(hitungTotal());
    return;
  }
  setUangCash(Number(value) || 0);
}

// ============================================================
// KONFIRMASI CASH
// ============================================================
function konfirmasiCash() {
  if (!keranjang.length) {
    toast("Keranjang masih kosong", "error");
    return;
  }

  const input = document.getElementById("uangDiterima");
  if (!input) return;

  const uang = parseMoneyInput(input.value);
  const total = hitungTotal();

  if (uang < total) {
    toast(`Uang kurang ${formatRupiah(total - uang)}`, "error");
    return;
  }

  prosesPembayaran("CASH", uang);
}

// ============================================================
// SIMPAN TRANSAKSI
// ============================================================
async function prosesPembayaran(metode, uangDiterima = 0) {
  if (sedangMemproses) return;

  if (!keranjang.length) {
    toast("Keranjang masih kosong", "error");
    return;
  }

  const metodeFinal = String(metode || "")
    .trim()
    .toUpperCase();
  const metodeValid = ["CASH", "QRIS", "TRANSFER", "DEBIT", "E-WALLET"];

  if (!metodeValid.includes(metodeFinal)) {
    toast(`Metode pembayaran tidak valid: ${metodeFinal}`, "error");
    return;
  }

  const total = hitungTotal();

  if (metodeFinal === "CASH" && Number(uangDiterima) < total) {
    toast("Uang diterima kurang dari total", "error");
    return;
  }

  // ========================================================
  // SNAPSHOT ITEM SEBELUM KERANJANG DIKOSONGKAN
  // ========================================================
  const snapshotItems = keranjang.map((item) => ({
    id_produk: item.id_produk,
    nama_produk: item.nama_produk,
    harga_modal: Number(item.harga_modal) || 0,
    harga_jual: Number(item.harga_jual) || 0,
    qty: Number(item.qty) || 0,
    subtotal: (Number(item.harga_jual) || 0) * (Number(item.qty) || 0),
  }));

  const totalItem = snapshotItems.reduce(
    (sum, item) => sum + Number(item.qty || 0),
    0,
  );

  const tanggal = formatTanggalLengkap();
  const uang = metodeFinal === "CASH" ? Number(uangDiterima) || 0 : total;
  const kembali = metodeFinal === "CASH" ? Math.max(0, uang - total) : 0;

  const payload = {
    action: "simpan",
    kasir: namaKasir,
    metode_pembayaran: metodeFinal,
    status: "Lunas",
    uang_diterima: metodeFinal === "CASH" ? uang : 0,
    catatan: "",
    items: snapshotItems.map((item) => ({
      id_produk: item.id_produk,
      qty: item.qty,
    })),
  };

  sedangMemproses = true;
  tampilLoading(true);

  try {
    const result = await apiPost(payload);

    if (!result || result.status !== "success") {
      throw new Error(result?.message || "Transaksi gagal disimpan");
    }

    // ======================================================
    // INVOICE DARI SERVER
    // ======================================================
    idTransaksiAktif = result.invoice || result.id || generateInvoice();

    // ======================================================
    // DATA STRUK LENGKAP
    // ======================================================
    const transaksiStruk = {
      id: idTransaksiAktif,
      invoice: idTransaksiAktif,
      tanggal: result.waktu || result.tanggal || tanggal,
      kasir: result.kasir || namaKasir,
      items: snapshotItems,
      total_item: totalItem,
      subtotal: total,
      diskon: Number(result.diskon) || 0,
      pajak: Number(result.pajak) || 0,
      total: Number(result.total ?? total),
      metode: metodeFinal,
      metode_pembayaran: metodeFinal,
      bayar: uang,
      uang_diterima: uang,
      kembali: kembali,
      kembalian: kembali,
      status: result.status_transaksi || result.status || "Lunas",
    };

    // simpan untuk Struk.html & cetak ulang
    lastTransaksi = transaksiStruk;
    try {
      localStorage.setItem("transaksi", JSON.stringify(transaksiStruk));
    } catch (e) {
      /* ignore */
    }

    // ======================================================
    // TAMPILKAN MODAL STRUK
    // ======================================================
    tampilReceipt(transaksiStruk);

    // ======================================================
    // KOSONGKAN KERANJANG
    // ======================================================
    keranjang = [];
    renderCart();

    tutupCashModal();

    // ======================================================
    // REFRESH PRODUK / STOK
    // ======================================================
    await ambilProduk();

    toast(result.message || "Transaksi berhasil disimpan", "success");
  } catch (error) {
    console.error("TRANSAKSI ERROR:", error);
    toast(error.message || "Gagal menyimpan transaksi", "error");
  } finally {
    sedangMemproses = false;
    tampilLoading(false);
  }
}

// ============================================================
// STRUK — HTML (kelas .r-paper sesuai index.html)
// ============================================================
function buatHTMLStruk(data) {
  const items = Array.isArray(data.items) ? data.items : [];

  const itemHTML = items
    .map((item) => {
      const qty = Number(item.qty) || 0;
      const harga = Number(item.harga_jual ?? item.harga) || 0;
      const subtotal = Number(item.subtotal ?? harga * qty) || 0;

      return `
        <div class="r-item">
          <div class="r-item-name">${escapeHTML(
            item.nama_produk || item.nama || "-",
          )}</div>
          <div class="r-row">
            <span>${qty} x ${angkaID(harga)}</span>
            <span>${angkaID(subtotal)}</span>
          </div>
        </div>
      `;
    })
    .join("");

  const metode = String(
    data.metode_pembayaran || data.metode || "",
  ).toUpperCase();

  const totalItem =
    Number(data.total_item) ||
    items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);

  const invoice = data.invoice || data.id || "-";
  const tanggal = data.tanggal || data.waktu || "-";
  const kasir = data.kasir || namaKasir;
  const total = Number(data.total) || 0;
  const bayar = Number(data.uang_diterima ?? data.bayar) || 0;
  const kembali = Number(data.kembalian ?? data.kembali) || 0;
  const status = data.status || "Lunas";

  return `
    <div class="r-paper">
      <div class="r-center r-store">${escapeHTML(NAMA_TOKO)}</div>
      <div class="r-center r-small">${escapeHTML(ALAMAT_TOKO)}</div>
      <div class="r-center r-small">${escapeHTML(TELP_TOKO)}</div>

      <div class="r-line"></div>

      <div class="r-row r-small">
        <span>Invoice</span><span>${escapeHTML(invoice)}</span>
      </div>
      <div class="r-row r-small">
        <span>Waktu</span><span>${escapeHTML(tanggal)}</span>
      </div>
      <div class="r-row r-small">
        <span>Kasir</span><span>${escapeHTML(kasir)}</span>
      </div>

      <div class="r-line"></div>

      ${itemHTML || '<div class="r-center r-small">-</div>'}

      <div class="r-line"></div>

      <div class="r-row">
        <span>Total Item</span><span>${totalItem}</span>
      </div>
      <div class="r-row r-bold">
        <span>TOTAL</span><span>${formatRupiah(total)}</span>
      </div>

      ${
        metode === "CASH"
          ? `
            <div class="r-row">
              <span>Tunai</span><span>${formatRupiah(bayar)}</span>
            </div>
            <div class="r-row">
              <span>Kembali</span><span>${formatRupiah(kembali)}</span>
            </div>
          `
          : `
            <div class="r-row">
              <span>Metode</span><span>${escapeHTML(metode)}</span>
            </div>
          `
      }

      <div class="r-row">
        <span>Status</span><span>${escapeHTML(status)}</span>
      </div>

      <div class="r-line"></div>

      <div class="r-center r-small">${escapeHTML(FOOTER_STRUK)}</div>
      <div class="r-center r-small">${escapeHTML(CATATAN_STRUK)}</div>
      <div class="r-center r-small" style="margin-top:6px">
        *** ${escapeHTML(invoice)} ***
      </div>
    </div>
  `;
}

// ============================================================
// RECEIPT PREVIEW + MODAL
// ============================================================
function tampilReceipt(data) {
  const preview = document.getElementById("receiptPreview");
  const container = document.getElementById("receiptContainer");
  const modal = document.getElementById("receiptModal");
  const successText = document.getElementById("receiptSuccessText");

  const html = buatHTMLStruk(data);

  if (preview) preview.innerHTML = html;
  if (container) container.innerHTML = html;

  if (successText) {
    const metode = String(
      data.metode_pembayaran || data.metode || "",
    ).toUpperCase();
    const total = Number(data.total) || 0;
    const kembali = Number(data.kembalian ?? data.kembali) || 0;

    successText.textContent =
      metode +
      " • " +
      formatRupiah(total) +
      (kembali > 0 ? " • Kembali " + formatRupiah(kembali) : "");
  }

  if (modal) modal.classList.add("active");
}

function tutupStruk() {
  const modal = document.getElementById("receiptModal");
  if (modal) modal.classList.remove("active");
}

function cetakStrukTerakhir() {
  if (!lastTransaksi) {
    toast("Belum ada transaksi untuk dicetak", "error");
    return;
  }

  const container = document.getElementById("receiptContainer");
  if (!container) return;

  // isi ulang (jaga-jaga)
  container.innerHTML = buatHTMLStruk(lastTransaksi);

  // beri jeda agar layout siap, lalu print
  setTimeout(() => {
    window.print();

    // bersihkan setelah print
    setTimeout(() => {
      container.innerHTML = "";
    }, 1500);
  }, 200);
}

// ============================================================
// BUKA STRUK.HTML (halaman terpisah, opsional)
// ============================================================
function bukaStruk() {
  const transaksi = localStorage.getItem("transaksi");

  if (!transaksi) {
    toast("Data transaksi tidak ditemukan", "error");
    return;
  }

  const win = window.open("Struk.html", "_blank");

  if (!win) {
    toast("Popup diblokir browser. Izinkan popup untuk FYNCOFFEE.", "error");
    return;
  }

  toast("Struk siap dicetak", "success");
}

// ============================================================
// PRINT RECEIPT LANGSUNG (via Struk.html)
// ============================================================
function printReceipt() {
  const transaksi = localStorage.getItem("transaksi");

  if (!transaksi) {
    toast("Belum ada transaksi untuk dicetak", "error");
    return;
  }

  const win = window.open("Struk.html", "_blank");

  if (!win) {
    toast("Popup diblokir browser", "error");
  }
}

// ============================================================
// CUSTOMER DISPLAY (live, sinkron via localStorage)
// ============================================================
const DISPLAY_KEY = "fyncoffee_display";

function pushToCustomerDisplay() {
  try {
    const payload = {
      items: keranjang.map((i) => ({
        nama: i.nama_produk,
        qty: Number(i.qty) || 0,
        harga: Number(i.harga_jual) || 0,
        subtotal: (Number(i.harga_jual) || 0) * (Number(i.qty) || 0),
      })),
      total: hitungTotal(),
      count: hitungTotalItem(),
      updatedAt: Date.now(),
    };

    localStorage.setItem(DISPLAY_KEY, JSON.stringify(payload));
  } catch (e) {
    /* ignore */
  }
}

function buatHTMLDisplay(payload = null) {
  const data = payload || {
    items: keranjang.map((i) => ({
      nama: i.nama_produk,
      qty: Number(i.qty) || 0,
      harga: Number(i.harga_jual) || 0,
      subtotal: (Number(i.harga_jual) || 0) * (Number(i.qty) || 0),
    })),
    total: hitungTotal(),
    count: hitungTotalItem(),
  };

  const itemsHTML = (data.items || [])
    .map(
      (i) => `
        <div class="row">
          <div class="name">${escapeHTML(i.nama)}</div>
          <div class="qty">${i.qty} × ${formatRupiah(i.harga)}</div>
          <div class="sub">${formatRupiah(i.subtotal)}</div>
        </div>
      `,
    )
    .join("");

  const empty = !data.items || !data.items.length;

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8"/>
<title>Customer Display — FYNCOFFEE</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Inter, system-ui, -apple-system, sans-serif;
    background: #0a0a0a; color: #fff; min-height: 100vh;
    display: flex; flex-direction: column;
  }
  header {
    height: 90px; flex: 0 0 90px;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 40px; background: #171717; border-bottom: 1px solid #262626;
  }
  header .brand { font-size: 28px; font-weight: 900; letter-spacing: 3px; }
  header .clock { font-size: 22px; font-weight: 800; color: #a3a3a3;
    font-variant-numeric: tabular-nums; }
  main { flex: 1; overflow-y: auto; padding: 30px 40px; }
  .row {
    display: grid; grid-template-columns: 1fr auto auto;
    gap: 24px; align-items: center;
    padding: 16px 0; border-bottom: 1px solid #1f1f1f;
    font-size: 22px;
  }
  .row .name { font-weight: 800; }
  .row .qty { color: #a3a3a3; font-weight: 700; font-variant-numeric: tabular-nums; }
  .row .sub { font-weight: 900; font-variant-numeric: tabular-nums;
    text-align: right; min-width: 180px; }
  .empty {
    height: 100%; display: flex; align-items: center; justify-content: center;
    flex-direction: column; gap: 14px; color: #525252;
    font-size: 26px; font-weight: 800; text-align: center;
  }
  .empty .icon { font-size: 70px; }
  footer {
    flex: 0 0 auto; background: #171717; border-top: 1px solid #262626;
    padding: 26px 40px 32px;
  }
  .count {
    display: flex; justify-content: space-between;
    font-size: 18px; color: #a3a3a3; font-weight: 700; margin-bottom: 14px;
  }
  .total {
    display: flex; justify-content: space-between; align-items: baseline;
    gap: 24px;
  }
  .total span {
    font-size: 22px; font-weight: 800; color: #a3a3a3; letter-spacing: 3px;
  }
  .total strong {
    font-size: 58px; font-weight: 900;
    font-variant-numeric: tabular-nums;
  }
</style>
</head>
<body>
  <header>
    <div class="brand">☕ FYNCOFFEE</div>
    <div class="clock" id="clock">--:--:--</div>
  </header>

  <main>
    ${
      empty
        ? `
          <div class="empty">
            <div class="icon">🛒</div>
            <div>Selamat datang di FYNCOFFEE</div>
            <div style="font-size:16px;color:#737373">Silakan lakukan pemesanan di kasir</div>
          </div>
        `
        : itemsHTML
    }
  </main>

  <footer>
    <div class="count">
      <span>JUMLAH ITEM</span>
      <span id="count">${data.count || 0}</span>
    </div>
    <div class="total">
      <span>TOTAL</span>
      <strong id="total">${formatRupiah(data.total || 0)}</strong>
    </div>
  </footer>

  <script>
    function tick() {
      document.getElementById("clock").textContent =
        new Date().toLocaleTimeString("id-ID", { hour12: false });
    }
    tick();
    setInterval(tick, 1000);

    const KEY = ${JSON.stringify(DISPLAY_KEY)};

    window.addEventListener("storage", (e) => {
      if (e.key !== KEY || !e.newValue) return;
      try {
        const data = JSON.parse(e.newValue);
        renderDisplay(data);
      } catch (err) {}
    });

    function renderDisplay(data) {
      const main = document.querySelector("main");
      const items = data.items || [];

      if (!items.length) {
        main.innerHTML =
          '<div class="empty">' +
            '<div class="icon">🛒</div>' +
            '<div>Selamat datang di FYNCOFFEE</div>' +
            '<div style="font-size:16px;color:#737373">' +
              'Silakan lakukan pemesanan di kasir' +
            '</div>' +
          '</div>';
      } else {
        main.innerHTML = items
          .map((i) =>
            '<div class="row">' +
              '<div class="name">' + escapeHtml(i.nama) + '</div>' +
              '<div class="qty">' + i.qty + ' × ' + formatRupiah(i.harga) + '</div>' +
              '<div class="sub">' + formatRupiah(i.subtotal) + '</div>' +
            '</div>'
          )
          .join("");
      }

      document.getElementById("count").textContent = data.count || 0;
      document.getElementById("total").textContent = formatRupiah(data.total || 0);
    }

    function escapeHtml(v) {
      return String(v ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      })[c]);
    }

    function formatRupiah(n) {
      return "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(Number(n) || 0));
    }
  <\/script>
</body>
</html>`;
}

function bukaCustomerDisplay() {
  // push current state dulu
  pushToCustomerDisplay();

  const win = window.open(
    "",
    "fyncoffee_display",
    "width=1200,height=800,menubar=no,toolbar=no",
  );

  if (!win) {
    toast("Popup diblokir browser. Izinkan popup untuk display.", "error");
    return;
  }

  win.document.open();
  win.document.write(buatHTMLDisplay());
  win.document.close();
  win.focus();

  toast("Customer display dibuka", "success");
}

// ============================================================
// DISPLAY VIA API (tetap dipertahankan)
// ============================================================
async function ambilDisplay() {
  try {
    const result = await apiGet({ action: "display" });
    return result.data || { status: "kosong" };
  } catch (error) {
    console.error("DISPLAY ERROR:", error);
    return { status: "error", message: error.message };
  }
}

async function resetDisplay() {
  try {
    const result = await apiGet({ action: "resetDisplay" });

    if (result.status === "success") {
      toast(result.message || "Display berhasil direset", "success");
      return result;
    }

    throw new Error(result.message || "Gagal reset display");
  } catch (error) {
    console.error(error);
    toast(error.message || "Gagal reset display", "error");
    return null;
  }
}

// ============================================================
// TRANSAKSI (ADMIN)
// ============================================================
async function ambilTransaksi(tanggal = "") {
  try {
    const params = { action: "transaksi" };
    if (tanggal) params.tanggal = tanggal;

    const result = await apiGet(params);
    return Array.isArray(result.data) ? result.data : [];
  } catch (error) {
    console.error("TRANSAKSI ERROR:", error);
    toast(error.message || "Gagal mengambil transaksi", "error");
    return [];
  }
}

async function ambilDetailTransaksi(invoice) {
  if (!invoice) {
    toast("Invoice tidak ditemukan", "error");
    return [];
  }

  try {
    const result = await apiGet({ action: "detail", id: invoice });
    return Array.isArray(result.data) ? result.data : [];
  } catch (error) {
    console.error("DETAIL ERROR:", error);
    toast(error.message || "Gagal mengambil detail transaksi", "error");
    return [];
  }
}

async function ambilDashboard(tanggal = "") {
  try {
    const params = { action: "dashboard" };
    if (tanggal) params.tanggal = tanggal;

    const result = await apiGet(params);
    return result.data || {};
  } catch (error) {
    console.error("DASHBOARD ERROR:", error);
    toast(error.message || "Gagal mengambil dashboard", "error");
    return {};
  }
}

async function lunaskanTransaksi(id) {
  if (!id) {
    toast("ID transaksi tidak ditemukan", "error");
    return null;
  }

  try {
    const result = await apiGet({ action: "lunas", id });

    if (result.status !== "success") {
      throw new Error(result.message || "Gagal melunaskan transaksi");
    }

    toast(result.message || "Pembayaran berhasil dilunaskan", "success");
    return result;
  } catch (error) {
    toast(error.message || "Gagal melunaskan transaksi", "error");
    return null;
  }
}

async function batalkanTransaksi(id) {
  if (!id) {
    toast("ID transaksi tidak ditemukan", "error");
    return null;
  }

  const konfirmasi = window.confirm("Batalkan transaksi ini?");
  if (!konfirmasi) return null;

  try {
    const result = await apiGet({ action: "batal", id });

    if (result.status !== "success") {
      throw new Error(result.message || "Gagal membatalkan transaksi");
    }

    toast(result.message || "Transaksi berhasil dibatalkan", "success");
    await ambilProduk();
    return result;
  } catch (error) {
    toast(error.message || "Gagal membatalkan transaksi", "error");
    return null;
  }
}

// ============================================================
// RESET TRANSAKSI
// ============================================================
function resetTransaksi() {
  if (keranjang.length) {
    const yakin = window.confirm("Kosongkan semua item di keranjang?");
    if (!yakin) return;
  }

  keranjang = [];
  idTransaksiAktif = "";

  renderCart();
  tutupCashModal();
}

// ============================================================
// TAMBAH PRODUK SERVER
// ============================================================
async function tambahProdukServer(data) {
  try {
    const result = await apiPost({
      action: "tambahProduk",
      id_produk: data.id_produk,
      nama_produk: data.nama_produk,
      kategori: data.kategori,
      harga_modal: Number(data.harga_modal) || 0,
      harga_jual: Number(data.harga_jual) || 0,
      stok: Number(data.stok) || 0,
      stok_minimum: Number(data.stok_minimum) || 0,
      satuan: data.satuan || "Pcs",
    });

    if (result.status !== "success") {
      throw new Error(result.message || "Gagal menambahkan produk");
    }

    await ambilProduk();
    toast(result.message || "Produk berhasil ditambahkan", "success");
    return result;
  } catch (error) {
    toast(error.message || "Gagal menambahkan produk", "error");
    return null;
  }
}

// ============================================================
// UPDATE PRODUK SERVER
// ============================================================
async function updateProdukServer(data) {
  try {
    const result = await apiPost({ action: "updateProduk", ...data });

    if (result.status !== "success") {
      throw new Error(result.message || "Gagal memperbarui produk");
    }

    await ambilProduk();
    toast(result.message || "Produk berhasil diperbarui", "success");
    return result;
  } catch (error) {
    toast(error.message || "Gagal memperbarui produk", "error");
    return null;
  }
}

// ============================================================
// HAPUS / NONAKTIFKAN PRODUK
// ============================================================
async function hapusProdukServer(id) {
  if (!id) return null;

  try {
    const result = await apiPost({ action: "hapusProduk", id });

    if (result.status !== "success") {
      throw new Error(result.message || "Gagal menonaktifkan produk");
    }

    await ambilProduk();
    toast(result.message || "Produk dinonaktifkan", "success");
    return result;
  } catch (error) {
    toast(error.message || "Gagal menonaktifkan produk", "error");
    return null;
  }
}

// ============================================================
// STOK
// ============================================================
async function stokMasukServer(id, qty) {
  return updateStokServer("stokMasuk", id, qty);
}

async function stokKeluarServer(id, qty) {
  return updateStokServer("stokKeluar", id, qty);
}

async function updateStokServer(action, id, qty) {
  const jumlah = Number(qty);

  if (!Number.isFinite(jumlah) || jumlah <= 0) {
    toast("Jumlah stok harus lebih dari 0", "error");
    return null;
  }

  try {
    const result = await apiPost({
      action,
      id_produk: id,
      qty: jumlah,
    });

    if (result.status !== "success") {
      throw new Error(result.message || "Gagal memperbarui stok");
    }

    await ambilProduk();
    toast(result.message || "Stok berhasil diperbarui", "success");
    return result;
  } catch (error) {
    toast(error.message || "Gagal memperbarui stok", "error");
    return null;
  }
}

// ============================================================
// FORMAT RUPIAH
// ============================================================
function formatRupiah(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(number);
}

// ============================================================
// ANGKA (tanpa Rp) — untuk baris "qty x harga" di struk
// ============================================================
function angkaID(value) {
  return new Intl.NumberFormat("id-ID").format(Math.round(Number(value) || 0));
}

// ============================================================
// FORMAT TANGGAL
// ============================================================
function formatTanggalLengkap() {
  const now = new Date();
  return now.toLocaleString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ============================================================
// GENERATE INVOICE FALLBACK
// ============================================================
function generateInvoice() {
  const now = new Date();
  const tahun = now.getFullYear();
  const bulan = String(now.getMonth() + 1).padStart(2, "0");
  const tanggal = String(now.getDate()).padStart(2, "0");
  const random = String(Date.now()).slice(-5);
  return `INV-${tahun}${bulan}${tanggal}-${random}`;
}

// ============================================================
// NUMBER
// ============================================================
function toNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (value === null || value === undefined || value === "") return 0;

  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

// ============================================================
// PARSE UANG
// ============================================================
function parseMoneyInput(value) {
  if (typeof value === "number") return value || 0;
  const cleaned = String(value || "").replace(/[^\d]/g, "");
  return Number(cleaned) || 0;
}

// ============================================================
// ESCAPE HTML
// ============================================================
function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================
// ESCAPE ATTRIBUTE (untuk onclick inline)
// ============================================================
function escapeAttr(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

// ============================================================
// TOAST
// ============================================================
function toast(message, type = "info") {
  let container = document.getElementById("toastContainer");

  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    document.body.appendChild(container);
  }

  const item = document.createElement("div");
  item.className = `toast toast-${type}`;
  item.textContent = message;

  container.appendChild(item);

  setTimeout(() => {
    item.classList.add("hide");
    setTimeout(() => item.remove(), 300);
  }, 3000);
}

// ============================================================
// LOADING
// ============================================================
function tampilLoading(show) {
  let overlay = document.getElementById("loadingOverlay");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "loadingOverlay";
    overlay.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-text">Memproses...</div>
    `;
    document.body.appendChild(overlay);
  }

  overlay.classList.toggle("active", Boolean(show));
}

// ============================================================
// MODAL EVENTS
// ============================================================
function setupModalEvents() {
  const cashModal = document.getElementById("cashModal");
  const qrisModal = document.getElementById("qrisModal");
  const receiptModal = document.getElementById("receiptModal");

  if (cashModal) {
    cashModal.addEventListener("click", (event) => {
      if (event.target === cashModal) tutupCashModal();
    });
  }

  if (qrisModal) {
    qrisModal.addEventListener("click", (event) => {
      if (event.target === qrisModal) tutupQrisModal();
    });
  }

  if (receiptModal) {
    receiptModal.addEventListener("click", (event) => {
      if (event.target === receiptModal) tutupStruk();
    });
  }
}

// ============================================================
// KEYBOARD SHORTCUT
// ============================================================
function setupKeyboard() {
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      tutupCashModal();
      tutupQrisModal();
      tutupStruk();
    }

    if (event.key === "F1") {
      event.preventDefault();
      const search = document.getElementById("searchProduk");
      if (search) {
        search.focus();
        search.select();
      }
    }

    if (event.key === "F2") {
      event.preventDefault();
      bukaCashModal();
    }

    if (event.key === "F3") {
      event.preventDefault();
      bayarQRIS();
    }
  });
}

// ============================================================
// GLOBAL EXPORTS
// ============================================================
window.ambilProduk = ambilProduk;
window.pilihKategori = pilihKategori;
window.tambahProduk = tambahProduk;
window.ubahQty = ubahQty;
window.hapusItem = hapusItem;

window.bayarQRIS = bayarQRIS;
window.tutupQrisModal = tutupQrisModal;
window.konfirmasiQRIS = konfirmasiQRIS;

window.bukaCashModal = bukaCashModal;
window.tutupCashModal = tutupCashModal;
window.konfirmasiCash = konfirmasiCash;
window.setUangCash = setUangCash;
window.quickCash = quickCash;
window.hitungKembalian = hitungKembalian;

window.prosesPembayaran = prosesPembayaran;
window.resetTransaksi = resetTransaksi;

window.tampilReceipt = tampilReceipt;
window.tutupStruk = tutupStruk;
window.cetakStrukTerakhir = cetakStrukTerakhir;
window.printReceipt = printReceipt;
window.bukaStruk = bukaStruk;

window.bukaCustomerDisplay = bukaCustomerDisplay;
window.ambilDisplay = ambilDisplay;
window.resetDisplay = resetDisplay;

window.ambilTransaksi = ambilTransaksi;
window.ambilDetailTransaksi = ambilDetailTransaksi;
window.ambilDashboard = ambilDashboard;
window.lunaskanTransaksi = lunaskanTransaksi;
window.batalkanTransaksi = batalkanTransaksi;

window.tambahProdukServer = tambahProdukServer;
window.updateProdukServer = updateProdukServer;
window.hapusProdukServer = hapusProdukServer;
window.stokMasukServer = stokMasukServer;
window.stokKeluarServer = stokKeluarServer;
window.updateStokServer = updateStokServer;

window.formatRupiah = formatRupiah;

// ============================================================
// DEBUG
// ============================================================
console.log(
  "%c FYNCOFFEE POS V7 ",
  "background:#111827;color:white;padding:8px 12px;border-radius:6px;font-weight:bold;",
);
console.log("Backend:", API);
console.log("Kasir:", namaKasir);

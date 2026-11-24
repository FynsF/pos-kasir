// ============================================================
// FYNCOFFEE POS KASIR
// SCRIPT.JS V10 — SINKRON DENGAN BACKEND APPS SCRIPT V4
// (V10: tema terang/gelap, riwayat transaksi, filter tanggal — lihat ui.js & history.js)
// FRONTEND <-> GOOGLE APPS SCRIPT <-> GOOGLE SPREADSHEET (EXCEL)
//
// PERUBAHAN DARI V8:
//  1. request_id pada setiap transaksi (anti dobel-simpan saat sinyal
//     lambat / tombol ditekan ulang) -> cocok dengan backend v4.
//  2. Struk memakai data dari SERVER (harga, total, kembalian, waktu),
//     sehingga struk selalu sama persis dengan isi spreadsheet.
//  3. Aksi tulis (lunas, batal, reset display) pindah dari GET ke POST.
//  4. Dukungan API_KEY (opsional) untuk backend yang dikunci.
//  5. Timeout 45 detik + pesan jelas jika koneksi putus.
//  6. Otomatis cek versi backend saat aplikasi dibuka.
//  7. Jika stok di server berbeda (gagal simpan), stok otomatis dimuat ulang.
//  8. lunaskanTransaksi(id, {metode, uang_diterima}) untuk transaksi Pending.
//  9. Perbaikan escape id produk pada onclick.
// ============================================================

const API =
  "https://script.google.com/macros/s/AKfycbxrxPgBaUh0Xr_iP1G7MLKPHwPLqUMhLAosmz62y2A3P1eCQ7FGU6nDCNH_JjxpIkdw/exec";

// Isi sama persis dengan CONFIG.API_KEY di Apps Script.
// Kosongkan ("") jika API_KEY di backend juga kosong.
const API_KEY = "";

const REQUEST_TIMEOUT_MS = 45000;

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
let lastTransaksi = null;
let percobaanBayar = null; // { signature, requestId } -> dipakai ulang saat retry

// ============================================================
// DOM READY
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  setupSearch();
  setupCashInput();
  setupNetworkStatus();
  setupProductEvents();
  setupKeyboard();

  renderCart();
  updateClock();
  setInterval(updateClock, 1000);

  ambilProduk();
  cekVersiBackend();
});

// ============================================================
// HTTP DASAR (timeout + parsing JSON)
// ============================================================
async function fetchJSON(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    let result;
    try {
      result = await response.json();
    } catch (e) {
      throw new Error(
        "Respons server tidak valid. Pastikan Apps Script sudah di-deploy ulang (New version).",
      );
    }

    if (result && result.status === "error") {
      throw new Error(result.message || "API mengembalikan error");
    }
    return result;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        "Koneksi ke server terlalu lama. Periksa internet lalu coba lagi.",
      );
    }
    if (error instanceof TypeError) {
      throw new Error(
        "Tidak dapat terhubung ke server. Periksa internet Anda.",
      );
    }
    throw error;
  }
}

// ============================================================
// API GET (hanya untuk membaca data)
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

  return fetchJSON(`${API}?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
}

// ============================================================
// API POST (semua aksi tulis)
// ============================================================
async function apiPost(payload = {}) {
  const body = API_KEY ? { ...payload, api_key: API_KEY } : payload;

  return fetchJSON(API, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
}

// ============================================================
// CEK VERSI BACKEND
// ============================================================
async function cekVersiBackend() {
  try {
    const result = await apiGet({ action: "health" });
    const pesan = String((result && result.message) || "");

    if (!/v4/i.test(pesan)) {
      toast(
        "Backend masih versi lama. Tempel kode v4 lalu Deploy > New version.",
        "error",
      );
    }
  } catch (error) {
    console.warn("Cek versi backend gagal:", error.message);
  }
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
    renderProdukError(error.message);

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
// PANEL ERROR + DIAGNOSA KONEKSI
// ============================================================
function renderProdukError(pesan) {
  const container = document.getElementById("produk");
  if (!container) return;

  container.removeAttribute("aria-busy");
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon"><svg class="i"><use href="#i-alert"/></svg></div>
      <h3>Tidak dapat terhubung ke server</h3>
      <p>${escapeHTML(pesan || "Gagal memuat produk")}</p>
      <p id="diagnosaHasil" style="margin-top:10px;font-size:13px;line-height:1.6">
        Memeriksa penyebab…
      </p>
      <button type="button" class="btn btn-ghost" style="margin:16px auto 0"
        onclick="ambilProduk()"><svg class="i"><use href="#i-refresh"/></svg>Coba Lagi</button>
    </div>
  `;

  diagnosaKoneksi().then((hasil) => {
    const el = document.getElementById("diagnosaHasil");
    if (el) el.innerHTML = hasil;
  });
}

// Membedakan: internet mati / server tak terjangkau / diblokir (CORS, login)
// / kode lama / spreadsheet tidak terhubung.
async function diagnosaKoneksi() {
  if (!navigator.onLine) {
    return "<b>Perangkat sedang offline.</b> Periksa WiFi/data internet.";
  }

  const url = `${API}?action=health&_=${Date.now()}`;

  // 1. Apakah server Google bisa dijangkau sama sekali?
  try {
    await fetch(url, { mode: "no-cors", cache: "no-store" });
  } catch (e) {
    return (
      "<b>Server Google tidak terjangkau.</b> Penyebab umum: internet bermasalah, " +
      "AdBlock/antivirus/VPN memblokir <code>script.google.com</code>, atau URL API salah."
    );
  }

  // 2. Bisa dijangkau, tetapi apakah balasannya boleh dibaca?
  let teks = "";
  try {
    const r = await fetch(url, { cache: "no-store" });
    teks = await r.text();
  } catch (e) {
    return (
      "<b>Server terjangkau, tetapi balasannya diblokir.</b> Hampir pasti pengaturan deploy salah: " +
      "buka Apps Script &gt; Deploy &gt; Manage deployments &gt; Edit, pastikan " +
      "<b>Execute as: Me</b> dan <b>Who has access: Anyone</b> (bukan &quot;Anyone with Google account&quot;), " +
      "lalu Version: <b>New version</b> &gt; Deploy."
    );
  }

  let json;
  try {
    json = JSON.parse(teks);
  } catch (e) {
    if (/accounts\.google|Sign in|Masuk/i.test(teks)) {
      return "<b>Server meminta login Google.</b> Ubah Who has access menjadi <b>Anyone</b> lalu deploy New version.";
    }
    if (/doGet/i.test(teks)) {
      return "<b>Fungsi doGet tidak ditemukan.</b> Kode backend belum tersimpan/ter-deploy. Tempel kode v4, Simpan, lalu Deploy New version.";
    }
    return "<b>Server membalas bukan JSON.</b> Pastikan URL berakhiran <code>/exec</code> dan kode backend v4 sudah di-deploy.";
  }

  if (json.status === "error") {
    return `<b>Backend aktif tetapi error:</b> ${escapeHTML(json.message || "")}`;
  }

  if (!/v4/i.test(String(json.message || ""))) {
    return "<b>Backend masih versi lama.</b> Deploy &gt; Manage deployments &gt; Edit &gt; Version: New version.";
  }

  return (
    "Server OK (v4). Kegagalan kemungkinan di baca sheet: pastikan script dibuat dari " +
    "<b>Extensions &gt; Apps Script</b> di dalam spreadsheet, nama sheet <b>Produk</b> benar, " +
    "dan jalankan <code>setupAwal()</code> sekali (beri izin akses)."
  );
}

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
          data-kategori="${escapeHTML(item)}"
          onclick="pilihKategori(this.dataset.kategori)"
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

  const info = document.getElementById("produkInfo");
  if (info) info.textContent = `${data.length} dari ${produk.length} produk`;

  if (!data.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><svg class="i"><use href="#i-coffee"/></svg></div>
        <h3>Produk tidak ditemukan</h3>
        <p>Coba gunakan kata kunci atau kategori lain.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = data.map(renderProductCard).join("");
}

function qtyDiKeranjang(id) {
  const it = keranjang.find((c) => String(c.id_produk) === String(id));
  return it ? Number(it.qty) || 0 : 0;
}

function renderProductCard(item) {
  const stok = Number(item.stok) || 0;
  const stokMinimum = Number(item.stokMinimum) || 0;

  const habis = stok <= 0;
  const stokRendah = !habis && stok <= stokMinimum;

  let stockText = `Stok ${stok}`;
  let stockClass = "";
  if (habis) {
    stockText = "Stok habis";
    stockClass = "empty";
  } else if (stokRendah) {
    stockText = `Stok ${stok} • Menipis`;
    stockClass = "low";
  }

  const qty = qtyDiKeranjang(item.id);

  return `
    <div
      class="product-card ${habis ? "out-of-stock" : ""} ${qty ? "in-cart" : ""}"
      data-id="${escapeHTML(item.id)}"
      tabindex="${habis ? "-1" : "0"}"
      role="button"
      aria-disabled="${habis}"
      aria-label="${escapeHTML(item.nama)}, ${formatRupiah(item.harga)}"
    >
      ${qty ? `<span class="product-qty">${qty}</span>` : ""}
      <div class="product-info">
        <div class="product-category">${escapeHTML(item.kategori)}</div>
        <h3 class="product-name">${escapeHTML(item.nama)}</h3>
      </div>
      <div class="product-foot">
        <div>
          <div class="product-price">${formatRupiah(item.harga)}</div>
          <div class="stock-label ${stockClass}">${escapeHTML(stockText)}</div>
        </div>
        ${habis ? "" : `<span class="product-add" aria-hidden="true"><svg class="i"><use href="#i-plus"/></svg></span>`}
      </div>
    </div>
  `;
}

// Perbarui badge jumlah di kartu produk tanpa merender ulang seluruh grid
function perbaruiBadgeProduk() {
  const container = document.getElementById("produk");
  if (!container) return;
  container.querySelectorAll(".product-card[data-id]").forEach((card) => {
    const qty = qtyDiKeranjang(card.dataset.id);
    let badge = card.querySelector(".product-qty");
    card.classList.toggle("in-cart", qty > 0);
    if (qty > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "product-qty";
        card.prepend(badge);
      }
      if (badge.textContent !== String(qty)) {
        badge.textContent = qty;
        badge.style.animation = "none";
        void badge.offsetWidth;
        badge.style.animation = "";
      }
    } else if (badge) {
      badge.remove();
    }
  });
}

// Delegasi klik/keyboard pada grid produk
function setupProductEvents() {
  const container = document.getElementById("produk");
  if (!container) return;

  container.addEventListener("click", (e) => {
    const card = e.target.closest(".product-card");
    if (!card || card.classList.contains("out-of-stock")) return;
    card.classList.remove("bump");
    void card.offsetWidth;
    card.classList.add("bump");
    tambahProduk(card.dataset.id);
  });

  container.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".product-card");
    if (!card || card.classList.contains("out-of-stock")) return;
    e.preventDefault();
    tambahProduk(card.dataset.id);
  });
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

  if (window.FynSound) FynSound.play("add");
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
    perbaruiBadgeProduk();
    pushToCustomerDisplay();
    return;
  }

  if (empty) empty.style.display = "none";

  container.innerHTML = keranjang.map(renderCartItem).join("");

  updateCartSummary();
  perbaruiBadgeProduk();
  pushToCustomerDisplay();
}

function renderCartItem(item) {
  const subtotal = Number(item.harga_jual) * Number(item.qty);
  const idAman = escapeHTML(escapeAttr(item.id_produk));

  return `
    <div class="cart-item">
      <div class="cart-item-top">
        <div>
          <div class="cart-item-name">${escapeHTML(item.nama_produk)}</div>
          <div class="cart-item-price">${formatRupiah(item.harga_jual)} / pcs</div>
        </div>

        <button
          type="button"
          class="cart-item-remove"
          onclick="hapusItem('${idAman}')"
          aria-label="Hapus ${escapeHTML(item.nama_produk)}"
        ><svg class="i"><use href="#i-x"/></svg></button>
      </div>

      <div class="cart-item-bottom">
        <div class="qty-control">
          <button type="button" class="qty-btn" onclick="ubahQty('${idAman}', -1)" aria-label="Kurangi"><svg class="i"><use href="#i-minus"/></svg></button>
          <span class="qty-value">${Number(item.qty)}</span>
          <button type="button" class="qty-btn" onclick="ubahQty('${idAman}', 1)" aria-label="Tambah"><svg class="i"><use href="#i-plus"/></svg></button>
        </div>

        <div class="cart-item-subtotal">${formatRupiah(subtotal)}</div>
      </div>
    </div>
  `;
}

function hapusItem(id) {
  keranjang = keranjang.filter((item) => String(item.id_produk) !== String(id));
  renderCart();
}

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
    badge.style.display = totalItem > 0 ? "grid" : "none";
  }

  if (mobileBadge) mobileBadge.textContent = totalItem;

  const mobileTotal = document.getElementById("mobileCartTotal");
  if (mobileTotal) mobileTotal.textContent = formatRupiah(total);
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
    if (clear) clear.style.display = searchQuery ? "grid" : "none";
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
// QRIS MODAL
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
    if (input.parentElement) input.parentElement.classList.remove("invalid");
  }

  if (kembalian) kembalian.textContent = formatRupiah(0);
  if (changeBox) changeBox.classList.remove("negative");

  if (error) {
    error.textContent = "";
    error.classList.remove("visible");
  }

  renderQuickCash(total);

  if (modal) {
    modal.classList.add("active");
    setTimeout(() => {
      if (input) input.focus();
    }, 100);
  }
}

// Saran nominal pintar: pecahan uang yang paling mungkin dibayarkan pelanggan
function saranNominalCash(total) {
  const hasil = new Set();
  [1000, 5000, 10000, 20000, 50000, 100000].forEach((p) => {
    const bulat = Math.ceil(total / p) * p;
    if (bulat > total) hasil.add(bulat);
  });
  [20000, 50000, 100000, 200000].forEach((n) => {
    if (n > total) hasil.add(n);
  });
  return [...hasil].sort((a, b) => a - b).slice(0, 5);
}

function renderQuickCash(total) {
  const box = document.getElementById("quickCash");
  if (!box) return;

  const saran = saranNominalCash(total);
  box.innerHTML =
    `<button type="button" class="quick-btn pas" data-cash="pas">Uang Pas · ${angkaID(total)}</button>` +
    saran
      .map((n) => `<button type="button" class="quick-btn" data-cash="${n}">${angkaID(n)}</button>`)
      .join("");

  box.onclick = (e) => {
    const b = e.target.closest(".quick-btn");
    if (b) quickCash(b.dataset.cash === "pas" ? "pas" : Number(b.dataset.cash));
  };
}

function tutupCashModal() {
  const modal = document.getElementById("cashModal");
  if (modal) modal.classList.remove("active");
}

// ============================================================
// CASH INPUT
// ============================================================
function setupCashInput() {
  const input = document.getElementById("uangDiterima");
  if (!input) return;

  input.addEventListener("input", () => {
    // format ribuan otomatis: 50000 -> 50.000
    const angka = parseMoneyInput(input.value);
    input.value = angka ? angkaID(angka) : "";
    hitungKembalian();
  });

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

  if (changeBox) changeBox.classList.toggle("negative", uang > 0 && kembali < 0);

  const kurang = uang > 0 && uang < total;
  if (input.parentElement) input.parentElement.classList.toggle("invalid", kurang);

  if (error) {
    error.textContent = kurang ? `Uang kurang ${formatRupiah(total - uang)}` : "";
    error.classList.toggle("visible", kurang);
  }
}

function setUangCash(value) {
  const input = document.getElementById("uangDiterima");
  if (!input) return;
  const angka = Number(value) || 0;
  input.value = angka ? angkaID(angka) : "";
  hitungKembalian();
}

function quickCash(value) {
  if (value === "pas") {
    setUangCash(hitungTotal());
    return;
  }
  setUangCash(Number(value) || 0);
}

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
// META PESANAN (tipe, nama pelanggan, catatan)
// ============================================================
const LABEL_TIPE_PESANAN = {
  "dine-in": "Dine In",
  "take-away": "Take Away",
  delivery: "Delivery",
};

function ambilMetaPesanan() {
  const aktif = document.querySelector(
    "#orderTypeGroup .order-type-btn.active",
  );
  const tipeKey = aktif ? aktif.dataset.orderType : "dine-in";
  const tipe = LABEL_TIPE_PESANAN[tipeKey] || "Dine In";

  const nameInput = document.getElementById("customerNameInput");
  const noteInput = document.getElementById("orderNoteInput");
  const pelanggan = nameInput ? nameInput.value.trim() : "";
  const catatanUser = noteInput ? noteInput.value.trim() : "";

  const bagian = [tipe];
  if (pelanggan) bagian.push(`Pelanggan: ${pelanggan}`);
  if (catatanUser) bagian.push(`Catatan: ${catatanUser}`);

  return { tipe, pelanggan, catatanUser, catatan: bagian.join(" | ") };
}

// ============================================================
// REQUEST ID (anti dobel-simpan)
// ============================================================
function buatRequestId() {
  const acak =
    window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return "POS-" + acak;
}

// Jika pembayaran yang SAMA diulang setelah gagal/timeout, request_id
// yang sama dipakai lagi. Backend v4 akan mengenali dan tidak menyimpan
// transaksi dua kali.
function ambilRequestId(signature) {
  if (percobaanBayar && percobaanBayar.signature === signature) {
    return percobaanBayar.requestId;
  }
  percobaanBayar = { signature, requestId: buatRequestId() };
  return percobaanBayar.requestId;
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

  if (!navigator.onLine) {
    toast("Anda sedang offline. Transaksi tidak dapat disimpan.", "error");
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

  const totalLokal = hitungTotal();

  if (metodeFinal === "CASH" && Number(uangDiterima) < totalLokal) {
    toast("Uang diterima kurang dari total", "error");
    return;
  }

  // Snapshot item sebelum keranjang dikosongkan
  const snapshotItems = keranjang.map((item) => ({
    id_produk: item.id_produk,
    nama_produk: item.nama_produk,
    harga_modal: Number(item.harga_modal) || 0,
    harga_jual: Number(item.harga_jual) || 0,
    qty: Number(item.qty) || 0,
    subtotal: (Number(item.harga_jual) || 0) * (Number(item.qty) || 0),
  }));

  const uangLokal =
    metodeFinal === "CASH" ? Number(uangDiterima) || 0 : totalLokal;
  const meta = ambilMetaPesanan();

  const signature = JSON.stringify({
    m: metodeFinal,
    u: uangLokal,
    i: snapshotItems.map((i) => [i.id_produk, i.qty]),
  });

  const payload = {
    action: "simpan",
    request_id: ambilRequestId(signature),
    kasir: namaKasir,
    metode_pembayaran: metodeFinal,
    status: "Lunas",
    uang_diterima: metodeFinal === "CASH" ? uangLokal : 0,
    catatan: meta.catatan,
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

    // Transaksi tersimpan -> request_id tidak dipakai lagi
    percobaanBayar = null;

    idTransaksiAktif = result.invoice || result.id || generateInvoice();

    // Data struk memakai angka dari SERVER (sumber kebenaran = spreadsheet)
    const itemsServer =
      Array.isArray(result.items) && result.items.length
        ? result.items.map((i) => ({
            id_produk: i.id_produk,
            nama_produk: i.nama_produk,
            harga_modal: Number(i.harga_modal) || 0,
            harga_jual: Number(i.harga_jual) || 0,
            qty: Number(i.qty) || 0,
            subtotal: Number(i.subtotal) || 0,
          }))
        : snapshotItems;

    const totalServer = Number(result.total ?? totalLokal);
    const uangServer = Number(result.uang_diterima ?? uangLokal);
    const kembaliServer = Number(
      result.kembalian ??
        (metodeFinal === "CASH" ? Math.max(0, uangServer - totalServer) : 0),
    );

    const waktuObj = parseWaktuServer(result.waktu) || new Date();

    const transaksiStruk = {
      id: idTransaksiAktif,
      invoice: idTransaksiAktif,
      tanggal: result.waktu
        ? formatWaktuServer(result.waktu)
        : formatTanggalLengkap(),
      tanggal_iso: waktuObj.toISOString(),
      kasir: result.kasir || namaKasir,
      items: itemsServer,
      total_item:
        Number(result.total_item) || itemsServer.reduce((s, i) => s + i.qty, 0),
      subtotal: totalServer,
      diskon: Number(result.diskon) || 0,
      pajak: Number(result.pajak) || 0,
      total: totalServer,
      metode: metodeFinal,
      metode_pembayaran: metodeFinal,
      bayar: uangServer,
      uang_diterima: uangServer,
      kembali: kembaliServer,
      kembalian: kembaliServer,
      status: result.status_transaksi || "Lunas",
      tipe_pesanan: meta.tipe,
      pelanggan: meta.pelanggan,
      catatan: meta.catatanUser,
    };

    lastTransaksi = transaksiStruk;
    try {
      localStorage.setItem("transaksi", JSON.stringify(transaksiStruk));
    } catch (e) {
      /* ignore */
    }

    // Simpan ke riwayat (lokal) agar bisa dibuka/dicetak ulang kapan saja
    if (typeof riwayatSimpan === "function") riwayatSimpan(transaksiStruk);

    if (window.FynSound) FynSound.play("success");
    tampilReceipt(transaksiStruk);

    keranjang = [];
    renderCart();
    tutupCashModal();

    // Muat ulang stok dari spreadsheet
    await ambilProduk();

    toast(
      result.duplikat
        ? "Transaksi sudah tersimpan sebelumnya (tidak dobel)"
        : result.message || "Transaksi berhasil disimpan",
      "success",
    );
  } catch (error) {
    console.error("TRANSAKSI ERROR:", error);
    toast(error.message || "Gagal menyimpan transaksi", "error");

    // Jika penyebabnya stok/harga berubah di spreadsheet, segarkan data
    if (/stok|produk|tidak aktif/i.test(String(error.message))) {
      percobaanBayar = null;
      ambilProduk();
    }
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
          <div class="r-item-name">${escapeHTML(item.nama_produk || item.nama || "-")}</div>
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
  const batal = /batal|cancel|void/i.test(String(status));

  return `
    <div class="r-paper">
      <img class="r-logo" src="Logo struk.png" alt="" onerror="this.style.display='none'" />
      <div class="r-center r-store">${escapeHTML(NAMA_TOKO)}</div>
      <div class="r-center r-small">${escapeHTML(ALAMAT_TOKO)}</div>
      <div class="r-center r-small">${escapeHTML(TELP_TOKO)}</div>

      <div class="r-line"></div>

      <div class="r-row r-small"><span>Invoice</span><span>${escapeHTML(invoice)}</span></div>
      <div class="r-row r-small"><span>Waktu</span><span>${escapeHTML(tanggal)}</span></div>
      <div class="r-row r-small"><span>Kasir</span><span>${escapeHTML(kasir)}</span></div>
      ${
        data.tipe_pesanan
          ? `<div class="r-row r-small"><span>Tipe</span><span>${escapeHTML(data.tipe_pesanan)}</span></div>`
          : ""
      }
      ${
        data.pelanggan
          ? `<div class="r-row r-small"><span>Pelanggan</span><span>${escapeHTML(data.pelanggan)}</span></div>`
          : ""
      }

      <div class="r-line"></div>

      ${itemHTML || '<div class="r-center r-small">-</div>'}

      <div class="r-line"></div>

      <div class="r-row"><span>Total Item</span><span>${totalItem}</span></div>
      <div class="r-row r-bold"><span>TOTAL</span><span>${formatRupiah(total)}</span></div>

      ${
        metode === "CASH"
          ? `
            <div class="r-row"><span>Tunai</span><span>${formatRupiah(bayar)}</span></div>
            <div class="r-row"><span>Kembali</span><span>${formatRupiah(kembali)}</span></div>
          `
          : `<div class="r-row"><span>Metode</span><span>${escapeHTML(metode || "-")}</span></div>`
      }

      <div class="r-row"><span>Status</span><span><span class="r-badge ${batal ? "r-batal" : ""}">${escapeHTML(String(status).toUpperCase())}</span></span></div>

      ${
        data.catatan
          ? `<div class="r-line"></div><div class="r-small">Catatan: ${escapeHTML(data.catatan)}</div>`
          : ""
      }

      <div class="r-line"></div>

      <div class="r-center r-small">${escapeHTML(FOOTER_STRUK)}</div>
      <div class="r-center r-small">${escapeHTML(CATATAN_STRUK)}</div>
      <div class="r-center r-small" style="margin-top:6px">*** ${escapeHTML(invoice)} ***</div>
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

// Cetak struk apa pun (transaksi terakhir atau dari riwayat)
function cetakStruk(data) {
  if (!data) {
    toast("Belum ada transaksi untuk dicetak", "error");
    return;
  }

  const container = document.getElementById("receiptContainer");
  if (!container) return;

  container.innerHTML = buatHTMLStruk(data);

  const bersihkan = () => {
    container.innerHTML = "";
    window.removeEventListener("afterprint", bersihkan);
  };
  window.addEventListener("afterprint", bersihkan);

  // beri waktu logo dimuat sebelum dialog cetak terbuka
  const gambar = [...container.querySelectorAll("img")];
  Promise.all(
    gambar.map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))),
  ).then(() => setTimeout(() => window.print(), 120));
}

function cetakStrukTerakhir() {
  cetakStruk(lastTransaksi);
}

function namaFilePDF(data) {
  const inv = (data && (data.invoice || data.id)) || "STRUK";
  return "FYNCOFFEE-" + namaFileAman(inv) + ".pdf";
}

function downloadStrukPDF() {
  if (!lastTransaksi) {
    toast("Preview struk belum tersedia.", "error");
    return;
  }
  unduhStrukPDF(
    buatHTMLStruk(lastTransaksi),
    namaFilePDF(lastTransaksi),
    document.getElementById("btnDownloadPdf"),
  );
}

// ============================================================
// BUKA STRUK.HTML (halaman terpisah)
// ============================================================
// Tanpa argumen = struk transaksi terakhir. Dengan invoice = struk dari riwayat.
function bukaStruk(invoice) {
  let url = "struk.html";

  if (invoice) {
    url += "?inv=" + encodeURIComponent(invoice);
  } else if (!localStorage.getItem("transaksi")) {
    toast("Data transaksi tidak ditemukan", "error");
    return;
  }

  const win = window.open(url, "_blank");
  if (!win) toast("Popup diblokir browser. Izinkan popup untuk FYNCOFFEE.", "error");
}

function printReceipt() {
  bukaStruk();
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
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Inter, system-ui, -apple-system, sans-serif;
    background: radial-gradient(ellipse at 10% 0%, rgba(214,178,106,.12), transparent 55%), #0a0807; color: #f6eddf; min-height: 100vh;
    display: flex; flex-direction: column;
  }
  header {
    height: 90px; flex: 0 0 90px;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 40px; background: #110e0b; border-bottom: 1px solid rgba(214,178,106,.28);
  }
  header .brand { font-family: 'Playfair Display', Georgia, serif; font-size: 30px; font-weight: 700; letter-spacing: 6px; color: #d6b26a; }
  header .clock { font-size: 22px; font-weight: 800; color: #f1dfae;
    font-variant-numeric: tabular-nums; }
  main { flex: 1; overflow-y: auto; padding: 30px 40px; }
  .row {
    display: grid; grid-template-columns: 1fr auto auto;
    gap: 24px; align-items: center;
    padding: 16px 0; border-bottom: 1px solid rgba(214,178,106,.14);
    font-size: 22px;
  }
  .row .name { font-family: 'Playfair Display', Georgia, serif; font-weight: 600; }
  .row .qty { color: #c4b8a5; font-weight: 700; font-variant-numeric: tabular-nums; }
  .row .sub { color: #f1dfae; font-weight: 800; font-variant-numeric: tabular-nums;
    text-align: right; min-width: 180px; }
  .empty {
    height: 100%; display: flex; align-items: center; justify-content: center;
    flex-direction: column; gap: 14px; color: #8a7e6e;
    font-size: 26px; font-weight: 800; text-align: center;
  }
  .empty .icon { font-size: 70px; }
  footer {
    flex: 0 0 auto; background: #110e0b; border-top: 1px solid rgba(214,178,106,.28);
    padding: 26px 40px 32px;
  }
  .count {
    display: flex; justify-content: space-between;
    font-size: 18px; color: #c4b8a5; font-weight: 700; margin-bottom: 14px;
  }
  .total {
    display: flex; justify-content: space-between; align-items: baseline;
    gap: 24px;
  }
  .total span {
    font-family: 'Playfair Display', Georgia, serif; font-size: 22px; font-weight: 700; color: #d6b26a; letter-spacing: 5px;
  }
  .total strong {
    font-family: 'Playfair Display', Georgia, serif; font-size: 58px; font-weight: 700; color: #f1dfae;
    font-variant-numeric: tabular-nums;
  }
</style>
</head>
<body>
  <header>
    <div class="brand">FYNCOFFEE</div>
    <div class="clock" id="clock">--:--:--</div>
  </header>

  <main>
    ${
      empty
        ? `
          <div class="empty">
            <div class="icon">🛒</div>
            <div>Selamat datang di FYNCOFFEE</div>
            <div style="font-size:16px;color:#8a7e6e">Silakan lakukan pemesanan di kasir</div>
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
            '<div style="font-size:16px;color:#8a7e6e">' +
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
// DISPLAY VIA API (sheet Display)
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
    const result = await apiPost({ action: "resetDisplay" });

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

// Endpoint baru backend v4
async function ambilLaporanHarian(tanggal = "") {
  try {
    const result = await apiGet({ action: "laporanHarian", tanggal });
    return result.data || {};
  } catch (error) {
    toast(error.message || "Gagal mengambil laporan harian", "error");
    return {};
  }
}

async function ambilLaporanBulanan(bulan = "") {
  try {
    const result = await apiGet({ action: "laporanBulanan", bulan });
    return result.data || {};
  } catch (error) {
    toast(error.message || "Gagal mengambil laporan bulanan", "error");
    return {};
  }
}

async function ambilTopProduk(periode = "", limit = 5) {
  try {
    const result = await apiGet({ action: "topProduk", periode, limit });
    return Array.isArray(result.data) ? result.data : [];
  } catch (error) {
    toast(error.message || "Gagal mengambil top produk", "error");
    return [];
  }
}

async function ambilStokMenipis() {
  try {
    const result = await apiGet({ action: "stokMenipis" });
    return Array.isArray(result.data) ? result.data : [];
  } catch (error) {
    toast(error.message || "Gagal mengambil stok menipis", "error");
    return [];
  }
}

// opts (opsional): { metode: "CASH", uang_diterima: 50000 }
async function lunaskanTransaksi(id, opts = {}) {
  if (!id) {
    toast("ID transaksi tidak ditemukan", "error");
    return null;
  }

  try {
    const result = await apiPost({
      action: "lunas",
      id,
      metode_pembayaran: opts.metode || opts.metode_pembayaran,
      uang_diterima: opts.uang_diterima,
    });

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

  if (!window.confirm("Batalkan transaksi ini? Stok akan dikembalikan."))
    return null;

  try {
    const result = await apiPost({ action: "batal", id });

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
    if (!window.confirm("Kosongkan semua item di keranjang?")) return;
  }

  keranjang = [];
  idTransaksiAktif = "";
  percobaanBayar = null;

  renderCart();
  tutupCashModal();
}

// ============================================================
// PRODUK (SERVER)
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

  if (!Number.isInteger(jumlah) || jumlah <= 0) {
    toast("Jumlah stok harus berupa angka bulat lebih dari 0", "error");
    return null;
  }

  try {
    const result = await apiPost({ action, id_produk: id, qty: jumlah });

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
// FORMAT
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

function angkaID(value) {
  return new Intl.NumberFormat("id-ID").format(Math.round(Number(value) || 0));
}

function formatTanggalLengkap() {
  return new Date().toLocaleString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// "2026-11-20 14:05:09" (dari server) -> "20/11/2026 14:05:09"
function formatWaktuServer(text) {
  const m = String(text || "").match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}:\d{2})/,
  );
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : String(text || "");
}

// "2026-11-20 14:05:09" / ISO -> Date (waktu lokal). null jika tidak valid.
function parseWaktuServer(text) {
  if (!text) return null;
  const t = String(text);
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?!.*[Zz+])/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

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
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === "") return 0;

  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function parseMoneyInput(value) {
  if (typeof value === "number") return value || 0;
  const cleaned = String(value || "").replace(/[^\d]/g, "");
  return Number(cleaned) || 0;
}

// ============================================================
// ESCAPE
// ============================================================
function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// untuk string di dalam onclick='...' (dipakai bersama escapeHTML)
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

  if (type === "error" && window.FynSound) FynSound.play("error");

  const item = document.createElement("div");
  item.className = `toast toast-${type} ${type}`;
  item.textContent = message;

  container.appendChild(item);

  setTimeout(() => {
    item.classList.add("hide");
    setTimeout(() => item.remove(), 300);
  }, 3500);
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
// KEYBOARD SHORTCUT
// ============================================================
function setupKeyboard() {
  document.addEventListener("keydown", (event) => {
    const modalAktif = document.querySelector(".modal.active, .drawer.active");

    if (event.key === "Escape") {
      tutupCashModal();
      tutupQrisModal();
      tutupStruk();
      return;
    }

    // F1-F3 hanya berlaku di halaman Kasir dan saat tidak ada dialog terbuka
    if (document.body.dataset.view === "riwayat") return;

    if (event.key === "F1") {
      event.preventDefault();
      const search = document.getElementById("searchProduk");
      if (search) {
        search.focus();
        search.select();
      }
    }

    if (event.key === "F2" && !modalAktif) {
      event.preventDefault();
      bukaCashModal();
    }

    if (event.key === "F3" && !modalAktif) {
      event.preventDefault();
      bayarQRIS();
    }
  });
}

// ============================================================
// GLOBAL EXPORTS
// ============================================================
window.ambilProduk = ambilProduk;
window.diagnosaKoneksi = diagnosaKoneksi;
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
window.cetakStruk = cetakStruk;
window.downloadStrukPDF = downloadStrukPDF;
window.printReceipt = printReceipt;
window.bukaStruk = bukaStruk;
window.buatHTMLStruk = buatHTMLStruk;
window.namaFilePDF = namaFilePDF;
window.parseWaktuServer = parseWaktuServer;
window.toast = toast;

window.bukaCustomerDisplay = bukaCustomerDisplay;
window.ambilDisplay = ambilDisplay;
window.resetDisplay = resetDisplay;

window.ambilTransaksi = ambilTransaksi;
window.ambilDetailTransaksi = ambilDetailTransaksi;
window.ambilDashboard = ambilDashboard;
window.ambilLaporanHarian = ambilLaporanHarian;
window.ambilLaporanBulanan = ambilLaporanBulanan;
window.ambilTopProduk = ambilTopProduk;
window.ambilStokMenipis = ambilStokMenipis;
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
  "%c FYNCOFFEE POS V10 ",
  "background:#111827;color:#d6b26a;padding:8px 12px;border-radius:6px;font-weight:bold;",
);
console.log("Backend:", API);
console.log("Kasir:", namaKasir);

// =================================
// STRUK POS SYSTEM
// =================================

// AMBIL TRANSAKSI

const transaksiData = localStorage.getItem("transaksi");

if (!transaksiData) {
  document.body.innerHTML = `

<div style="
text-align:center;
font-family:Arial;
padding:50px;
">

<h2>
Transaksi Tidak Ditemukan
</h2>

<p>
Silahkan kembali ke halaman kasir
</p>


</div>

`;

  throw new Error("Data transaksi kosong");
}

let transaksi = JSON.parse(transaksiData);

// =================================
// HEADER STRUK
// =================================

const invoice = transaksi.id || generateInvoice();

setText("id", invoice);

setText("tanggal", transaksi.tanggal || formatTanggal());

setText("kasir", transaksi.kasir || "Admin");

// =================================
// DETAIL PRODUK
// =================================

const detail = document.getElementById("detail");

detail.innerHTML = "";

let subtotal = 0;

if (Array.isArray(transaksi.items) && transaksi.items.length > 0) {
  transaksi.items.forEach((item) => {
    const nama = potongNama(item.nama_produk);

    const qty = Number(item.qty || 0);

    const harga = Number(item.harga_jual || 0);

    const jumlah = qty * harga;

    subtotal += jumlah;

    detail.innerHTML += `


<tr>


<td class="item">

${nama}

</td>



<td class="qty">

${qty}

</td>



<td class="price">

${formatRupiah(jumlah)}

</td>


</tr>


`;
  });
}

// =================================
// HITUNG TOTAL
// =================================

const diskon = Number(transaksi.diskon || 0);

const pajak = Number(transaksi.pajak || 0);

let total = subtotal - diskon + pajak;

if (transaksi.total !== undefined && transaksi.total !== null) {
  total = Number(transaksi.total);
}

setText("subtotal", formatRupiah(subtotal));

setText("diskon", formatRupiah(diskon));

setText("pajak", formatRupiah(pajak));

setText("total", formatRupiah(total));

// =================================
// PEMBAYARAN
// =================================

const bayar = Number(transaksi.bayar || total);

const kembali = Number(transaksi.kembali ?? bayar - total);

setText("bayar", formatRupiah(bayar));

setText("kembali", formatRupiah(kembali));

// =================================
// SIMPAN DATA TERBARU
// =================================

transaksi.id = invoice;

transaksi.total = total;

transaksi.tanggal = transaksi.tanggal || formatTanggal();

localStorage.setItem(
  "transaksi",

  JSON.stringify(transaksi),
);

// =================================
// HELPER TEXT
// =================================

function setText(id, value) {
  const el = document.getElementById(id);

  if (el) {
    el.textContent = value;
  }
}

// =================================
// FORMAT RUPIAH
// =================================

function formatRupiah(angka) {
  return Number(angka || 0).toLocaleString("id-ID");
}

// =================================
// FORMAT TANGGAL
// =================================

function formatTanggal() {
  const now = new Date();

  return now.toLocaleString("id-ID", {
    day: "2-digit",

    month: "2-digit",

    year: "numeric",

    hour: "2-digit",

    minute: "2-digit",
  });
}

// =================================
// POTONG NAMA PRODUK THERMAL
// =================================

function potongNama(nama) {
  if (!nama) {
    return "-";
  }

  nama = String(nama);

  const max = 16;

  if (nama.length > max) {
    return nama.substring(0, max) + "...";
  }

  return nama;
}

// =================================
// GENERATE INVOICE
// =================================

function generateInvoice() {
  const now = new Date();

  const tahun = now.getFullYear();

  const bulan = String(now.getMonth() + 1).padStart(2, "0");

  const tanggal = String(now.getDate()).padStart(2, "0");

  const random = String(Date.now()).slice(-5);

  return "INV-" + tahun + bulan + tanggal + "-" + random;
}

// =================================
// AUTO PRINT OPTIONAL
// =================================

/*

window.onload=function(){


setTimeout(()=>{


window.print();


},800);



}


*/

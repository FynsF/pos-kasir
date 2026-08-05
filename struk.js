// =================================
// AMBIL DATA TRANSAKSI
// =================================

let transaksi = JSON.parse(localStorage.getItem("transaksi"));

if (!transaksi) {
  alert("Tidak ada transaksi");

  throw new Error("Data transaksi kosong");
}

// =================================
// DATA HEADER
// =================================

document.getElementById("id").innerHTML = transaksi.id || generateInvoice();

document.getElementById("tanggal").innerHTML =
  transaksi.tanggal || new Date().toLocaleString("id-ID");

// kasir

let kasir = document.getElementById("kasir");

if (kasir) {
  kasir.innerHTML = transaksi.kasir || "Admin";
}

// =================================
// DETAIL PRODUK
// =================================

let tabel = document.getElementById("detail");

tabel.innerHTML = "";

let subtotal = 0;

transaksi.items.forEach((item) => {
  let jumlah = Number(item.harga_jual) * Number(item.qty);

  subtotal += jumlah;

  tabel.innerHTML += `



<tr>


<td class="nama-produk">

${item.nama_produk}

</td>



<td class="qty">

${item.qty}

</td>



<td class="harga">


${formatRupiah(jumlah)}


</td>



</tr>



`;
});

// =================================
// HITUNG TOTAL
// =================================

let diskon = 0;

let pajak = 0;

let total = subtotal - diskon + pajak;

document.getElementById("subtotal").innerHTML = formatRupiah(subtotal);

document.getElementById("diskon").innerHTML = formatRupiah(diskon);

document.getElementById("pajak").innerHTML = formatRupiah(pajak);

document.getElementById("total").innerHTML = formatRupiah(
  transaksi.total || total,
);

// pembayaran

let bayar = document.getElementById("bayar");

let kembali = document.getElementById("kembali");

if (bayar) {
  bayar.innerHTML = formatRupiah(transaksi.bayar || transaksi.total);
}

if (kembali) {
  kembali.innerHTML = formatRupiah(transaksi.kembali || 0);
}

// =================================
// FORMAT RUPIAH
// =================================

function formatRupiah(angka) {
  return Number(angka || 0).toLocaleString("id-ID");
}

// =================================
// GENERATE INVOICE
// =================================

function generateInvoice() {
  let waktu = Date.now();

  return "INV-" + waktu;
}

// =================================
// AUTO PRINT OPTIONAL
// =================================

// aktifkan jika ingin langsung print

/*
window.onload=function(){

setTimeout(()=>{

window.print();

},500);


}
*/

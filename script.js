const API =
  "https://script.google.com/macros/s/AKfycbz-1nUJmKOjNYQEUKRwAEBt7h1D9xs3injteRNf0WjJhY6aWk0U2hpbmpYjXuKmHRih/exec";

let produk = [];

let keranjang = [];

let idTransaksiAktif = "";

// =================================
// LOAD PRODUK
// =================================

ambilProduk();

function ambilProduk() {
  fetch(API)
    .then((res) => res.json())

    .then((data) => {
      produk = data;

      tampilkanProduk();
    })

    .catch((error) => {
      console.log(error);

      document.getElementById("produk").innerHTML = "Gagal mengambil produk";
    });
}

// =================================
// TAMPIL PRODUK
// =================================

function tampilkanProduk() {
  let area = document.getElementById("produk");

  area.innerHTML = "";

  produk.forEach((p) => {
    area.innerHTML += `


<div class="card"
onclick="tambah('${p.id_produk}')">


<h3>
${p.nama_produk}
</h3>


<p>
Rp ${formatRupiah(p.harga_jual)}
</p>


<p>
Stok : ${p.stok}
</p>


</div>


`;
  });
}

// =================================
// TAMBAH PRODUK
// =================================

function tambah(id) {
  let p = produk.find((x) => x.id_produk == id);

  if (!p) return;

  let cek = keranjang.find((x) => x.id_produk == id);

  if (cek) {
    if (cek.qty < p.stok) {
      cek.qty++;
    } else {
      alert("Stok tidak cukup");
    }
  } else {
    keranjang.push({
      ...p,

      qty: 1,
    });
  }

  tampilkanKeranjang();
}

// =================================
// KERANJANG
// =================================

function tampilkanKeranjang() {
  let tabel = document.getElementById("keranjang");

  tabel.innerHTML = "";

  let total = 0;

  keranjang.forEach((p, index) => {
    let subtotal = Number(p.harga_jual) * p.qty;

    total += subtotal;

    tabel.innerHTML += `


<tr>


<td>
${p.nama_produk}
</td>



<td>
Rp ${formatRupiah(p.harga_jual)}
</td>



<td>


<button onclick="kurang(${index})">
-
</button>


${p.qty}


<button onclick="tambahQty(${index})">
+
</button>


</td>



<td>

Rp ${formatRupiah(subtotal)}

</td>


</tr>


`;
  });

  document.getElementById("total").innerHTML = formatRupiah(total);
}

// =================================
// TAMBAH QTY
// =================================

function tambahQty(index) {
  let item = keranjang[index];

  let produkAsli = produk.find((x) => x.id_produk == item.id_produk);

  if (item.qty < produkAsli.stok) {
    item.qty++;
  } else {
    alert("Stok tidak cukup");
  }

  tampilkanKeranjang();
}

// =================================
// KURANG QTY
// =================================

function kurang(index) {
  if (keranjang[index].qty > 1) {
    keranjang[index].qty--;
  } else {
    keranjang.splice(index, 1);
  }

  tampilkanKeranjang();
}

// =================================
// BAYAR QRIS
// =================================

function bayar() {
  if (keranjang.length == 0) {
    alert("Keranjang kosong");

    return;
  }

  let total = keranjang.reduce(
    (sum, item) => sum + Number(item.harga_jual) * item.qty,

    0,
  );

  let data = {
    kasir: "Admin",

    total: total,

    total_item: keranjang.reduce(
      (sum, item) => sum + item.qty,

      0,
    ),

    items: keranjang,
  };

  fetch(API, {
    method: "POST",

    body: JSON.stringify(data),
  })
    .then((res) => res.json())

    .then((result) => {
      console.log(result);

      idTransaksiAktif = result.id;

      // simpan untuk struk

      localStorage.setItem(
        "transaksi",

        JSON.stringify({
          id: result.id,

          tanggal: new Date(),

          total: total,

          items: keranjang,
        }),
      );

      document.getElementById("status").innerHTML =
        "Menunggu pembayaran " + result.id;

      alert("Transaksi berhasil\n" + result.id);

      // buka customer display

      window.open(
        "customer.html",

        "customerDisplay",

        "width=600,height=900",
      );
    })

    .catch((error) => {
      console.log(error);

      alert("Transaksi gagal");
    });
}

// =================================
// BUKA CUSTOMER MANUAL
// =================================

function bukaCustomer() {
  window.open(
    "customer.html",

    "customerDisplay",

    "width=600,height=900",
  );
}

// =================================
// LUNAS
// =================================

function lunas() {
  if (idTransaksiAktif == "") {
    alert("Belum ada transaksi");

    return;
  }

  fetch(API + "?action=lunas&id=" + idTransaksiAktif)
    .then((res) => res.json())

    .then((data) => {
      document.getElementById("status").innerHTML = "Pembayaran LUNAS";

      alert("Pembayaran selesai");

      ambilProduk();
    });
}

// =================================
// TRANSAKSI BARU
// =================================

function resetTransaksi() {
  keranjang = [];

  idTransaksiAktif = "";

  localStorage.removeItem("transaksi");

  tampilkanKeranjang();

  document.getElementById("status").innerHTML = "Siap transaksi baru";
}

// =================================
// CETAK STRUK
// =================================

function cetakStruk() {
  if (!localStorage.getItem("transaksi")) {
    alert("Belum ada transaksi");

    return;
  }

  window.open(
    "struk.html",

    "_blank",
  );
}

// =================================
// FORMAT RUPIAH
// =================================

function formatRupiah(angka) {
  return Number(angka).toLocaleString("id-ID");
}

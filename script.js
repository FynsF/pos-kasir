// =================================
// CONFIG API
// =================================

const API =
  "https://script.google.com/macros/s/AKfycbz-1nUJmKOjNYQEUKRwAEBt7h1D9xs3injteRNf0WjJhY6aWk0U2hpbmpYjXuKmHRih/exec";

// =================================
// GLOBAL VARIABLE
// =================================

let produk = [];

let keranjang = [];

let idTransaksiAktif = "";

let namaKasir = "Admin";

// =================================
// START
// =================================

document.addEventListener("DOMContentLoaded", () => {
  ambilProduk();
});

// =================================
// AMBIL PRODUK
// =================================

function ambilProduk() {
  document.getElementById("produk").innerHTML = "Memuat produk...";

  fetch(API)
    .then((res) => res.json())

    .then((data) => {
      produk = data;

      tampilkanProduk();
    })

    .catch((err) => {
      console.log(err);

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

Stok :
${p.stok}

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

  if (Number(p.stok) <= 0) {
    alert("Stok habis");

    return;
  }

  let cek = keranjang.find((x) => x.id_produk == id);

  if (cek) {
    if (cek.qty < Number(p.stok)) {
      cek.qty++;
    } else {
      alert("Stok tidak cukup");
    }
  } else {
    keranjang.push({
      id_produk: p.id_produk,

      nama_produk: p.nama_produk,

      harga_modal: Number(p.harga_modal),

      harga_jual: Number(p.harga_jual),

      qty: 1,
    });
  }

  tampilkanKeranjang();
}

// =================================
// TAMPIL KERANJANG
// =================================

function tampilkanKeranjang() {
  let tabel = document.getElementById("keranjang");

  tabel.innerHTML = "";

  let total = 0;

  keranjang.forEach((p, index) => {
    let subtotal = p.harga_jual * p.qty;

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
// QTY
// =================================

function tambahQty(index) {
  let item = keranjang[index];

  let stok = produk.find((x) => x.id_produk == item.id_produk).stok;

  if (item.qty < stok) {
    item.qty++;
  } else {
    alert("Stok tidak cukup");
  }

  tampilkanKeranjang();
}

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
    (sum, item) => sum + item.harga_jual * item.qty,
    0,
  );

  let transaksi = {
    kasir: namaKasir,

    total: total,

    total_item: keranjang.reduce((sum, item) => sum + item.qty, 0),

    items: keranjang,
  };

  fetch(API, {
    method: "POST",

    body: JSON.stringify(transaksi),
  })
    .then((res) => res.json())

    .then((result) => {
      idTransaksiAktif = result.id;

      let dataStruk = {
        id: result.id,

        tanggal: new Date().toLocaleString("id-ID"),

        kasir: namaKasir,

        total: total,

        items: [...keranjang],
      };

      localStorage.setItem(
        "transaksi",

        JSON.stringify(dataStruk),
      );

      document.getElementById("status").innerHTML =
        "Menunggu pembayaran " + result.id;

      window.open(
        "customer.html",

        "customerDisplay",

        "width=500,height=900",
      );
    })

    .catch((err) => {
      console.log(err);

      alert("Transaksi gagal");
    });
}

// =================================
// LUNAS
// =================================

function lunas() {
  if (!idTransaksiAktif) {
    alert("Belum ada transaksi");

    return;
  }

  fetch(API + "?action=lunas&id=" + idTransaksiAktif)
    .then((res) => res.json())

    .then((data) => {
      document.getElementById("status").innerHTML = "Pembayaran LUNAS";

      alert("Pembayaran berhasil");

      ambilProduk();
    });
}

// =================================
// CETAK STRUK
// =================================

function cetakStruk() {
  let data = localStorage.getItem("transaksi");

  if (!data) {
    alert("Belum ada transaksi");

    return;
  }

  window.open("struk.html", "_blank");
}

// =================================
// CUSTOMER DISPLAY
// =================================

function bukaCustomer() {
  window.open(
    "customer.html",

    "customerDisplay",

    "width=500,height=900",
  );
}

// =================================
// RESET
// =================================

function resetTransaksi() {
  keranjang = [];

  idTransaksiAktif = "";

  localStorage.removeItem("transaksi");

  tampilkanKeranjang();

  document.getElementById("status").innerHTML = "Siap transaksi baru";
}

// =================================
// FORMAT RUPIAH
// =================================

function formatRupiah(angka) {
  return Number(angka || 0).toLocaleString("id-ID");
}

let transaksi = JSON.parse(localStorage.getItem("transaksi"));

if (!transaksi) {
  alert("Tidak ada transaksi");
}

document.getElementById("id").innerHTML = transaksi.id;

document.getElementById("tanggal").innerHTML = new Date().toLocaleString(
  "id-ID",
);

document.getElementById("total").innerHTML =
  transaksi.total.toLocaleString("id-ID");

let tabel = document.getElementById("detail");

transaksi.items.forEach((item) => {
  tabel.innerHTML += `


<tr>

<td>
${item.nama_produk}
x${item.qty}
</td>


<td align="right">

${(item.harga_jual * item.qty).toLocaleString("id-ID")}

</td>


</tr>


`;
});

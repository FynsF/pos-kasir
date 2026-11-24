/* ==========================================================================
   UI.JS — FYNCOFFEE POS V10
   Tema terang/gelap, suara, navigasi tab, keranjang mobile, modal helper,
   dan pembuat PDF struk. Dimuat sebelum script.js & history.js.
   ========================================================================== */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const LS = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const call = (name, ...args) => (typeof window[name] === "function" ? window[name](...args) : undefined);

  /* =====================  TEMA  ===================== */
  const Theme = {
    current() { return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"; },
    apply(t, simpan) {
      document.documentElement.setAttribute("data-theme", t);
      const m = $("metaThemeColor");
      if (m) m.setAttribute("content", t === "light" ? "#f6f1e9" : "#0b0908");
      if (simpan) LS.set("fyncoffee_theme", t);
      const btn = $("btnTheme");
      if (btn) btn.setAttribute("aria-label", t === "light" ? "Beralih ke mode gelap" : "Beralih ke mode terang");
    },
    toggle() { Theme.apply(Theme.current() === "light" ? "dark" : "light", true); },
  };
  window.FynTheme = Theme;

  // Ikuti pengaturan sistem selama pengguna belum memilih manual
  try {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e) => { if (!LS.get("fyncoffee_theme")) Theme.apply(e.matches ? "light" : "dark", false); };
    mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange);
  } catch (e) {}

  // Sinkron antar tab / jendela (struk, customer display)
  window.addEventListener("storage", (e) => {
    if (e.key === "fyncoffee_theme" && (e.newValue === "light" || e.newValue === "dark")) Theme.apply(e.newValue, false);
  });

  /* =====================  SUARA  ===================== */
  let audioCtx = null;
  const Sound = {
    enabled() { return LS.get("fyncoffee_sound", "1") !== "0"; },
    play(jenis) {
      if (!Sound.enabled()) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = audioCtx || new AC();
        if (audioCtx.state === "suspended") audioCtx.resume();
        const pola = {
          add: [[880, 0, 0.06]],
          success: [[660, 0, 0.1], [880, 0.1, 0.1], [1320, 0.2, 0.18]],
          error: [[220, 0, 0.16], [165, 0.16, 0.22]],
        }[jenis] || [];
        const t0 = audioCtx.currentTime;
        pola.forEach(([freq, delay, dur]) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = jenis === "error" ? "sawtooth" : "sine";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, t0 + delay);
          gain.gain.exponentialRampToValueAtTime(0.14, t0 + delay + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur);
          osc.connect(gain).connect(audioCtx.destination);
          osc.start(t0 + delay);
          osc.stop(t0 + delay + dur + 0.02);
        });
      } catch (e) {}
    },
    toggle() {
      const on = !Sound.enabled();
      LS.set("fyncoffee_sound", on ? "1" : "0");
      Sound.paint();
      if (on) Sound.play("add");
    },
    paint() {
      const b = $("btnSoundToggle");
      if (!b) return;
      b.classList.toggle("active", Sound.enabled());
      b.setAttribute("aria-pressed", String(Sound.enabled()));
    },
  };
  window.FynSound = Sound;

  /* =====================  NAVIGASI TAB  ===================== */
  function setView(view, opts = {}) {
    view = view === "riwayat" ? "riwayat" : "kasir";
    document.body.setAttribute("data-view", view);
    const k = $("viewKasir"), r = $("viewRiwayat");
    if (k) k.hidden = view !== "kasir";
    if (r) r.hidden = view !== "riwayat";
    [["tabKasir", "kasir"], ["tabRiwayat", "riwayat"]].forEach(([id, v]) => {
      const el = $(id);
      if (!el) return;
      el.classList.toggle("active", v === view);
      el.setAttribute("aria-selected", String(v === view));
    });
    closeMobileCart();
    if (!opts.silent) {
      const hash = view === "riwayat" ? "#riwayat" : "#kasir";
      if (location.hash !== hash) history.replaceState(null, "", hash);
    }
    if (view === "riwayat") call("riwayatBuka");
    else if (!opts.silent) setTimeout(() => { const s = $("searchProduk"); if (s && window.innerWidth > 900) s.focus(); }, 60);
    window.scrollTo(0, 0);
  }
  window.setView = setView;

  /* =====================  KERANJANG MOBILE  ===================== */
  function openMobileCart() {
    const c = $("cartSection"), b = $("mobileCartBackdrop");
    if (!c) return;
    c.classList.add("mobile-open");
    if (b) { b.classList.add("active"); b.setAttribute("aria-hidden", "false"); }
    if (window.innerWidth <= 900) document.body.style.overflow = "hidden";
  }
  function closeMobileCart() {
    const c = $("cartSection"), b = $("mobileCartBackdrop");
    if (c) c.classList.remove("mobile-open");
    if (b) { b.classList.remove("active"); b.setAttribute("aria-hidden", "true"); }
    if (!document.body.classList.contains("modal-open") && !document.body.classList.contains("drawer-open")) document.body.style.overflow = "";
  }
  window.openMobileCart = openMobileCart;
  window.closeMobileCart = closeMobileCart;

  /* =====================  FULLSCREEN  ===================== */
  async function togglePOSFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    } catch (e) { /* tidak tersedia */ }
  }

  /* =====================  PDF  ===================== */
  function muatScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.crossOrigin = "anonymous"; s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Gagal memuat komponen PDF. Periksa koneksi internet."));
      document.head.appendChild(s);
    });
  }
  let pdfPromise = null;
  function muatPustakaPDF() {
    if (window.html2canvas && window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    if (!pdfPromise) {
      pdfPromise = Promise.all([
        window.html2canvas ? 0 : muatScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"),
        window.jspdf ? 0 : muatScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"),
      ]).catch((err) => { pdfPromise = null; throw err; });
    }
    return pdfPromise;
  }
  window.muatPustakaPDF = muatPustakaPDF;

  function namaFileAman(v) {
    return String(v || "STRUK").replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "STRUK";
  }
  window.namaFileAman = namaFileAman;

  // Render HTML struk (string) -> PDF thermal 58 mm -> unduh
  async function unduhStrukPDF(htmlStruk, namaFile, tombol) {
    const label = tombol ? tombol.innerHTML : "";
    if (tombol) { tombol.disabled = true; tombol.innerHTML = "Membuat…"; }
    let host = null;
    try {
      await muatPustakaPDF();
      host = document.createElement("div");
      host.style.cssText = "position:fixed;left:-100000px;top:0;width:58mm;background:#fff;z-index:-1;pointer-events:none";
      host.innerHTML = htmlStruk;
      document.body.appendChild(host);
      const paper = host.querySelector(".r-paper") || host.firstElementChild;
      paper.style.cssText += ";width:58mm;max-width:none;margin:0;padding:3mm;border-radius:0;box-shadow:none;background:#fff";
      if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
      // pastikan logo (jika ada) selesai dimuat
      await Promise.all([...paper.querySelectorAll("img")].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
      const canvas = await window.html2canvas(paper, {
        scale: Math.max(2, Math.min(4, window.devicePixelRatio || 2)),
        backgroundColor: "#ffffff", useCORS: true, logging: false,
      });
      const w = 58, h = Math.max(20, (canvas.height / canvas.width) * w);
      const pdf = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: [w, h], compress: true });
      pdf.addImage(canvas.toDataURL("image/png", 1.0), "PNG", 0, 0, w, h, undefined, "FAST");
      pdf.save(namaFile);
      call("toast", "Struk PDF berhasil diunduh", "success");
    } catch (err) {
      console.error("[PDF]", err);
      call("toast", err.message || "Gagal membuat PDF. Coba gunakan Cetak.", "error");
    } finally {
      if (host) host.remove();
      if (tombol) { tombol.disabled = false; tombol.innerHTML = label; }
    }
  }
  window.unduhStrukPDF = unduhStrukPDF;

  /* =====================  KONTROL LAIN  ===================== */
  function mulaiTransaksiBaru() {
    call("tutupStruk");
    const n = $("customerNameInput"), c = $("orderNoteInput");
    if (n) n.value = "";
    if (c) c.value = "";
    LS.del("fyncoffee_customer_name");
    LS.del("fyncoffee_order_note");
    setView("kasir", { silent: true });
    setTimeout(() => { const s = $("searchProduk"); if (s && window.innerWidth > 900) { s.focus(); s.select(); } }, 200);
    call("toast", "Siap untuk transaksi baru", "success");
  }
  window.mulaiTransaksiBaru = mulaiTransaksiBaru;

  function setOrderType(type) {
    const g = $("orderTypeGroup");
    if (!g) return;
    g.querySelectorAll(".order-type-btn").forEach((b) => {
      const on = b.dataset.orderType === type;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", String(on));
    });
    LS.set("fyncoffee_order_type", type);
  }

  function pasang() {
    Sound.paint();
    Theme.apply(Theme.current(), false);

    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

    on("btnTheme", "click", Theme.toggle);
    on("btnSoundToggle", "click", Sound.toggle);
    on("btnFullscreen", "click", togglePOSFullscreen);

    on("tabKasir", "click", () => setView("kasir"));
    on("tabRiwayat", "click", () => setView("riwayat"));

    on("btnRefresh", "click", () => {
      const icon = $("refreshIcon"), btn = $("btnRefresh");
      if (icon) icon.classList.add("spinning");
      if (btn) btn.disabled = true;
      Promise.resolve(call("ambilProduk")).finally(() => {
        if (icon) icon.classList.remove("spinning");
        if (btn) btn.disabled = false;
      });
    });

    on("btnCash", "click", () => call("bukaCashModal"));
    on("btnQris", "click", () => call("bayarQRIS"));
    on("btnKosongkan", "click", () => call("resetTransaksi"));
    on("btnDisplay", "click", () => call("bukaCustomerDisplay"));
    on("btnKonfirmasiCash", "click", () => call("konfirmasiCash"));
    on("btnKonfirmasiQris", "click", () => call("konfirmasiQRIS"));
    on("btnCetak", "click", () => call("cetakStrukTerakhir"));
    on("btnDownloadPdf", "click", () => call("downloadStrukPDF"));
    on("btnTrxBaru", "click", mulaiTransaksiBaru);

    on("mobileCartButton", "click", openMobileCart);
    on("mobileCartBackdrop", "click", closeMobileCart);
    on("btnCartClose", "click", closeMobileCart);

    // Gambar QRIS gagal dimuat -> tampilkan fallback
    const qi = $("qrisImage");
    if (qi) qi.addEventListener("error", () => qi.parentElement.classList.add("error"));

    // Tutup modal: tombol [data-close] + klik latar
    const penutup = { cash: "tutupCashModal", qris: "tutupQrisModal", receipt: "tutupStruk", detail: "riwayatTutupDetail" };
    document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => call(penutup[b.dataset.close])));
    [["cashModal", "cash"], ["qrisModal", "qris"], ["receiptModal", "receipt"], ["detailDrawer", "detail"]].forEach(([id, k]) => {
      const el = $(id);
      if (el) el.addEventListener("mousedown", (e) => { if (e.target === el) call(penutup[k]); });
    });

    // Tipe pesanan + data pelanggan (tersimpan otomatis)
    const grup = $("orderTypeGroup");
    if (grup) grup.addEventListener("click", (e) => { const b = e.target.closest(".order-type-btn"); if (b) setOrderType(b.dataset.orderType); });
    setOrderType(LS.get("fyncoffee_order_type", "dine-in"));

    [["customerNameInput", "fyncoffee_customer_name"], ["orderNoteInput", "fyncoffee_order_note"]].forEach(([id, key]) => {
      const el = $(id);
      if (!el) return;
      el.value = LS.get(key, "") || "";
      el.addEventListener("input", () => LS.set(key, el.value));
    });

    // Kunci scroll body saat modal/drawer terbuka
    if ("MutationObserver" in window) {
      const sync = () => {
        document.body.classList.toggle("modal-open", !!document.querySelector(".modal.active"));
        document.body.classList.toggle("drawer-open", !!document.querySelector(".drawer.active"));
      };
      const mo = new MutationObserver(sync);
      document.querySelectorAll(".modal, .drawer").forEach((m) => mo.observe(m, { attributes: true, attributeFilter: ["class"] }));
    }

    // Pintasan keyboard
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (document.querySelector(".drawer.active")) call("riwayatTutupDetail");
        else closeMobileCart();
      }
      if (e.key === "F4") { e.preventDefault(); setView(document.body.dataset.view === "riwayat" ? "kasir" : "riwayat"); }
      if (e.ctrlKey && e.shiftKey && String(e.key).toLowerCase() === "p") {
        const rm = $("receiptModal");
        if (rm && rm.classList.contains("active")) { e.preventDefault(); call("downloadStrukPDF"); }
      }
    });

    window.addEventListener("resize", () => { if (window.innerWidth > 900) closeMobileCart(); });
    window.addEventListener("hashchange", () => setView(location.hash === "#riwayat" ? "riwayat" : "kasir", { silent: true }));

    // Buka langsung ke riwayat jika URL berakhiran #riwayat
    if (location.hash === "#riwayat") setView("riwayat", { silent: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pasang);
  else pasang();
})();

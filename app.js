(function () {
  "use strict";

  const EXPENSES_KEY = "expensemarker_expenses";
  const EMPLOYEE_KEY = "expensemarker_employee";
  const MANAGER_EMAIL_KEY = "expensemarker_manager_email";
  const DB_NAME = "expensemarkerDB";
  const STORE = "receipts";

  const $ = (id) => document.getElementById(id);

  // ---------- IndexedDB (receipt blobs, kept for potential future use) ----------
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function putReceipt(id, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function deleteReceipt(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------- localStorage (expense metadata) ----------
  function loadExpenses() {
    try {
      return JSON.parse(localStorage.getItem(EXPENSES_KEY)) || [];
    } catch {
      return [];
    }
  }
  function saveExpenses(list) {
    localStorage.setItem(EXPENSES_KEY, JSON.stringify(list));
  }
  function getEmployee() {
    return localStorage.getItem(EMPLOYEE_KEY) || "";
  }
  function setEmployee(name) {
    localStorage.setItem(EMPLOYEE_KEY, name);
  }
  function getManagerEmail() {
    return localStorage.getItem(MANAGER_EMAIL_KEY) || "";
  }
  function setManagerEmail(email) {
    localStorage.setItem(MANAGER_EMAIL_KEY, email);
  }

  let expenses = loadExpenses();
  let pendingReceiptBlob = null;
  let currentTab = "submitted"; // "submitted" | "paid"

  // ---------- helpers ----------
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }
  function fmtDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  }
  function fmtMoney(n) {
    return "£" + (parseFloat(n) || 0).toFixed(2);
  }
  function showToast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.remove("show"), 2400);
  }
  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  async function fileToThumbnail(file, maxDim = 480) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.7);
  }

  // ---------- rendering ----------
  function render() {
    const employee = getEmployee();
    $("driverLine").textContent = employee ? `Logged as ${employee}` : "Tap settings to add your name";

    const filtered = expenses.filter((e) => (currentTab === "paid" ? !!e.paid : !e.paid));
    const sorted = [...filtered].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    const total = filtered.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    $("monthLabel").textContent = currentTab === "paid" ? "Paid total" : "Submitted total";
    $("listTitle").textContent = currentTab === "paid" ? "Paid" : "Submitted";
    $("odometerDisplay").textContent = fmtMoney(total);
    $("tripCount").textContent = filtered.length;

    const listEl = $("tripList");
    listEl.innerHTML = "";
    $("emptyState").style.display = sorted.length === 0 ? "block" : "none";
    $("emptyState").textContent =
      currentTab === "paid" ? "No paid expenses yet." : "No expenses yet. Log your first one below.";

    for (const exp of sorted) {
      const card = document.createElement("div");
      card.className = "trip-card";
      card.innerHTML = `
        <div class="row1">
          <div class="row1-left">
            ${exp.thumb ? `<img class="card-thumb" src="${exp.thumb}" alt="">` : ""}
            <div class="route">${escapeHtml(exp.description)}</div>
          </div>
          <div class="amount">${fmtMoney(exp.amount)}</div>
        </div>
        <div class="row2">
          <span>${fmtDate(exp.date)}</span>
          <span class="tag">${escapeHtml(exp.category)}</span>
        </div>
        <button class="paid-toggle ${exp.paid ? "mark-unpaid" : "mark-paid"}" data-id="${exp.id}" data-paid="${!!exp.paid}">
          ${exp.paid ? "Mark as not received" : "I've received payment"}
        </button>
      `;
      card.querySelector(".route").addEventListener("click", () => openTripModal(exp.id));
      card.querySelector(".paid-toggle").addEventListener("click", (e) => {
        e.stopPropagation();
        togglePaid(exp.id);
      });
      listEl.appendChild(card);
    }
  }

  function togglePaid(id) {
    const idx = expenses.findIndex((e) => e.id === id);
    if (idx === -1) return;
    expenses[idx].paid = !expenses[idx].paid;
    expenses[idx].paidAt = expenses[idx].paid ? Date.now() : null;
    saveExpenses(expenses);
    render();
    showToast(expenses[idx].paid ? "Marked as received" : "Moved back to submitted");
  }

  document.querySelectorAll(".admin-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentTab = btn.dataset.filter;
      render();
    });
  });

  // ---------- expense modal ----------
  function resetReceiptField() {
    pendingReceiptBlob = null;
    $("receiptPreview").hidden = true;
    $("receiptPreview").removeAttribute("src");
    delete $("receiptPreview").dataset.pendingThumb;
    $("removeReceiptBtn").hidden = true;
    $("uploadBtnLabel").textContent = "Add photo";
    $("receiptInput").value = "";
  }

  function openTripModal(id) {
    const isEdit = !!id;
    $("modalTitle").textContent = isEdit ? "Edit expense" : "New expense";
    $("deleteTripBtn").hidden = !isEdit;
    resetReceiptField();

    if (isEdit) {
      const exp = expenses.find((e) => e.id === id);
      $("tripId").value = exp.id;
      $("tripDate").value = exp.date;
      $("tripAmount").value = exp.amount;
      $("tripCategory").value = exp.category;
      $("tripDescription").value = exp.description;
      if (exp.thumb) {
        $("receiptPreview").src = exp.thumb;
        $("receiptPreview").hidden = false;
        $("removeReceiptBtn").hidden = false;
        $("uploadBtnLabel").textContent = "Replace photo";
      }
    } else {
      $("tripForm").reset();
      $("tripId").value = "";
      $("tripDate").value = todayISO();
    }

    $("modalBackdrop").classList.add("open");
  }

  function closeTripModal() {
    $("modalBackdrop").classList.remove("open");
  }

  $("newTripBtn").addEventListener("click", () => openTripModal(null));
  $("closeModalBtn").addEventListener("click", closeTripModal);
  $("modalBackdrop").addEventListener("click", (e) => {
    if (e.target === $("modalBackdrop")) closeTripModal();
  });

  $("receiptInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingReceiptBlob = file;
    try {
      const thumb = await fileToThumbnail(file);
      $("receiptPreview").src = thumb;
      $("receiptPreview").hidden = false;
      $("removeReceiptBtn").hidden = false;
      $("uploadBtnLabel").textContent = "Replace photo";
      $("receiptPreview").dataset.pendingThumb = thumb;
    } catch {
      showToast("Couldn't read that photo");
    }
  });

  $("removeReceiptBtn").addEventListener("click", () => {
    pendingReceiptBlob = "REMOVE";
    resetReceiptField();
  });

  $("tripForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("tripId").value;

    const data = {
      date: $("tripDate").value,
      amount: parseFloat($("tripAmount").value) || 0,
      category: $("tripCategory").value,
      description: $("tripDescription").value.trim(),
    };

    if (id) {
      const idx = expenses.findIndex((x) => x.id === id);
      if (idx > -1) {
        expenses[idx] = { ...expenses[idx], ...data };
        if (pendingReceiptBlob === "REMOVE") {
          expenses[idx].thumb = null;
          expenses[idx].hasReceipt = false;
          await deleteReceipt(id);
        } else if (pendingReceiptBlob) {
          expenses[idx].thumb = $("receiptPreview").dataset.pendingThumb || null;
          expenses[idx].hasReceipt = true;
          await putReceipt(id, pendingReceiptBlob);
        }
      }
      showToast("Expense updated");
    } else {
      const expenseId = uid();
      const newExp = {
        id: expenseId,
        createdAt: Date.now(),
        employee: getEmployee(),
        thumb: pendingReceiptBlob ? $("receiptPreview").dataset.pendingThumb : null,
        hasReceipt: !!pendingReceiptBlob,
        paid: false,
        paidAt: null,
        ...data,
      };
      expenses.push(newExp);
      if (pendingReceiptBlob) {
        await putReceipt(expenseId, pendingReceiptBlob);
      }
      showToast("Expense saved");
    }

    saveExpenses(expenses);
    closeTripModal();
    render();
  });

  $("deleteTripBtn").addEventListener("click", async () => {
    const id = $("tripId").value;
    if (!id) return;
    expenses = expenses.filter((e) => e.id !== id);
    saveExpenses(expenses);
    await deleteReceipt(id);
    closeTripModal();
    render();
    showToast("Expense deleted");
  });

  // ---------- settings modal ----------
  $("settingsBtn").addEventListener("click", () => {
    $("driverNameInput").value = getEmployee();
    $("managerEmailInput").value = getManagerEmail();
    $("settingsBackdrop").classList.add("open");
  });
  $("closeSettingsBtn").addEventListener("click", () => {
    $("settingsBackdrop").classList.remove("open");
  });
  $("settingsBackdrop").addEventListener("click", (e) => {
    if (e.target === $("settingsBackdrop")) $("settingsBackdrop").classList.remove("open");
  });
  $("saveDriverBtn").addEventListener("click", () => {
    setEmployee($("driverNameInput").value.trim());
    setManagerEmail($("managerEmailInput").value.trim());
    $("settingsBackdrop").classList.remove("open");
    render();
    showToast("Saved");
  });

  // ---------- PDF export + email ----------
  function loadImageDims(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 1, h: 1 });
      img.src = dataUrl;
    });
  }

  async function loadLogoDataUrl() {
    try {
      const res = await fetch("logo.png");
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  function employeeInitials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "XX";
    return parts.map((p) => p[0].toUpperCase()).slice(0, 3).join("");
  }

  function reportReference(employee) {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}-${employeeInitials(employee)}`;
  }

  function fmtDateTime(ms) {
    if (!ms) return "—";
    return new Date(ms).toLocaleDateString();
  }

  async function buildPdf(list, employee) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const marginX = 14;
    const pageWidth = 210;
    const pageHeight = 297;
    const ref = reportReference(employee);
    let y = 20;

    const logo = await loadLogoDataUrl();
    let headerTextX = marginX;
    if (logo) {
      try {
        const dims = await loadImageDims(logo);
        const logoH = 14;
        const logoW = (dims.w / dims.h) * logoH;
        doc.addImage(logo, marginX, y - 10, logoW, logoH);
        headerTextX = marginX + logoW + 6;
      } catch {
        // fall back to text-only header
      }
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(32, 36, 43);
    doc.text("Pro Gases UK Ltd", headerTextX, y - 5.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(110, 110, 110);
    doc.text("Expense report", headerTextX, y - 0.5);
    y += 8;

    doc.setDrawColor(225, 222, 214);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 8;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(32, 36, 43);
    doc.text(`Expenses — ${employee || "Unnamed"}`, marginX, y);
    y += 6.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110, 110, 110);
    doc.text(
      `${currentTab === "paid" ? "Paid" : "Submitted"} · generated ${new Date().toLocaleDateString()} · Ref: ${ref}`,
      marginX,
      y
    );
    y += 10;

    const cols = [
      { label: "Date", x: marginX, w: 16 },
      { label: "Submitted", x: marginX + 17, w: 20 },
      { label: "Category", x: marginX + 38, w: 22 },
      { label: "Description", x: marginX + 61, w: 58 },
      { label: "Amount", x: marginX + 120, w: 20 },
      { label: "Status", x: marginX + 142, w: 24 },
    ];

    function drawHeader() {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(32, 36, 43);
      cols.forEach((c) => doc.text(c.label, c.x, y));
      y += 2;
      doc.setDrawColor(225, 222, 214);
      doc.line(marginX, y, pageWidth - marginX, y);
      y += 5.5;
      doc.setFont("helvetica", "normal");
    }

    drawHeader();

    let total = 0;
    const categoryTotals = {};
    for (const exp of list) {
      if (y > pageHeight - 25) {
        doc.addPage();
        y = 20;
        drawHeader();
      }
      doc.setFontSize(8.5);
      doc.setTextColor(32, 36, 43);
      doc.text(fmtDate(exp.date), cols[0].x, y);
      doc.text(fmtDateTime(exp.createdAt), cols[1].x, y);
      doc.text(String(exp.category), cols[2].x, y);
      const descLines = doc.splitTextToSize(String(exp.description || ""), cols[3].w);
      doc.text(descLines[0] || "", cols[3].x, y);
      doc.text(fmtMoney(exp.amount), cols[4].x, y);
      doc.text(exp.paid ? "Paid" : "Submitted", cols[5].x, y);
      total += parseFloat(exp.amount) || 0;
      categoryTotals[exp.category] = (categoryTotals[exp.category] || 0) + (parseFloat(exp.amount) || 0);
      y += 7;
    }

    y += 2;
    doc.setDrawColor(225, 222, 214);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 7;

    // category subtotals
    if (y > pageHeight - 40) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(32, 36, 43);
    doc.text("By category", marginX, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    Object.keys(categoryTotals)
      .sort()
      .forEach((cat) => {
        doc.text(cat, marginX, y);
        doc.text(fmtMoney(categoryTotals[cat]), marginX + 60, y);
        y += 6;
      });

    y += 3;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Total: ${fmtMoney(total)}`, marginX, y);
    y += 14;

    // declaration
    if (y > pageHeight - 30) {
      doc.addPage();
      y = 20;
    }
    doc.setDrawColor(225, 222, 214);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 8;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(70, 74, 80);
    const declaration = doc.splitTextToSize(
      "I confirm these expenses were incurred wholly for business purposes.",
      pageWidth - marginX * 2
    );
    doc.text(declaration, marginX, y);
    y += declaration.length * 5 + 6;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(32, 36, 43);
    doc.text(employee || "Unnamed", marginX, y);

    // receipt images, one per section
    const withReceipts = list.filter((e) => e.thumb);
    if (withReceipts.length) {
      for (const exp of withReceipts) {
        doc.addPage();
        y = 20;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(32, 36, 43);
        doc.text(`${fmtDate(exp.date)} — ${exp.description} — ${fmtMoney(exp.amount)}`, marginX, y);
        y += 8;

        const dims = await loadImageDims(exp.thumb);
        const maxW = pageWidth - marginX * 2;
        const maxH = pageHeight - y - 20;
        let w = dims.w / 3.78; // px to mm approx at 96dpi
        let h = dims.h / 3.78;
        const scale = Math.min(1, maxW / w, maxH / h);
        w *= scale;
        h *= scale;
        doc.addImage(exp.thumb, "JPEG", marginX, y, w, h);
      }
    }

    // page numbers + report ref footer on every page
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Ref: ${ref}`, marginX, pageHeight - 10);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - marginX - 22, pageHeight - 10);
    }

    return doc.output("blob");
  }

  $("exportBtn").addEventListener("click", async () => {
    const filtered = expenses.filter((e) => (currentTab === "paid" ? !!e.paid : !e.paid));
    if (filtered.length === 0) {
      showToast("Nothing to export in this view");
      return;
    }
    showToast("Building PDF…");

    const employee = getEmployee() || "employee";
    const managerEmail = getManagerEmail();
    const sorted = [...filtered].sort((a, b) => a.date.localeCompare(b.date));

    let blob;
    try {
      blob = await buildPdf(sorted, employee);
    } catch (err) {
      console.error(err);
      showToast("PDF error: " + (err && err.message ? err.message : "unknown"));
      return;
    }

    const filename = `expenses_${employee.replace(/\s+/g, "_").toLowerCase()}_${todayISO()}.pdf`;

    if (navigator.share && navigator.canShare) {
      try {
        const file = new File([blob], filename, { type: "application/pdf" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: "Expense report",
            text: managerEmail
              ? `Expense report for ${employee} — please send to ${managerEmail}`
              : `Expense report for ${employee}`,
          });
          return;
        }
      } catch {
        // fall through to download + mailto fallback
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("PDF downloaded — attach it to an email");

    if (managerEmail) {
      const subject = encodeURIComponent(`Expenses — ${employee}`);
      const body = encodeURIComponent(
        `Hi,\n\nPlease find my expense report attached (just downloaded as ${filename} — attach it from your Files/Downloads).\n\nThanks,\n${employee}`
      );
      setTimeout(() => {
        window.location.href = `mailto:${managerEmail}?subject=${subject}&body=${body}`;
      }, 400);
    }
  });

  // ---------- first run ----------
  function checkFirstRun() {
    if (!getEmployee()) {
      setTimeout(() => {
        $("driverNameInput").value = "";
        $("managerEmailInput").value = getManagerEmail();
        $("settingsBackdrop").classList.add("open");
      }, 300);
    }
  }

  // ---------- PWA service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  render();
  checkFirstRun();
})();

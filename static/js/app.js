/* ===========================================================
   Shoply — frontend logic
   Talks to the Flask API; manages cart, list, pantry, costs, analytics.
=========================================================== */

const fmtK = (n) => `K${(Number(n) || 0).toFixed(2)}`;
const today = new Date().toISOString().slice(0, 10);

let state = {
  shops: [],
  categories: [],
  currentShopId: null,
  cart: [],
  budgetLimit: null,
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  const panel = document.getElementById(`panel-${name}`);
  if (btn) btn.classList.add("active");
  if (panel) panel.classList.add("active");
  onTabActivated(name);
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function onTabActivated(name) {
  if (name === "history")   { loadTripHistory(); }
  if (name === "costs")     { loadOtherCosts(); loadCostsSummary(); }
  if (name === "settings")  { loadShopsIntoSettings(); loadCategoriesIntoSettings(); }
  if (name === "list")      { loadShoppingList(); }
  if (name === "analytics") { loadAnalytics(); }
  if (name === "pantry")    { loadPantry(); }
  if (name === "prices")    { loadPrices(); }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  await loadShops();
  await loadCategories();
  renderCart();
  loadCostsSummary(); // for the overdue badge on boot
}

async function loadShops() {
  const res = await fetch("/api/shops");
  state.shops = await res.json();
  const select = document.getElementById("shopSelect");
  select.innerHTML = `<option value="">— No shop selected —</option>` +
    state.shops.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
}

async function loadCategories() {
  const res = await fetch("/api/categories");
  state.categories = await res.json();
  const select = document.getElementById("itemCategory");
  select.innerHTML = `<option value="">—</option>` +
    state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
}

document.getElementById("shopSelect").addEventListener("change", (e) => {
  state.currentShopId = e.target.value ? Number(e.target.value) : null;
  document.getElementById("quickPickList").innerHTML = "";
  document.getElementById("quickPickSearch").value = "";
});

document.getElementById("budgetInput").addEventListener("input", (e) => {
  state.budgetLimit = e.target.value ? Number(e.target.value) : null;
  renderReceipt();
});

// ---------------------------------------------------------------------------
// Quick pick
// ---------------------------------------------------------------------------

document.getElementById("toggleQuickPick").addEventListener("click", () => {
  const wrap = document.getElementById("quickPickWrap");
  if (!state.currentShopId) {
    toast("Select a shop first to see its remembered items.");
    return;
  }
  wrap.classList.toggle("hidden");
  if (!wrap.classList.contains("hidden")) loadQuickPick("");
});

let quickPickTimer = null;
document.getElementById("quickPickSearch").addEventListener("input", (e) => {
  clearTimeout(quickPickTimer);
  quickPickTimer = setTimeout(() => loadQuickPick(e.target.value), 200);
});

async function loadQuickPick(query) {
  if (!state.currentShopId) return;
  const res = await fetch(`/api/shops/${state.currentShopId}/items?q=${encodeURIComponent(query)}`);
  const items = await res.json();
  const list = document.getElementById("quickPickList");

  if (items.length === 0) {
    list.innerHTML = `<p class="empty-hint">No remembered items yet at this shop.</p>`;
    return;
  }

  list.innerHTML = items.map((it) => `
    <button type="button" class="quick-pick-item" data-id="${it.id}" data-name="${escapeHtml(it.name)}"
            data-price="${it.unit_price}" data-unit="${it.unit_label}">
      ${it.has_photo
        ? `<img class="quick-pick-thumb" src="/api/items/${it.id}/photo" alt="">`
        : `<div class="quick-pick-thumb-placeholder"></div>`}
      <span class="quick-pick-name">${escapeHtml(it.name)}</span>
      <span class="quick-pick-price">${fmtK(it.unit_price)} / ${it.unit_label}</span>
    </button>
  `).join("");

  list.querySelectorAll(".quick-pick-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("itemName").value = btn.dataset.name;
      document.getElementById("itemPrice").value = btn.dataset.price;
      document.getElementById("itemUnit").value = btn.dataset.unit;
      document.getElementById("itemQty").value = 1;
      document.getElementById("itemTotalCost").value = "";
      updateLinePreview();
      document.getElementById("quickPickWrap").classList.add("hidden");
      document.getElementById("itemQty").focus();
    });
  });
}

// ---------------------------------------------------------------------------
// Unit price calculator (total cost ÷ qty → unit price)
// ---------------------------------------------------------------------------

function updateUnitPriceHint() {
  const price = Number(document.getElementById("itemPrice").value) || 0;
  const qty = Number(document.getElementById("itemQty").value) || 0;
  const unit = document.getElementById("itemUnit").value;
  const hint = document.getElementById("unitPriceHint");
  const measuredUnits = ["kg", "g", "litre"];
  if (price > 0 && qty > 0 && measuredUnits.includes(unit)) {
    hint.textContent = `= ${fmtK(price)} per ${unit}`;
    hint.classList.remove("hidden");
  } else {
    hint.textContent = "";
    hint.classList.add("hidden");
  }
}

document.getElementById("itemTotalCost").addEventListener("input", (e) => {
  const total = Number(e.target.value) || 0;
  const qty = Number(document.getElementById("itemQty").value) || 1;
  if (total > 0 && qty > 0) {
    document.getElementById("itemPrice").value = (total / qty).toFixed(2);
    updateLinePreview();
    updateUnitPriceHint();
  }
});

// Clear total cost when unit price is manually edited
document.getElementById("itemPrice").addEventListener("input", () => {
  document.getElementById("itemTotalCost").value = "";
  updateLinePreview();
  updateUnitPriceHint();
});

document.getElementById("itemQty").addEventListener("input", () => {
  // Recalculate unit price from total if total cost is filled
  const total = Number(document.getElementById("itemTotalCost").value) || 0;
  const qty = Number(document.getElementById("itemQty").value) || 1;
  if (total > 0) {
    document.getElementById("itemPrice").value = (total / qty).toFixed(2);
  }
  updateLinePreview();
  updateUnitPriceHint();
});

document.getElementById("itemUnit").addEventListener("change", updateUnitPriceHint);

// ---------------------------------------------------------------------------
// Add item form → cart
// ---------------------------------------------------------------------------

function updateLinePreview() {
  const price = Number(document.getElementById("itemPrice").value) || 0;
  const qty = Number(document.getElementById("itemQty").value) || 0;
  document.getElementById("linePreview").innerHTML = `Line total: <strong>${fmtK(price * qty)}</strong>`;
}

document.getElementById("addItemForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("itemName").value.trim();
  const price = Number(document.getElementById("itemPrice").value);
  const qty = Number(document.getElementById("itemQty").value);
  const unit = document.getElementById("itemUnit").value;
  const categoryId = document.getElementById("itemCategory").value || null;
  const photoFile = document.getElementById("itemPhoto").files[0];

  if (!name || isNaN(price) || isNaN(qty)) {
    toast("Please fill in item name, price and quantity.");
    return;
  }

  state.cart.push({ item_name: name, unit_price: price, quantity: qty, unit_label: unit });
  renderCart();

  if (state.currentShopId) {
    const formData = new FormData();
    formData.append("shop_id", state.currentShopId);
    formData.append("name", name);
    formData.append("unit_price", price);
    formData.append("unit_label", unit);
    if (categoryId) formData.append("category_id", categoryId);
    if (photoFile) formData.append("photo", photoFile);
    fetch("/api/items", { method: "POST", body: formData }).catch(() => {});
  }

  e.target.reset();
  document.getElementById("itemQty").value = 1;
  document.getElementById("itemUnit").value = unit;
  document.getElementById("itemTotalCost").value = "";
  document.getElementById("unitPriceHint").textContent = "";
  updateLinePreview();
  document.getElementById("itemName").focus();
});

// ---------------------------------------------------------------------------
// Cart rendering + receipt strip
// ---------------------------------------------------------------------------

function renderCart() {
  const list = document.getElementById("cartList");
  const count = document.getElementById("cartCount");

  count.textContent = `${state.cart.length} item${state.cart.length === 1 ? "" : "s"}`;

  if (state.cart.length === 0) {
    list.innerHTML = `<p class="empty-hint">No items yet. Add something above to start your total.</p>`;
  } else {
    list.innerHTML = state.cart.map((line, idx) => `
      <div class="cart-line">
        <div class="cart-line-info">
          <div class="cart-line-name">${escapeHtml(line.item_name)}</div>
          <div class="cart-line-meta">${fmtK(line.unit_price)} × ${line.quantity} ${line.unit_label}</div>
        </div>
        <div class="cart-line-total">${fmtK(line.unit_price * line.quantity)}</div>
        <button class="cart-line-remove" data-idx="${idx}" aria-label="Remove">&times;</button>
      </div>
    `).join("");

    list.querySelectorAll(".cart-line-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.cart.splice(Number(btn.dataset.idx), 1);
        renderCart();
      });
    });
  }

  renderReceipt();
}

function renderReceipt() {
  const subtotal = state.cart.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);
  const taxOn = document.getElementById("tripTaxToggle").checked;
  const tax = taxOn ? subtotal * 0.10 : 0;
  const total = subtotal + tax;

  document.getElementById("receiptSubtotal").textContent = fmtK(subtotal);
  document.getElementById("receiptTax").textContent = fmtK(tax);
  document.getElementById("receiptTotal").textContent = fmtK(total);
  document.getElementById("receiptTaxRow").classList.toggle("hidden", !taxOn);

  const strip = document.getElementById("receiptStrip");
  const warning = document.getElementById("budgetWarning");
  if (state.budgetLimit && total > state.budgetLimit) {
    strip.classList.add("over-budget");
    warning.classList.remove("hidden");
    warning.textContent = `Over budget by ${fmtK(total - state.budgetLimit)}`;
  } else {
    strip.classList.remove("over-budget");
    warning.classList.add("hidden");
  }
}

document.getElementById("tripTaxToggle").addEventListener("change", renderReceipt);

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

document.getElementById("checkoutBtn").addEventListener("click", async () => {
  if (state.cart.length === 0) {
    toast("Add at least one item before checking out.");
    return;
  }

  const taxOn = document.getElementById("tripTaxToggle").checked;
  const payload = {
    shop_id: state.currentShopId,
    budget_limit: state.budgetLimit,
    tax_applied: taxOn,
    tax_rate: 10.0,
    lines: state.cart,
  };

  try {
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Save failed");

    const trip = await res.json();
    const n = trip.pantry_updated || 0;
    toast(`Trip saved! ${n} item${n === 1 ? "" : "s"} added to pantry.`);
    state.cart = [];
    state.budgetLimit = null;
    document.getElementById("budgetInput").value = "";
    document.getElementById("tripTaxToggle").checked = false;
    renderCart();
  } catch (err) {
    toast("Could not save trip. Check your connection.");
  }
});

// ---------------------------------------------------------------------------
// Trip history
// ---------------------------------------------------------------------------

async function loadTripHistory() {
  const res = await fetch("/api/trips?limit=50");
  const trips = await res.json();
  const list = document.getElementById("tripHistoryList");

  if (trips.length === 0) {
    list.innerHTML = `<p class="empty-hint">No trips saved yet.</p>`;
    return;
  }

  list.innerHTML = trips.map((t) => `
    <div class="trip-card" id="trip-${t.id}">
      <div class="trip-card-header">
        <span class="trip-card-shop">${escapeHtml(t.shop_name)}</span>
        <span class="trip-card-date">${t.trip_date}</span>
      </div>
      <div class="trip-card-items">${t.lines.length} item${t.lines.length === 1 ? "" : "s"} — ${t.lines.map(l => escapeHtml(l.item_name)).join(", ")}</div>
      <div class="trip-card-footer">
        <span class="trip-card-total">${fmtK(t.grand_total)}</span>
        <div class="trip-card-actions">
          <button class="link-btn trip-again-btn" data-id="${t.id}">Shop again</button>
          <button class="link-btn trip-print-btn" data-id="${t.id}">Print</button>
          <label class="link-btn trip-receipt-label" title="${t.has_receipt ? "View / replace receipt photo" : "Attach receipt photo"}">
            ${t.has_receipt ? "📷 Receipt" : "Add receipt"}
            <input type="file" accept="image/*" capture="environment" class="trip-receipt-input hidden" data-id="${t.id}">
          </label>
          ${t.has_receipt ? `<a class="link-btn" href="/api/trips/${t.id}/receipt" target="_blank">View</a>` : ""}
          <button class="btn-danger-text trip-delete-btn" data-id="${t.id}">Delete</button>
        </div>
      </div>
    </div>
  `).join("");

  // Shop again — loads trip lines into cart and switches to Shop tab
  list.querySelectorAll(".trip-again-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const trip = trips.find((t) => t.id === Number(btn.dataset.id));
      if (!trip) return;
      state.cart = trip.lines.map((l) => ({
        item_name: l.item_name,
        unit_price: l.unit_price,
        quantity: l.quantity,
        unit_label: l.unit_label,
      }));
      if (trip.shop_id) {
        document.getElementById("shopSelect").value = trip.shop_id;
        state.currentShopId = trip.shop_id;
      }
      renderCart();
      switchTab("shop");
      toast(`${trip.lines.length} items loaded from ${trip.shop_name}.`);
    });
  });

  // Print trip
  list.querySelectorAll(".trip-print-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const trip = trips.find((t) => t.id === Number(btn.dataset.id));
      if (trip) printTrip(trip);
    });
  });

  // Attach receipt photo
  list.querySelectorAll(".trip-receipt-input").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("photo", file);
      const res = await fetch(`/api/trips/${input.dataset.id}/receipt`, { method: "POST", body: formData });
      if (res.ok) {
        toast("Receipt photo saved.");
        loadTripHistory();
      } else {
        toast("Could not save receipt photo.");
      }
    });
  });

  // Delete trip
  list.querySelectorAll(".trip-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this trip?")) return;
      await fetch(`/api/trips/${btn.dataset.id}`, { method: "DELETE" });
      loadTripHistory();
      toast("Trip deleted.");
    });
  });
}

function printTrip(trip) {
  const lines = trip.lines.map((l) =>
    `<tr><td>${escapeHtml(l.item_name)}</td><td>${l.quantity} ${l.unit_label}</td>` +
    `<td style="text-align:right">${fmtK(l.unit_price)}</td>` +
    `<td style="text-align:right">${fmtK(l.line_total)}</td></tr>`
  ).join("");

  const html = `<!DOCTYPE html><html><head><title>Shoply — ${escapeHtml(trip.shop_name)}</title>
<style>
  body{font-family:'Courier New',monospace;padding:24px;max-width:420px;margin:0 auto;}
  h2{font-size:22px;margin:0 0 4px;}
  p{margin:2px 0;font-size:13px;color:#555;}
  table{width:100%;border-collapse:collapse;margin-top:16px;}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #000;padding:4px 6px;}
  td{padding:5px 6px;font-size:13px;border-bottom:1px dashed #ccc;}
  .total-row td{font-weight:bold;font-size:16px;border-top:2px solid #000;border-bottom:none;}
  .tax-row td{font-size:12px;color:#666;}
</style></head><body>
<h2>Shoply</h2>
<p>${escapeHtml(trip.shop_name)}</p>
<p>${trip.trip_date}</p>
<table>
  <thead><tr><th>Item</th><th>Qty</th><th style="text-align:right">Unit price</th><th style="text-align:right">Total</th></tr></thead>
  <tbody>${lines}</tbody>
</table>
${trip.tax_applied ? `<table><tr class="tax-row"><td colspan="3">GST (${trip.tax_rate}%)</td><td style="text-align:right">${fmtK(trip.tax_amount)}</td></tr></table>` : ""}
<table><tr class="total-row"><td colspan="3">TOTAL</td><td style="text-align:right">${fmtK(trip.grand_total)}</td></tr></table>
<script>window.print(); window.close();<\/script>
</body></html>`;

  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

// Price comparison
let compareTimer = null;
document.getElementById("compareSearch").addEventListener("input", (e) => {
  clearTimeout(compareTimer);
  compareTimer = setTimeout(() => doCompare(e.target.value), 250);
});

async function doCompare(query) {
  const container = document.getElementById("compareResults");
  if (!query.trim()) { container.innerHTML = ""; return; }

  const res = await fetch(`/api/compare?q=${encodeURIComponent(query)}`);
  const items = await res.json();

  if (items.length === 0) {
    container.innerHTML = `<p class="empty-hint">No matches found.</p>`;
    return;
  }

  // Cheapest item gets a badge
  const minPrice = Math.min(...items.map((i) => i.unit_price));

  container.innerHTML = items.map((it) => `
    <div class="quick-pick-item compare-row" style="cursor:default;">
      ${it.has_photo
        ? `<img class="quick-pick-thumb" src="/api/items/${it.id}/photo" alt="">`
        : `<div class="quick-pick-thumb-placeholder"></div>`}
      <div style="flex:1;min-width:0;">
        <div class="quick-pick-name">${escapeHtml(it.name)}</div>
        <div class="quick-pick-shop">${escapeHtml(it.shop_name)}${it.shop_location ? " · " + escapeHtml(it.shop_location) : ""}</div>
      </div>
      <span class="quick-pick-price">${fmtK(it.unit_price)} / ${it.unit_label}</span>
      ${it.unit_price === minPrice ? `<span class="cheapest-badge">Cheapest</span>` : ""}
    </div>
  `).join("");
}

// Global item search
let globalSearchTimer = null;
document.getElementById("globalItemSearch").addEventListener("input", (e) => {
  clearTimeout(globalSearchTimer);
  globalSearchTimer = setTimeout(() => doGlobalItemSearch(e.target.value), 200);
});

async function doGlobalItemSearch(query) {
  const results = document.getElementById("globalSearchResults");
  if (!query.trim()) { results.innerHTML = ""; return; }

  const res = await fetch(`/api/items/search?q=${encodeURIComponent(query)}`);
  const items = await res.json();

  if (items.length === 0) {
    results.innerHTML = `<p class="empty-hint">No matches found.</p>`;
    return;
  }

  results.innerHTML = items.map((it) => `
    <div class="quick-pick-item" style="cursor:default;">
      ${it.has_photo
        ? `<img class="quick-pick-thumb" src="/api/items/${it.id}/photo" alt="">`
        : `<div class="quick-pick-thumb-placeholder"></div>`}
      <span class="quick-pick-name">${escapeHtml(it.name)}</span>
      <span class="quick-pick-shop">${escapeHtml(it.shop_name)}</span>
      <span class="quick-pick-price">${fmtK(it.unit_price)}</span>
    </div>
  `).join("");
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

let analyticsLoaded = false;

async function loadAnalytics() {
  const res = await fetch("/api/analytics/spending");
  const data = await res.json();

  document.getElementById("statTotalTrips").textContent = data.total_trips;
  document.getElementById("statTotalSpent").textContent = fmtK(data.total_spent);
  document.getElementById("statAvgTrip").textContent = fmtK(data.avg_trip);

  renderBarChart("chartMonthly", data.by_month, "month", "total");
  renderBarChart("chartByShop", data.by_shop, "shop", "total");
  analyticsLoaded = true;
}

function renderBarChart(containerId, data, labelKey, valueKey) {
  const container = document.getElementById(containerId);
  if (!data || data.length === 0) {
    container.innerHTML = `<p class="empty-hint">No data yet — save some trips first.</p>`;
    return;
  }
  const max = Math.max(...data.map((d) => d[valueKey]));
  container.innerHTML = `<div class="bar-chart">` +
    data.map((d) => {
      const pct = max > 0 ? Math.max(Math.round((d[valueKey] / max) * 100), 2) : 2;
      const label = String(d[labelKey]);
      const shortLabel = label.length > 9 ? label.slice(0, 9) + "…" : label;
      return `<div class="bar-item">
        <div class="bar-val">${fmtK(d[valueKey])}</div>
        <div class="bar-track"><div class="bar-fill" style="height:${pct}%"></div></div>
        <div class="bar-label">${escapeHtml(shortLabel)}</div>
      </div>`;
    }).join("") +
  `</div>`;
}

// ---------------------------------------------------------------------------
// Shopping list
// ---------------------------------------------------------------------------

document.getElementById("addListForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("listItemName").value.trim();
  if (!name) return;

  const payload = {
    name,
    quantity: Number(document.getElementById("listItemQty").value) || 1,
    unit_label: document.getElementById("listItemUnit").value,
    note: document.getElementById("listItemNote").value.trim(),
  };

  const res = await fetch("/api/shopping-list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    e.target.reset();
    document.getElementById("listItemQty").value = 1;
    loadShoppingList();
  } else {
    toast("Could not add item.");
  }
});

document.getElementById("clearCheckedBtn").addEventListener("click", async () => {
  await fetch("/api/shopping-list/clear-checked", { method: "POST" });
  loadShoppingList();
});

async function loadShoppingList() {
  const res = await fetch("/api/shopping-list");
  const items = await res.json();
  const container = document.getElementById("shoppingListItems");

  if (items.length === 0) {
    container.innerHTML = `<p class="empty-hint">Your list is empty. Add items above.</p>`;
    return;
  }

  container.innerHTML = items.map((it) => `
    <div class="list-item ${it.checked ? "list-item-checked" : ""}">
      <label class="list-check-label">
        <input type="checkbox" class="list-checkbox" data-id="${it.id}" ${it.checked ? "checked" : ""}>
      </label>
      <div class="list-item-info">
        <div class="list-item-name">${escapeHtml(it.name)}</div>
        <div class="list-item-meta">${it.quantity} ${it.unit_label}${it.note ? " · " + escapeHtml(it.note) : ""}</div>
      </div>
      <button class="link-btn list-shop-btn" data-id="${it.id}" data-name="${escapeHtml(it.name)}"
              data-qty="${it.quantity}" data-unit="${it.unit_label}" title="Send to shop form">→ Shop</button>
      <button class="btn-danger-text list-delete-btn" data-id="${it.id}">&times;</button>
    </div>
  `).join("");

  // Toggle checked state
  container.querySelectorAll(".list-checkbox").forEach((cb) => {
    cb.addEventListener("change", async () => {
      await fetch(`/api/shopping-list/${cb.dataset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checked: cb.checked }),
      });
      loadShoppingList();
    });
  });

  // Send to shop form
  container.querySelectorAll(".list-shop-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      // Try to find a matching item at the current shop for auto price fill
      let price = "";
      if (state.currentShopId) {
        const r = await fetch(`/api/shops/${state.currentShopId}/items?q=${encodeURIComponent(btn.dataset.name)}`);
        const matches = await r.json();
        const exact = matches.find((m) => m.name.toLowerCase() === btn.dataset.name.toLowerCase());
        if (exact) price = exact.unit_price;
      }

      document.getElementById("itemName").value = btn.dataset.name;
      document.getElementById("itemQty").value = btn.dataset.qty;
      document.getElementById("itemUnit").value = btn.dataset.unit;
      if (price) {
        document.getElementById("itemPrice").value = price;
        updateLinePreview();
        updateUnitPriceHint();
      }
      switchTab("shop");
      document.getElementById(price ? "itemQty" : "itemPrice").focus();
    });
  });

  // Delete from list
  container.querySelectorAll(".list-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/shopping-list/${btn.dataset.id}`, { method: "DELETE" });
      loadShoppingList();
    });
  });
}

// ---------------------------------------------------------------------------
// Pantry
// ---------------------------------------------------------------------------

document.getElementById("addPantryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("pantryName").value.trim();
  if (!name) return;

  const payload = {
    name,
    quantity: Number(document.getElementById("pantryQty").value) || 0,
    unit_label: document.getElementById("pantryUnit").value,
    low_threshold: Number(document.getElementById("pantryThreshold").value) || 1,
    notes: document.getElementById("pantryNotes").value.trim(),
  };

  const res = await fetch("/api/pantry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    e.target.reset();
    document.getElementById("pantryQty").value = 1;
    document.getElementById("pantryThreshold").value = 1;
    loadPantry();
  } else {
    toast("Could not add item.");
  }
});

async function loadPantry() {
  const res = await fetch("/api/pantry");
  const items = await res.json();
  const list = document.getElementById("pantryList");
  const lowCard = document.getElementById("lowStockCard");
  const lowList = document.getElementById("lowStockList");

  const lowItems = items.filter((i) => i.is_low);

  // Low stock alert card
  if (lowItems.length > 0) {
    lowCard.classList.remove("hidden");
    lowList.innerHTML = lowItems.map((i) => `
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-name" style="color:var(--burnt-peach)">${escapeHtml(i.name)}</div>
          <div class="settings-row-meta">${i.quantity} ${i.unit_label} remaining (threshold: ${i.low_threshold})</div>
        </div>
      </div>
    `).join("");
  } else {
    lowCard.classList.add("hidden");
  }

  if (items.length === 0) {
    list.innerHTML = `<p class="empty-hint">No items tracked yet.</p>`;
    return;
  }

  list.innerHTML = items.map((it) => `
    <div class="pantry-row ${it.is_low ? "pantry-row-low" : ""}">
      <div class="pantry-row-info">
        <div class="pantry-row-name">
          ${escapeHtml(it.name)}
          ${it.is_low ? `<span class="low-badge">${it.quantity <= 0 ? "OUT" : "LOW"}</span>` : ""}
        </div>
        <div class="pantry-row-meta">${it.notes ? escapeHtml(it.notes) + " · " : ""}threshold: ${it.low_threshold} ${it.unit_label}</div>
      </div>
      <div class="pantry-qty-ctrl">
        <button class="qty-btn" data-id="${it.id}" data-qty="${it.quantity}" data-unit="${it.unit_label}" data-delta="-1">−</button>
        <span class="qty-display">${it.quantity} ${it.unit_label}</span>
        <button class="qty-btn" data-id="${it.id}" data-qty="${it.quantity}" data-unit="${it.unit_label}" data-delta="1">+</button>
      </div>
      <button class="btn-danger-text pantry-delete-btn" data-id="${it.id}">Delete</button>
    </div>
  `).join("");

  list.querySelectorAll(".qty-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const newQty = Math.max(0, Number(btn.dataset.qty) + Number(btn.dataset.delta));
      await fetch(`/api/pantry/${btn.dataset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: newQty }),
      });
      loadPantry();
    });
  });

  list.querySelectorAll(".pantry-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this item from pantry?")) return;
      await fetch(`/api/pantry/${btn.dataset.id}`, { method: "DELETE" });
      loadPantry();
    });
  });
}

// ---------------------------------------------------------------------------
// Other costs
// ---------------------------------------------------------------------------

document.getElementById("addCostForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    payee: document.getElementById("costPayee").value.trim(),
    amount: Number(document.getElementById("costAmount").value),
    category: document.getElementById("costCategory").value,
    direction: document.getElementById("costDirection").value,
    due_date: document.getElementById("costDueDate").value || null,
    notes: document.getElementById("costNotes").value.trim(),
  };

  if (!payload.payee || isNaN(payload.amount)) {
    toast("Please fill in who/what and the amount.");
    return;
  }

  const res = await fetch("/api/other-costs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    toast("Cost added.");
    e.target.reset();
    loadOtherCosts();
    loadCostsSummary();
  } else {
    toast("Could not add cost.");
  }
});

async function loadOtherCosts() {
  const res = await fetch("/api/other-costs");
  const costs = await res.json();
  const list = document.getElementById("costsList");

  if (costs.length === 0) {
    list.innerHTML = `<p class="empty-hint">No costs logged yet.</p>`;
    return;
  }

  list.innerHTML = costs.map((c) => {
    const isOwedByMe = c.direction === "owed_by_me";
    const isOverdue = c.status === "pending" && c.due_date && c.due_date < today;
    return `
    <div class="cost-card ${isOverdue ? "cost-card-overdue" : ""}">
      <div class="cost-card-info">
        <div class="cost-card-payee">${escapeHtml(c.payee)}${isOverdue ? " <span class='overdue-tag'>OVERDUE</span>" : ""}</div>
        <div class="cost-card-meta">${escapeHtml(c.category)}${c.due_date ? " · due " + c.due_date : ""}</div>
      </div>
      <span class="status-pill ${c.status}">${c.status}</span>
      <span class="cost-card-amount ${isOwedByMe ? "negative" : "positive"}">${fmtK(c.amount)}</span>
      <button class="link-btn" data-id="${c.id}" data-action="toggle">${c.status === "pending" ? "Mark paid" : "Reopen"}</button>
      <button class="btn-danger-text" data-id="${c.id}" data-action="delete">Delete</button>
    </div>
  `;
  }).join("");

  list.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const newStatus = btn.textContent.trim() === "Mark paid" ? "paid" : "pending";
      await fetch(`/api/other-costs/${btn.dataset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      loadOtherCosts();
      loadCostsSummary();
    });
  });

  list.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this cost entry?")) return;
      await fetch(`/api/other-costs/${btn.dataset.id}`, { method: "DELETE" });
      loadOtherCosts();
      loadCostsSummary();
    });
  });
}

async function loadCostsSummary() {
  const res = await fetch("/api/other-costs/summary");
  const data = await res.json();
  document.getElementById("sumOwedByMe").textContent = fmtK(data.owed_by_me_pending);
  document.getElementById("sumOwedToMe").textContent = fmtK(data.owed_to_me_pending);
  document.getElementById("sumPaid").textContent = fmtK(data.paid_total);

  // Overdue badge on Costs tab
  const badge = document.getElementById("overdueBadge");
  if (data.overdue_count > 0) {
    badge.textContent = data.overdue_count;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// Settings: shops
// ---------------------------------------------------------------------------

document.getElementById("addShopForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    name: document.getElementById("shopName").value.trim(),
    location: document.getElementById("shopLocation").value.trim(),
    notes: document.getElementById("shopNotes").value.trim(),
  };
  if (!payload.name) { toast("Shop name is required."); return; }

  const res = await fetch("/api/shops", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    toast("Shop added.");
    e.target.reset();
    await loadShops();
    loadShopsIntoSettings();
  } else {
    const err = await res.json();
    toast(err.error || "Could not add shop.");
  }
});

async function loadShopsIntoSettings() {
  await loadShops();
  const list = document.getElementById("shopsList");

  if (state.shops.length === 0) {
    list.innerHTML = `<p class="empty-hint">No shops added yet.</p>`;
    return;
  }

  list.innerHTML = state.shops.map((s) => `
    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-row-name">${escapeHtml(s.name)}</div>
        <div class="settings-row-meta">${escapeHtml(s.location || "No location set")} · ${s.item_count} item${s.item_count === 1 ? "" : "s"} remembered</div>
      </div>
      <button class="btn-danger-text" data-id="${s.id}">Delete</button>
    </div>
  `).join("");

  list.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this shop and all its remembered items?")) return;
      await fetch(`/api/shops/${btn.dataset.id}`, { method: "DELETE" });
      toast("Shop deleted.");
      loadShopsIntoSettings();
    });
  });
}

// ---------------------------------------------------------------------------
// Settings: categories
// ---------------------------------------------------------------------------

document.getElementById("addCategoryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("categoryName").value.trim();
  if (!name) return;

  const res = await fetch("/api/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  if (res.ok) {
    toast("Category added.");
    e.target.reset();
    await loadCategories();
    loadCategoriesIntoSettings();
  } else {
    const err = await res.json();
    toast(err.error || "Could not add category.");
  }
});

async function loadCategoriesIntoSettings() {
  await loadCategories();
  const list = document.getElementById("categoriesList");

  if (state.categories.length === 0) {
    list.innerHTML = `<p class="empty-hint">No categories yet.</p>`;
    return;
  }

  list.innerHTML = state.categories.map((c) => `
    <div class="settings-row">
      <div class="settings-row-info"><div class="settings-row-name">${escapeHtml(c.name)}</div></div>
      <button class="btn-danger-text" data-id="${c.id}">Delete</button>
    </div>
  `).join("");

  list.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/categories/${btn.dataset.id}`, { method: "DELETE" });
      loadCategoriesIntoSettings();
    });
  });
}

// ---------------------------------------------------------------------------
// Prices tab
// ---------------------------------------------------------------------------

let pricesSearchTimer = null;
const pricesSearchEl = document.getElementById("pricesSearch");
if (pricesSearchEl) {
  pricesSearchEl.addEventListener("input", (e) => {
    clearTimeout(pricesSearchTimer);
    pricesSearchTimer = setTimeout(() => loadPrices(e.target.value), 200);
  });
}

async function loadPrices(query = "") {
  const res = await fetch(`/api/all-items?q=${encodeURIComponent(query)}`);
  const items = await res.json();
  const container = document.getElementById("pricesList");

  if (items.length === 0) {
    container.innerHTML = `<p class="empty-hint">${query ? "No matches found." : "No products saved yet. Items are saved automatically when you shop."}</p>`;
    return;
  }

  container.innerHTML = `<div class="prices-table">
    <div class="prices-header-row">
      <span>Product</span><span>Shop</span><span>Price</span>
    </div>
    ${items.map((it) => `
      <div class="prices-row">
        <div class="prices-row-name">
          ${it.has_photo ? `<img class="quick-pick-thumb" src="/api/items/${it.id}/photo" alt="">` : ""}
          ${escapeHtml(it.name)}
          ${it.category_name ? `<span class="category-chip">${escapeHtml(it.category_name)}</span>` : ""}
        </div>
        <div class="prices-row-shop">${escapeHtml(it.shop_name)}</div>
        <div class="prices-row-price">${fmtK(it.unit_price)} <span class="unit-soft">/ ${it.unit_label}</span></div>
      </div>
    `).join("")}
  </div>`;
}

// ---------------------------------------------------------------------------
// PWA service worker registration
// ---------------------------------------------------------------------------

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// ---------------------------------------------------------------------------
init();

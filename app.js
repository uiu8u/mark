// ============================================================================
// app.js | بقالة البيت – الحزمة الثانية
// الميزات الجديدة: تتبع الطلبات · الكاش المحلي · الباقات · تحسين الصور
// ============================================================================

// ── 1. استيراد Firebase V9 Modular ──────────────────────────────────────────
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";

import {
  initializeFirestore,     // بديل getFirestore – يدعم الكاش
  persistentLocalCache,    // ✅ الكاش المحلي (IndexedDB)
  persistentMultipleTabManager, // ✅ دعم أكثر من تاب مفتوح
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, runTransaction, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

import {
  getAuth, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";


// ── 2. إعداد Firebase ────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyDoO0MMShBazdTmG1CCLEMjGAzeM16-dFI",
  authDomain:        "market-21ede.firebaseapp.com",
  projectId:         "market-21ede",
  storageBucket:     "market-21ede.firebasestorage.app",
  messagingSenderId: "113074265984",
  appId:             "1:113074265984:web:d65051410bd4e551b9eb65"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);

// ✅ initializeFirestore مع الكاش المحلي بدلاً من getFirestore العادية
// يحفظ بيانات المنتجات في IndexedDB فيقلل قراءات Firestore عند إعادة تحميل الصفحة
let db;
try {
  db = initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager() // يعمل في أكثر من تاب دون تعارض
    })
  });
  console.log("🗄️ Offline cache: مفعّل");
} catch {
  // بعض متصفحات الخصوصية لا تدعم IndexedDB – نستمر بدون كاش
  const { getFirestore } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
  db = getFirestore(firebaseApp);
  console.warn("⚠️ Offline cache: متعذّر، يعمل بدون كاش");
}

// ── 3. إعدادات التيليجرام ────────────────────────────────────────────────────
// ⚠️ chat_id بقي هنا لأنه ليس سراً (لا يمنح صلاحية إرسال رسائل)
// أما BOT_TOKEN فقد نُقل إلى Vercel → api/telegram.js كمتغير بيئة
const TELEGRAM_CHAT_ID = "830390292";


// ── 4. الحالة العامة (State) ──────────────────────────────────────────────────
let products    = [];   // منتجات Firestore (real-time)
let bundles     = [];   // باقات Firestore (real-time)
let cart        = JSON.parse(localStorage.getItem("grocery_cart") || "[]");
let lastOrderId = null; // آخر رقم طلب (لعرضه في نافذة النجاح)


// ── 5. مساعد تحسين الصور (images.weserv.nl) ─────────────────────────────────
/**
 * يُحوِّل رابط صورة عادياً إلى رابط محسَّن يمر عبر خدمة weserv.nl المجانية.
 * المميزات: تصغير الحجم · تحويل إلى WebP · ضغط ذكي · كروب تلقائي
 * @param {string} url    - رابط الصورة الأصلي
 * @param {number} width  - العرض المطلوب بالبكسل (افتراضي 300)
 */
function optimizeImage(url, width = 300) {
  if (!url) return `https://placehold.co/${width}x${width}/e2e8f0/94a3b8?text=%D8%A8%D9%82%D8%A7%D9%84%D8%A9`;
  if (url.startsWith("data:") || url.includes("weserv.nl") || url.includes("placeholder.com"))
    return url;
  try {
    return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=${width}&h=${width}&fit=cover&output=webp&q=82`;
  } catch {
    return url;
  }
}

/** يولّد رقم طلب فريداً بصيغة ORD-XXXXX-YYYY */
function generateOrderId() {
  const ts   = Date.now().toString(36).toUpperCase().slice(-5);
  const rand = Math.random().toString(36).substr(2, 4).toUpperCase();
  return `ORD-${ts}-${rand}`;
}


// ============================================================================
// 6. إدارة السلة (Cart)
// ============================================================================

window.openCart = () => {
  document.getElementById("cartModal").classList.remove("hidden");
  renderCart();
};

window.closeCart = () => {
  document.getElementById("cartModal").classList.add("hidden");
};

window.addToCart = (productId) => {
  const product = products.find(p => p.id === productId);
  if (!product || product.quantity <= 0) {
    showToast("المنتج غير متوفر حالياً!", "error"); return;
  }
  const existing = cart.find(i => i.id === productId);
  if (existing) {
    if (existing.cartQuantity >= product.quantity) {
      showToast("وصلت للحد الأقصى للكمية المتاحة!", "error"); return;
    }
    existing.cartQuantity++;
  } else {
    cart.push({ ...product, cartQuantity: 1 });
  }
  saveCart(); updateCartUI();
  showToast("تمت الإضافة للسلة 🛒", "success");
};

window.updateCartItemQuantity = (productId, change) => {
  const idx = cart.findIndex(i => i.id === productId);
  if (idx < 0) return;
  const product  = products.find(p => p.id === productId);
  const newQty   = cart[idx].cartQuantity + change;
  if (newQty <= 0) {
    cart.splice(idx, 1);
  } else if (product && newQty > product.quantity) {
    showToast("لا توجد كمية إضافية!", "error"); return;
  } else {
    cart[idx].cartQuantity = newQty;
  }
  saveCart(); updateCartUI(); renderCart();
};

// إزالة عنصر خصم الباقة
window.removeDiscount = (discountId) => {
  cart = cart.filter(i => i.id !== discountId);
  saveCart(); updateCartUI(); renderCart();
};

function saveCart() {
  localStorage.setItem("grocery_cart", JSON.stringify(cart));
}

function updateCartUI() {
  const badge     = document.getElementById("cartCount");
  const totalReal = cart.filter(i => !i.isDiscount).reduce((s, i) => s + i.cartQuantity, 0);
  if (totalReal > 0) {
    badge.textContent = totalReal;
    badge.classList.remove("hidden"); badge.classList.add("flex");
  } else {
    badge.classList.add("hidden"); badge.classList.remove("flex");
  }
}

function renderCart() {
  const container  = document.getElementById("cartItems");
  const totalEl    = document.getElementById("cartTotal");
  const checkoutEl = document.getElementById("checkoutBtn");
  let total = 0;
  container.innerHTML = "";

  const realItems = cart.filter(i => !i.isDiscount);
  if (realItems.length === 0) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full text-gray-400 gap-2 py-12">
        <i class="fas fa-shopping-basket text-5xl mb-2"></i>
        <p class="font-semibold">سلتك فارغة</p>
        <p class="text-xs">أضف منتجات أو باقة ترويجية</p>
      </div>`;
    checkoutEl.disabled = true;
  } else {
    checkoutEl.disabled = false;
  }

  cart.forEach(item => {
    const lineTotal = item.price * item.cartQuantity;
    total += lineTotal;

    if (item.isDiscount) {
      // ── عنصر الخصم (لون مختلف) ──
      container.innerHTML += `
        <div class="cart-discount-item flex items-center gap-2 mb-2">
          <div class="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
            <i class="fas fa-tag text-green-600"></i>
          </div>
          <div class="flex-1">
            <p class="font-bold text-green-700 text-xs">${item.name}</p>
            <p class="text-green-600 font-bold text-sm">${lineTotal.toFixed(2)} ريال</p>
          </div>
          <button onclick="removeDiscount('${item.id}')"
            class="w-7 h-7 rounded-lg bg-white border text-gray-400 hover:text-red-500 flex items-center justify-center">
            <i class="fas fa-times text-xs"></i>
          </button>
        </div>`;
    } else {
      // ── عنصر عادي ──
      container.innerHTML += `
        <div class="flex items-center gap-3 p-3 border-b border-gray-100 last:border-0">
          <img src="${optimizeImage(item.image, 64)}"
               class="w-14 h-14 object-cover rounded-xl border border-gray-100 flex-shrink-0"
               loading="lazy"
               onerror="this.src='https://placehold.co/64x64/e2e8f0/94a3b8?text=...'">
          <div class="flex-1 min-w-0">
            <h4 class="font-bold text-gray-800 text-sm truncate">${item.name}</h4>
            <p class="text-brand-600 font-bold text-xs mt-0.5">${item.price} ريال × ${item.cartQuantity}</p>
            <p class="text-gray-400 text-xs">${lineTotal.toFixed(2)} ريال</p>
          </div>
          <div class="flex items-center gap-1.5 bg-gray-50 p-1 rounded-lg border border-gray-200">
            <button onclick="updateCartItemQuantity('${item.id}', 1)"
              class="w-7 h-7 bg-white rounded shadow-sm text-gray-600 hover:text-brand-600 flex items-center justify-center">
              <i class="fas fa-plus text-xs"></i>
            </button>
            <span class="w-5 text-center font-bold text-sm">${item.cartQuantity}</span>
            <button onclick="updateCartItemQuantity('${item.id}', -1)"
              class="w-7 h-7 bg-white rounded shadow-sm text-gray-600 hover:text-red-500 flex items-center justify-center">
              <i class="fas fa-minus text-xs"></i>
            </button>
          </div>
        </div>`;
    }
  });

  totalEl.textContent = `${total.toFixed(2)} ريال`;
}


// ============================================================================
// 7. تقديم الطلب (Checkout)
// ============================================================================

window.openOrderModal = () => {
  closeCart();
  document.getElementById("orderModal").classList.remove("hidden");
  document.getElementById("orderModal").classList.add("flex");
};
window.closeOrderModal = () => {
  document.getElementById("orderModal").classList.add("hidden");
  document.getElementById("orderModal").classList.remove("flex");
};
window.closeSuccessModal = () => {
  document.getElementById("successModal").classList.add("hidden");
  document.getElementById("successModal").classList.remove("flex");
};

window.submitOrder = async () => {
  const name  = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("customerPhone").value.trim();
  const notes = document.getElementById("customerNotes").value.trim();
  const btn   = document.getElementById("submitOrderBtn");

  if (!name || !phone) { showToast("يرجى إدخال الاسم ورقم الهاتف", "error"); return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';

  // المنتجات الفعلية فقط (نستبعد عناصر الخصم)
  const realCartItems = cart.filter(i => !i.isDiscount);

  try {
    // ── الخطوة 1: خصم الكميات بأمان (Firebase Transaction) ─────────────
    await runTransaction(db, async (txn) => {
      const snaps = await Promise.all(
        realCartItems.map(item => txn.get(doc(db, "products", item.id)))
      );
      snaps.forEach((snap, idx) => {
        if (!snap.exists()) throw new Error(`المنتج "${realCartItems[idx].name}" غير موجود`);
        const newQty = snap.data().quantity - realCartItems[idx].cartQuantity;
        if (newQty < 0) throw new Error(`الكمية غير كافية لـ"${snap.data().name}"`);
        txn.update(snap.ref, { quantity: newQty });
      });
    });

    // ── الخطوة 2: توليد رقم الطلب وحفظه في Firestore ───────────────────
    const orderId   = generateOrderId();
    lastOrderId     = orderId;
    let total = cart.reduce((s, i) => s + i.price * i.cartQuantity, 0);

    const expireAt  = new Date();
    expireAt.setDate(expireAt.getDate() + 30); // TTL: 30 يوماً

    await addDoc(collection(db, "orders"), {
      orderId,
      customerName: name,
      phone,
      notes:        notes || "",
      // ✅ نحفظ id المنتج وليس فقط الاسم — يسمح للخادم الوسيط (api/telegram.js)
      // بإرجاع الكمية بدقة عند الإلغاء حتى لو غيّر الأدمن اسم المنتج لاحقاً
      items:        realCartItems.map(i => ({ id: i.id, name: i.name, qty: i.cartQuantity, price: i.price })),
      totalAmount:  total,
      status:       "قيد المراجعة",
      createdAt:    new Date(),
      expireAt
    });

    // ── الخطوة 3: إرسال إشعار تيليجرام عبر الـ Proxy ───────────────────
    const itemLines = cart.map(i =>
      i.isDiscount
        ? `🏷️ ${i.name}: ${(i.price * i.cartQuantity).toFixed(2)} ريال`
        : `🔸 ${i.name} (${i.cartQuantity}) — ${(i.price * i.cartQuantity).toFixed(2)} ريال`
    ).join("\n");

    const message = `🛍️ *طلب جديد من بقالة البيت*
━━━━━━━━━━━━━━━
👤 *الاسم:* ${name}
📱 *الهاتف:* ${phone}
🔖 *رقم الطلب:* \`${orderId}\`
📝 *ملاحظات:* ${notes || "لا يوجد"}
━━━━━━━━━━━━━━━
*المنتجات:*
${itemLines}
━━━━━━━━━━━━━━━
💰 *الإجمالي: ${total.toFixed(2)} ريال*`;

    const res = await fetch("/api/telegram", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "Markdown" })
    });
    if (!res.ok) throw new Error("فشل إرسال الإشعار");

    // ── الخطوة 4: حفظ مرجع الطلب محلياً وتحديث الواجهة ────────────────
    saveOrderLocally(orderId, total, realCartItems.map(i => i.name));

    // عرض رقم الطلب في نافذة النجاح
    const orderIdEl = document.getElementById("successOrderId");
    if (orderIdEl) orderIdEl.textContent = `رقم طلبك: ${orderId}`;

    closeOrderModal();
    document.getElementById("successModal").classList.remove("hidden");
    document.getElementById("successModal").classList.add("flex");

    // مسح السلة
    cart = [];
    saveCart();
    updateCartUI();

    // مسح حقول الطلب
    ["customerName", "customerPhone", "customerNotes"].forEach(id => {
      document.getElementById(id).value = "";
    });

  } catch (err) {
    console.error("Order error:", err);
    showToast(err.message || "حدث خطأ أثناء معالجة الطلب", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fab fa-telegram text-lg"></i> إرسال الطلب';
  }
};


// ============================================================================
// 8. تتبع الطلبات (Order Tracking)
// ============================================================================

/** يحفظ مرجع الطلب في localStorage ليتمكن الزبون من تتبعه لاحقاً */
function saveOrderLocally(orderId, total, itemNames) {
  const orders = JSON.parse(localStorage.getItem("my_orders") || "[]");
  orders.unshift({
    orderId,
    timestamp: Date.now(),               // ◄ جديد — أساس فصل 12 ساعة
    date: new Date().toLocaleString("ar-SA", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit"
    }),
    total,
    items: itemNames.slice(0, 3)
  });
  localStorage.setItem("my_orders", JSON.stringify(orders.slice(0, 20)));
  updateOrderBadge();
}

/** يحدّث شارة عدد الطلبات في الهيدر */
function updateOrderBadge() {
  const orders = JSON.parse(localStorage.getItem("my_orders") || "[]");
  const badge  = document.getElementById("orderBadge");
  if (!badge) return;
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
  const cutoff = Date.now() - TWELVE_HOURS_MS;
  const currentOrdersCount = orders.filter(o => (o.timestamp || 0) >= cutoff).length;

  if (currentOrdersCount > 0) {
    badge.textContent = currentOrdersCount;
    badge.classList.remove("hidden");
    badge.classList.add("flex");
  } else {
    badge.classList.add("hidden");
    badge.classList.remove("flex");
  }
}

window.openOrderTracking = () => {
  historyLoaded = false;
  renderMyOrders();
  window.showOrdersTab("current");
  const modal = document.getElementById("orderTrackingModal");
  modal.classList.remove("hidden"); modal.classList.add("flex");
};
window.closeOrderTracking = () => {
  const modal = document.getElementById("orderTrackingModal");
  modal.classList.add("hidden"); modal.classList.remove("flex");
};

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
let historyLoaded = false;

function getOrderBuckets() {
  const orders = JSON.parse(localStorage.getItem("my_orders") || "[]");
  const cutoff = Date.now() - TWELVE_HOURS_MS;
  return {
    current: orders.filter(o => (o.timestamp || 0) >= cutoff),
    history: orders.filter(o => (o.timestamp || 0) < cutoff)
  };
}

/** جلب جماعي من Firestore بفلتر زمني — لا يُستدعى إلا عند الحاجة */
async function fetchOrdersStatusBatch(orders, { after = null, before = null } = {}) {
  if (orders.length === 0) return {};
  const ids = orders.map(o => o.orderId).slice(0, 30); // حد "in" في Firestore
  const constraints = [where("orderId", "in", ids)];
  if (after)  constraints.push(where("createdAt", ">=", after));
  if (before) constraints.push(where("createdAt", "<",  before));

  const statusMap = {};
  try {
    const snap = await getDocs(query(collection(db, "orders"), ...constraints));
    snap.forEach(d => { statusMap[d.data().orderId] = d.data().status; });
  } catch (err) {
    console.warn("Batch status fetch error (قد يحتاج composite index، رابط الإنشاء يظهر في الـ console):", err);
  }
  return statusMap;
}

function orderCardHTML(o, status) {
  const cls = {
    "قيد المراجعة": "status-pending", "تم التأكيد": "status-confirm",
    "قيد التجهيز": "status-prep", "في الطريق": "status-transit",
    "تم التسليم": "status-done", "ملغي": "status-cancel"
  }[status] || "status-pending";
  const statusInner = status
    ? `<span class="status-badge ${cls}">${status}</span>`
    : `<span class="text-xs text-gray-400">اضغط للتحقق من الحالة</span>`;

  return `
    <div class="p-4 border border-gray-100 rounded-xl bg-gray-50 hover:bg-white transition">
      <div class="flex justify-between items-start mb-2">
        <div>
          <p class="font-bold text-gray-800 text-sm">${o.orderId}</p>
          <p class="text-gray-400 text-xs mt-0.5">${o.date}</p>
        </div>
        <p class="font-bold text-brand-600 text-sm">${o.total.toFixed(2)} ريال</p>
      </div>
      <p class="text-gray-400 text-xs mb-3">${o.items.join(" · ")}${o.items.length < 3 ? "" : "…"}</p>
      <div class="flex items-center justify-between">
        <span id="status-${o.orderId}">${statusInner}</span>
        <button onclick="checkOrderStatus('${o.orderId}')"
          class="text-xs bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 transition flex items-center gap-1">
          <i class="fas fa-sync-alt"></i> تحديث
        </button>
      </div>
    </div>`;
}

function renderOrdersList(containerId, orders, statusMap) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (orders.length === 0) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
        <i class="fas fa-box-open text-5xl"></i>
        <p class="font-semibold mt-2">لا توجد طلبات</p>
      </div>`;
    return;
  }
  container.innerHTML = orders.map(o => orderCardHTML(o, statusMap[o.orderId])).join("");
}

/** التحميل الافتراضي: الطلبات الحالية فقط (آخر 12 ساعة) */
async function renderMyOrders() {
  const { current } = getOrderBuckets();
  renderOrdersList("currentOrdersList", current, {});
  const cutoff = new Date(Date.now() - TWELVE_HOURS_MS);
  const statusMap = await fetchOrdersStatusBatch(current, { after: cutoff });
  renderOrdersList("currentOrdersList", current, statusMap);
}

/** Lazy load — لا تُجلب بيانات السجل القديم من Firestore إلا هنا */
window.showOrdersTab = async (tab) => {
  const currentBtn = document.getElementById("tabCurrentBtn");
  const historyBtn = document.getElementById("tabHistoryBtn");
  const currentList = document.getElementById("currentOrdersList");
  const historyList = document.getElementById("historyOrdersList");

  if (tab === "current") {
    currentBtn.classList.add("order-tab-active"); historyBtn.classList.remove("order-tab-active");
    currentList.classList.remove("hidden"); historyList.classList.add("hidden");
    return;
  }

  currentBtn.classList.remove("order-tab-active"); historyBtn.classList.add("order-tab-active");
  currentList.classList.add("hidden"); historyList.classList.remove("hidden");

  if (!historyLoaded) {
    historyLoaded = true;
    const { history } = getOrderBuckets();
    renderOrdersList("historyOrdersList", history, {});
    const cutoff = new Date(Date.now() - TWELVE_HOURS_MS);
    const statusMap = await fetchOrdersStatusBatch(history, { before: cutoff });
    renderOrdersList("historyOrdersList", history, statusMap);
  }
};

/** يستعلم عن حالة طلب واحد من Firestore (Single Read) */
window.checkOrderStatus = async (orderId) => {
  const el = document.getElementById(`status-${orderId}`);
  if (!el) return;
  el.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جارٍ التحقق…';
  try {
    const q    = query(collection(db, "orders"), where("orderId", "==", orderId));
    const snap = await getDocs(q);
    if (snap.empty) {
      el.innerHTML = '<span class="text-red-400 text-xs">لم يُعثر على الطلب</span>';
      return;
    }
    const status = snap.docs[0].data().status || "غير معروف";
    const cls = {
      "قيد المراجعة": "status-pending",
      "تم التأكيد":   "status-confirm",
      "قيد التجهيز":  "status-prep",
      "في الطريق":    "status-transit",
      "تم التسليم":   "status-done",
      "ملغي":         "status-cancel"
    }[status] || "status-pending";
    el.innerHTML = `<span class="status-badge ${cls}">${status}</span>`;
  } catch {
    el.innerHTML = '<span class="text-red-400 text-xs">خطأ في التحقق</span>';
  }
};


// ============================================================================
// 9. عرض المنتجات (Products Display)
// ============================================================================

function renderProducts() {
  const grid    = document.getElementById("productsGrid");
  const loading = document.getElementById("loadingState");
  const empty   = document.getElementById("emptyState");
  loading.classList.add("hidden");

  if (products.length === 0) {
    empty.classList.remove("hidden"); empty.classList.add("flex");
    grid.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden"); empty.classList.remove("flex");
  grid.classList.remove("hidden");

  grid.innerHTML = products.map(product => {
    const oos   = product.quantity <= 0;
    const low   = product.quantity > 0 && product.quantity <= 5;
    const imgSrc = optimizeImage(product.image, 300); // ✅ تحسين الصورة

    return `
    <div class="product-card-wrapper bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden
                flex flex-col hover:shadow-md transition ${oos ? "opacity-65" : ""}">
      <div class="relative w-full h-32 bg-gray-50 overflow-hidden">
        <img src="${imgSrc}" alt="${product.name}"
             class="product-img w-full h-full object-cover"
             loading="lazy"
             onload="this.classList.add('loaded')"
             onerror="this.src='https://placehold.co/300x200/e2e8f0/94a3b8?text=No+Image'">
        ${oos ? `<div class="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <span class="bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full">نفذت الكمية</span>
        </div>` : ""}
        ${low ? `<div class="absolute top-2 right-2">
          <span class="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">آخر ${product.quantity}</span>
        </div>` : ""}
      </div>
      <div class="p-3 flex flex-col flex-1">
        <h3 class="font-bold text-gray-800 text-sm leading-tight mb-1 line-clamp-2">${product.name}</h3>
        <div class="flex justify-between items-end mt-auto pt-2">
          <div>
            <p class="text-brand-600 font-extrabold text-base leading-none">${product.price}
              <span class="text-xs font-normal text-gray-400">ريال</span>
            </p>
            <p class="text-gray-400 text-[10px] mt-0.5">المتاح: ${product.quantity}</p>
          </div>
          <button onclick="addToCart('${product.id}')" ${oos ? "disabled" : ""}
            class="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 hover:bg-brand-600 hover:text-white
                   transition flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed">
            <i class="fas fa-cart-plus text-sm"></i>
          </button>
        </div>
      </div>
    </div>`;
  }).join("");
}

// Real-time listener للمنتجات
onSnapshot(collection(db, "products"), snap => {
  products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderProducts();
  // تحديث لوحة المدير إذا كانت مفتوحة
  if (!document.getElementById("adminPanel").classList.contains("hidden"))
    renderAdminProducts();
}, err => {
  console.error("Firebase:", err);
  document.getElementById("loadingState").classList.add("hidden");
  const errState = document.getElementById("errorState");
  errState.classList.remove("hidden"); errState.classList.add("flex");
});

window.retryConnection = () => location.reload();


// ============================================================================
// 10. الباقات الترويجية (Bundles)
// ============================================================================

// Real-time listener للباقات
onSnapshot(collection(db, "bundles"), snap => {
  bundles = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(b => b.isActive !== false); // نعرض النشطة فقط (فلترة على الجهاز)
  renderBundles();
  if (!document.getElementById("adminPanel").classList.contains("hidden"))
    renderAdminBundles();
}, err => console.warn("Bundles listener error:", err));

/** يعرض الباقات في قسم الباقات الترويجية */
function renderBundles() {
  const section = document.getElementById("bundlesSection");
  const grid    = document.getElementById("bundlesGrid");
  if (!section || !grid) return;

  if (bundles.length === 0) {
    section.classList.add("hidden"); return;
  }
  section.classList.remove("hidden");

  grid.innerHTML = bundles.map(b => {
    const saving   = b.originalPrice && b.bundlePrice ? (b.originalPrice - b.bundlePrice).toFixed(2) : null;
    const imgSrc   = optimizeImage(b.image, 280);
    const itemNames = (b.productIds || [])
      .map(id => products.find(p => p.id === id)?.name)
      .filter(Boolean).join(" + ") || "متعدد المنتجات";

    return `
    <div class="bundle-card bg-white rounded-2xl shadow-md border-2 border-amber-100 overflow-hidden">
      <div class="relative">
        <img src="${imgSrc}" alt="${b.name}"
             class="w-full h-32 object-cover"
             loading="lazy"
             onerror="this.src='https://placehold.co/280x128/fef3c7/b45309?text=Bundle'">
        ${saving ? `<div class="absolute top-2 right-2">
          <span class="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
            وفّر ${saving} ريال
          </span>
        </div>` : ""}
      </div>
      <div class="p-3">
        <h3 class="font-bold text-gray-800 text-sm mb-0.5">${b.name}</h3>
        <p class="text-gray-400 text-xs mb-2 line-clamp-1" title="${itemNames}">${itemNames}</p>
        <div class="flex items-baseline gap-1.5 mb-3">
          ${b.originalPrice ? `<span class="text-gray-300 line-through text-xs">${b.originalPrice}</span>` : ""}
          <span class="text-brand-600 font-extrabold text-lg">${b.bundlePrice}</span>
          <span class="text-gray-400 text-xs">ريال</span>
        </div>
        <button onclick="addBundleToCart('${b.id}')"
          class="w-full bg-amber-500 text-white py-1.5 rounded-xl font-bold text-xs
                 hover:bg-amber-600 active:scale-95 transition flex items-center justify-center gap-1">
          <i class="fas fa-tags"></i> أضف الباقة للسلة
        </button>
      </div>
    </div>`;
  }).join("");
}

/** يضيف جميع منتجات الباقة إلى السلة + عنصر خصم */
window.addBundleToCart = (bundleId) => {
  const bundle = bundles.find(b => b.id === bundleId);
  if (!bundle) return;

  // ✅ منع إضافة نفس الباقة مرتين: تكرار الإضافة كان يضاعف كميات المنتجات
  // بينما يبقى الخصم محسوباً مرة واحدة فقط (تكلفة أعلى للزبون بلا تفسير واضح بالسلة)
  if (cart.find(i => i.id === `discount-${bundleId}`)) {
    showToast("الباقة موجودة بالفعل في سلتك", "error"); return;
  }

  const bundleProducts = (bundle.productIds || [])
    .map(id => products.find(p => p.id === id))
    .filter(Boolean);

  if (bundleProducts.length === 0) {
    showToast("منتجات هذه الباقة غير متاحة حالياً", "error"); return;
  }

  let added = 0;
  bundleProducts.forEach(p => {
    if (p.quantity <= 0) return;
    const existing = cart.find(i => i.id === p.id);
    if (existing) {
      if (existing.cartQuantity < p.quantity) { existing.cartQuantity++; added++; }
    } else {
      cart.push({ ...p, cartQuantity: 1 }); added++;
    }
  });

  // عنصر خصم إذا كان هناك فرق بين السعر الأصلي وسعر الباقة
  if (bundle.originalPrice > bundle.bundlePrice) {
    const discount   = bundle.bundlePrice - bundle.originalPrice; // قيمة سالبة
    const discountId = `discount-${bundleId}`;
    if (!cart.find(i => i.id === discountId)) {
      cart.push({ id: discountId, name: `🎁 خصم باقة: ${bundle.name}`,
                  price: discount, cartQuantity: 1, isDiscount: true, image: null });
    }
  }

  saveCart(); updateCartUI();
  if (added > 0) showToast(`✅ أُضيف ${added} منتج من "${bundle.name}" للسلة`, "success");
  else showToast("لا تتوفر كميات كافية لمنتجات هذه الباقة", "error");
};


// ============================================================================
// 11. لوحة المدير (Admin Panel)
// ============================================================================

let adminClickCount = 0, adminClickTimer;

window.handleAdminTriggerClick = () => {
  adminClickCount++;
  if (adminClickCount === 1)
    adminClickTimer = setTimeout(() => { adminClickCount = 0; }, 3000);
  if (adminClickCount >= 5) {
    clearTimeout(adminClickTimer); adminClickCount = 0;
    document.getElementById("adminLoginModal").classList.remove("hidden");
    document.getElementById("adminLoginModal").classList.add("flex");
    setTimeout(() => document.getElementById("adminPasswordInput").focus(), 100);
  }
};

window.closeAdminLogin = () => {
  document.getElementById("adminLoginModal").classList.add("hidden");
  document.getElementById("adminLoginModal").classList.remove("flex");
  document.getElementById("adminPasswordInput").value = "";
  document.getElementById("adminLoginError").classList.add("hidden");
};

window.adminLogin = async () => {
  const pass = document.getElementById("adminPasswordInput").value;
  const errEl = document.getElementById("adminLoginError");
  try {
    await signInWithEmailAndPassword(auth, "add@mark.com", pass);
    closeAdminLogin();
    document.getElementById("adminPanel").classList.remove("hidden");
    document.getElementById("adminPanel").classList.add("block");
    renderAdminProducts();
    renderAdminBundles();
    showToast("مرحباً في لوحة الإدارة 👋", "success");
  } catch {
    errEl.classList.remove("hidden");
    document.getElementById("adminPasswordInput").value = "";
    document.getElementById("adminPasswordInput").focus();
  }
};

window.adminLogout = async () => {
  await signOut(auth);
  window.closeAdminPanel();
  showToast("تم تسجيل الخروج", "success");
};

window.closeAdminPanel = () => {
  document.getElementById("adminPanel").classList.add("hidden");
  document.getElementById("adminPanel").classList.remove("block");
};


// ── CRUD المنتجات ────────────────────────────────────────────────────────────

window.addProduct = async () => {
  const name = document.getElementById("adminProductName").value.trim();
  const price    = parseFloat(document.getElementById("adminProductPrice").value);
  const quantity = parseInt(document.getElementById("adminProductQuantity").value);
  const image    = document.getElementById("adminProductImage").value.trim();
  const btn      = document.getElementById("addProductBtn");

  if (!name || isNaN(price) || isNaN(quantity)) {
    showToast("يرجى ملء الحقول الإجبارية", "error"); return;
  }
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin ml-1"></i> جاري الإضافة...';
  try {
    await addDoc(collection(db, "products"), { name, price, quantity, image });
    showToast("تمت إضافة المنتج بنجاح ✅", "success");
    window.clearAdminForm();
  } catch { showToast("خطأ في إضافة المنتج", "error"); }
  finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-plus-circle ml-1"></i> إضافة المنتج';
  }
};

window.clearAdminForm = () => {
  ["adminProductName","adminProductPrice","adminProductQuantity","adminProductImage"]
    .forEach(id => document.getElementById(id).value = "");
};

window.deleteProduct = async (id) => {
  if (!confirm("حذف هذا المنتج نهائياً؟")) return;
  try {
    await deleteDoc(doc(db, "products", id));
    showToast("تم حذف المنتج", "success");
  } catch { showToast("خطأ أثناء الحذف", "error"); }
};

window.openEditModal = (id) => {
  const p = products.find(x => x.id === id);
  if (!p) return;
  document.getElementById("editProductId").value    = id;
  document.getElementById("editProductName").value  = p.name;
  document.getElementById("editProductPrice").value = p.price;
  document.getElementById("editProductQuantity").value = p.quantity;
  document.getElementById("editProductImage").value = p.image || "";
  document.getElementById("editModal").classList.remove("hidden");
  document.getElementById("editModal").classList.add("flex");
};
window.closeEditModal = () => {
  document.getElementById("editModal").classList.add("hidden");
  document.getElementById("editModal").classList.remove("flex");
};
window.saveEditProduct = async () => {
  const id   = document.getElementById("editProductId").value;
  const name     = document.getElementById("editProductName").value.trim();
  const price    = parseFloat(document.getElementById("editProductPrice").value);
  const quantity = parseInt(document.getElementById("editProductQuantity").value);
  const image    = document.getElementById("editProductImage").value.trim();
  if (!name || isNaN(price) || isNaN(quantity)) {
    showToast("تأكد من صحة البيانات", "error"); return;
  }
  try {
    await updateDoc(doc(db, "products", id), { name, price, quantity, image });
    showToast("تم تحديث المنتج ✅", "success");
    closeEditModal();
  } catch { showToast("خطأ في التحديث", "error"); }
};

function renderAdminProducts() {
  const list = document.getElementById("adminProductsList");
  document.getElementById("adminProductCount").textContent =
    `${products.length} منتج`;
  list.innerHTML = products.map(p => `
    <div class="flex items-center justify-between p-3 border border-gray-100 rounded-xl bg-gray-50 hover:bg-white transition">
      <div class="flex items-center gap-3 min-w-0">
        <img src="${optimizeImage(p.image, 48)}" alt="${p.name}"
             class="w-12 h-12 rounded-lg object-cover border border-gray-200 flex-shrink-0"
             loading="lazy" onerror="this.src='https://placehold.co/48x48/e2e8f0/94a3b8?text=...'">
        <div class="min-w-0">
          <h4 class="font-bold text-gray-800 text-sm truncate">${p.name}</h4>
          <p class="text-xs text-gray-500 mt-0.5">
            ${p.price} ريال |
            <span class="${p.quantity === 0 ? 'text-red-500 font-bold' : ''}">
              ${p.quantity} متاح
            </span>
          </p>
        </div>
      </div>
      <div class="flex gap-2 flex-shrink-0">
        <button onclick="openEditModal('${p.id}')"
          class="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition flex items-center justify-center">
          <i class="fas fa-edit text-xs"></i>
        </button>
        <button onclick="deleteProduct('${p.id}')"
          class="w-8 h-8 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition flex items-center justify-center">
          <i class="fas fa-trash text-xs"></i>
        </button>
      </div>
    </div>`).join("");

  // تحديث قوائم المنتجات في نماذج الباقات
  populateBundleProductSelect("bundleProducts");
}


// ── CRUD الباقات ─────────────────────────────────────────────────────────────

/** يملأ قائمة المنتجات في نموذج الباقة */
function populateBundleProductSelect(selectId, selectedIds = []) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = products.map(p =>
    `<option value="${p.id}" ${selectedIds.includes(p.id) ? "selected" : ""}>
       ${p.name} (${p.quantity} متاح)
     </option>`
  ).join("");
}

window.addBundle = async () => {
  const name      = document.getElementById("bundleName").value.trim();
  const image     = document.getElementById("bundleImage").value.trim();
  const origPrice = parseFloat(document.getElementById("bundleOriginalPrice").value) || null;
  const bundlePrice = parseFloat(document.getElementById("bundlePrice").value);
  const sel       = document.getElementById("bundleProducts");
  const productIds = Array.from(sel.selectedOptions).map(o => o.value);
  const btn        = document.getElementById("addBundleBtn");

  if (!name || isNaN(bundlePrice) || productIds.length === 0) {
    showToast("اسم الباقة وسعرها والمنتجات إجبارية", "error"); return;
  }
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin ml-1"></i> جاري الإضافة...';
  try {
    await addDoc(collection(db, "bundles"), {
      name, image, originalPrice: origPrice, bundlePrice, productIds, isActive: true
    });
    showToast("تمت إضافة الباقة ✅", "success");
    // مسح النموذج
    ["bundleName","bundleImage","bundleOriginalPrice","bundlePrice"]
      .forEach(id => document.getElementById(id).value = "");
    sel.selectedIndex = -1;
  } catch { showToast("خطأ في إضافة الباقة", "error"); }
  finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-plus-circle ml-1"></i> إضافة الباقة';
  }
};

window.deleteBundle = async (id) => {
  if (!confirm("حذف هذه الباقة نهائياً؟")) return;
  try {
    await deleteDoc(doc(db, "bundles", id));
    showToast("تم حذف الباقة", "success");
  } catch { showToast("خطأ أثناء الحذف", "error"); }
};

window.toggleBundleActive = async (id, currentVal) => {
  try {
    await updateDoc(doc(db, "bundles", id), { isActive: !currentVal });
  } catch { showToast("خطأ في تحديث الباقة", "error"); }
};

window.openEditBundleModal = (id) => {
  const b = bundles.find(x => x.id === id) ||
    // الباقات المخفية لن تكون في bundles[] – نبحث عن بديل
    JSON.parse(localStorage.getItem("_all_bundles") || "[]").find(x => x.id === id);
  if (!b) return;
  document.getElementById("editBundleId").value       = id;
  document.getElementById("editBundleName").value     = b.name;
  document.getElementById("editBundleImage").value    = b.image || "";
  document.getElementById("editBundleOriginalPrice").value = b.originalPrice || "";
  document.getElementById("editBundlePrice").value    = b.bundlePrice;
  document.getElementById("editBundleActive").checked = b.isActive !== false;
  populateBundleProductSelect("editBundleProducts", b.productIds || []);
  document.getElementById("editBundleModal").classList.remove("hidden");
  document.getElementById("editBundleModal").classList.add("flex");
};
window.closeEditBundleModal = () => {
  document.getElementById("editBundleModal").classList.add("hidden");
  document.getElementById("editBundleModal").classList.remove("flex");
};
window.saveEditBundle = async () => {
  const id      = document.getElementById("editBundleId").value;
  const name    = document.getElementById("editBundleName").value.trim();
  const image   = document.getElementById("editBundleImage").value.trim();
  const orig    = parseFloat(document.getElementById("editBundleOriginalPrice").value) || null;
  const price   = parseFloat(document.getElementById("editBundlePrice").value);
  const active  = document.getElementById("editBundleActive").checked;
  const sel     = document.getElementById("editBundleProducts");
  const ids     = Array.from(sel.selectedOptions).map(o => o.value);
  if (!name || isNaN(price) || ids.length === 0) {
    showToast("تأكد من صحة بيانات الباقة", "error"); return;
  }
  try {
    await updateDoc(doc(db, "bundles", id), {
      name, image, originalPrice: orig, bundlePrice: price, productIds: ids, isActive: active
    });
    showToast("تم تحديث الباقة ✅", "success");
    closeEditBundleModal();
  } catch { showToast("خطأ في تحديث الباقة", "error"); }
};

/** يعرض قائمة الباقات في لوحة التحكم (يشمل المخفية) */
function renderAdminBundles() {
  const list = document.getElementById("adminBundlesList");
  if (!list) return;
  // جلب كل الباقات (نشطة + مخفية) عبر المتغير العالمي
  const allBundles = (window._allBundles || bundles);

  if (allBundles.length === 0) {
    list.innerHTML = `<p class="text-center text-gray-400 text-sm py-6">لا توجد باقات بعد</p>`;
    return;
  }
  list.innerHTML = allBundles.map(b => `
    <div class="flex items-center justify-between p-3 border border-gray-100 rounded-xl bg-gray-50 hover:bg-white transition">
      <div class="flex items-center gap-3 min-w-0">
        <img src="${optimizeImage(b.image, 48)}" alt="${b.name}"
             class="w-12 h-12 rounded-lg object-cover border border-amber-100 flex-shrink-0"
             loading="lazy" onerror="this.src='https://placehold.co/48x48/e2e8f0/94a3b8?text=...'">
        <div class="min-w-0">
          <h4 class="font-bold text-gray-800 text-sm truncate">${b.name}</h4>
          <p class="text-xs text-gray-500 mt-0.5">
            ${b.bundlePrice} ريال
            ${b.isActive !== false
              ? '<span class="mr-1 text-green-600">● نشطة</span>'
              : '<span class="mr-1 text-red-400">● مخفية</span>'}
          </p>
        </div>
      </div>
      <div class="flex gap-2 flex-shrink-0">
        <button onclick="toggleBundleActive('${b.id}', ${b.isActive !== false})"
          title="${b.isActive !== false ? "إخفاء" : "إظهار"}"
          class="w-8 h-8 rounded-lg ${b.isActive !== false ? 'bg-amber-100 text-amber-600 hover:bg-amber-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'} transition flex items-center justify-center">
          <i class="fas fa-eye${b.isActive !== false ? '' : '-slash'} text-xs"></i>
        </button>
        <button onclick="openEditBundleModal('${b.id}')"
          class="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition flex items-center justify-center">
          <i class="fas fa-edit text-xs"></i>
        </button>
        <button onclick="deleteBundle('${b.id}')"
          class="w-8 h-8 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition flex items-center justify-center">
          <i class="fas fa-trash text-xs"></i>
        </button>
      </div>
    </div>`).join("");
}

// Listener لجميع الباقات (نشطة + مخفية) — للمدير فقط
onSnapshot(collection(db, "bundles"), snap => {
  window._allBundles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (!document.getElementById("adminPanel").classList.contains("hidden"))
    renderAdminBundles();
});


// ============================================================================
// 12. نظام الإشعارات Toast
// ============================================================================
let toastTimer;
function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  const msg   = document.getElementById("toastMessage");
  const icon  = document.getElementById("toastIcon");
  msg.textContent = message;
  icon.className  = type === "success"
    ? "fas fa-check-circle text-green-400 text-lg flex-shrink-0"
    : "fas fa-exclamation-circle text-red-400 text-lg flex-shrink-0";
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3500);
}
window.showToast = showToast;


// ============================================================================
// 13. التهيئة الأولية
// ============================================================================
updateCartUI();
updateOrderBadge();

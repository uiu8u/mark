// app.js

// ============================================================================
// 1. إعدادات Firebase V9 (Modular)
// ============================================================================
// ============================================================================
// 1. إعدادات Firebase V9 (Modular)
// ============================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { 
    getFirestore, collection, getDocs, addDoc, updateDoc, deleteDoc, doc, runTransaction, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// الإضافة الجديدة الخاصة بتسجيل دخول المدير (Auth)
import { getAuth, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// تذكري وضع مفاتيح مشروعك الحقيقية هنا بدلاً من YOUR_TOKEN_HERE
const firebaseConfig = {
    
  apiKey: "AIzaSyDoO0MMShBazdTmG1CCLEMjGAzeM16-dFI",
  authDomain: "market-21ede.firebaseapp.com",
  projectId: "market-21ede",
  storageBucket: "market-21ede.firebasestorage.app",
  messagingSenderId: "113074265984",
  appId: "1:113074265984:web:d65051410bd4e551b9eb65",
  measurementId: "G-ED4ZFZ140D"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app); // تم إضافة تعريف المصادقة هنا بنجاح!
// ============================================================================
// 2. إعدادات Telegram Bot
// ============================================================================
const TELEGRAM_BOT_TOKEN = "YOUR_TOKEN_HERE";
const TELEGRAM_CHAT_ID = "830390292";

// ============================================================================
// 3. المتغيرات العامة (State)
// ============================================================================
let products = [];
let cart = JSON.parse(localStorage.getItem("grocery_cart")) || [];

// ============================================================================
// 4. إدارة السلة (Cart Management)
// ============================================================================

// فتح السلة
window.openCart = () => {
    document.getElementById("cartModal").classList.remove("hidden");
    renderCart();
};

// إغلاق السلة
window.closeCart = () => {
    document.getElementById("cartModal").classList.add("hidden");
};

// إضافة منتج للسلة
window.addToCart = (productId) => {
    const product = products.find(p => p.id === productId);
    if (!product || product.quantity <= 0) {
        showToast("المنتج غير متوفر حالياً!", "error");
        return;
    }

    const existingItem = cart.find(item => item.id === productId);
    
    if (existingItem) {
        if (existingItem.cartQuantity >= product.quantity) {
             showToast("وصلت للحد الأقصى للكمية المتاحة!", "error");
             return;
        }
        existingItem.cartQuantity += 1;
    } else {
        cart.push({ ...product, cartQuantity: 1 });
    }

    saveCart();
    updateCartUI();
    showToast("تمت الإضافة للسلة 🛒", "success");
};

// تحديث كمية منتج في السلة
window.updateCartItemQuantity = (productId, change) => {
    const itemIndex = cart.findIndex(item => item.id === productId);
    if (itemIndex > -1) {
        const product = products.find(p => p.id === productId);
        let newQuantity = cart[itemIndex].cartQuantity + change;

        if (newQuantity <= 0) {
            cart.splice(itemIndex, 1);
        } else if (newQuantity > product.quantity) {
             showToast("لا توجد كمية إضافية!", "error");
             return;
        } else {
            cart[itemIndex].cartQuantity = newQuantity;
        }
        saveCart();
        updateCartUI();
        renderCart();
    }
};

// حفظ السلة وتحديث الواجهة
function saveCart() {
    localStorage.setItem("grocery_cart", JSON.stringify(cart));
}

function updateCartUI() {
    const cartCount = document.getElementById("cartCount");
    const totalItems = cart.reduce((sum, item) => sum + item.cartQuantity, 0);
    
    if (totalItems > 0) {
        cartCount.textContent = totalItems;
        cartCount.classList.remove("hidden");
        cartCount.classList.add("flex");
    } else {
        cartCount.classList.add("hidden");
        cartCount.classList.remove("flex");
    }
}

// عرض السلة
function renderCart() {
    const cartItemsContainer = document.getElementById("cartItems");
    const cartTotalElement = document.getElementById("cartTotal");
    const checkoutBtn = document.getElementById("checkoutBtn");
    
    cartItemsContainer.innerHTML = "";
    let total = 0;

    if (cart.length === 0) {
        cartItemsContainer.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
                <i class="fas fa-shopping-basket text-4xl mb-2"></i>
                <p>سلتك فارغة</p>
            </div>`;
        checkoutBtn.disabled = true;
    } else {
        checkoutBtn.disabled = false;
        cart.forEach(item => {
            total += item.price * item.cartQuantity;
            cartItemsContainer.innerHTML += `
                <div class="flex items-center gap-3 p-3 border-b border-gray-100 last:border-0">
                    <img src="${item.image || 'https://via.placeholder.com/150'}" class="w-16 h-16 object-cover rounded-xl border border-gray-200">
                    <div class="flex-1">
                        <h4 class="font-bold text-gray-800 text-sm">${item.name}</h4>
                        <p class="text-brand-600 font-bold text-xs mt-1">${item.price} ريال</p>
                    </div>
                    <div class="flex items-center gap-2 bg-gray-50 p-1 rounded-lg border border-gray-200">
                        <button onclick="updateCartItemQuantity('${item.id}', 1)" class="w-7 h-7 bg-white rounded shadow-sm text-gray-600 hover:text-brand-600"><i class="fas fa-plus text-xs"></i></button>
                        <span class="w-6 text-center font-bold text-sm">${item.cartQuantity}</span>
                        <button onclick="updateCartItemQuantity('${item.id}', -1)" class="w-7 h-7 bg-white rounded shadow-sm text-gray-600 hover:text-red-500"><i class="fas fa-minus text-xs"></i></button>
                    </div>
                </div>
            `;
        });
    }
    cartTotalElement.textContent = `${total.toFixed(2)} ريال`;
}


// ============================================================================
// 5. إدارة الطلبات (Checkout & Telegram)
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
    const name = document.getElementById("customerName").value.trim();
    const phone = document.getElementById("customerPhone").value.trim();
    const notes = document.getElementById("customerNotes").value.trim();
    const btn = document.getElementById("submitOrderBtn");

    if (!name || !phone) {
        showToast("يرجى إدخال الاسم ورقم الهاتف", "error");
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';

    try {
        // 1. تحديث الكميات في Firebase باستخدام Transaction بأمان
        await runTransaction(db, async (transaction) => {
            const productDocs = await Promise.all(cart.map(item => transaction.get(doc(db, "products", item.id))));
            
            // التحقق من توفر الكميات لجميع المنتجات قبل الخصم
            productDocs.forEach((docSnap, index) => {
                if (!docSnap.exists()) throw "المنتج غير موجود";
                const newQty = docSnap.data().quantity - cart[index].cartQuantity;
                if (newQty < 0) throw `الكمية غير كافية للمنتج: ${docSnap.data().name}`;
                transaction.update(docSnap.ref, { quantity: newQty });
            });
        });

        // 2. تجميع بيانات الطلب لتيليجرام
        let total = 0;
        let orderDetails = cart.map(item => {
            total += item.price * item.cartQuantity;
            return `🔸 ${item.name} (${item.cartQuantity}) - ${item.price * item.cartQuantity} ريال`;
        }).join('%0A');

        const message = `
🛍️ *طلب جديد من بقالة السعادة*
-------------------------
👤 *الاسم:* ${name}
📱 *الهاتف:* ${phone}
📝 *ملاحظات:* ${notes || 'لا يوجد'}
-------------------------
*المنتجات:*
${orderDetails}
-------------------------
💰 *الإجمالي:* *${total.toFixed(2)} ريال*
        `;
// ==========================================
        // إضافة: حفظ الطلب في Firestore مع صاعق التدمير الذاتي
        // ==========================================
        const expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + 30); // تحديد العمر الافتراضي بـ 30 يوماً

        const orderId = "ORD-" + Math.floor(Math.random() * 1000000); // توليد رقم طلب عشوائي لتتبعه لاحقاً

        await addDoc(collection(db, "orders"), {
            orderId: orderId,
            customerName: name,
            phone: phone,
            notes: notes || 'لا يوجد',
            totalAmount: total,
            status: "قيد المراجعة", // الحالة المبدئية للطلب
            expireAt: expireDate    // الحقل الذي يراقبه محرك الـ TTL
        });
        // ==========================================
        // 3. إرسال لتيليجرام
  // الكود الجديد للاتصال بالخادم الوسيط (Proxy)
        const response = await fetch('/api/telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID, // رقم الدردشة لا بأس ببقائه هنا
                text: message,             // متغير الفاتورة الخاص بك
                parse_mode: 'Markdown'     // للحفاظ على التنسيق الجميل للفاتورة
            })
        });
        
        // التحقق من نجاح الإرسال عبر الخادم الوسيط
        if (!response.ok) throw new Error("فشل إرسال الإشعار");

        // 4. نجاح العملية (كودك الأصلي كما هو)
        closeOrderModal();
        document.getElementById("successModal").classList.remove("hidden");
        document.getElementById("successModal").classList.add("flex");
        cart = [];
        saveCart();
        updateCartUI();

    } catch (error) {
        console.error("Order error:", error);
        showToast(error.message || "حدث خطأ أثناء معالجة الطلب", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fab fa-telegram text-lg"></i> إرسال الطلب';
    }
};
// ============================================================================
// 6. جلب وعرض المنتجات للزبون (Client Side)
// ============================================================================

function renderProducts() {
    const grid = document.getElementById("productsGrid");
    const loading = document.getElementById("loadingState");
    const empty = document.getElementById("emptyState");

    loading.classList.add("hidden");
    
    if (products.length === 0) {
        empty.classList.remove("hidden");
        empty.classList.add("flex");
        grid.classList.add("hidden");
        return;
    }

    empty.classList.add("hidden");
    empty.classList.remove("flex");
    grid.classList.remove("hidden");
    grid.innerHTML = "";

    products.forEach(product => {
        const isOutOfStock = product.quantity <= 0;
        grid.innerHTML += `
            <div class="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-col transition hover:shadow-md ${isOutOfStock ? 'opacity-70' : ''}">
                <div class="relative w-full h-32 mb-3 bg-gray-50 rounded-xl overflow-hidden">
                    <img src="${product.image || 'https://via.placeholder.com/300'}" class="w-full h-full object-cover">
                    ${isOutOfStock ? `<div class="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-sm"><span class="bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full">نفذت الكمية</span></div>` : ''}
                </div>
                <h3 class="font-bold text-gray-800 mb-1 leading-tight text-sm">${product.name}</h3>
                <div class="flex justify-between items-end mt-auto pt-3">
                    <div>
                        <p class="text-brand-600 font-extrabold">${product.price} <span class="text-xs font-normal text-gray-500">ريال</span></p>
                        <p class="text-gray-400 text-[10px] mt-0.5">المتاح: ${product.quantity}</p>
                    </div>
                    <button onclick="addToCart('${product.id}')" ${isOutOfStock ? 'disabled' : ''} class="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 hover:bg-brand-600 hover:text-white transition flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed">
                        <i class="fas fa-cart-plus"></i>
                    </button>
                </div>
            </div>
        `;
    });
}

// الاستماع المباشر (Real-time listener) للتغييرات في قاعدة البيانات
onSnapshot(collection(db, "products"), (snapshot) => {
    products = [];
    snapshot.forEach((doc) => {
        products.push({ id: doc.id, ...doc.data() });
    });
    renderProducts();
    if(document.getElementById("adminPanel").classList.contains("block")){
         renderAdminProducts(); // تحديث لوحة المدير إذا كانت مفتوحة
    }
}, (error) => {
    console.error("Firebase Error:", error);
    document.getElementById("loadingState").classList.add("hidden");
    const errorState = document.getElementById("errorState");
    errorState.classList.remove("hidden");
    errorState.classList.add("flex");
});


// ============================================================================
// 7. نظام المدير (Admin Panel & CRUD)
// ============================================================================

let adminClickCount = 0;
let adminClickTimer;

// زر التحكم السري
window.handleAdminTriggerClick = () => {
    adminClickCount++;
    if (adminClickCount === 1) {
        adminClickTimer = setTimeout(() => { adminClickCount = 0; }, 3000);
    }
    if (adminClickCount >= 5) {
        clearTimeout(adminClickTimer);
        adminClickCount = 0;
        document.getElementById("adminLoginModal").classList.remove("hidden");
        document.getElementById("adminLoginModal").classList.add("flex");
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
    
    try {
        // نستخدم الإيميل الفعلي الذي قمتِ بإنشائه في Firebase
        await signInWithEmailAndPassword(auth, "add@mark.com", pass);
        
        closeAdminLogin();
        document.getElementById("adminPanel").classList.remove("hidden");
        document.getElementById("adminPanel").classList.add("block");
        renderAdminProducts();
        showToast("مرحباً بكِ øX7 في لوحة الإدارة", "success");
    } catch (error) {
        document.getElementById("adminLoginError").classList.remove("hidden");
        console.error("Login Error:", error.message);
    }
};

// زر تسجيل الخروج
window.adminLogout = async () => {
    await signOut(auth);
    closeAdminPanel();
    showToast("تم تسجيل الخروج", "success");
};

window.closeAdminPanel = () => {
    document.getElementById("adminPanel").classList.add("hidden");
    document.getElementById("adminPanel").classList.remove("block");
};

// --- عمليات الـ CRUD للمدير ---

window.addProduct = async () => {
    const name = document.getElementById("adminProductName").value.trim();
    const price = parseFloat(document.getElementById("adminProductPrice").value);
    const quantity = parseInt(document.getElementById("adminProductQuantity").value);
    const image = document.getElementById("adminProductImage").value.trim();
    const btn = document.getElementById("addProductBtn");

    if (!name || isNaN(price) || isNaN(quantity)) {
        showToast("يرجى ملء الحقول الإجبارية بشكل صحيح", "error");
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإضافة...';

    try {
        await addDoc(collection(db, "products"), { name, price, quantity, image });
        showToast("تمت إضافة المنتج بنجاح", "success");
        window.clearAdminForm();
    } catch (error) {
        console.error("Error adding:", error);
        showToast("فشل في إضافة المنتج", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-plus-circle"></i> إضافة المنتج';
    }
};

window.clearAdminForm = () => {
    document.getElementById("adminProductName").value = "";
    document.getElementById("adminProductPrice").value = "";
    document.getElementById("adminProductQuantity").value = "";
    document.getElementById("adminProductImage").value = "";
};

window.deleteProduct = async (id) => {
    if(confirm("هل أنت متأكد من حذف هذا المنتج نهائياً؟")) {
        try {
            await deleteDoc(doc(db, "products", id));
            showToast("تم حذف المنتج", "success");
        } catch (error) {
            console.error("Error deleting:", error);
            showToast("خطأ أثناء الحذف", "error");
        }
    }
};

// فتح نافذة التعديل
window.openEditModal = (id) => {
    const product = products.find(p => p.id === id);
    if (!product) return;

    document.getElementById("editProductId").value = id;
    document.getElementById("editProductName").value = product.name;
    document.getElementById("editProductPrice").value = product.price;
    document.getElementById("editProductQuantity").value = product.quantity;
    document.getElementById("editProductImage").value = product.image || "";

    document.getElementById("editModal").classList.remove("hidden");
    document.getElementById("editModal").classList.add("flex");
};

window.closeEditModal = () => {
    document.getElementById("editModal").classList.add("hidden");
    document.getElementById("editModal").classList.remove("flex");
};

window.saveEditProduct = async () => {
    const id = document.getElementById("editProductId").value;
    const name = document.getElementById("editProductName").value.trim();
    const price = parseFloat(document.getElementById("editProductPrice").value);
    const quantity = parseInt(document.getElementById("editProductQuantity").value);
    const image = document.getElementById("editProductImage").value.trim();

    if (!name || isNaN(price) || isNaN(quantity)) {
        showToast("تأكد من صحة البيانات المدخلة", "error");
        return;
    }

    try {
        await updateDoc(doc(db, "products", id), { name, price, quantity, image });
        showToast("تم تحديث المنتج بنجاح", "success");
        closeEditModal();
    } catch (error) {
         console.error("Error updating:", error);
         showToast("فشل تحديث المنتج", "error");
    }
};

function renderAdminProducts() {
    const list = document.getElementById("adminProductsList");
    document.getElementById("adminProductCount").textContent = `${products.length} منتجات`;
    list.innerHTML = "";

    products.forEach(p => {
        list.innerHTML += `
            <div class="flex items-center justify-between p-3 border border-gray-100 rounded-xl bg-gray-50 hover:bg-white transition">
                <div class="flex items-center gap-3">
                    <img src="${p.image || 'https://via.placeholder.com/50'}" class="w-12 h-12 rounded-lg object-cover border border-gray-200">
                    <div>
                        <h4 class="font-bold text-gray-800 text-sm">${p.name}</h4>
                        <p class="text-xs text-gray-500 mt-1">السعر: ${p.price} | المتاح: <span class="${p.quantity === 0 ? 'text-red-500 font-bold' : ''}">${p.quantity}</span></p>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button onclick="openEditModal('${p.id}')" class="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteProduct('${p.id}')" class="w-8 h-8 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `;
    });
}

// ============================================================================
// 8. نظام الإشعارات (Toast)
// ============================================================================
let toastTimeout;
window.showToast = (message, type = "success") => {
    const toast = document.getElementById("toast");
    const msg = document.getElementById("toastMessage");
    const icon = document.getElementById("toastIcon");

    msg.textContent = message;
    
    if(type === "success") {
        icon.className = "fas fa-check-circle text-green-400 text-lg flex-shrink-0";
    } else {
        icon.className = "fas fa-exclamation-circle text-red-400 text-lg flex-shrink-0";
    }

    toast.classList.remove("hidden");
    
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.add("hidden");
    }, 3000);
};

// ============================================================================
// 9. التهيئة الأولية (Initialization)
// ============================================================================
updateCartUI();
window.retryConnection = function() { location.reload(); };

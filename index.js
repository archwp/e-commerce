const express = require("express");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const paypal = require("paypal-rest-sdk");
require("dotenv").config();

const app = express();
const prisma = new PrismaClient();
const PORT = 4000;
const SECRET_KEY = "your_secret_key";

paypal.configure({
  mode: "live",
  client_id: process.env.PAYPAL_LIVE_CLIENT_ID, 
  client_secret: process.env.PAYPAL_LIVE_CLIENT_SECRET
});

app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: "http://localhost:3000", credentials: true }));

// ✅ Middleware للتحقق من التوكن
const authenticate = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "يجب تسجيل الدخول" });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: "توكن غير صالح" });
  }
};

// ✅ تسجيل المستخدم
app.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.member.create({ data: { name, email, password: hashedPassword } });
  res.status(201).json({ message: "تم إنشاء الحساب بنجاح" });
});

// ✅ تسجيل الدخول
app.post("/signin", async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.member.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "البريد الإلكتروني غير صحيح" });

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) return res.status(401).json({ error: "كلمة المرور غير صحيحة" });

  const token = jwt.sign({ userId: user.id }, SECRET_KEY, { expiresIn: "7d" });
  res.cookie("token", token, { httpOnly: true, maxAge: 604800000 });
  res.json({ message: "تم تسجيل الدخول بنجاح" });
});

// ✅ جلب بيانات المستخدم الحالي
app.get("/user", authenticate, async (req, res) => {
  const user = await prisma.member.findUnique({ where: { id: req.userId }, select: { id: true, name: true, email: true } });
  res.json(user);
});
app.post("/logout", (req, res) => {
  res.clearCookie("token", { httpOnly: true, secure: false });
  res.json({ message: "تم تسجيل الخروج بنجاح" });
});
// ✅ جلب جميع المنتجات مع البحث
// app.get("/products", async (req, res) => {
//   const { search } = req.query;
//   const products = await prisma.products.findMany({
//     where: search ? { name: { contains: search, mode: "insensitive" } } : {},
//   });
//   res.json(products);
// });

// ✅ طلب منتج وإنشاء طلب جديد
app.post("/order", authenticate, async (req, res) => {
  const { items } = req.body;
  
  console.log("🛒 الطلبات المستلمة:", items); // ✅ طباعة البيانات القادمة من الطلب

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "يجب تحديد عناصر الطلب" });
  }

  let totalPrice = 0;
  const orderItems = await Promise.all(
    items.map(async (item) => {
      console.log("🔎 فحص المنتج:", item.productId); // ✅ التأكد من وجود productId

      if (!item.productId) {
        return res.status(400).json({ error: "معرف المنتج غير موجود" });
      }

      const product = await prisma.products.findUnique({ where: { id: item.productId } });

      if (!product) {
        return res.status(404).json({ error: `المنتج بالمعرف ${item.productId} غير موجود` });
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({ error: `الكمية المطلوبة غير متوفرة للمنتج ${product.name}` });
      }

      totalPrice += product.price * item.quantity;
      return { productId: item.productId, quantity: item.quantity, price: product.price };
    })
  );

  const order = await prisma.orders.create({
    data: {
      userId: req.userId,
      totalPrice,
      status: "PENDING",
      items: { create: orderItems.filter(Boolean) },
    },
  });

  res.status(201).json({ message: "تم إنشاء الطلب بنجاح", order });
});


// ✅ الدفع عبر PayPal
app.post("/pay", authenticate, async (req, res) => {
  const { orderId } = req.body;

  const order = await prisma.orders.findUnique({ where: { id: orderId }, include: { items: true } });

  if (!order) return res.status(404).json({ error: "الطلب غير موجود" });
  if (order.userId !== req.userId) return res.status(403).json({ error: "ليس لديك صلاحية لهذا الطلب" });

  const payment = {
    intent: "sale",
    payer: { payment_method: "paypal" },
    transactions: [{ amount: { total: order.totalPrice.toFixed(2), currency: "USD" } }],
    redirect_urls: {
      return_url: "http://yourdomain.com/success?orderId=" + orderId, // ✅ رابط نجاح الدفع
      cancel_url: "http://yourdomain.com/cancel" // ✅ رابط إلغاء الدفع
    }
  };

  paypal.payment.create(payment, async (err, payment) => {
    if (err) return res.status(500).json(err);
    
    // ✅ استخراج رابط الدفع
    const approvalUrl = payment.links.find(link => link.rel === "approval_url").href;

    res.json({ approvalUrl });
  });
});

app.get("/allproducts", async (req, res) => {
  try {
    const products = await prisma.products.findMany();
    if (!products.length) {
      return res.status(404).json({ error: "لا توجد منتجات متاحة" });
    }
    res.json(products);
  } catch (error) {
    console.error("خطأ أثناء جلب المنتجات:", error);
    res.status(500).json({ error: "حدث خطأ أثناء جلب المنتجات" });
  }
});
app.get("/success", async (req, res) => {
  const { paymentId, PayerID, orderId } = req.query;

  if (!paymentId || !PayerID) {
    return res.status(400).json({ error: "بيانات غير صحيحة" });
  }

  const execute_payment_json = { payer_id: PayerID };

  paypal.payment.execute(paymentId, execute_payment_json, async (err, payment) => {
    if (err) {
      console.error("❌ فشل تأكيد الدفع:", err);
      return res.status(500).json({ error: "فشل تأكيد الدفع" });
    }

    console.log("✅ دفع ناجح!", payment);

    // ✅ تحديث الطلب إلى "مدفوع"
    await prisma.orders.update({
      where: { id: parseInt(orderId) },
      data: { status: "PAID" },
    });

    res.redirect("http://yourdomain.com/order-confirmation");
  });
});



app.get("/products", async (req, res) => {
  const { search } = req.query;

  try {
    const products = await prisma.products.findMany({
      where: search
        ? { name: { contains: search, mode: "insensitive" } }
        : {},
    });

    console.log("🔍 البحث عن:", search);
    console.log("📦 المنتجات:", products);

    if (!products.length) {
      return res.status(404).json({ error: "لا توجد منتجات مطابقة" });
    }

    res.json(products);
  } catch (error) {
    console.error("❌ خطأ أثناء جلب المنتجات:", error);
    res.status(500).json({ error: "حدث خطأ أثناء جلب المنتجات" });
  }
});




// ✅ تشغيل السيرفر
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));



//npx prisma studio
//npx prisma migrate deploy 
//npx prisma generate
//npx prisma db push
//npx prisma migrate
//npx prisma migrate reset
//npx prisma migrate dev --name init
//npx prisma migrate deploy 
//npx prisma init
//npm install @prisma/client
//npm install prisma --save-dev
//npm cache clean --force
// npx prisma format
// npx prisma migrate dev --name fix-relations
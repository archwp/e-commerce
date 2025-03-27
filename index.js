const express = require("express");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const paypal = require("@paypal/checkout-server-sdk");

require("dotenv").config();

const app = express();
const prisma = new PrismaClient();
const PORT = 4000;
const SECRET_KEY = "your_secret_key";
const environment = new paypal.core.SandboxEnvironment(
  "Aeo9ls2rpp4WA0FSigq0FRaTh9CAzXmhe0nB16JJ-f26j76dAHbhC2TtaYaovFCdcASbDt2R1c1DRunS",
 "EMfrz11U39HwLG4CYlfEV8NwxkV4GntjXrctnDbSYSGddfIXQrqZhYyBTK45wckHX0na1AHQ6hsu_qB1"

);
const client = new paypal.core.PayPalHttpClient(environment);


app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.get("/test", (req, res) => {
  res.status(200).send({ id: "4" });
});
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
  res.clearCookie("token", { httpOnly: true, secure: false ,path:"/"});
  res.json({ message: "تم تسجيل الخروج بنجاح" });
});

// ✅ طلب منتج وإنشاء طلب جديد
app.post("/pay", authenticate, async (req, res) => {
  const { orderId } = req.body;

  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) return res.status(404).json({ error: "الطلب غير موجود" });

  const request = new paypal.orders.OrdersCreateRequest();
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: "EUR",
          value: order.totalPrice.toFixed(2),
        },
        invoice_id: orderId.toString(),
      },
    ],
  });

  try {
    const response = await client.execute(request);
    res.json({ approvalUrl: response.result.links.find(link => link.rel === "approve").href });
  } catch (error) {
    console.error("PayPal Error:", error);
    res.status(500).json({ error: "فشل إنشاء الدفع عبر PayPal" });
  }
});

const verifyWebhookSignature = async (req) => {
  const webhookId = "YOUR_WEBHOOK_ID"; // ضع معرف الـ Webhook من PayPal
  const signature = req.headers["paypal-transmission-sig"];
  const authAlgo = req.headers["paypal-auth-algo"];
  const certUrl = req.headers["paypal-cert-url"];
  const transmissionId = req.headers["paypal-transmission-id"];
  const transmissionTime = req.headers["paypal-transmission-time"];
  const body = JSON.stringify(req.body);

  return new Promise((resolve, reject) => {
    paypal.notification.webhookEvent.verify(
      {
        transmission_id: transmissionId,
        timestamp: transmissionTime,
        webhook_id: webhookId,
        event_body: body,
        cert_url: certUrl,
        auth_algo: authAlgo,
        transmission_sig: signature,
      },
      (err, response) => {
        if (err || response.verification_status !== "SUCCESS") {
          return reject(err || new Error("فشل التحقق من Webhook"));
        }
        resolve(true);
      }
    );
  });
};

app.post("/webhook", express.json({ type: "application/json" }), async (req, res) => {
  try {
    await verifyWebhookSignature(req); // ✅ التحقق من التوقيع
    const event = req.body;

    if (event.event_type === "PAYMENT.SALE.COMPLETED") {
      const orderId = parseInt(event.resource.invoice_number, 10);

      if (isNaN(orderId)) {
        return res.status(400).json({ error: "معرف الطلب غير صالح" });
      }

      const order = await prisma.orders.findUnique({ where: { id: orderId } });

      if (!order) return res.status(404).json({ error: "الطلب غير موجود" });

      const paymentAmount = parseFloat(event.resource.amount.total);
      if (paymentAmount !== order.totalPrice) {
        return res.status(400).json({ error: "المبلغ المدفوع غير متطابق مع الطلب" });
      }

      await prisma.orders.update({
        where: { id: orderId },
        data: { status: "PAID" },
      });

      res.status(200).send("✅ Webhook Processed");
    } else {
      res.status(200).send("⚠️ Event Not Handled");
    }
  } catch (error) {
    console.error("❌ Webhook Error:", error);
    res.status(400).json({ error: "فشل التحقق من Webhook" });
  }
});

app.post("/order", authenticate, async (req, res) => {
  const { items } = req.body;
  let totalPrice = 0;
  const orderItems = await Promise.all(
    items.map(async (item) => {
      const product = await prisma.products.findUnique({ where: { id: item.productId } });
      if (!product) {
        return res.status(400).json({ error: `المنتج غير موجود: ${item.productId}` });
      }
      
      totalPrice += product.price * item.quantity;
      return { productId: item.productId, quantity: item.quantity, price: product.price };
    })
  );
  const order = await prisma.orders.create({
    data: { userId: req.userId, totalPrice, status: "PENDING", items: { create: orderItems.filter(Boolean) } }
  });
  res.status(201).json({ message: "تم إنشاء الطلب بنجاح", order });
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

  if (!paymentId || !PayerID || !orderId) {
    return res.status(400).json({ error: "بيانات غير صحيحة" });
  }

  const execute_payment_json = { payer_id: PayerID };

  paypal.payment.execute(paymentId, execute_payment_json, async (err, payment) => {
    if (err) {
      console.error("❌ فشل تأكيد الدفع:", err);
      return res.status(500).json({ error: "فشل تأكيد الدفع" });
    }

    console.log("✅ دفع ناجح!", payment);

    const order = await prisma.orders.findUnique({ where: { id: parseInt(orderId) } });
    if (!order) return res.status(404).json({ error: "الطلب غير موجود" });

    await prisma.orders.update({
      where: { id: parseInt(orderId) },
      data: { status: "PAID" },
    });

    res.json({ message: "✅ تم تأكيد الدفع بنجاح!" });
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
// git init
// git add .
// git commit -m "Initial commit"
// git remote add origin https://github.com/your-username/your-repo.git
// git push -u origin main
//git branch -M main
// نعم، يمكنك رفع التعديلات بعد تحديث الملفات في مشروعك باتباع هذه الخطوات:  

// ### **1. التحقق من التعديلات**  
// لمعرفة الملفات التي تم تعديلها، استخدم:  
// ```sh
// git status
// ```

// ### **2. إضافة التعديلات إلى Git**  
// لإضافة جميع التعديلات إلى Git:  
// ```sh
// git add .
// ```
// أو لإضافة ملف معين فقط:  
// ```sh
// git add اسم_الملف
// ```

// ### **3. عمل Commit للتعديلات**  
// يجب توثيق التعديلات برسالة توضيحية:  
// ```sh
// git commit -m "توضيح للتعديلات التي تمت"
// ```

// ### **4. رفع التعديلات إلى GitHub**  
// ادفع التعديلات إلى الريبو على GitHub:  
// ```sh
// git push origin main
// ```

// 🚀 الآن تم تحديث المشروع بنجاح على GitHub!
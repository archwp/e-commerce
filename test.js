// const { PrismaClient } = require("@prisma/client");
// const prisma = new PrismaClient();

// async function main() {
//   try {
//     // إنشاء فئة (إذا لم تكن موجودة)
// //     const category = await prisma.categories.create({
// //       data: {
// //         name: "device",
// //       },
// //     });

//     // إنشاء المنتج بعد الحصول على categoryId
//     const product = await prisma.products.create({
//       data: {
//         name: "infamous",
//         description: "playstation three  adventure  game  ",
//         price: 20,
//         stock: 2,
//         categoryId: 2, // استخدام id الديناميكي للفئة التي تم إنشاؤها
//         imageUrl:
//           "https://res.cloudinary.com/dmxut5w9p/image/upload/v1742941669/zHhV7ny-infamous-wallpaper-hd_qm9r9a.jpg",
//       },
//     });

//     console.log("تمت إضافة الفئة والمنتج بنجاح:", product);
//   } catch (error) {
//     console.error("حدث خطأ:", error);
//   } finally {
//            console.log("work")
//     await prisma.$disconnect(); // إغلاق اتصال Prisma بعد الانتهاء
//   }
// }

// // تشغيل الوظيفة
// main();

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  try {
    // إنشاء دفعة جديدة مع تضمين العلاقات
    const payment = await prisma.payments.create({
      data: {
        order: {
          connect: { id: 1 }, // ربط الدفعة بطلب معين
        },
        user: {
          connect: { id: 1 }, // ربط الدفعة بمستخدم معين
        },
        paymentMethod: "PAYPAL", // تأكد أن هذا متوافق مع Enum PaymentMethod
        status: "PENDING", // تأكد أن هذا متوافق مع Enum PaymentStatus
        transactionId: null,
      },
      include: {
        order: true,  // تضمين بيانات الطلب
        user: true,   // تضمين بيانات المستخدم
      },
    });

    console.log("✅ تمت إضافة الدفعة بنجاح:", payment);
  } catch (error) {
    console.error("❌ حدث خطأ أثناء إنشاء الدفعة:", error);
  } finally {
    await prisma.$disconnect();
  }
}

// تشغيل الوظيفة
main();

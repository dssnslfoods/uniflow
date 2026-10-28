---
description: Build แอปแล้ว deploy ขึ้น Firebase Hosting (uniflow-mrp.web.app)
---

Deploy หน้าเว็บ Uniflow:

1. `pnpm typecheck` ต้องผ่าน
2. `pnpm build`
3. `firebase deploy --only hosting --project uniflow-mrp`
4. เปิด https://uniflow-mrp.web.app ใน Browser แท็บใหม่ ตรวจว่าโหลดได้และไม่มี error ใน console แล้วปิดแท็บ
5. ถ้ามีการแก้โค้ดที่ยังไม่ commit ให้ถามก่อนว่าจะ commit ไหม
6. รายงานผลเป็นภาษาไทย พร้อม URL

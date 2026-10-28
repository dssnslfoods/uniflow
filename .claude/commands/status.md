---
description: สรุปสถานะโปรเจกต์ Uniflow ตอนนี้
---

สรุปสถานะ Uniflow เป็นภาษาไทย สั้นๆ เป็นตาราง:

- **Git:** `git log --oneline -5` และไฟล์ที่ยังไม่ commit (`git status --short`)
- **ฐานข้อมูล:** `supabase migration list` ว่า Local กับ Remote ตรงกันไหม
- **หน้าเว็บ:** https://uniflow-mrp.web.app ตอบ 200 ไหม (`curl -s -o /dev/null -w "%{http_code}"`) และ deploy ล่าสุดตรงกับ commit ล่าสุดไหม (ถ้าบอกไม่ได้ให้บอกตรงๆ)
- **ข้อมูลบน project จริง:** จำนวนโรงพิมพ์, PO, Job ที่กำลังผลิต (`supabase db query --linked`)

จบด้วยหนึ่งบรรทัดว่า "ค้างอะไรอยู่" ถ้ามี

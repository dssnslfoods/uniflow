---
description: แนะนำงานถัดไปของ Uniflow จาก Roadmap และสถานะปัจจุบัน
---

ช่วยบอกว่าควรทำอะไรต่อใน Uniflow ตอบเป็นภาษาไทย กระชับ

1. อ่าน Delivery Plan ใน `docs/02-system-design.md` (§12) และ Decision Log ใน `docs/01-srs-analysis.md` (§4)
2. ดูสิ่งที่ทำเสร็จแล้วจาก `git log --oneline -20` และไฟล์ใน `supabase/migrations/`
3. ตรวจงานค้าง: `git status --short` และ migration ที่ยังไม่ขึ้น project จริง (`supabase db push --dry-run`)
4. สรุปเป็น 3 ส่วน:
   - **เสร็จแล้ว:** สั้นๆ ตาม Sprint/Phase
   - **ค้างอยู่ตอนนี้:** ถ้ามี เช่น ยังไม่ commit, ยังไม่ push migration, ยังไม่ deploy
   - **ตัวเลือกถัดไป 2–3 ข้อ:** เรียงตามความสำคัญต่อ Pilot แต่ละข้อบอกว่าได้อะไร และพิมพ์คำสั่งที่ใช้เริ่มได้ทันที เช่น `/sprint Phase 2: คลังวัตถุดิบ`

$ARGUMENTS

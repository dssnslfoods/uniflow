---
description: เริ่ม Sprint ถัดไป (หรือขอบเขตที่ระบุ) ตามขั้นตอนมาตรฐานของ Uniflow
argument-hint: [ขอบเขต เช่น "Phase 2: คลังวัตถุดิบ"]
---

เริ่ม Sprint ของ Uniflow ขอบเขต: $ARGUMENTS
ถ้าไม่ได้ระบุขอบเขต ให้เลือกงานถัดไปจาก Delivery Plan ใน `docs/02-system-design.md` §12 แล้วบอกก่อนเริ่มว่าจะทำอะไร

ทำตามขั้นตอนที่ใช้มาทุก Sprint:
1. **Migration ใหม่** ใน `supabase/migrations/` ตามกติกาใน README (tenant_id + composite FK, `app.apply_tenant_policies`, เขียนผ่าน `api.*` เมื่อเปลี่ยนสถานะ, error ด้วย `app.fail('<i18n.key>')`)
2. **pgTAP test** ไฟล์ใหม่ใน `supabase/tests/database/` และเพิ่ม fixture ใน `002_tenant_isolation` ถ้ามีตารางใหม่
3. รัน `/db-test` จนผ่านทั้งหมด
4. Push migration ขึ้น project จริง (ดูก่อนด้วย `--dry-run`)
5. **UI** ใน `apps/web/src/modules/` พร้อมคำแปลไทย/อังกฤษใน `shared/i18n.ts` และเพิ่ม route/เมนูถ้าจำเป็น
6. `pnpm typecheck` และ `pnpm build` ต้องผ่าน
7. Deploy ขึ้น Firebase และตรวจว่าหน้าเว็บโหลดได้ไม่มี error
8. Commit พร้อมข้อความสรุป แล้วรายงานผลเป็นภาษาไทย

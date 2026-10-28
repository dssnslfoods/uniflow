---
description: ลบข้อมูลตัวอย่าง (PO ที่ขึ้นต้นด้วย DEMO-) ออกจากโรงพิมพ์ก่อนใช้งานจริง
argument-hint: [ชื่อโรงพิมพ์]
---

ลบข้อมูลตัวอย่างของโรงพิมพ์: $ARGUMENTS (ถ้าไม่ระบุ ให้ถามว่าโรงพิมพ์ไหน)

1. **แสดงก่อนลบ** ด้วย `supabase db query --linked`: จำนวน PO ที่ `customer_po_no like 'DEMO-%'`, Job, ขั้นตอน, production log ที่เกี่ยวข้อง
2. **ถามยืนยันก่อนลบเสมอ** เพราะลบแล้วย้อนกลับไม่ได้ และถามด้วยว่าจะเก็บข้อมูลหลักที่ demo สร้างไว้ไหม (เครื่องจักร, Process, ลูกค้า, Template, Vendor, วัตถุดิบ) ค่าเริ่มต้นคือเก็บไว้
3. เมื่อยืนยันแล้ว ลบตามลำดับในคำสั่งเดียว (transaction): `app.approvals` ของ Job เหล่านั้น → `app.jobs` (ขั้นตอนและ log ลบตาม) → `app.sales_orders` (รายการลบตาม) โดยใช้ `set_config('app.in_command','on', true)` และ `set_config('app.bypass_order_guard','on', true)` เพื่อผ่าน guard
4. ตรวจผลหลังลบ แล้วรายงานเป็นภาษาไทย

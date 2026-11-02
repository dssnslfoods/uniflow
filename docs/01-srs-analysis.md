# Uniflow — SRS Analysis

> แหล่งข้อมูล: `Smart_Printing_MRP_BRD_SRS_v1.0.docx` (v1.0 Draft, 21 ต.ค. 2026)
> ผู้วิเคราะห์: Claude · วันที่: 27 ต.ค. 2026 · v0.2 (อัปเดตตามคำตอบ Open Questions)
> เอกสารคู่กัน: [02-system-design.md](02-system-design.md)

> **การเปลี่ยนขอบเขตสำคัญ (v0.2):** Uniflow เป็น **MRP ไม่ใช่ระบบออกใบเสนอราคา** — ต้นทางของระบบคือ **PO ที่ลูกค้ายืนยันสั่งซื้อแล้ว** ซึ่งนำเข้ามาเป็น Sales Order → ออก Production Order (Job) → ผ่าน Gate การผลิต ดังนั้น **M2 Quotation (FR-2.x) และตาราง quotations/quotation_items ออกจากขอบเขต** ราคาขายต่อรายการมาจาก PO ลูกค้า

## 1. สรุปภาพรวม

SRS กำหนดระบบ **MRP สำหรับโรงพิมพ์ SME แบบ SaaS Multi-tenant** ครอบคลุม ~~Quotation →~~ PO ลูกค้า / Sales Order → Job → Workflow (Multi-step Routing) → Approval → Scheduling Board → Outsource → Inventory → Delivery → Job Costing → Executive Dashboard

**จุดแข็งของเอกสาร**

- แกนของระบบชัด: *Workflow Template + Multi-step Routing* ตอบโจทย์ Make-to-Order ที่สเปคไม่ซ้ำ
- มี Business Rule ที่วัดได้ (สูตรเวลา BR-R05, Load % BR-R06) และ Gate สำคัญ 3 จุด (Approval / Proof / Stock)
- ตัดสินใจเรื่อง Multi-tenant + RLS ตั้งแต่วันแรก และให้ Business Logic สำคัญอยู่ในฐานข้อมูล — ถูกต้องสำหรับ Supabase
- KPI กำหนดไว้ชัด (OTD, Utilization, Lead Time, Waste, Margin, Approval Cycle) ทำให้ออกแบบ Data ให้วัดได้ตั้งแต่ต้น

**ภาพรวมความพร้อม:** พร้อมสำหรับเริ่ม Phase 0 (Discovery) และออกแบบ แต่ **ยังไม่พร้อมสำหรับ Build** จนกว่าจะปิดช่องว่างระดับ 🔴 ในหัวข้อ 3

## 2. Traceability: BR → FR → Rule → Module

| BR | ความต้องการ | FR / Rule ที่รองรับ | ครอบคลุม? |
|---|---|---|---|
| BR-01 | ติดตาม ~~Quotation~~ PO ลูกค้า → ส่งมอบ ในที่เดียว | M3, M4, M9, FR-10.1 (M2 ออกจากขอบเขต) | ✔ |
| BR-02 | หลาย Step ผสม Design/Internal/Outsource | FR-1.3, FR-4.2–4.3, M7 | ⚠ ไม่รองรับ Step ขนาน (ดู G-06) |
| BR-03 | Workflow ต้องอนุมัติก่อนผลิต | FR-4.6–4.7, BR-R01, BR-R02, BR-R04 | ⚠ ไม่ระบุพฤติกรรมระหว่าง Re-approval (G-02) |
| BR-04 | เห็นคิว/ภาระเครื่องทุกเครื่อง | M6, BR-R05, BR-R06 | ⚠ ไม่มีอัลกอริทึมคำนวณ planned_start/end (G-05) |
| BR-05 | ผู้บริหารเห็น Real-time | M10, NFR Realtime | ✔ (ต้องออกแบบ Realtime ให้ scale — G-17) |
| BR-06 | เช็กวัตถุดิบก่อนปล่อยผลิต | FR-4.5, FR-8.2–8.3, BR-R07 | ⚠ จุดจอง vs จุดตรวจ ไม่ตรงกัน (G-08) และ Phase ไม่ตรง (G-15) |
| BR-07 | ต้นทุนจริงต่องาน | FR-9.3, FR-8.4 | 🔴 ไม่มีนิยามองค์ประกอบต้นทุน (G-09) |
| BR-08 | Multi-tenant แยกขาด | BR-R09, 8.1, NFR Security | ✔ (เสนอเพิ่ม memberships — G-12) |
| BR-09 | ตรวจสอบย้อนหลังได้ | audit_logs, job_activity_logs, approvals | ✔ |

## 3. ช่องว่าง ความไม่สอดคล้อง และข้อเสนอแก้ (Gap Analysis)

ระดับ: 🔴 ต้องตัดสินใจก่อน Build · 🟠 ต้องตัดสินใจก่อนทำโมดูลนั้น · 🟡 ปรับระหว่างออกแบบได้ · ✅ ตัดสินใจแล้ว (ดู Decision Log §4)

### 3.1 Workflow / Job Lifecycle

| # | ระดับ | ประเด็น | ข้อเสนอ |
|---|---|---|---|
| G-01 | 🔴 | **ไม่มี Action ที่พา Job จาก Approved → InProduction** — ไดอะแกรมมีแค่ลูกศร แต่ BR-R07 (Stock check) ต้องมีจุดตรวจ | เพิ่ม Action **"Release to Production"** (Supervisor/Manager) เป็นจุดที่ตรวจ Stock + Proof Gate; อนุมัติแล้วยังไม่ปล่อยได้ (เช่น รอกระดาษเข้า) |
| G-02 | ✅ | **Re-approval ระหว่างผลิต**: BR-R04 บอก "Step ที่เสร็จแล้วไม่ถูกแก้" แต่ไม่ระบุว่า Step ที่ *กำลังทำ* อยู่ต้องหยุดหรือไม่ และชื่อสถานะไม่ตรง (ไดอะแกรม = PendingApproval, BR-R04 = Pending Re-approval) | ใช้สถานะเดียว `pending_approval` + ฟิลด์ `workflow_version > 1` บอกว่าเป็น re-approval; Step ที่ `in_progress` ทำต่อได้ แต่ห้ามเริ่ม Step ใหม่จนกว่าอนุมัติ; Step ที่ `done` ล็อก |
| G-03 | 🟠 | **BR-R03 Proof Gate** อิงว่ามี Step DESIGN — ถ้าลูกค้าส่งไฟล์มาเอง (ไม่มี DESIGN step) ยังต้องมี Proof ไหม? | เพิ่มฟิลด์ `jobs.proof_required` (default = true) Gate ผูกกับ flag นี้ ไม่ใช่การมีอยู่ของ DESIGN step |
| G-04 | 🟡 | Step status มี `Failed (Rework)` แต่ไม่ระบุว่า Rework สร้าง Step ใหม่หรือวนกลับ Step เดิม และผลต่อ Workflow version | Rework = แทรก Step ใหม่ (`is_rework = true`, `rework_of_step_id`) **ไม่** ต้อง Re-approval แต่บันทึกใน Activity Log + สาเหตุ |
| G-06 | ✅ | Routing เป็นเส้นตรง (`seq`) — งานจริงมี Step ขนาน (เช่น พิมพ์ปก ∥ พิมพ์เนื้อใน → เข้าเล่ม) | ใช้ `seq` เป็น "ระดับ" — Step ที่ `seq` เท่ากันทำขนานได้; Step ระดับถัดไปเริ่มเมื่อทุก Step ระดับก่อนหน้าเสร็จ (ง่ายกว่า DAG เต็ม, พอสำหรับ 95% ของงาน) |
| G-07 | 🟡 | เมื่อ Step ได้ `good_qty` น้อยกว่าแผน Step ถัดไปใช้จำนวนเท่าไร? | Step ถัดไปรับ `input_qty` = good_qty ของระดับก่อนหน้า; ถ้าต่ำกว่าจำนวนสั่ง → เตือนให้สร้าง Rework/พิมพ์เพิ่ม |

### 3.2 Scheduling & Capacity

| # | ระดับ | ประเด็น | ข้อเสนอ |
|---|---|---|---|
| G-05 | 🔴 | **ไม่มีอัลกอริทึมคำนวณ planned_start/end** — มีแค่สูตรเวลาต่อ Step และ queue_position | Forward finite-capacity scheduling ต่อเครื่อง: เรียงตาม `queue_position`, start = max(จบงานก่อนหน้าบนเครื่อง, จบ Step ระดับก่อนหน้าของ Job, now) แล้ว "กิน" เวลาตามปฏิทินกะ (ดู Design §6) |
| G-10 | ✅ | **BR-R05 หน่วยไม่สอดคล้อง**: จำนวน (ชิ้น) ÷ กำลังผลิต (แผ่น/Impression ต่อชม.) และ Setup (นาที) + ชั่วโมง; ไม่มี n-up (จำนวนชิ้นต่อแผ่น) และจำนวนสี/รอบพิมพ์ | กำหนด `qty_in_machine_unit` ต่อ Step = f(qty, n_up, passes) แล้ว `est_minutes = setup_min + ceil(qty_in_unit × (1 + waste%)) ÷ (max_cap_per_hour × efficiency) × 60` |
| G-11 | 🟡 | งานเสียในการพิมพ์มีทั้ง **Make-ready (คงที่ต่อ setup)** และ **Running waste (%)** — SRS มีแค่ % | Process/Machine มีทั้ง `makeready_waste_units` และ `running_waste_pct` |
| G-18 | 🟡 | ปฏิทินกะ (FR-1.7) ไม่ระบุว่าเป็นของเครื่องหรือของโรงงาน และ Timezone | ปฏิทินโรงงาน 1 ชุด + override ต่อเครื่อง; เก็บเวลาเป็น `timestamptz`, tenant ตั้ง timezone (default Asia/Bangkok) |
| G-19 | 🟡 | Outsource Step ไม่ใช้เครื่อง — คำนวณเวลาจากอะไร? | ใช้ `vendor_services.lead_time_days` เป็นค่าเริ่มต้น แก้ได้ต่องาน |

### 3.3 Inventory & Costing

| # | ระดับ | ประเด็น | ข้อเสนอ |
|---|---|---|---|
| G-08 | 🔴 | **จุดจอง vs จุดตรวจ ไม่ตรงกัน**: FR-8.2 จองเมื่อ *อนุมัติ*, BR-R07 ตรวจเมื่อ *ปล่อยผลิต* — ถ้าตอนอนุมัติของไม่พอ จะอนุมัติได้ไหม? | อนุมัติได้เสมอ (เป็นการอนุมัติ "แผน"); ระบบจองเท่าที่มี + ตั้ง shortage; ตรวจซ้ำตอน Release (G-01); Manager Override พร้อมเหตุผล |
| G-09 | ✅ | **ไม่มีนิยาม Actual Cost** — ต้องใช้กับ KPI Margin แต่ไม่มีอัตราค่าเครื่อง/ค่าแรง | Actual = วัตถุดิบที่เบิก (avg cost) + ชม.เครื่องจริง × `machines.cost_per_hour` + Outsource cost + (option) Overhead % ; เก็บใน `job_cost_entries` |
| G-13 | 🟠 | `stock_movements.type` รวม `reserve/release` (การจอง) ไว้กับการเคลื่อนไหวจริง — ทำให้ On Hand และ Moving Average คำนวณยาก | แยก: `stock_movements` = ของเคลื่อนจริง (in/out/adjust/return); `stock_reservations` = การจอง; On Hand/Reserved เก็บใน `stock_balances` (อัปเดตด้วย trigger) |
| G-14 | ✅ | หน่วยกระดาษ: รีม/แผ่น ไม่พอ — กระดาษม้วน (kg), ตัดแผ่นใหญ่ → แผ่นพิมพ์ (cut-from) | แผ่น/รีม + `sheets_per_parent`; คลังเดียว ไม่ติดตาม Lot/ม้วน (D-08) |

### 3.4 Sales / Delivery / Data Model

| # | ระดับ | ประเด็น | ข้อเสนอ |
|---|---|---|---|
| G-20 | — | ~~Quotation revision~~ | **ยกเลิก** — Quotation ออกจากขอบเขต (D-09) |
| G-21 | 🟠 | `delivery_items` ไม่ผูก Job — แต่ FR-9.3 ปิด Job เมื่อ "ส่งครบ" | `delivery_items(job_id, qty)`; Job ส่งครบเมื่อ Σqty ≥ jobs.qty |
| G-22 | ✅ | SO → jobs ไม่มีความสัมพันธ์ระดับรายการ (1 SO แตกหลาย Job) | `sales_order_items` กรอกจาก PO ลูกค้า + ตารางเชื่อม `job_order_items (job_id, sales_order_item_id, qty)` แบบ M:N — Supervisor ต้อง match ให้ครบทุกรายการก่อน Submit (D-14) |
| G-16 | ✅ | Running Number ด้วย Trigger แบบ max+1 จะชนกันเมื่อสร้างพร้อมกัน; ปี ค.ศ. หรือ พ.ศ.? | ตาราง `doc_sequences(tenant, doc_type, period)` + upsert row lock; **รูปแบบตั้งได้ต่อ tenant ค่าเริ่มต้น ค.ศ. รายปี** (D-06) |

### 3.5 Security / RBAC / SaaS

| # | ระดับ | ประเด็น | ข้อเสนอ |
|---|---|---|---|
| G-12 | ✅ | **1 user = 1 role = 1 tenant** (profiles) — โรงพิมพ์เล็กคนเดียวมักถือหลายบทบาท และ SoD (BR-R02) อาจทำให้ tenant ที่มี Manager คนเดียวอนุมัติไม่ได้เลย | `memberships(user_id, tenant_id, roles[])` หลาย role ได้; SoD ตรวจที่ "ตัวบุคคล" (ผู้ submit ≠ ผู้ approve) และ tenant ตั้ง `allow_self_approval` ได้ (บันทึก Audit พิเศษ) |
| G-23 | 🟡 | RBAC: Escalation 7.4 แจ้ง Executive แต่ Executive อ่านอย่างเดียว; "Dashboard บางส่วน" ของ Supervisor ไม่นิยาม; ใครเปลี่ยนสถานะเครื่องเป็น Maintenance | Executive = แจ้งเพื่อทราบ; Supervisor เห็น Dashboard ยกเว้นต้นทุน/Margin; Supervisor+Manager เปลี่ยนสถานะเครื่องได้ |
| G-24 | ✅ | ไม่มีการบังคับ Limit ตามแผน Subscription (ผู้ใช้/เครื่อง) | `plans.limits jsonb` + ตรวจใน RPC สร้างผู้ใช้/เครื่อง |

### 3.6 Phase & NFR

| # | ระดับ | ประเด็น | ข้อเสนอ |
|---|---|---|---|
| G-15 | ✅ | **Phase ไม่สอดคล้อง**: Executive Summary บอก Inventory อยู่ Phase 1 แต่ Roadmap วางไว้ Phase 2; Proof Gate (BR-R03) เป็น Must แต่ M5 อยู่ Phase 2 | **Inventory = Phase 2** (D-01); Gate เป็น feature flag ต่อ tenant (`stock_gate`, `proof_gate`) ปิดใน MVP; Sales Order สร้างจาก PO ลูกค้าโดยตรง (D-09) |
| G-17 | 🟠 | NFR Realtime < 2s ที่ 200 tenant × 50 users — `postgres_changes` ของ Supabase ประเมิน RLS ต่อ subscriber ต่อแถว จะช้าเมื่อโต | ใช้ **Realtime Broadcast** จาก trigger ไปยัง private channel `tenant:{id}:board` (authorize ด้วย RLS บน `realtime.messages`) |
| G-25 | 🟡 | Escalation "รออนุมัติเกิน 24 ชม." ต้องมี Scheduler แต่ n8n อยู่ Phase 2 | ใช้ `pg_cron` ใน MVP (in-app notification); n8n/Email/LINE ภายหลัง |
| G-26 | 🟡 | PDPA: สิทธิ์ลบ/Export — ขัดกับ Audit Log ที่แก้ไม่ได้ | ลบ = anonymize ข้อมูลส่วนบุคคลของลูกค้า/ผู้ติดต่อ; audit เก็บ id ไม่เก็บ PII ซ้ำ |

## 4. Decision Log — คำตอบ Open Questions (27 ต.ค. 2026)

| # | คำถาม | การตัดสินใจ | กระทบ |
|---|---|---|---|
| D-01 | Inventory อยู่ Phase ไหน | **Phase 2** — MVP ปิด `stock_gate` | G-15, G-08 |
| D-02 | n-up / รอบพิมพ์ เก็บระดับไหน | **ระดับ Step** (`n_up`, `passes` ต่อ job_step) | G-10 |
| D-03 | ต้นทุนเครื่อง / Overhead | **tenant กรอก `cost_per_hour` ต่อเครื่องเอง** + Overhead % ระดับบริษัท | G-09 |
| D-04 | Re-approval ระหว่างผลิต | **Step ที่กำลังทำ ทำต่อได้ — ห้ามเริ่ม Step ใหม่** จนกว่าอนุมัติ | G-02 |
| D-05 | Manager คนเดียวอนุมัติงานตัวเอง | **ได้ เมื่อ Admin เปิด `allow_self_approval`** — ทุกครั้งบันทึก Audit พิเศษ (ค่าเริ่มต้นปิด) | G-12, BR-R02 |
| D-06 | รูปแบบเลขเอกสาร | **ตั้งค่าได้ต่อ tenant** ค่าเริ่มต้น ค.ศ. รีเซ็ตรายปี (`SO-2026-0001`) | G-16 |
| D-07 | Step ขนาน | **ต้องมีใน MVP** — Step ที่ `seq` เท่ากันทำพร้อมกันได้ | G-06 |
| D-08 | หลายคลัง / Lot | **คลังเดียว ไม่ติดตาม Lot** — เก็บ `warehouse_id` ไว้ในตารางเพื่อขยายภายหลัง | G-14 |
| D-09 | การคิดราคา / Quotation | **ระบบเป็น MRP ไม่ใช่ระบบออกใบเสนอราคา** — รับ PO ที่ลูกค้ายืนยันแล้ว → Sales Order → Production Order → Gate การผลิต; **ตัด M2 Quotation ออก**, ราคาขายมาจาก PO | M2, M3, G-20, G-22 |
| D-10 | ใบกำกับภาษี / บัญชี | **ไม่เกี่ยวข้อง** — ไม่ออกเอกสารบัญชีและไม่ทำ Export ไปโปรแกรมบัญชี (แก้ไขจากเดิม ดู D-20) | Out-of-scope |
| D-11 | โมเดลราคา SaaS | **แพ็กเกจต่อบริษัท** จำกัดจำนวนเครื่อง/ผู้ใช้ (`plans.limits`) | G-24 |
| D-12 | Pilot customer | **มีแล้ว** — Phase 0 ใช้ข้อมูลเครื่องจักร/Process/งานจริงของ Pilot | Roadmap Phase 0 |
| D-13 | รูปแบบ PO | **PDF** — แนบไฟล์และกรอกรายการโดยดู PDF ข้างฟอร์ม; OCR PDF → รายการ เป็น AI ลำดับแรก (Phase 4) | M3, AI |
| D-14 | PO หลายรายการ → Job | **1 PO มีได้หลายรายการ** — Supervisor สร้างการ์ด Workflow (Job) และ **match กับรายการ PO ให้ครบ** (จำนวนที่ match = จำนวนใน PO ทุกรายการ) จึง Submit ได้ | G-22, BR-R11 ใหม่ |
| D-15 | ลำดับอนุมัติ | Supervisor ออกแบบ Flow (พิมพ์ → ตัด → เคลือบ → ส่งทำข้างนอก → แพ็ก ฯลฯ) + มอบหมายเครื่อง → Submit ทั้ง PO → **Manager อนุมัติ** → Job เข้า Gate การผลิตได้ | BR-03, §6.4 design |
| D-16 | ผู้วางแผน/มอบหมาย | **Supervisor** เป็นผู้ออกแบบ Flow และ assign งานลงเครื่อง (สอดคล้อง RBAC เดิม) | RBAC |
| D-17 | ผู้นำ PO เข้าระบบ | **Supervisor หรือ Manager** (สิทธิ์ `create_sales_order`) | RBAC |
| D-18 | หน่วยการอนุมัติ | **Submit ทั้ง PO → Manager Approve all ได้ในคลิกเดียว, Reject เฉพาะบาง Job ได้** | §6.4 design |
| D-20 | วัตถุประสงค์ของระบบ | **MRP เพื่อบริหารและจัดการงานผลิต** — ให้ผู้บริหารเห็นคิวและ Load ของเครื่องพิมพ์/เครื่องจักร และออก **รายงานสนับสนุนการตัดสินใจ**: ซื้อเครื่องจักรเพิ่ม, เพิ่มคน, ตัดสินใจเรื่องการผลิต (รับงาน/OT/Outsource/เลื่อนงาน) | M10 ขยาย, design §9 |
| D-21 | การจัดการงานแบบ Trello | **Task Board**: การ์ด Task ต่อ Step วางในคอลัมน์ต่อเครื่อง — ลากเพื่อ **โยกเครื่อง** และ **ปรับคิว** ได้ โดยระบบคำนวณเวลา/Load/Due ใหม่และตรวจกฎทุกครั้ง | M6 (FR-6.1–6.4), design §8.1 |
| D-22 | UX/UI | **เน้น User friendly ทันสมัย น่าใช้งาน** — Design system เดียว, งานหลัก ≤ 3 คลิก, Undo แทน Confirm, Mobile-first สำหรับ Staff, โหมด TV สำหรับผู้บริหาร, Usability test กับ Pilot ก่อนเขียนโค้ด (เป้า SUS ≥ 75) | NFR Usability, design §8.0 |
| D-23 | Infrastructure | **Database/Backend = Supabase**, **Frontend รันบน Firebase Hosting** (แทน Vercel ใน SRS §9) | design §2.1 |
| D-24 | ส่งของขาดจากจำนวนสั่ง (UAT 1 พ.ย. 2026) | **ส่งได้ไม่เกินของดีจากขั้นสุดท้าย** (รวมงานแก้) ถ้าไม่ทำเพิ่ม Manager/Admin **ปิดงานแบบส่งขาด** พร้อมเหตุผล ต้องส่งแล้วอย่างน้อยหนึ่งครั้ง | G-07, G-21, FR-9.3 |
| D-25 | สิทธิ์ของ Staff (UAT 1 พ.ย. 2026) | **Staff ไม่เห็นราคาขาย, PO, Dashboard, หน้าอนุมัติ และหน้าจ้างนอก** ตาม RBAC §10; คอลัมน์ `unit_price` อ่านผ่าน `sales_order_item_prices_v` เท่านั้น | SRS §10 |
| D-19 | Gang run | **1 Job รวมหลายรายการ PO ได้** (พิมพ์รวมแผ่น) — ใช้ `job_order_items` แบบ M:N | D-14 |

**คำถามที่ยังเปิด (ถามโรงพิมพ์นำร่องใน Phase 0):**

1. ~~รูปแบบ PO~~ → D-13 · ~~หลายรายการ~~ → D-14
2. ~~Export บัญชี~~ → ตัดออก (D-10, D-20)
3. ~~ผู้นำ PO เข้าระบบ~~ → D-17 · ~~หน่วยการอนุมัติ~~ → D-18 · ~~รวมหลายรายการใน Job เดียว~~ → D-19

## 5. ความเสี่ยงเพิ่มเติม (นอกเหนือ SRS §12)

| ความเสี่ยง | ผลกระทบ | แนวทางลด |
|---|---|---|
| ข้อมูล Master (Capacity, Efficiency, ปฏิทิน) ไม่ครบตอน Onboard → Board ไม่มีความหมาย | ผู้ใช้เลิกใช้ในสัปดาห์แรก | Onboarding Wizard + Template ข้อมูลเครื่องจักรมาตรฐาน (Heidelberg SM74, Konica ฯลฯ) ให้แก้ตัวเลข |
| Logic ใน PL/pgSQL เยอะ → ทดสอบ/ดีบักยาก | Bug เงียบในกฎสำคัญ | pgTAP ครอบทุก RPC, migration-only workflow, ห้ามแก้ DB ผ่าน Dashboard |
| Drag & Drop + Recalc schedule พร้อมกันหลายคน | คิวเพี้ยน/ชนกัน | `SELECT … FOR UPDATE` ต่อเครื่อง + optimistic version บนการ์ด |
| Supabase vendor lock-in | ย้ายยากเมื่อโต | Logic อยู่ใน Postgres มาตรฐาน; Frontend เรียกผ่าน `api` layer เดียว |

## 6. ข้อสรุป

SRS มีทิศทางถูกต้องและเลือกสถาปัตยกรรมเหมาะกับทีมเล็ก ช่องว่างหลักอยู่ที่ **"กลไก" ที่อยู่ระหว่างกฎ** — การปล่อยผลิต (G-01), การคำนวณตารางเวลา (G-05), หน่วยในสูตรกำลังผลิต (G-10), นิยามต้นทุน (G-09), และ Phase ของ Gate (G-15) ซึ่งเอกสารออกแบบ [02-system-design.md](02-system-design.md) เสนอทางแก้ไว้แล้ว และคำถามเชิงธุรกิจหลักได้ตัดสินใจแล้วใน Decision Log §4 — ไม่มีคำถามค้างที่บล็อกการเริ่ม Build

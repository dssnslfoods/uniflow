---
description: รันเทสต์ฐานข้อมูลทั้งหมด (migrations + pgTAP) บน PostgreSQL ในเครื่อง
---

รันเทสต์ฐานข้อมูลของ Uniflow:

```bash
UNIFLOW_PG_WORKDIR="<scratchpad>/pgtest" bash scripts/db-test-local.sh
```

ใช้โฟลเดอร์ scratchpad ของ session เป็น `UNIFLOW_PG_WORKDIR`

สรุปผลเป็นตาราง: ไฟล์เทสต์, ผ่านกี่ข้อจากทั้งหมด ถ้ามีข้อไม่ผ่านหรือ ERROR ให้แสดงข้อความ บอกสาเหตุ และเสนอวิธีแก้ (อย่าแก้เองถ้าผู้ใช้ไม่ได้สั่ง)

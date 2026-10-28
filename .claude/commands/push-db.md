---
description: ดู migration ที่ยังไม่ขึ้น แล้ว push ขึ้น Supabase project จริง
---

Push migration ของ Uniflow ขึ้น project จริง (ref `jsixbvqqkxgbcjpefybk`):

1. `supabase db push --dry-run` แสดงรายการ migration ที่จะขึ้น ถ้าไม่มี ให้บอกว่าเป็นปัจจุบันแล้วและจบ
2. รัน `/db-test` ก่อน ถ้าไม่ผ่าน ให้หยุดและรายงาน
3. `supabase db push --yes`
4. ยืนยันด้วย `supabase migration list` ว่าคอลัมน์ Local และ Remote ตรงกัน
5. รายงานผลเป็นภาษาไทย

ห้ามใช้ `supabase config push` ในคำสั่งนี้

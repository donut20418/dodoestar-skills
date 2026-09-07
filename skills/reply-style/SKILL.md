---
name: reply-style
description: How this user wants Claude to talk and to close out work - short, plain-language answers, and a three-part wrap-up (ทำไปแล้ว / เหลืออะไร / ถัดไป). Use when finishing any task, reporting results, summarizing a change, answering a question about the code, or whenever a reply is getting long, table-heavy, or header-heavy. Also covers when to stop and ask instead of editing.
---

# Reply style

Rules for any AI coding assistant working with this user.
เจ้าของ repo อ่านเร็ว และอ่านบนมือถือบ่อย เขียนให้ "สั้น ได้ใจความ อ่านง่าย"

Answer in whatever language the user's message is in (usually Thai).

## 1. รูปแบบคำตอบ / Answer shape

- ขึ้นต้นด้วยคำตอบ ไม่ใช่บทนำ ("ใช่ พังตรง X" ก่อน แล้วค่อยอธิบาย)
- bullet สั้น ๆ ไม่กี่ข้อ ประโยคเดียวจบต่อข้อ
- ไม่ต้องมี header / ตาราง เว้นแต่ผู้ใช้ขอ หรือของมันเป็นตารางจริง ๆ
- code block เฉพาะโค้ดหรือคำสั่งที่เขาจะรันจริง
- ไม่ต้องสรุปซ้ำสิ่งที่เพิ่งพูดไป ไม่ต้องขอโทษยาว ๆ

## 2. ปิดงานด้วย 3 หัวข้อนี้เสมอ / Always close with these three

```
ทำไปแล้ว          (done)
- <ผลลัพธ์ ไม่ใช่ log การแก้ทีละไฟล์>

เหลืออะไร         (what is left)
- <งานที่ยังไม่จบ หรือที่ข้ามไป + เพราะอะไร ถ้าไม่เหลือ ใส่ "-">

ถัดไป             (next)
- <ข้อเดียว ที่แนะนำจริง ๆ>
```

- แต่ละหัวข้อ 1-3 บรรทัด ไม่ใช่ changelog
- "เหลืออะไร" ห้ามเงียบ ถ้ายังไม่จบหรือข้ามอะไรไปต้องบอก
- "ถัดไป" เสนอข้อเดียว ไม่ใช่เมนู 5 ทางเลือก

## 3. ก่อนลงมือแก้ / Before editing

- ไม่ชัด = ถาม ไม่ใช่เดาแล้วแก้
- ผู้ใช้แจ้งอาการทางสายตา (UI เพี้ยน สีผิด ระยะไม่สวย) -> วิเคราะห์และเสนอเป็นข้อความก่อน รอไฟเขียวค่อยแก้ไฟล์
- ห้าม commit เอง รอสัญญาณจากผู้ใช้ (เช่น "เริ่ม Phase ถัดไป")

## 4. ตอนทำงาน / While working

- แก้ที่ชั้นโครงสร้าง ไม่ใช่ที่อาการ (ผักชีโรยหน้าคือของต้องห้าม)
  เช่น item ห่างเกิน -> แก้ layout ตัวแม่ ไม่ใช่ margin ของทุก item
- เก็บของค้างให้จบก่อนปิดงาน ถ้า "ถัดไป" กลายเป็น "ไปตามดู error ที่เพิ่งเห็น" แปลว่ายังไม่จบ
- ตัวเลข ขนาด พฤติกรรม framework: วัดจริงก่อนพูด อย่าตอบจากความจำ
- เขียนเทสไว้ในโฟลเดอร์เทสของโปรเจกต์ ไม่ใช่สคริปต์ลอย ๆ ที่ root
- จะให้ดูรูป ให้แสดงรูปแบบ inline ถ้าเครื่องมือทำได้ (แนบไฟล์เฉย ๆ มักไม่ขึ้นบนมือถือ)

## ตัวอย่าง / Example

Bad:
> ผมได้ทำการตรวจสอบไฟล์ทั้งหมดแล้ว พบว่ามีหลายจุดที่เกี่ยวข้อง... (ตาราง 8 แถว) ...สรุปได้ว่า

Good:
> สาเหตุคือ layout ตัวแม่ตั้ง spacing ไว้ 12 ทุก item เลยห่าง
>
> ทำไปแล้ว
> - แก้ spacing ที่ Column ตัวเดียว item ไม่ต้องแตะ
>
> เหลืออะไร
> - -
>
> ถัดไป
> - เปิดแอปดูหน้า Layers ว่าไม่ชิดเกินไป

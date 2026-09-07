# reply-style - ติดตั้งให้ AI ตัวอื่นใช้

`AGENTS.md` คือตัวจริง (tool-neutral) ส่วน `SKILL.md` คือฉบับของ Claude Code
ที่ generate มาจากมัน แก้ที่ `AGENTS.md` แล้วรัน `sh sync.sh` ทุกครั้ง

## วางไว้ตรงไหน

| เครื่องมือ | ที่อยู่ไฟล์ |
|---|---|
| Claude Code | `~/.claude/skills/reply-style/SKILL.md` (อยู่แล้ว) |
| Codex CLI / Jules / เอเจนต์ที่อ่าน AGENTS.md | `AGENTS.md` ที่ root ของโปรเจกต์ (Codex อ่าน `~/.codex/AGENTS.md` ด้วย) |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Gemini CLI | `GEMINI.md` ที่ root หรือ `~/.gemini/GEMINI.md` |
| Cursor | `.cursor/rules/reply-style.mdc` (ใส่ `alwaysApply: true` ใน frontmatter) |
| Windsurf | `.windsurf/rules/reply-style.md` |
| Cline | `.clinerules/reply-style.md` |
| อื่น ๆ / chat ทั่วไป | paste เนื้อ `AGENTS.md` เข้า custom instructions |

ตำแหน่งพวกนี้เปลี่ยนตามเวอร์ชันของเครื่องมือได้ ถ้าตัวไหนไม่ทำงาน เช็คเอกสารของมันก่อน

## ติดตั้งเข้าโปรเจกต์

```powershell
powershell -File "$env:USERPROFILE\.claude\skills\reply-style\install.ps1" -Project "C:\path\to\your-project"
```

ใส่ `-Tools agents,copilot,gemini,cursor` เพื่อเลือกเฉพาะบางตัว (default = ทั้งหมด)

## ข้อควรระวัง

- ไฟล์นี้มีภาษาไทย ถ้า repo ปลายทางมีกฎว่า project notes ต้องเป็น ASCII อย่างเดียว
  มันจะชนกฎ ให้ตัดสินใจก่อนว่าจะยกเว้นให้ไฟล์นี้ หรือปล่อยไว้นอก repo
  (วางที่ระดับ user เช่น `~/.codex/AGENTS.md` ก็ใช้ได้ ไม่ต้อง commit)
- ไฟล์ที่ install.ps1 เขียนเป็นสำเนา ไม่ใช่ link แก้ต้นทางแล้วต้องรัน install ใหม่

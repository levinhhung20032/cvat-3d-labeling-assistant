// Thư mục dự án dùng chung giữa Windows và Linux. `npm install` xoá binding native của HĐH kia,
// nên script này tải (npm pack) và giải nén binding rolldown cho một hoặc mọi HĐH vào node_modules,
// không đụng package.json / package-lock.json. Binding chỉ là file thêm, không ảnh hưởng nhau.
// Dùng: node scripts/sync-native.mjs   (chạy sau mỗi lần `npm install`)
import { existsSync, readFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const targets = ['win32-x64-msvc', 'linux-x64-gnu']
const version = JSON.parse(readFileSync('node_modules/rolldown/package.json', 'utf8')).version
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
for (const t of targets) {
  const dest = `node_modules/@rolldown/binding-${t}`
  if (existsSync(dest)) { console.log('OK  ', dest); continue }
  const tmp = mkdtempSync(join(tmpdir(), 'cvla-native-'))
  try {
    execFileSync(npm, ['pack', `@rolldown/binding-${t}@${version}`, '--pack-destination', tmp], { stdio: 'inherit', shell: process.platform === 'win32' })
    const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'))
    mkdirSync(dest, { recursive: true })
    execFileSync('tar', ['-xzf', join(tmp, tgz), '-C', dest, '--strip-components=1'], { stdio: 'inherit' })
    console.log('ADD ', dest)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

import { api } from '../shared/api';
import { originPattern, parseOrigin, patternOrigin } from '../shared/hosts';

/**
 * Trang Cài đặt: danh sách máy chủ CVAT = các quyền host extension đang có. Host trong manifest là mặc định (không gỡ được);
 * máy chủ thêm ở đây là quyền host TÙY CHỌN, trình duyệt hỏi người dùng cho từng tên miền; gỡ thì trả lại quyền.
 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const list = $<HTMLUListElement>('list'), form = $<HTMLFormElement>('add'), input = $<HTMLInputElement>('host'), msg = $<HTMLParagraphElement>('msg');
const isOrigin = (o: string | null): o is string => !!o;
const manifestHosts: string[] = (api.runtime.getManifest() as chrome.runtime.ManifestV3).host_permissions ?? [];
const defaults = new Set<string>(manifestHosts.map(patternOrigin).filter(isOrigin));

const say = (text: string, tone: '' | 'ok' | 'bad' = '') => { msg.textContent = text; msg.className = tone; };

async function render(): Promise<void> {
  const all = await api.permissions.getAll();
  const granted: string[] = all.origins ?? [];
  const origins = [...new Set<string>([...defaults, ...granted.map(patternOrigin).filter(isOrigin)])].sort();
  list.replaceChildren(...origins.map((o) => {
    const li = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = o;
    li.append(code);
    if (defaults.has(o)) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'mặc định';
      li.append(tag);
    } else {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = 'Gỡ';
      rm.title = `Gỡ ${o}: tool không chạy trên máy chủ này nữa (dữ liệu nháp đã lưu vẫn giữ)`;
      rm.onclick = async () => {
        const ok = await api.permissions.remove({ origins: [originPattern(o)] });
        say(ok ? `Đã gỡ ${o}.` : `Không gỡ được ${o}.`, ok ? 'ok' : 'bad');
        await render();
      };
      li.append(rm);
    }
    return li;
  }));
}

form.onsubmit = (e) => {
  e.preventDefault();
  const origin = parseOrigin(input.value);
  if (!origin) { say('Tên miền không hợp lệ: cần https, một tên miền cụ thể (không IP, không ký tự *, không cổng riêng).', 'bad'); return; }
  // Firefox: permissions.request phải được gọi ngay trong thao tác của người dùng (không await gì trước).
  void api.permissions.request({ origins: [originPattern(origin)] }).then(async (ok) => {
    if (ok) { input.value = ''; say(`Đã thêm ${origin}. Quay lại tab CVAT và bấm biểu tượng extension.`, 'ok'); } else say(`Chưa thêm ${origin}: quyền không được cấp.`, 'bad');
    await render();
  }, (err: unknown) => say(`Không thêm được: ${String(err)}`, 'bad'));
};

// Mở từ biểu tượng extension trên trang job của một máy chủ chưa thêm: điền sẵn tên miền đó.
const pre = new URLSearchParams(location.hash.slice(1)).get('add');
if (pre) {
  input.value = pre;
  say(`Tool chưa được bật cho ${pre}. Bấm "Thêm" để cho phép.`);
}
void render();

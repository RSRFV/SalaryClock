# 时薪时钟 SalaryClock — 本地预览

纯静态 PWA，零构建依赖。

## 启动

在本目录执行：

```powershell
.\start-demo.ps1
```

或手动：

```powershell
python -m http.server 8787 --bind 127.0.0.1 --directory .
```

然后浏览器打开 <http://127.0.0.1:8787/>。

> 位置打卡需要 **HTTPS 或 localhost** 才能调用浏览器定位；用 `127.0.0.1` 打开即可测试。
> 手机真机访问需部署到 HTTPS（Vercel / Netlify / Cloudflare Pages 均可），
> 或先用「设置 → 公司位置 → 关闭/提醒」手动计时。

## 功能

| 模块 | 内容 |
| --- | --- |
| 打卡 | 定位围栏（关闭/提醒/严格）、上班打卡、正常↔加班切换、下班结算 |
| 实时 | 今日已赚逐秒累加、本月累计、月薪进度、今日明细 |
| 记录 | 按月浏览、每天每段工时与金额、补录、删除、实发校准（对比 + 反推税后时薪） |
| 设置 | 时薪公式与口径预设（法定 21.75 / 本月工作日 / 排班天数 / 自定义）、加班固定时薪或倍率（平日/周末/节假日可调）、法定节假日列表、排班制（手动 / CSV / JSON 导入）、公司位置、导出 JSON、清空 |
| 账户 | 注册 / 登录、云端快照同步、自动同步开关、服务器地址可配 |
| PWA | 离线可用、可添加到主屏幕 |
| 外观 | 白色简洁（默认）/ 夜间 / 粉色可爱 三套主题，设置页切换，立即生效并持久化 |

## 后端与同步

零第三方依赖，只需 Node 18+：

```powershell
node server/index.mjs
# → http://127.0.0.1:8788（同时托管前端与 API）
```

然后打开 <http://127.0.0.1:8788/>，在「设置 → 账户与同步」注册/登录即可。也可继续用静态预览（8787）并把服务器地址填成 `http://127.0.0.1:8788`。

| 接口 | 说明 |
| --- | --- |
| `POST /api/auth/register` | `{username, password}` → token |
| `POST /api/auth/login` | 同上，token 有效期 30 天 |
| `GET /api/sync` | 读取当前用户的快照 `{data, updatedAt}` |
| `PUT /api/sync` | 上传 `{data, updatedAt}`（整包快照） |
| `GET /api/health` | 健康检查 |

实现要点：密码 `scrypt` 加盐哈希、token 为 HMAC-SHA256 签名、数据落在 `server/data/users.json`（已 gitignore）、CORS 允许跨域便于本地双端口调试。**生产部署请放在 HTTPS 反向代理后**，并定期备份 `server/data`。详见 [`docs/后端与同步.md`](./docs/后端与同步.md)。

## 演示数据

- 首页首开为空，可在「设置 → 载入演示数据」一键生成：今天（09:05 上班，18:00 起加班进行中）+ 过去 8 个工作日。
- 也可用 URL 参数：`?demo=1`、`?tab=records`、`?tab=settings`。

## 测试算法

```powershell
node tests/calc.test.mjs
```

覆盖：时薪换算、固定/倍率加班、进行中实时累计、跨月过滤、金额/时长格式化、定位距离、本月工作日数、合规提示。

端到端（需本地服务 + Chrome 远程调试端口）：

```powershell
node tests/e2e.mjs
```

覆盖：打卡、加班切换、下班结算、补录、实发校准、口径预设、改薪重算、倍率预设、清空。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.html` | 单页骨架 + 底部三 Tab |
| `styles.css` | 移动优先深色主题 |
| `calc.js` | 纯函数计算内核（可复用） |
| `app.js` | 状态机、打卡流程、定位围栏、渲染 |
| `sw.js` / `manifest.webmanifest` | PWA 离线与安装 |
| `tests/calc.test.mjs` | 算法单测 |

## 文档与截图

- 产品方案评估与优化（PM 文档）：[`docs/产品方案评估与优化.md`](./docs/产品方案评估与优化.md)
- 界面截图：`docs/home.png`（白色简洁）、`docs/home-dark.png`（夜间）、`docs/home-pink.png`（粉色可爱）、`docs/settings.png`（时薪口径与主题）、`docs/settings-ot.png`（加班计费）、`docs/settings-shift.png`（排班制）、`docs/settings-sync.png`（账户同步）、`docs/records.png`（含实发校准）、`docs/checkout.png`（下班结算）、`docs/empty.png`

## 安装包

| 平台 | 产物 | 说明 |
| --- | --- | --- |
| Android | `dist/SalaryClock-android-debug.apk`（已构建，约 70 KB） | minSdk 21 / targetSdk 34，debug 签名，可直接安装自用；上架需自建 keystore |
| iOS | `dist/SalaryClock-ios-unsigned.ipa`（未签名，需构建或 CI） | **不能直接安装**，需 Sideloadly/AltStore 自签，或使用 Apple 开发者账号 |

- Android 本地重建：`cd android-native; .\build.ps1`（不依赖 Gradle，只用 aapt2/d8/apksigner）
- CI 构建入口：**Actions → Build Android APK / Build iOS (unsigned) → Run workflow**
- 详细步骤与签名说明见 [`docs/安装包构建说明.md`](./docs/安装包构建说明.md)
- 最快的 iOS 体验方式：把网页部署到 HTTPS（GitHub Pages 等），Safari 打开后「添加到主屏幕」

## 手机上用

1. 电脑与手机连同一 Wi-Fi，改用监听全部网卡启动（`start-demo.ps1` 默认只监听本机）：
   `python -m http.server 8787 --bind 0.0.0.0`
2. 手机浏览器打开 `http://<电脑IP>:8787/`，"添加到主屏幕"即为类 App 全屏体验。
3. 注意：**HTTP + 局域网访问时浏览器不允许定位**，App 会自动降级为手动打卡；需要真机测定位请部署到 HTTPS（Vercel / Netlify / Cloudflare Pages）。

## 数据

全部存 `localStorage['salary-clock-v1']`，结构：

```json
{
  "settings": { "monthlySalary": 16000, "workDaysPerMonth": 21.75, "hoursPerDay": 8, "otMode": "fixed", "otFixedRate": 100, "geofenceMode": "loose", "company": { "lat": 0, "lng": 0, "radius": 200 } },
  "days": {
    "2026-10-31": {
      "date": "2026-10-31",
      "segments": [
        { "t": "normal", "s": 1761904800000, "e": 1761933600000 },
        { "t": "overtime", "s": 1761933600000, "e": null }
      ]
    }
  },
  "months": {
    "2026-10": { "actualPay": 13500, "updatedAt": 1793443200000 }
  }
}
```

`t`：`normal` 正常 / `overtime` 加班；`s`/`e` 为毫秒时间戳，`e=null` 表示计时中。
`months[mk].actualPay` 是「实发校准」填写的实际到账金额，只用于对比，不参与计算。
金额不入库，始终由 `segments` 按当前设置实时推算 —— 改月薪或加班费，历史金额会同步重算。

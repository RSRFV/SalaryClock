# 鏃惰柂鏃堕挓 SalaryClock 鈥?鏈湴棰勮

绾潤鎬?PWA锛岄浂鏋勫缓渚濊禆銆?
## 鍚姩

鍦ㄦ湰鐩綍鎵ц锛?
```powershell
.\start-demo.ps1
```

鎴栨墜鍔細

```powershell
python -m http.server 8787 --bind 127.0.0.1 --directory .
```

鐒跺悗娴忚鍣ㄦ墦寮€ <http://127.0.0.1:8787/>銆?
> 浣嶇疆鎵撳崱闇€瑕?**HTTPS 鎴?localhost** 鎵嶈兘璋冪敤娴忚鍣ㄥ畾浣嶏紱鐢?`127.0.0.1` 鎵撳紑鍗冲彲娴嬭瘯銆?> 鎵嬫満鐪熸満璁块棶闇€閮ㄧ讲鍒?HTTPS锛圴ercel / Netlify / Cloudflare Pages 鍧囧彲锛夛紝
> 鎴栧厛鐢ㄣ€岃缃?鈫?鍏徃浣嶇疆 鈫?鍏抽棴/鎻愰啋銆嶆墜鍔ㄨ鏃躲€?
## 鍔熻兘

| 妯″潡 | 鍐呭 |
| --- | --- |
| 鎵撳崱 | 瀹氫綅鍥存爮锛堝叧闂?鎻愰啋/涓ユ牸锛夈€佷笂鐝墦鍗°€佹甯糕啍鍔犵彮鍒囨崲銆佷笅鐝粨绠?|
| 瀹炴椂 | 浠婃棩宸茶禋閫愮绱姞銆佹湰鏈堢疮璁°€佹湀钖繘搴︺€佷粖鏃ユ槑缁?|
| 璁板綍 | 鎸夋湀娴忚銆佹瘡澶╂瘡娈靛伐鏃朵笌閲戦銆佽ˉ褰曘€佸垹闄ゃ€佸疄鍙戞牎鍑嗭紙瀵规瘮 + 鍙嶆帹绋庡悗鏃惰柂锛?|
| 鏃ュ巻 | 椤舵爮鏃ュ巻鎸夐挳锛氭敹鍏ヨ鍥撅紙鏃ユ湡涓嬫柟鏄剧ず褰撳ぉ宸茶禋銆佺孩鐐规爣鑺傚亣鏃ワ級銆佹帓鐝鍥撅紙鐐规棩鏈熷垏鎹紤鎭?涓婄彮锛?|
| 璁剧疆 | 鏃惰柂鍏紡涓庡彛寰勯璁撅紙娉曞畾 21.75 / 鏈湀宸ヤ綔鏃?/ 鎺掔彮澶╂暟 / 鑷畾涔夛級銆佸姞鐝浐瀹氭椂钖垨鍊嶇巼锛堝钩鏃?鍛ㄦ湯/鑺傚亣鏃ュ彲璋冿級銆佹硶瀹氳妭鍋囨棩锛堣仈缃戝悓姝?+ 鎵嬪姩锛夈€佹帓鐝埗锛堟棩鍘嗙偣閫?/ CSV / JSON 瀵煎叆锛夈€佹墦鍗℃柟寮忥紙鎵嬪姩 / 鑷姩锛氬畾浣嶅洿鏍?+ 鎸囧畾 WiFi锛夈€佸叕鍙镐綅缃€佸鍑?JSON銆佹竻绌?|
| 璐︽埛 | 娉ㄥ唽 / 鐧诲綍銆佷簯绔揩鐓у悓姝ャ€佽嚜鍔ㄥ悓姝ュ紑鍏炽€佹湇鍔″櫒鍦板潃鍙厤 |
| PWA | 绂荤嚎鍙敤銆佸彲娣诲姞鍒颁富灞忓箷 |
| 澶栬 | 鐧借壊绠€娲侊紙榛樿锛? 澶滈棿 / 绮夎壊鍙埍 涓夊涓婚锛岃缃〉鍒囨崲锛岀珛鍗崇敓鏁堝苟鎸佷箙鍖?|

## 鍚庣涓庡悓姝?
闆剁涓夋柟渚濊禆锛屽彧闇€ Node 18+锛?
```powershell
node server/index.mjs
# 鈫?http://127.0.0.1:8788锛堝悓鏃舵墭绠″墠绔笌 API锛?```

鐒跺悗鎵撳紑 <http://127.0.0.1:8788/>锛屽湪銆岃缃?鈫?璐︽埛涓庡悓姝ャ€嶆敞鍐?鐧诲綍鍗冲彲銆備篃鍙户缁敤闈欐€侀瑙堬紙8787锛夊苟鎶婃湇鍔″櫒鍦板潃濉垚 `http://127.0.0.1:8788`銆?
| 鎺ュ彛 | 璇存槑 |
| --- | --- |
| `POST /api/auth/register` | `{username, password}` 鈫?token |
| `POST /api/auth/login` | 鍚屼笂锛宼oken 鏈夋晥鏈?30 澶?|
| `GET /api/sync` | 璇诲彇褰撳墠鐢ㄦ埛鐨勫揩鐓?`{data, updatedAt}` |
| `PUT /api/sync` | 涓婁紶 `{data, updatedAt}`锛堟暣鍖呭揩鐓э級 |
| `GET /api/holidays?year=2026` | 鑱旂綉璇诲彇鑺傚亣鏃ワ紙涓婃父鍙厤 `HOLIDAY_API`锛屾湰鍦扮紦瀛?7 澶╋紝澶辫触鍥為€€缂撳瓨锛?|
| `GET /api/health` | 鍋ュ悍妫€鏌?|

瀹炵幇瑕佺偣锛氬瘑鐮?`scrypt` 鍔犵洂鍝堝笇銆乼oken 涓?HMAC-SHA256 绛惧悕銆佹暟鎹惤鍦?`server/data/users.json`锛堝凡 gitignore锛夈€丆ORS 鍏佽璺ㄥ煙渚夸簬鏈湴鍙岀鍙ｈ皟璇曘€?*鐢熶骇閮ㄧ讲璇锋斁鍦?HTTPS 鍙嶅悜浠ｇ悊鍚?*锛屽苟瀹氭湡澶囦唤 `server/data`銆傝瑙?[`docs/鍚庣涓庡悓姝?md`](./docs/鍚庣涓庡悓姝?md)銆?
## 婕旂ず鏁版嵁

- 棣栭〉棣栧紑涓虹┖锛屽彲鍦ㄣ€岃缃?鈫?杞藉叆婕旂ず鏁版嵁銆嶄竴閿敓鎴愶細浠婂ぉ锛?9:05 涓婄彮锛?8:00 璧峰姞鐝繘琛屼腑锛? 杩囧幓 8 涓伐浣滄棩銆?- 涔熷彲鐢?URL 鍙傛暟锛歚?demo=1`銆乣?tab=records`銆乣?tab=settings`銆?
## 娴嬭瘯绠楁硶

```powershell
node tests/calc.test.mjs
```

瑕嗙洊锛氭椂钖崲绠椼€佸浐瀹?鍊嶇巼鍔犵彮銆佽繘琛屼腑瀹炴椂绱銆佽法鏈堣繃婊ゃ€侀噾棰?鏃堕暱鏍煎紡鍖栥€佸畾浣嶈窛绂汇€佹湰鏈堝伐浣滄棩鏁般€佸悎瑙勬彁绀恒€?
绔埌绔紙闇€鏈湴鏈嶅姟 + Chrome 杩滅▼璋冭瘯绔彛锛夛細

```powershell
node tests/e2e.mjs
```

瑕嗙洊锛氭墦鍗°€佸姞鐝垏鎹€佷笅鐝粨绠椼€佽ˉ褰曘€佸疄鍙戞牎鍑嗐€佸彛寰勯璁俱€佹敼钖噸绠椼€佸€嶇巼棰勮銆佹竻绌恒€?
## 鏂囦欢

| 鏂囦欢 | 浣滅敤 |
| --- | --- |
| `index.html` | 鍗曢〉楠ㄦ灦 + 搴曢儴涓?Tab |
| `styles.css` | 绉诲姩浼樺厛娣辫壊涓婚 |
| `calc.js` | 绾嚱鏁拌绠楀唴鏍革紙鍙鐢級 |
| `app.js` | 鐘舵€佹満銆佹墦鍗℃祦绋嬨€佸畾浣嶅洿鏍忋€佹覆鏌?|
| `sw.js` / `manifest.webmanifest` | PWA 绂荤嚎涓庡畨瑁?|
| `tests/calc.test.mjs` | 绠楁硶鍗曟祴 |

## 鏂囨。涓庢埅鍥?
- 浜у搧鏂规璇勪及涓庝紭鍖栵紙PM 鏂囨。锛夛細[`docs/浜у搧鏂规璇勪及涓庝紭鍖?md`](./docs/浜у搧鏂规璇勪及涓庝紭鍖?md)
- 鐣岄潰鎴浘锛歚docs/home.png`锛堢櫧鑹茬畝娲侊級銆乣docs/home-dark.png`锛堝闂达級銆乣docs/home-pink.png`锛堢矇鑹插彲鐖憋級銆乣docs/calendar.png`锛堟敹鍏ユ棩鍘嗭級銆乣docs/settings.png`锛堟椂钖彛寰勪笌涓婚锛夈€乣docs/settings-ot.png`锛堝姞鐝璐癸級銆乣docs/settings-shift.png`锛堟帓鐝埗锛夈€乣docs/schedule-calendar.png`锛堟帓鐝棩鍘嗭級銆乣docs/checkin.png`锛堣嚜鍔ㄦ墦鍗★級銆乣docs/settings-sync.png`锛堣处鎴峰悓姝ワ級銆乣docs/records.png`锛堝惈瀹炲彂鏍″噯锛夈€乣docs/checkout.png`锛堜笅鐝粨绠楋級銆乣docs/empty.png`

## 瀹夎鍖?
| 骞冲彴 | 浜х墿 | 璇存槑 |
| --- | --- | --- |
| Android | `dist/SalaryClock-android-debug.apk`锛堝凡鏋勫缓锛岀害 70 KB锛?| minSdk 21 / targetSdk 34锛宒ebug 绛惧悕锛屽彲鐩存帴瀹夎鑷敤锛涗笂鏋堕渶鑷缓 keystore |
| iOS | `dist/SalaryClock-ios-unsigned.ipa`锛堟湭绛惧悕锛岄渶鏋勫缓鎴?CI锛?| **涓嶈兘鐩存帴瀹夎**锛岄渶 Sideloadly/AltStore 鑷锛屾垨浣跨敤 Apple 寮€鍙戣€呰处鍙?|

- Android 鏈湴閲嶅缓锛歚cd android-native; .\build.ps1`锛堜笉渚濊禆 Gradle锛屽彧鐢?aapt2/d8/apksigner锛?- CI 鏋勫缓鍏ュ彛锛?*Actions 鈫?Build Android APK / Build iOS (unsigned) 鈫?Run workflow**
- 璇︾粏姝ラ涓庣鍚嶈鏄庤 [`docs/瀹夎鍖呮瀯寤鸿鏄?md`](./docs/瀹夎鍖呮瀯寤鸿鏄?md)
- 鏈€蹇殑 iOS 浣撻獙鏂瑰紡锛氭妸缃戦〉閮ㄧ讲鍒?HTTPS锛圙itHub Pages 绛夛級锛孲afari 鎵撳紑鍚庛€屾坊鍔犲埌涓诲睆骞曘€?
## 鎵嬫満涓婄敤

1. 鐢佃剳涓庢墜鏈鸿繛鍚屼竴 Wi-Fi锛屾敼鐢ㄧ洃鍚叏閮ㄧ綉鍗″惎鍔紙`start-demo.ps1` 榛樿鍙洃鍚湰鏈猴級锛?   `python -m http.server 8787 --bind 0.0.0.0`
2. 鎵嬫満娴忚鍣ㄦ墦寮€ `http://<鐢佃剳IP>:8787/`锛?娣诲姞鍒颁富灞忓箷"鍗充负绫?App 鍏ㄥ睆浣撻獙銆?3. 娉ㄦ剰锛?*HTTP + 灞€鍩熺綉璁块棶鏃舵祻瑙堝櫒涓嶅厑璁稿畾浣?*锛孉pp 浼氳嚜鍔ㄩ檷绾т负鎵嬪姩鎵撳崱锛涢渶瑕佺湡鏈烘祴瀹氫綅璇烽儴缃插埌 HTTPS锛圴ercel / Netlify / Cloudflare Pages锛夈€?
## 鏁版嵁

鍏ㄩ儴瀛?`localStorage['salary-clock-v1']`锛岀粨鏋勶細

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

`t`锛歚normal` 姝ｅ父 / `overtime` 鍔犵彮锛沗s`/`e` 涓烘绉掓椂闂存埑锛宍e=null` 琛ㄧず璁℃椂涓€?`months[mk].actualPay` 鏄€屽疄鍙戞牎鍑嗐€嶅～鍐欑殑瀹為檯鍒拌处閲戦锛屽彧鐢ㄤ簬瀵规瘮锛屼笉鍙備笌璁＄畻銆?閲戦涓嶅叆搴擄紝濮嬬粓鐢?`segments` 鎸夊綋鍓嶈缃疄鏃舵帹绠?鈥斺€?鏀规湀钖垨鍔犵彮璐癸紝鍘嗗彶閲戦浼氬悓姝ラ噸绠椼€?
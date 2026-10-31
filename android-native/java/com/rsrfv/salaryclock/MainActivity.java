package com.rsrfv.salaryclock;

import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.CalendarContract;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
import java.util.TimeZone;

/**
 * 轻量 WebView 壳：把打包在 assets/www 的 PWA 通过拦截式 https 源提供，
 * 这样 localStorage 与定位都处于安全上下文（file:// 会被限制）。
 * 不依赖 AndroidX / Gradle 依赖，纯粹用平台 API。
 */
public class MainActivity extends Activity {

    private static final String ORIGIN = "https://salaryclock.local";
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#F5F6F8"));

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowContentAccess(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);

        web.setBackgroundColor(Color.parseColor("#F5F6F8"));
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAsset(request.getUrl());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }
        });

        web.addJavascriptInterface(new WifiBridge(), "SalaryClockNative");
        if (Build.VERSION.SDK_INT >= 23
                && checkSelfPermission(android.Manifest.permission.READ_CALENDAR) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { android.Manifest.permission.READ_CALENDAR }, 1001);
        }
        web.loadUrl(ORIGIN + "/index.html");
        setContentView(web, new ViewGroup.LayoutParams(-1, -1));
    }

    /** 暴露当前 WiFi 名称给网页，用于「连接指定 WiFi 自动打卡」 */
    public class WifiBridge {
        @JavascriptInterface
        public String getWifiSsid() {
            try {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm == null || wm.getConnectionInfo() == null) return "";
                String ssid = wm.getConnectionInfo().getSSID();
                if (ssid == null) return "";
                if (ssid.startsWith("\"") && ssid.endsWith("\"") && ssid.length() > 1) {
                    return ssid.substring(1, ssid.length() - 1);
                }
                return ssid;
            } catch (Exception e) {
                return "";
            }
        }

        /** 读取本机日历中的节假日事件（标题含春节/国庆等关键词），供网页自动同步 */
        @JavascriptInterface
        public String getCalendarHolidays(int year) {
            try {
                if (Build.VERSION.SDK_INT >= 23
                        && checkSelfPermission(android.Manifest.permission.READ_CALENDAR) != PackageManager.PERMISSION_GRANTED) {
                    return "{\"error\":\"permission\"}";
                }
                java.util.Calendar start = java.util.Calendar.getInstance();
                start.set(year, java.util.Calendar.JANUARY, 1, 0, 0, 0);
                start.set(java.util.Calendar.MILLISECOND, 0);
                java.util.Calendar end = (java.util.Calendar) start.clone();
                end.add(java.util.Calendar.YEAR, 1);

                String[] projection = {
                        CalendarContract.Events.TITLE,
                        CalendarContract.Events.DTSTART,
                        CalendarContract.Events.ALL_DAY,
                };
                String selection = CalendarContract.Events.DTSTART + ">=? AND " + CalendarContract.Events.DTSTART + "<?";
                Cursor cursor = getContentResolver().query(
                        CalendarContract.Events.CONTENT_URI,
                        projection,
                        selection,
                        new String[] { String.valueOf(start.getTimeInMillis()), String.valueOf(end.getTimeInMillis()) },
                        null);

                String[] keywords = { "元旦", "春节", "除夕", "清明", "劳动节", "端午", "中秋", "国庆", "放假" };
                JSONArray dates = new JSONArray();
                if (cursor != null) {
                    while (cursor.moveToNext()) {
                        String title = cursor.getString(0);
                        if (title == null) continue;
                        boolean hit = false;
                        for (String keyword : keywords) {
                            if (title.contains(keyword)) {
                                hit = true;
                                break;
                            }
                        }
                        if (!hit) continue;
                        boolean allDay = cursor.getInt(2) == 1;
                        java.util.Calendar day = java.util.Calendar.getInstance(
                                allDay ? TimeZone.getTimeZone("UTC") : TimeZone.getDefault());
                        day.setTimeInMillis(cursor.getLong(1));
                        String date = String.format(Locale.US, "%04d-%02d-%02d",
                                day.get(java.util.Calendar.YEAR),
                                day.get(java.util.Calendar.MONTH) + 1,
                                day.get(java.util.Calendar.DAY_OF_MONTH));
                        JSONObject item = new JSONObject();
                        item.put("date", date);
                        item.put("name", title);
                        dates.put(item);
                    }
                    cursor.close();
                }
                JSONObject out = new JSONObject();
                out.put("dates", dates);
                return out.toString();
            } catch (Exception e) {
                return "{\"error\":\"" + e.getMessage() + "\"}";
            }
        }
    }

    private WebResourceResponse serveAsset(Uri url) {
        if (url == null || !"salaryclock.local".equals(url.getHost())) return null;
        String path = url.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
        if (path.contains("..")) return null;
        try {
            InputStream is = getAssets().open("www" + path);
            return new WebResourceResponse(mimeOf(path), "UTF-8", is);
        } catch (IOException e) {
            return null;
        }
    }

    private String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}

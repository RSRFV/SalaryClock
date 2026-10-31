package com.rsrfv.salaryclock;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Bundle;
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

import java.io.IOException;
import java.io.InputStream;

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

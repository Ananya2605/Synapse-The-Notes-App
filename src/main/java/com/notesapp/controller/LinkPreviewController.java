package com.notesapp.controller;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@RestController
@CrossOrigin(origins = "*", maxAge = 3600)
public class LinkPreviewController {

    private static final Pattern YOUTUBE_PATTERN = Pattern.compile(
            "(?:youtube\\.com/watch\\?v=|youtu\\.be/|youtube\\.com/embed/)([a-zA-Z0-9_-]{6,})"
    );
    private static final Pattern MAPS_PATTERN = Pattern.compile("(google\\.[a-z.]+/maps|goo\\.gl/maps|maps\\.app\\.goo\\.gl)");

    @GetMapping("/api/link-preview")
    public Map<String, Object> preview(@RequestParam("url") String url) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("url", url);

        String host;
        try {
            host = URI.create(url).getHost();
        } catch (Exception e) {
            host = "";
        }
        result.put("domain", host == null ? "" : host.replaceFirst("^www\\.", ""));

        Matcher yt = YOUTUBE_PATTERN.matcher(url);
        if (yt.find()) {
            String videoId = yt.group(1);
            result.put("type", "youtube");
            result.put("title", "YouTube video");
            result.put("thumbnail", "https://img.youtube.com/vi/" + videoId + "/hqdefault.jpg");
            result.put("embedUrl", "https://www.youtube.com/embed/" + videoId);
            return result;
        }

        if (MAPS_PATTERN.matcher(url).find()) {
            result.put("type", "map");
            result.put("title", "Google Maps location");
            result.put("embedUrl", "https://www.google.com/maps?q=" + java.net.URLEncoder.encode(url, java.nio.charset.StandardCharsets.UTF_8) + "&output=embed");
            return result;
        }

        if (!isSafePublicUrl(url)) {
            result.put("type", "link");
            result.put("title", url);
            result.put("description", "");
            result.put("error", "Preview isn't available for this address.");
            return result;
        }

        try {
            Document doc = Jsoup.connect(url)
                    .userAgent("Mozilla/5.0 (compatible; NotebookApp/1.0)")
                    .timeout(6000)
                    .get();

            String title = firstNonBlank(
                    doc.select("meta[property=og:title]").attr("content"),
                    doc.title()
            );
            String description = firstNonBlank(
                    doc.select("meta[property=og:description]").attr("content"),
                    doc.select("meta[name=description]").attr("content")
            );
            String image = doc.select("meta[property=og:image]").attr("content");
            String siteName = doc.select("meta[property=og:site_name]").attr("content");

            result.put("type", isDocumentLink(url) ? "document" : "link");
            result.put("title", title.isBlank() ? url : title);
            result.put("description", description);
            result.put("image", image);
            result.put("siteName", siteName.isBlank() ? result.get("domain") : siteName);
        } catch (Exception e) {
            result.put("type", isDocumentLink(url) ? "document" : "link");
            result.put("title", url);
            result.put("description", "");
            result.put("error", "Couldn't fetch a preview for this link.");
        }
        return result;
    }

    /** Only http(s) URLs pointing at public hosts - stops the server being used to probe internal networks. */
    private boolean isSafePublicUrl(String url) {
        try {
            URI uri = URI.create(url);
            String scheme = uri.getScheme();
            if (scheme == null || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) return false;
            String host = uri.getHost();
            if (host == null) return false;
            for (java.net.InetAddress addr : java.net.InetAddress.getAllByName(host)) {
                if (addr.isAnyLocalAddress() || addr.isLoopbackAddress() || addr.isLinkLocalAddress()
                        || addr.isSiteLocalAddress() || addr.isMulticastAddress()) {
                    return false;
                }
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean isDocumentLink(String url) {
        String lower = url.toLowerCase();
        return lower.endsWith(".pdf") || lower.endsWith(".doc") || lower.endsWith(".docx")
                || lower.endsWith(".xls") || lower.endsWith(".xlsx") || lower.endsWith(".ppt") || lower.endsWith(".pptx");
    }

    private String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) return v;
        }
        return "";
    }
}

package com.notesapp.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.notesapp.model.Note;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;

/**
 * Powers the "AI Assistant" and "Ask My Notes" features.
 *
 * By default this runs entirely offline using extractive / statistical NLP
 * (see {@link NlpUtils}) so the app works immediately after deployment with
 * zero configuration. If an ANTHROPIC_API_KEY environment variable is
 * present, methods transparently upgrade to real Claude-generated answers,
 * falling back to the offline heuristic if the API call fails for any
 * reason (missing credit, network issue, rate limit, etc.) so the feature
 * never breaks.
 */
@Service
public class AiService {

    private static final String ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
    private static final String MODEL = "claude-sonnet-4-6";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .build();

    public boolean isLiveAiEnabled() {
        String key = System.getenv("ANTHROPIC_API_KEY");
        return key != null && !key.isBlank();
    }

    // ---------------- Live Claude API pass-through ----------------

    private String callClaude(String systemPrompt, String userMessage) {
        String apiKey = System.getenv("ANTHROPIC_API_KEY");
        if (apiKey == null || apiKey.isBlank()) return null;
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", MODEL);
            body.put("max_tokens", 1024);
            body.put("system", systemPrompt);
            body.put("messages", List.of(Map.of("role", "user", "content", userMessage)));

            String json = objectMapper.writeValueAsString(body);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(ANTHROPIC_API_URL))
                    .timeout(Duration.ofSeconds(30))
                    .header("Content-Type", "application/json")
                    .header("x-api-key", apiKey)
                    .header("anthropic-version", "2023-06-01")
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) return null;

            JsonNode root = objectMapper.readTree(response.body());
            JsonNode content = root.path("content");
            StringBuilder sb = new StringBuilder();
            if (content.isArray()) {
                for (JsonNode block : content) {
                    if ("text".equals(block.path("type").asText())) {
                        sb.append(block.path("text").asText());
                    }
                }
            }
            String text = sb.toString().trim();
            return text.isEmpty() ? null : text;
        } catch (Exception e) {
            return null; // caller falls back to the offline heuristic
        }
    }

    // ---------------- Public AI operations ----------------

    public AiResult summarize(String html) {
        String plain = NlpUtils.toPlainText(html);
        if (plain.isBlank()) return AiResult.offline("There's nothing in this note yet to summarize.");

        String live = callClaude(
                "Summarize the user's note in 2-4 concise sentences. Reply with only the summary, no preamble.",
                plain);
        if (live != null) return AiResult.live(live);

        List<String> top = NlpUtils.topSentences(plain, 3);
        return AiResult.offline(String.join(" ", top));
    }

    public AiResult rewrite(String html) {
        String plain = NlpUtils.toPlainText(html);
        if (plain.isBlank()) return AiResult.offline("There's nothing in this note yet to rewrite.");

        String live = callClaude(
                "Rewrite the user's note to be clearer and better organized, keeping the same meaning and all facts. Reply with only the rewritten text.",
                plain);
        if (live != null) return AiResult.live(live);

        // Offline fallback: light-touch cleanup only (no LLM available).
        List<String> sentences = NlpUtils.splitSentences(plain);
        StringBuilder sb = new StringBuilder();
        for (String s : sentences) {
            String cleaned = s.trim();
            if (cleaned.isEmpty()) continue;
            cleaned = Character.toUpperCase(cleaned.charAt(0)) + cleaned.substring(1);
            if (!cleaned.matches(".*[.!?]$")) cleaned += ".";
            sb.append(cleaned).append(" ");
        }
        String cleanup = sb.toString().trim();
        return AiResult.offline(cleanup.isEmpty() ? plain : cleanup,
                "Basic cleanup only — connect an ANTHROPIC_API_KEY for full AI rewriting.");
    }

    public AiResult keyPoints(String html) {
        String plain = NlpUtils.toPlainText(html);
        if (plain.isBlank()) return AiResult.offlineList(List.of("There's nothing in this note yet."));

        String live = callClaude(
                "Extract the key points from the user's note as a short bullet list. Reply with only the bullet points, one per line, each starting with '- '.",
                plain);
        if (live != null) return AiResult.liveList(parseBulletLines(live));

        return AiResult.offlineList(NlpUtils.topSentences(plain, 5));
    }

    public AiResult checklist(String html) {
        String plain = NlpUtils.toPlainText(html);
        if (plain.isBlank()) return AiResult.offlineList(List.of());

        String live = callClaude(
                "Turn the user's note into an actionable checklist. Reply with only the checklist items, one per line, each starting with '- '.",
                plain);
        if (live != null) return AiResult.liveList(parseBulletLines(live));

        List<String> items = new ArrayList<>();
        for (String s : NlpUtils.splitSentences(plain)) {
            String item = s.replaceAll("[.!?]+$", "").trim();
            if (item.length() > 2) items.add(item);
        }
        return AiResult.offlineList(items);
    }

    public AiResult suggestMeta(String title, String html) {
        String plain = NlpUtils.toPlainText(html);
        String combined = (title == null ? "" : title) + " " + plain;

        String live = callClaude(
                "Given a note, suggest: 1) a short clear title (max 8 words), 2) one category from [Work, Personal, Study, Finance, Health, Travel, Ideas, Shopping, Other], 3) up to 5 short lowercase tags. " +
                        "Reply as exactly three lines: 'Title: ...', 'Category: ...', 'Tags: tag1, tag2, tag3'.",
                combined);
        if (live != null) {
            Map<String, Object> parsed = parseMetaLines(live);
            if (parsed != null) return AiResult.liveMeta(parsed);
        }

        List<String> keywords = NlpUtils.topKeywords(combined, 5);
        String suggestedTitle = title;
        if (suggestedTitle == null || suggestedTitle.isBlank() || suggestedTitle.equalsIgnoreCase("untitled note")) {
            List<String> sentences = NlpUtils.splitSentences(plain);
            suggestedTitle = sentences.isEmpty() ? "Untitled note" : NlpUtils.truncate(sentences.get(0), 60);
        }
        String category = guessCategory(combined);

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("title", suggestedTitle);
        meta.put("category", category);
        meta.put("tags", keywords);
        meta.put("source", "offline");
        return new AiResult(false, null, null, meta, null);
    }

    public AiResult askAboutNote(String html, String question) {
        String plain = NlpUtils.toPlainText(html);
        if (plain.isBlank()) return AiResult.offline("This note is empty, so I don't have anything to answer from.");

        String live = callClaude(
                "Answer the user's question using ONLY the information in this note. If the note doesn't contain the answer, say so plainly.\n\nNOTE:\n" + plain,
                question);
        if (live != null) return AiResult.live(live);

        List<String> sentences = NlpUtils.splitSentences(plain);
        List<int[]> scored = new ArrayList<>();
        for (int i = 0; i < sentences.size(); i++) {
            scored.add(new int[]{i, NlpUtils.relevance(question, sentences.get(i))});
        }
        scored.sort((a, b) -> Integer.compare(b[1], a[1]));

        if (scored.isEmpty() || scored.get(0)[1] == 0) {
            return AiResult.offline("I couldn't find anything about that in this note.");
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < Math.min(2, scored.size()); i++) {
            if (scored.get(i)[1] == 0) break;
            sb.append(sentences.get(scored.get(i)[0])).append(" ");
        }
        return AiResult.offline(sb.toString().trim());
    }

    /** "Ask My Notes": search across every note and answer using the best-matching ones. */
    public AiResult askMyNotes(List<Note> notes, String question) {
        List<int[]> scored = new ArrayList<>(); // [index, score]
        for (int i = 0; i < notes.size(); i++) {
            Note n = notes.get(i);
            String doc = n.getTitle() + " " + NlpUtils.toPlainText(n.getContentHtml()) + " " + String.join(" ", n.getTags());
            scored.add(new int[]{i, NlpUtils.relevance(question, doc)});
        }
        scored.sort((a, b) -> Integer.compare(b[1], a[1]));

        List<Note> matches = new ArrayList<>();
        for (int[] s : scored) {
            if (s[1] <= 0 || matches.size() >= 3) break;
            matches.add(notes.get(s[0]));
        }

        if (matches.isEmpty()) {
            Map<String, Object> meta = new LinkedHashMap<>();
            meta.put("answer", "I couldn't find any notes about that yet.");
            meta.put("matchedNoteIds", List.of());
            return new AiResult(false, null, null, meta, null);
        }

        StringBuilder context = new StringBuilder();
        for (Note n : matches) {
            context.append("### ").append(n.getTitle()).append("\n")
                    .append(NlpUtils.truncate(NlpUtils.toPlainText(n.getContentHtml()), 1500)).append("\n\n");
        }

        String live = callClaude(
                "Answer the user's question using ONLY the notes provided below. Mention which note(s) the answer came from by title. If the notes don't contain the answer, say so.\n\n" + context,
                question);

        String answer;
        if (live != null) {
            answer = live;
        } else {
            StringBuilder sb = new StringBuilder();
            for (Note n : matches) {
                String plain = NlpUtils.toPlainText(n.getContentHtml());
                List<String> best = NlpUtils.topSentences(plain, 1);
                if (!best.isEmpty()) {
                    sb.append("From \"").append(n.getTitle()).append("\": ").append(best.get(0)).append(" ");
                }
            }
            answer = sb.toString().trim();
            if (answer.isEmpty()) {
                answer = "Found related notes (" +
                        matches.stream().map(Note::getTitle).reduce((a, b) -> a + ", " + b).orElse("") +
                        ") but couldn't extract a direct answer.";
            }
        }

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("answer", answer);
        meta.put("matchedNoteIds", matches.stream().map(Note::getId).collect(java.util.stream.Collectors.toList()));
        meta.put("matchedTitles", matches.stream().map(Note::getTitle).collect(java.util.stream.Collectors.toList()));
        return new AiResult(live != null, null, null, meta, null);
    }

    /** Convert a note into another structured format: table | timeline | flashcards | outline | summary | checklist */
    public AiResult convert(String html, String format) {
        String plain = NlpUtils.toPlainText(html);
        List<String> sentences = NlpUtils.splitSentences(plain);

        switch (format.toLowerCase(Locale.ROOT)) {
            case "summary":
                return summarize(html);
            case "checklist":
                return checklist(html);
            case "table": {
                List<Map<String, String>> rows = new ArrayList<>();
                for (String s : sentences) {
                    String[] parts = s.split("[:\\-–]", 2);
                    Map<String, String> row = new LinkedHashMap<>();
                    row.put("item", parts[0].trim());
                    row.put("detail", parts.length > 1 ? parts[1].trim() : "");
                    rows.add(row);
                }
                Map<String, Object> meta = new LinkedHashMap<>();
                meta.put("rows", rows);
                return new AiResult(false, null, null, meta, null);
            }
            case "timeline": {
                List<Map<String, String>> steps = new ArrayList<>();
                for (int i = 0; i < sentences.size(); i++) {
                    Map<String, String> step = new LinkedHashMap<>();
                    step.put("label", "Step " + (i + 1));
                    step.put("text", sentences.get(i));
                    steps.add(step);
                }
                Map<String, Object> meta = new LinkedHashMap<>();
                meta.put("steps", steps);
                return new AiResult(false, null, null, meta, null);
            }
            case "flashcards": {
                List<Map<String, String>> cards = new ArrayList<>();
                List<String> top = NlpUtils.topSentences(plain, Math.min(8, sentences.size()));
                for (String s : top) {
                    List<String> words = NlpUtils.meaningfulWords(s);
                    String topic = words.isEmpty() ? "this" : words.get(0);
                    Map<String, String> card = new LinkedHashMap<>();
                    card.put("question", "What does the note say about \"" + topic + "\"?");
                    card.put("answer", s);
                    cards.add(card);
                }
                Map<String, Object> meta = new LinkedHashMap<>();
                meta.put("cards", cards);
                return new AiResult(false, null, null, meta, null);
            }
            case "outline":
            default: {
                List<String> outline = NlpUtils.topSentences(plain, Math.min(6, sentences.size()));
                Map<String, Object> meta = new LinkedHashMap<>();
                meta.put("outline", outline);
                return new AiResult(false, null, null, meta, null);
            }
        }
    }

    // ---------------- helpers ----------------

    private List<String> parseBulletLines(String text) {
        List<String> lines = new ArrayList<>();
        for (String line : text.split("\\r?\\n")) {
            String cleaned = line.replaceFirst("^[\\-•*\\d.\\)\\s]+", "").trim();
            if (!cleaned.isEmpty()) lines.add(cleaned);
        }
        return lines;
    }

    private Map<String, Object> parseMetaLines(String text) {
        try {
            String title = null, category = null;
            List<String> tags = new ArrayList<>();
            for (String line : text.split("\\r?\\n")) {
                String l = line.trim();
                if (l.toLowerCase(Locale.ROOT).startsWith("title:")) {
                    title = l.substring(l.indexOf(':') + 1).trim();
                } else if (l.toLowerCase(Locale.ROOT).startsWith("category:")) {
                    category = l.substring(l.indexOf(':') + 1).trim();
                } else if (l.toLowerCase(Locale.ROOT).startsWith("tags:")) {
                    String raw = l.substring(l.indexOf(':') + 1).trim();
                    for (String t : raw.split(",")) {
                        String tag = t.trim().toLowerCase(Locale.ROOT);
                        if (!tag.isEmpty()) tags.add(tag);
                    }
                }
            }
            if (title == null && category == null && tags.isEmpty()) return null;
            Map<String, Object> meta = new LinkedHashMap<>();
            meta.put("title", title);
            meta.put("category", category);
            meta.put("tags", tags);
            meta.put("source", "live");
            return meta;
        } catch (Exception e) {
            return null;
        }
    }

    private static final Map<String, List<String>> CATEGORY_KEYWORDS = Map.ofEntries(
            Map.entry("Work", List.of("meeting", "project", "deadline", "client", "report", "task", "team", "office")),
            Map.entry("Study", List.of("exam", "lecture", "chapter", "homework", "assignment", "study", "course", "notes")),
            Map.entry("Finance", List.of("budget", "expense", "invoice", "payment", "salary", "tax", "bank", "money")),
            Map.entry("Health", List.of("doctor", "workout", "diet", "medicine", "sleep", "exercise", "health", "appointment")),
            Map.entry("Travel", List.of("flight", "hotel", "trip", "itinerary", "passport", "vacation", "travel", "booking")),
            Map.entry("Shopping", List.of("buy", "price", "cart", "order", "store", "shopping", "discount")),
            Map.entry("Ideas", List.of("idea", "brainstorm", "concept", "plan", "vision", "startup"))
    );

    private String guessCategory(String text) {
        Map<String, Integer> freq = NlpUtils.wordFrequency(text);
        String best = "Personal";
        int bestScore = 0;
        for (Map.Entry<String, List<String>> entry : CATEGORY_KEYWORDS.entrySet()) {
            int score = 0;
            for (String kw : entry.getValue()) {
                score += freq.getOrDefault(kw, 0);
            }
            if (score > bestScore) {
                bestScore = score;
                best = entry.getKey();
            }
        }
        return best;
    }
}

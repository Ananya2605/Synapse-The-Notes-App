package com.notesapp.ai;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Small, dependency-free text utilities used to power the "offline" AI
 * heuristics (summarize, key points, checklist, search relevance, etc.)
 * whenever no live LLM API key is configured. Pure extractive/statistical
 * methods only - no external calls.
 */
public final class NlpUtils {

    private NlpUtils() {
    }

    public static final Set<String> STOP_WORDS = new HashSet<>(Arrays.asList(
            "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been", "being",
            "to", "of", "in", "on", "for", "with", "at", "by", "from", "as", "it", "its", "this",
            "that", "these", "those", "i", "you", "he", "she", "we", "they", "my", "your", "his",
            "her", "our", "their", "not", "have", "has", "had", "do", "does", "did", "will", "would",
            "can", "could", "should", "so", "if", "then", "there", "here", "just", "about", "into",
            "than", "them", "also", "very", "some", "any", "all", "only", "such", "no", "yes", "up",
            "out", "over", "again"
    ));

    private static final Pattern TAG_PATTERN = Pattern.compile("<[^>]*>");
    private static final Pattern WHITESPACE_PATTERN = Pattern.compile("\\s+");
    private static final Pattern WORD_PATTERN = Pattern.compile("[a-zA-Z0-9']+");
    private static final Pattern SENTENCE_SPLIT = Pattern.compile("(?<=[.!?])\\s+");

    /** Strips HTML tags and collapses whitespace, returning readable plain text. */
    public static String toPlainText(String html) {
        if (html == null) return "";
        String noTags = TAG_PATTERN.matcher(html).replaceAll(" ");
        String unescaped = noTags
                .replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'");
        return WHITESPACE_PATTERN.matcher(unescaped).replaceAll(" ").trim();
    }

    public static List<String> splitSentences(String plainText) {
        if (plainText == null || plainText.isBlank()) return Collections.emptyList();
        List<String> out = new ArrayList<>();
        for (String s : SENTENCE_SPLIT.split(plainText.trim())) {
            String trimmed = s.trim();
            if (!trimmed.isEmpty()) out.add(trimmed);
        }
        return out;
    }

    public static List<String> tokenize(String text) {
        List<String> tokens = new ArrayList<>();
        if (text == null) return tokens;
        Matcher m = WORD_PATTERN.matcher(text.toLowerCase(Locale.ROOT));
        while (m.find()) {
            tokens.add(m.group());
        }
        return tokens;
    }

    public static List<String> meaningfulWords(String text) {
        List<String> out = new ArrayList<>();
        for (String t : tokenize(text)) {
            if (t.length() > 3 && !STOP_WORDS.contains(t)) out.add(t);
        }
        return out;
    }

    /** Word-frequency map over meaningful (non-stopword) tokens. */
    public static Map<String, Integer> wordFrequency(String text) {
        Map<String, Integer> freq = new HashMap<>();
        for (String w : meaningfulWords(text)) {
            freq.merge(w, 1, Integer::sum);
        }
        return freq;
    }

    /**
     * Ranks sentences by the summed frequency-score of the meaningful words
     * they contain (classic extractive-summarization heuristic), returning
     * the top {@code count} sentences in their ORIGINAL order.
     */
    public static List<String> topSentences(String plainText, int count) {
        List<String> sentences = splitSentences(plainText);
        if (sentences.size() <= count) return sentences;

        Map<String, Integer> freq = wordFrequency(plainText);
        List<int[]> scored = new ArrayList<>(); // [index, score]
        for (int i = 0; i < sentences.size(); i++) {
            int score = 0;
            for (String w : meaningfulWords(sentences.get(i))) {
                score += freq.getOrDefault(w, 0);
            }
            scored.add(new int[]{i, score});
        }
        scored.sort((a, b) -> Integer.compare(b[1], a[1]));

        Set<Integer> chosen = new TreeSet<>();
        for (int i = 0; i < count && i < scored.size(); i++) {
            chosen.add(scored.get(i)[0]);
        }
        List<String> result = new ArrayList<>();
        for (int idx : chosen) result.add(sentences.get(idx));
        return result;
    }

    public static List<String> topKeywords(String text, int count) {
        Map<String, Integer> freq = wordFrequency(text);
        return freq.entrySet().stream()
                .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
                .limit(count)
                .map(Map.Entry::getKey)
                .collect(java.util.stream.Collectors.toList());
    }

    /** Simple relevance score between a query and a document: shared meaningful-word count. */
    public static int relevance(String query, String document) {
        Set<String> queryWords = new HashSet<>(meaningfulWords(query));
        if (queryWords.isEmpty()) return 0;
        int score = 0;
        for (String w : meaningfulWords(document)) {
            if (queryWords.contains(w)) score++;
        }
        return score;
    }

    public static String truncate(String text, int maxLen) {
        if (text == null) return "";
        return text.length() <= maxLen ? text : text.substring(0, maxLen).trim() + "…";
    }
}

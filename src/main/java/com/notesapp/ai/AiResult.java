package com.notesapp.ai;

import java.util.List;
import java.util.Map;

/** Uniform JSON-friendly result shape returned by every AiService operation. */
public class AiResult {

    private final boolean live;      // true = answered by the real Claude API, false = offline heuristic
    private final String text;       // free-text result (summary, rewrite, answer, ...)
    private final String note;       // optional disclaimer shown to the user (e.g. "basic cleanup only")
    private final Map<String, Object> meta;   // structured result (suggestMeta, convert, askMyNotes)
    private final List<String> list; // list-shaped result (key points, checklist)

    public AiResult(boolean live, String text, String note, Map<String, Object> meta, List<String> list) {
        this.live = live;
        this.text = text;
        this.note = note;
        this.meta = meta;
        this.list = list;
    }

    public static AiResult offline(String text) {
        return new AiResult(false, text, null, null, null);
    }

    public static AiResult offline(String text, String note) {
        return new AiResult(false, text, note, null, null);
    }

    public static AiResult live(String text) {
        return new AiResult(true, text, null, null, null);
    }

    public static AiResult offlineList(List<String> items) {
        return new AiResult(false, null, null, null, items);
    }

    public static AiResult liveList(List<String> items) {
        return new AiResult(true, null, null, null, items);
    }

    public static AiResult liveMeta(Map<String, Object> meta) {
        return new AiResult(true, null, null, meta, null);
    }

    public boolean isLive() {
        return live;
    }

    public String getText() {
        return text;
    }

    public String getNote() {
        return note;
    }

    public Map<String, Object> getMeta() {
        return meta;
    }

    public List<String> getList() {
        return list;
    }
}

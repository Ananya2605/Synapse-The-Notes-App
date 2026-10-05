package com.notesapp.controller;

import com.notesapp.ai.AiResult;
import com.notesapp.ai.AiService;
import com.notesapp.ai.NlpUtils;
import com.notesapp.dto.AskRequest;
import com.notesapp.dto.NoteRequest;
import com.notesapp.exception.NoteNotFoundException;
import com.notesapp.model.Attachment;
import com.notesapp.model.Note;
import com.notesapp.model.NoteVersion;
import com.notesapp.repository.AttachmentRepository;
import com.notesapp.repository.NoteRepository;
import com.notesapp.repository.NoteVersionRepository;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/notes")
@CrossOrigin(origins = "*", maxAge = 3600)
public class NoteController {

    private static final int MAX_VERSIONS_PER_NOTE = 20;

    private final NoteRepository noteRepository;
    private final NoteVersionRepository versionRepository;
    private final AttachmentRepository attachmentRepository;
    private final AiService aiService;

    public NoteController(NoteRepository noteRepository,
                           NoteVersionRepository versionRepository,
                           AttachmentRepository attachmentRepository,
                           AiService aiService) {
        this.noteRepository = noteRepository;
        this.versionRepository = versionRepository;
        this.attachmentRepository = attachmentRepository;
        this.aiService = aiService;
    }

    // ---------------- Basic CRUD ----------------

    @GetMapping
    public List<Note> getAllNotes() {
        return noteRepository.findAllByDeletedAtIsNullOrderByPinnedDescUpdatedAtDesc();
    }

    @GetMapping("/{id}")
    public ResponseEntity<Note> getNoteById(@PathVariable Long id) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));
        return ResponseEntity.ok(note);
    }

    @GetMapping("/favorites")
    public List<Note> getFavorites() {
        return noteRepository.findAllByFavoriteTrueAndDeletedAtIsNullOrderByUpdatedAtDesc();
    }

    @GetMapping("/archived")
    public List<Note> getArchived() {
        return noteRepository.findAllByArchivedTrueAndDeletedAtIsNullOrderByUpdatedAtDesc();
    }

    @GetMapping("/trash")
    public List<Note> getTrash() {
        return noteRepository.findAllByDeletedAtIsNotNullOrderByDeletedAtDesc();
    }

    @GetMapping("/folder/{folderId}")
    public List<Note> getByFolder(@PathVariable Long folderId) {
        return noteRepository.findAllByFolderIdAndDeletedAtIsNullOrderByPinnedDescUpdatedAtDesc(folderId);
    }

    /** Smart search: text match plus optional tag / category / favorite / file-type / date filters. */
    @GetMapping("/search")
    public List<Note> search(@RequestParam(value = "q", required = false) String q,
                              @RequestParam(value = "tag", required = false) String tag,
                              @RequestParam(value = "category", required = false) String category,
                              @RequestParam(value = "favorite", required = false) Boolean favorite,
                              @RequestParam(value = "hasFiles", required = false) Boolean hasFiles,
                              @RequestParam(value = "from", required = false) String from,
                              @RequestParam(value = "to", required = false) String to) {

        List<Note> base = (q == null || q.isBlank())
                ? noteRepository.findAllByDeletedAtIsNullOrderByPinnedDescUpdatedAtDesc()
                : noteRepository.findByTitleContainingIgnoreCaseOrContentHtmlContainingIgnoreCase(q, q)
                    .stream().filter(n -> n.getDeletedAt() == null).collect(Collectors.toList());

        // Meaning-based fallback: if the plain text/keyword match found nothing,
        // rank all notes by shared-keyword relevance instead (a lightweight
        // stand-in for semantic search).
        if ((q != null && !q.isBlank()) && base.isEmpty()) {
            base = noteRepository.findAllByDeletedAtIsNullOrderByPinnedDescUpdatedAtDesc().stream()
                    .map(n -> new AbstractMap.SimpleEntry<>(n, NlpUtils.relevance(q, n.getTitle() + " " + NlpUtils.toPlainText(n.getContentHtml()))))
                    .filter(e -> e.getValue() > 0)
                    .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
                    .map(AbstractMap.SimpleEntry::getKey)
                    .collect(Collectors.toList());
        }

        LocalDateTime fromDate = parseDateOrNull(from);
        LocalDateTime toDate = parseDateOrNull(to);

        return base.stream()
                .filter(n -> tag == null || tag.isBlank() || n.getTags().stream().anyMatch(t -> t.equalsIgnoreCase(tag)))
                .filter(n -> category == null || category.isBlank() || category.equalsIgnoreCase(n.getCategory()))
                .filter(n -> favorite == null || n.isFavorite() == favorite)
                .filter(n -> hasFiles == null || (hasFiles == !attachmentRepository.findAllByNoteIdOrderByUploadedAtDesc(n.getId()).isEmpty()))
                .filter(n -> fromDate == null || (n.getUpdatedAt() != null && !n.getUpdatedAt().isBefore(fromDate)))
                .filter(n -> toDate == null || (n.getUpdatedAt() != null && !n.getUpdatedAt().isAfter(toDate)))
                .collect(Collectors.toList());
    }

    private LocalDateTime parseDateOrNull(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return java.time.LocalDate.parse(value).atStartOfDay();
        } catch (Exception e) {
            return null;
        }
    }

    @PostMapping
    public ResponseEntity<Note> createNote(@Valid @RequestBody NoteRequest request) {
        Note note = new Note(request.getTitle(), request.getContentHtml());
        applyRequest(note, request);
        Note saved = noteRepository.save(note);
        return ResponseEntity.status(HttpStatus.CREATED).body(saved);
    }

    @PutMapping("/{id}")
    public ResponseEntity<Note> updateNote(@PathVariable Long id, @Valid @RequestBody NoteRequest request) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));

        // Snapshot the previous version before overwriting, for version history / undo.
        boolean changed = !Objects.equals(note.getTitle(), request.getTitle())
                || !Objects.equals(note.getContentHtml(), request.getContentHtml());
        if (changed) {
            versionRepository.save(new NoteVersion(note.getId(), note.getTitle(), note.getContentHtml()));
            trimOldVersions(note.getId());
        }

        applyRequest(note, request);
        Note saved = noteRepository.save(note);
        return ResponseEntity.ok(saved);
    }

    private void applyRequest(Note note, NoteRequest request) {
        note.setTitle(request.getTitle());
        note.setContentHtml(request.getContentHtml());
        note.setFolderId(request.getFolderId());
        if (request.getTags() != null) note.setTags(request.getTags());
        note.setCategory(request.getCategory());
        note.setColor(request.getColor());
    }

    private void trimOldVersions(Long noteId) {
        List<NoteVersion> versions = versionRepository.findAllByNoteIdOrderBySavedAtDesc(noteId);
        if (versions.size() > MAX_VERSIONS_PER_NOTE) {
            versions.subList(MAX_VERSIONS_PER_NOTE, versions.size())
                    .forEach(versionRepository::delete);
        }
    }

    // ---------------- Organization: pin / favorite / archive / trash ----------------

    @PatchMapping("/{id}/pin")
    public ResponseEntity<Note> togglePin(@PathVariable Long id) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));
        note.setPinned(!note.isPinned());
        return ResponseEntity.ok(noteRepository.save(note));
    }

    @PatchMapping("/{id}/favorite")
    public ResponseEntity<Note> toggleFavorite(@PathVariable Long id) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));
        note.setFavorite(!note.isFavorite());
        return ResponseEntity.ok(noteRepository.save(note));
    }

    @PatchMapping("/{id}/move")
    public ResponseEntity<Note> moveToFolder(@PathVariable Long id,
                                              @RequestParam(value = "folderId", required = false) Long folderId) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));
        note.setFolderId(folderId);
        return ResponseEntity.ok(noteRepository.save(note));
    }

    @PatchMapping("/{id}/archive")
    public ResponseEntity<Note> toggleArchive(@PathVariable Long id) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));
        note.setArchived(!note.isArchived());
        return ResponseEntity.ok(noteRepository.save(note));
    }

    /** Soft delete -> moves the note to Trash. */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> moveToTrash(@PathVariable Long id) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));
        note.setDeletedAt(LocalDateTime.now());
        noteRepository.save(note);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/restore")
    public ResponseEntity<Note> restoreFromTrash(@PathVariable Long id) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));
        note.setDeletedAt(null);
        return ResponseEntity.ok(noteRepository.save(note));
    }

    @DeleteMapping("/{id}/permanent")
    public ResponseEntity<Void> deletePermanently(@PathVariable Long id) {
        if (!noteRepository.existsById(id)) throw new NoteNotFoundException(id);

        List<Attachment> files = attachmentRepository.findAllByNoteIdOrderByUploadedAtDesc(id);
        attachmentRepository.deleteAll(files); // (attachment files on disk are cleaned up on next admin pass)
        versionRepository.findAllByNoteIdOrderBySavedAtDesc(id).forEach(versionRepository::delete);
        noteRepository.deleteById(id);
        return ResponseEntity.noContent().build();
    }

    // ---------------- Version history ----------------

    @GetMapping("/{id}/versions")
    public List<NoteVersion> getVersions(@PathVariable Long id) {
        return versionRepository.findAllByNoteIdOrderBySavedAtDesc(id);
    }

    @PostMapping("/{id}/versions/{versionId}/restore")
    public ResponseEntity<Note> restoreVersion(@PathVariable Long id, @PathVariable Long versionId) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));
        NoteVersion version = versionRepository.findById(versionId)
                .filter(v -> v.getNoteId().equals(id))
                .orElseThrow(() -> new NoteNotFoundException(id));

        versionRepository.save(new NoteVersion(note.getId(), note.getTitle(), note.getContentHtml()));
        note.setTitle(version.getTitleSnapshot());
        note.setContentHtml(version.getContentSnapshot());
        return ResponseEntity.ok(noteRepository.save(note));
    }

    // ---------------- Knowledge graph ----------------

    @GetMapping("/graph")
    public Map<String, Object> knowledgeGraph() {
        List<Note> notes = noteRepository.findAllByDeletedAtIsNullOrderByPinnedDescUpdatedAtDesc();

        List<Map<String, Object>> nodes = new ArrayList<>();
        for (Note n : notes) {
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("id", n.getId());
            node.put("title", n.getTitle());
            node.put("category", n.getCategory());
            node.put("tags", n.getTags());
            nodes.add(node);
        }

        List<Map<String, Object>> edges = new ArrayList<>();
        for (int i = 0; i < notes.size(); i++) {
            for (int j = i + 1; j < notes.size(); j++) {
                Note a = notes.get(i);
                Note b = notes.get(j);
                Set<String> shared = new HashSet<>(a.getTags());
                shared.retainAll(b.getTags());
                int strength = shared.size();
                if (a.getCategory() != null && a.getCategory().equalsIgnoreCase(b.getCategory())) strength += 1;

                if (strength > 0) {
                    Map<String, Object> edge = new LinkedHashMap<>();
                    edge.put("source", a.getId());
                    edge.put("target", b.getId());
                    edge.put("strength", strength);
                    edge.put("sharedTags", shared);
                    edges.add(edge);
                }
            }
        }

        Map<String, Object> graph = new LinkedHashMap<>();
        graph.put("nodes", nodes);
        graph.put("edges", edges);
        return graph;
    }

    // ---------------- Dashboard ----------------

    @GetMapping("/dashboard")
    public Map<String, Object> dashboard() {
        List<Note> active = noteRepository.findAllByDeletedAtIsNullOrderByPinnedDescUpdatedAtDesc();

        Map<String, Long> byCategory = active.stream()
                .collect(Collectors.groupingBy(n -> n.getCategory() == null || n.getCategory().isBlank() ? "Uncategorized" : n.getCategory(), Collectors.counting()));

        Map<String, Long> tagCounts = new LinkedHashMap<>();
        for (Note n : active) {
            for (String tag : n.getTags()) {
                tagCounts.merge(tag, 1L, Long::sum);
            }
        }
        List<Map.Entry<String, Long>> topTags = tagCounts.entrySet().stream()
                .sorted((a, b) -> Long.compare(b.getValue(), a.getValue()))
                .limit(8)
                .collect(Collectors.toList());

        List<Note> recentActivity = active.stream()
                .sorted((a, b) -> b.getUpdatedAt().compareTo(a.getUpdatedAt()))
                .limit(6)
                .collect(Collectors.toList());

        List<Note> favorites = active.stream().filter(Note::isFavorite).limit(6).collect(Collectors.toList());

        List<Attachment> recentFiles = attachmentRepository.findAll().stream()
                .sorted((a, b) -> b.getUploadedAt().compareTo(a.getUploadedAt()))
                .limit(6)
                .collect(Collectors.toList());

        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("totalNotes", active.size());
        stats.put("totalFavorites", active.stream().filter(Note::isFavorite).count());
        stats.put("totalArchived", noteRepository.findAllByArchivedTrueAndDeletedAtIsNullOrderByUpdatedAtDesc().size());
        stats.put("totalTrashed", noteRepository.findAllByDeletedAtIsNotNullOrderByDeletedAtDesc().size());
        stats.put("totalAttachments", attachmentRepository.count());
        stats.put("byCategory", byCategory);
        List<Map<String, Object>> topTagList = new ArrayList<>();
        for (Map.Entry<String, Long> e : topTags) {
            Map<String, Object> t = new LinkedHashMap<>();
            t.put("tag", e.getKey());
            t.put("count", e.getValue());
            topTagList.add(t);
        }
        stats.put("topTags", topTagList);
        stats.put("recentActivity", recentActivity);
        stats.put("favorites", favorites);
        stats.put("recentFiles", recentFiles);
        return stats;
    }

    // ---------------- Ask My Notes ----------------

    @PostMapping("/ask")
    public AiResult askMyNotes(@Valid @RequestBody AskRequest request) {
        List<Note> notes = noteRepository.findAllByDeletedAtIsNullOrderByPinnedDescUpdatedAtDesc();
        return aiService.askMyNotes(notes, request.getQuestion());
    }

    // ---------------- AI Assistant (per note) ----------------

    @PostMapping("/{id}/ai/summarize")
    public AiResult aiSummarize(@PathVariable Long id) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));
        return aiService.summarize(note.getContentHtml());
    }

    @PostMapping("/{id}/ai/rewrite")
    public AiResult aiRewrite(@PathVariable Long id) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));
        return aiService.rewrite(note.getContentHtml());
    }

    @PostMapping("/{id}/ai/key-points")
    public AiResult aiKeyPoints(@PathVariable Long id) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));
        return aiService.keyPoints(note.getContentHtml());
    }

    @PostMapping("/{id}/ai/checklist")
    public AiResult aiChecklist(@PathVariable Long id) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));
        return aiService.checklist(note.getContentHtml());
    }

    @PostMapping("/{id}/ai/suggest-meta")
    public AiResult aiSuggestMeta(@PathVariable Long id) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));
        return aiService.suggestMeta(note.getTitle(), note.getContentHtml());
    }

    @PostMapping("/{id}/ai/ask")
    public AiResult aiAskAboutNote(@PathVariable Long id, @Valid @RequestBody AskRequest request) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));
        return aiService.askAboutNote(note.getContentHtml(), request.getQuestion());
    }

    @GetMapping("/{id}/ai/convert")
    public AiResult aiConvert(@PathVariable Long id, @RequestParam("format") String format) {
        Note note = noteRepository.findById(id).orElseThrow(() -> new NoteNotFoundException(id));
        return aiService.convert(note.getContentHtml(), format);
    }

    /** Minimal public/read-only view of a note, used by share.html for the "copy shareable link" feature. */
    @GetMapping("/{id}/share")
    public ResponseEntity<Map<String, Object>> shareView(@PathVariable Long id) {
        Note note = noteRepository.findById(id).orElse(null);
        if (note == null || note.getDeletedAt() != null) {
            return ResponseEntity.notFound().build();
        }
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("title", note.getTitle());
        view.put("contentHtml", note.getContentHtml());
        view.put("updatedAt", note.getUpdatedAt());
        view.put("tags", note.getTags());
        return ResponseEntity.ok(view);
    }

    @GetMapping("/ai/status")
    public Map<String, Object> aiStatus() {
        Map<String, Object> status = new LinkedHashMap<>();
        status.put("liveAiEnabled", aiService.isLiveAiEnabled());
        return status;
    }
}

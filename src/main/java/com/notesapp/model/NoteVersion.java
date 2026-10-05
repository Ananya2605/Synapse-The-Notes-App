package com.notesapp.model;

import jakarta.persistence.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "note_versions")
public class NoteVersion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "note_id", nullable = false)
    private Long noteId;

    @Column(name = "title_snapshot", length = 150)
    private String titleSnapshot;

    @Column(name = "content_snapshot", length = 1000000)
    private String contentSnapshot;

    @Column(name = "saved_at")
    private LocalDateTime savedAt;

    public NoteVersion() {
    }

    public NoteVersion(Long noteId, String titleSnapshot, String contentSnapshot) {
        this.noteId = noteId;
        this.titleSnapshot = titleSnapshot;
        this.contentSnapshot = contentSnapshot;
        this.savedAt = LocalDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public Long getNoteId() {
        return noteId;
    }

    public String getTitleSnapshot() {
        return titleSnapshot;
    }

    public String getContentSnapshot() {
        return contentSnapshot;
    }

    public LocalDateTime getSavedAt() {
        return savedAt;
    }
}

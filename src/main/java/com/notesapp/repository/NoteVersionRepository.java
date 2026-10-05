package com.notesapp.repository;

import com.notesapp.model.NoteVersion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface NoteVersionRepository extends JpaRepository<NoteVersion, Long> {
    List<NoteVersion> findAllByNoteIdOrderBySavedAtDesc(Long noteId);
}

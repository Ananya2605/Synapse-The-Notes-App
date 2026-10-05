package com.notesapp.repository;

import com.notesapp.model.Note;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface NoteRepository extends JpaRepository<Note, Long> {

    List<Note> findAllByDeletedAtIsNullOrderByPinnedDescUpdatedAtDesc();

    List<Note> findAllByDeletedAtIsNotNullOrderByDeletedAtDesc();

    List<Note> findAllByArchivedTrueAndDeletedAtIsNullOrderByUpdatedAtDesc();

    List<Note> findAllByFavoriteTrueAndDeletedAtIsNullOrderByUpdatedAtDesc();

    List<Note> findAllByFolderIdAndDeletedAtIsNullOrderByPinnedDescUpdatedAtDesc(Long folderId);

    List<Note> findByTitleContainingIgnoreCaseOrContentHtmlContainingIgnoreCase(String title, String content);
}

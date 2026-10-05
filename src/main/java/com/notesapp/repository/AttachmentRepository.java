package com.notesapp.repository;

import com.notesapp.model.Attachment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AttachmentRepository extends JpaRepository<Attachment, Long> {
    List<Attachment> findAllByNoteIdOrderByUploadedAtDesc(Long noteId);
}

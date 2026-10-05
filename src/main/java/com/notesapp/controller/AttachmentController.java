package com.notesapp.controller;

import com.notesapp.model.Attachment;
import com.notesapp.repository.AttachmentRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.net.MalformedURLException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.UUID;

@RestController
@CrossOrigin(origins = "*", maxAge = 3600)
public class AttachmentController {

    private final AttachmentRepository attachmentRepository;
    private final Path uploadRoot;

    public AttachmentController(AttachmentRepository attachmentRepository,
                                 @Value("${app.upload-dir:./uploads}") String uploadDir) {
        this.attachmentRepository = attachmentRepository;
        this.uploadRoot = Paths.get(uploadDir).toAbsolutePath().normalize();
        try {
            Files.createDirectories(uploadRoot);
        } catch (IOException e) {
            throw new IllegalStateException("Could not create upload directory: " + uploadRoot, e);
        }
    }

    @GetMapping("/api/notes/{noteId}/attachments")
    public List<Attachment> listForNote(@PathVariable Long noteId) {
        return attachmentRepository.findAllByNoteIdOrderByUploadedAtDesc(noteId);
    }

    @PostMapping(value = "/api/notes/{noteId}/attachments", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Attachment> upload(@PathVariable Long noteId,
                                              @RequestParam("file") MultipartFile file) throws IOException {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        Path noteDir = uploadRoot.resolve(String.valueOf(noteId));
        Files.createDirectories(noteDir);

        String safeName = sanitizeFilename(file.getOriginalFilename());
        String storedName = UUID.randomUUID() + "_" + safeName;
        Path target = noteDir.resolve(storedName);
        file.transferTo(target);

        Attachment attachment = new Attachment();
        attachment.setNoteId(noteId);
        attachment.setOriginalName(safeName);
        attachment.setContentType(file.getContentType());
        attachment.setSizeBytes(file.getSize());
        attachment.setStoredPath(noteId + "/" + storedName);

        Attachment saved = attachmentRepository.save(attachment);
        return ResponseEntity.ok(saved);
    }

    @GetMapping("/api/attachments/{id}/download")
    public ResponseEntity<Resource> download(@PathVariable Long id) throws MalformedURLException {
        Attachment attachment = attachmentRepository.findById(id).orElse(null);
        if (attachment == null) return ResponseEntity.notFound().build();

        Path filePath = uploadRoot.resolve(attachment.getStoredPath()).normalize();
        if (!filePath.startsWith(uploadRoot) || !Files.exists(filePath)) {
            return ResponseEntity.notFound().build();
        }

        Resource resource = new UrlResource(filePath.toUri());
        String contentType = attachment.getContentType() != null
                ? attachment.getContentType()
                : "application/octet-stream";

        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(contentType))
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + attachment.getOriginalName() + "\"")
                .body(resource);
    }

    @DeleteMapping("/api/attachments/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) throws IOException {
        Attachment attachment = attachmentRepository.findById(id).orElse(null);
        if (attachment == null) return ResponseEntity.notFound().build();

        Path filePath = uploadRoot.resolve(attachment.getStoredPath()).normalize();
        if (filePath.startsWith(uploadRoot)) {
            Files.deleteIfExists(filePath);
        }
        attachmentRepository.delete(attachment);
        return ResponseEntity.noContent().build();
    }

    private String sanitizeFilename(String original) {
        if (original == null || original.isBlank()) return "file";
        String name = Paths.get(original).getFileName().toString();
        return name.replaceAll("[^a-zA-Z0-9._-]", "_");
    }
}

package com.notesapp.controller;

import com.notesapp.dto.FolderRequest;
import com.notesapp.model.Folder;
import com.notesapp.repository.FolderRepository;
import com.notesapp.repository.NoteRepository;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/folders")
@CrossOrigin(origins = "*", maxAge = 3600)
public class FolderController {

    private final FolderRepository folderRepository;
    private final NoteRepository noteRepository;

    public FolderController(FolderRepository folderRepository, NoteRepository noteRepository) {
        this.folderRepository = folderRepository;
        this.noteRepository = noteRepository;
    }

    @GetMapping
    public List<Folder> getAll() {
        return folderRepository.findAllByOrderByNameAsc();
    }

    @PostMapping
    public ResponseEntity<Folder> create(@Valid @RequestBody FolderRequest request) {
        Folder folder = new Folder(request.getName(), request.getParentId());
        folder.setColor(request.getColor());
        return ResponseEntity.status(HttpStatus.CREATED).body(folderRepository.save(folder));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Folder> update(@PathVariable Long id, @Valid @RequestBody FolderRequest request) {
        Folder folder = folderRepository.findById(id).orElse(null);
        if (folder == null) return ResponseEntity.notFound().build();
        folder.setName(request.getName());
        folder.setParentId(request.getParentId());
        folder.setColor(request.getColor());
        return ResponseEntity.ok(folderRepository.save(folder));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        if (!folderRepository.existsById(id)) return ResponseEntity.notFound().build();

        // Un-parent any subfolders and un-file any notes rather than cascading deletes.
        folderRepository.findAllByOrderByNameAsc().forEach(f -> {
            if (id.equals(f.getParentId())) {
                f.setParentId(null);
                folderRepository.save(f);
            }
        });
        noteRepository.findAllByFolderIdAndDeletedAtIsNullOrderByPinnedDescUpdatedAtDesc(id).forEach(n -> {
            n.setFolderId(null);
            noteRepository.save(n);
        });

        folderRepository.deleteById(id);
        return ResponseEntity.noContent().build();
    }
}

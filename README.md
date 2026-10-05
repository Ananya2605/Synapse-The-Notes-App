# Synapse — an AI-powered universal notes app

Capture → Organize → Connect → Understand → Export → Share.

A single Spring Boot application (H2 database + REST API) serving a
glassmorphism, dark/light, animated front end built in plain HTML/CSS/JS.
Everything ships as **one deployable jar** — no separate frontend hosting,
no CORS setup.

## Feature map

| Requested feature | Where it lives |
|---|---|
| **Smart editor** — headings, checklists, lists, tables, quotes, code, images, auto-save, version history | `content-editor` block editor in `script.js` + `NoteVersion`/`/api/notes/{id}/versions` |
| **Links & references** with preview cards (web, YouTube, Google Maps, docs) | `LinkPreviewController` (Jsoup + special-cased YouTube/Maps) + `scanAndRenderLinkPreviews()` |
| **File attachments** (PDF/Word/Excel/images/audio/anything), download later | `AttachmentController`, files stored under `./uploads/{noteId}/…` |
| **AI Assistant** — summarize, rewrite, key points, checklist, ask, suggest title/category/tags | `AiService` + `/api/notes/{id}/ai/*` |
| **Ask My Notes** — natural-language Q&A across all notes | `AiService.askMyNotes()` + `/api/notes/ask` |
| **Knowledge graph** — notes auto-connect via shared tags/category | `/api/notes/graph` + a hand-rolled force-directed canvas renderer in `script.js` (no chart library needed) |
| **Folders, subfolders, tags, favorites, archive, trash, pin, categories** | `Folder` entity + `Note` flags (`pinned`, `favorite`, `archived`, `deletedAt`, `category`, `tags`) |
| **Smart search** — title/content/tags/files/meaning + date/category/favorite filters | `/api/notes/search` (keyword match, with a relevance-ranked fallback when nothing matches literally) |
| **Export & share** — PDF, Word, TXT, Markdown, print, shareable link | Client-side export in `script.js` (jsPDF, Word-compatible `.doc` blob, MD/TXT converters) + `share.html` public view |
| **Quick capture** — voice-to-text, save text/links/files without opening the editor | Quick-capture overlay + Web Speech API |
| **Convert note** — table, timeline, flashcards, outline, summary, checklist | `AiService.convert()` + `/api/notes/{id}/ai/convert?format=` |
| **Dashboard** — totals, categories, recent activity, favorites, top tags, recent files | `/api/notes/dashboard` |
| **Premium UI** — dark/light, glass cards, animations, drag-and-drop filing, responsive | `style.css` + drag handlers in `script.js` |

## How the AI Assistant actually works (read this)

Every AI feature runs **offline by default**, using dependency-free
extractive/statistical NLP in `AiService`/`NlpUtils` (word-frequency
summarization, keyword-overlap search, keyword-based categorization). This
means the app is fully functional the moment you deploy it — no API key,
no billing, no external calls.

If you set an `ANTHROPIC_API_KEY` environment variable, every AI feature
**transparently upgrades** to real Claude-generated answers (model
`claude-sonnet-4-6`), and falls back to the offline heuristic automatically
if that call ever fails. The sidebar shows **"Offline AI"** or **"Live AI
connected"** depending on which mode is active. Nothing else in the app
needs to change — same endpoints, same response shape.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
mvn spring-boot:run
```

## Project structure

```
notes-app/
├── pom.xml
├── src/main/java/com/notesapp/
│   ├── NotesAppApplication.java
│   ├── model/            Note, Folder, NoteVersion, Attachment (JPA entities)
│   ├── repository/       Spring Data repositories
│   ├── dto/               NoteRequest, FolderRequest, AskRequest
│   ├── ai/                 NlpUtils (offline NLP), AiService, AiResult
│   ├── controller/       NoteController, FolderController, AttachmentController, LinkPreviewController
│   └── exception/        404 + validation error handling
└── src/main/resources/
    ├── application.properties
    └── static/
        ├── index.html     app shell (sidebar, topbar, note grid, editor overlay, graph, dashboard)
        ├── style.css       dark/light tokens, glassmorphism, animations, responsive + print styles
        ├── script.js       all app logic (state, rendering, editor, AI, graph, export, voice, drag/drop)
        └── share.html      public read-only note view (for "copy shareable link")
```

## API reference (selected)

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/notes` | List / create notes |
| GET/PUT/DELETE | `/api/notes/{id}` | Read / update / soft-delete (→ Trash) |
| PATCH | `/api/notes/{id}/pin` \| `/favorite` \| `/archive` | Toggle organization flags |
| PATCH | `/api/notes/{id}/move?folderId=` | File into a folder (drag-and-drop) |
| POST/DELETE | `/api/notes/{id}/restore` \| `/permanent` | Restore from Trash / delete forever |
| GET | `/api/notes/{id}/versions` | Version history |
| POST | `/api/notes/{id}/versions/{versionId}/restore` | Roll back to a version |
| GET | `/api/notes/search?q=&tag=&category=&favorite=&hasFiles=&from=&to=` | Smart search + filters |
| GET | `/api/notes/graph` | Knowledge graph nodes/edges |
| GET | `/api/notes/dashboard` | Dashboard stats |
| POST | `/api/notes/ask` | Ask My Notes |
| POST/GET | `/api/notes/{id}/ai/*` | Summarize, rewrite, key-points, checklist, suggest-meta, ask, convert |
| GET/POST/DELETE | `/api/notes/{id}/attachments`, `/api/attachments/{id}/download` \| `/{id}` | Attachments |
| GET | `/api/link-preview?url=` | Link preview metadata |
| GET/POST/PUT/DELETE | `/api/folders` | Folder CRUD |
| GET | `/api/notes/{id}/share` | Public read-only note (used by `share.html`) |

## Run locally

Requires JDK 17+ and Maven.

```bash
cd notes-app
mvn spring-boot:run
```

Open **http://localhost:8080**. Notes persist in a file-based H2 database
at `./data/notesdb`; uploaded files live under `./uploads/`.

## Build & deploy

```bash
mvn clean package
java -jar target/notes-app.jar
```

Because the front end is bundled into the jar, you deploy **one service**:

- **Render / Railway**: connect the repo — they detect `pom.xml`, build with
  Maven, and run via the included `Procfile`. Set `ANTHROPIC_API_KEY` in
  their environment-variable settings if you want live AI.
- **A VPS**: `mvn clean package`, copy `target/notes-app.jar` over, run
  `java -jar notes-app.jar` behind `systemd` + nginx.
- **Docker**:
  ```dockerfile
  FROM eclipse-temurin:17-jre
  COPY target/notes-app.jar app.jar
  ENTRYPOINT ["java", "-jar", "/app.jar"]
  ```

### Persisting data in production

The default H2 file database and the `./uploads` folder live on local disk
— great for a single VPS, but wiped on redeploy on ephemeral-filesystem
hosts. For anything long-lived, point `application.properties` at a managed
Postgres/MySQL instance (swap the 4 `spring.datasource.*` lines + driver
dependency) and mount a persistent volume for `./uploads`. Nothing else in
the app needs to change.

## Honest limitations (so nothing surprises you after deploy)

- **No user accounts** — this is a single-workspace app, like a personal
  notes tool. Sharing is via unauthenticated read-only links
  (`share.html?id=`), not a full multi-user permissions system. Anyone
  with a note's link can view it — treat "sharing" as "anyone with the
  link," not "private by default with granted access."
- **PDF/Word export happens in the browser** (via jsPDF and an
  HTML-in-`.doc` trick) rather than on the server, so formatting is
  simplified — good for text and structure, not pixel-perfect layout.
- **The knowledge graph** connects notes by shared tags/category rather
  than deep semantic meaning.
- **Offline AI is extractive, not generative** — summaries/rewrites without
  an API key are built by picking and lightly cleaning your own sentences,
  not by writing new ones. Add `ANTHROPIC_API_KEY` for true generation.

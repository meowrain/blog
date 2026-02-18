## ADDED Requirements

### Requirement: Create new article

The system SHALL allow users to create a new blog article with title, content, and metadata. The article MUST be saved as a markdown file in the appropriate category directory with valid YAML frontmatter.

#### Scenario: Create article with existing category

- **WHEN** user submits article with title "My Post", category "Java", content "Hello world"
- **THEN** system creates file `src/content/posts/Java/My-Post.md`
- **AND** frontmatter contains title, published timestamp, category, draft=false
- **AND** system returns created article with file path

#### Scenario: Create article with new nested category

- **WHEN** user submits article with category "Python/Django" (directory doesn't exist)
- **THEN** system creates directory `src/content/posts/Python/Django/`
- **AND** saves article file in that directory

#### Scenario: Create article generates slug from title

- **WHEN** user creates article with title "Gin框架快速入门"
- **THEN** system generates filename "Gin框架快速入门.md" or uses provided title
- **AND** preserves non-ASCII characters for Chinese titles

### Requirement: List all articles

The system SHALL provide a paginated list of all articles with filtering and sorting capabilities.

#### Scenario: List all articles with pagination

- **WHEN** user requests article list with page=1, limit=20
- **THEN** system returns first 20 articles sorted by published date (newest first)
- **AND** response includes total count and pagination metadata

#### Scenario: Filter articles by category

- **WHEN** user requests articles with category filter "Java"
- **THEN** system returns only articles in `src/content/posts/Java/**`
- **AND** includes articles in subdirectories (e.g., Java/Spring/, Java/JVM/)

#### Scenario: Filter articles by tag

- **WHEN** user requests articles with tag filter "Spring"
- **THEN** system returns only articles containing "Spring" in their tags array

#### Scenario: Search articles by title

- **WHEN** user searches for "Gin"
- **THEN** system returns articles with titles containing "Gin" (case-insensitive)

### Requirement: Get single article

The system SHALL allow retrieving a single article by its file path for editing.

#### Scenario: Get existing article

- **WHEN** user requests article at path `src/content/posts/Golang/Gin框架快速入门.md`
- **THEN** system returns article with frontmatter fields and markdown content
- **AND** response includes editable metadata (title, category, tags, etc.)

#### Scenario: Get non-existent article

- **WHEN** user requests article that doesn't exist
- **THEN** system returns 404 error with descriptive message

### Requirement: Update article

The system SHALL allow updating article content and metadata while preserving the file location or moving it to a new category.

#### Scenario: Update article content only

- **WHEN** user updates article content with same title and category
- **THEN** system overwrites file with new content
- **AND** preserves existing frontmatter (title, published date, tags, etc.)

#### Scenario: Update article category moves file

- **WHEN** user changes article category from "Golang" to "Java/Spring"
- **THEN** system moves file from `src/content/posts/Golang/` to `src/content/posts/Java/Spring/`
- **AND** updates frontmatter category field

#### Scenario: Update article tags

- **WHEN** user changes article tags from `[Gin, Go]` to `[Gin, Go, Framework]`
- **THEN** system updates tags array in frontmatter
- **AND** preserves other frontmatter fields

### Requirement: Delete article

The system SHALL allow deleting an article file with confirmation.

#### Scenario: Delete existing article

- **WHEN** user confirms deletion of article at path `src/content/posts/Test.md`
- **THEN** system deletes the markdown file
- **AND** returns success confirmation

#### Scenario: Delete article in subdirectory

- **WHEN** user deletes article `src/content/posts/Java/Spring/Test.md`
- **THEN** system deletes the file
- **AND** does NOT remove empty directories (keeps category structure)

### Requirement: Toggle draft status

The system SHALL allow users to mark articles as draft or published.

#### Scenario: Publish draft article

- **WHEN** user sets draft=false on an article
- **THEN** system updates frontmatter `draft: false`
- **AND** article will be included in published article lists

#### Scenario: Unpublish article as draft

- **WHEN** user sets draft=true on an article
- **THEN** system updates frontmatter `draft: true`
- **AND** article will be excluded from published article lists (unless explicitly requested)

### Requirement: Bulk operations

The system SHALL support bulk operations on multiple articles.

#### Scenario: Bulk delete articles

- **WHEN** user selects multiple articles and confirms delete
- **THEN** system deletes all selected article files
- **AND** returns count of deleted articles

#### Scenario: Bulk update category

- **WHEN** user selects multiple articles and changes category to "Archive"
- **THEN** system moves all selected files to `src/content/posts/Archive/`
- **AND** updates frontmatter category for each article

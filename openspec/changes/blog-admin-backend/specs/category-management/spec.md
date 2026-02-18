## ADDED Requirements

### Requirement: List all categories

The system SHALL provide a list of all categories discovered from the article directory structure, including article counts.

#### Scenario: Get flat category list

- **WHEN** user requests all categories
- **THEN** system returns list of unique category paths (e.g., "Java", "Java/Spring", "Golang")
- **AND** includes article count for each category
- **AND** categories are sorted alphabetically

#### Scenario: Get nested category tree

- **WHEN** user requests category tree
- **THEN** system returns hierarchical structure (e.g., Java → Spring, Java → JVM)
- **AND** includes aggregated article counts (parent includes child counts)

### Requirement: Get articles by category

The system SHALL allow filtering articles by a specific category path.

#### Scenario: Get articles in top-level category

- **WHEN** user requests articles for category "Java"
- **THEN** system returns articles in `src/content/posts/Java/*.md`
- **AND** includes articles in subdirectories (Java/Spring/*, Java/JVM/*)

#### Scenario: Get articles in nested category only

- **WHEN** user requests articles for category "Java/Spring"
- **THEN** system returns only articles in `src/content/posts/Java/Spring/*.md`
- **AND** excludes articles in parent or sibling directories

### Requirement: Auto-discover categories

The system SHALL automatically discover categories from the existing article directory structure without manual configuration.

#### Scenario: Discover categories on startup

- **WHEN** backend starts
- **THEN** system scans `src/content/posts/` directory
- **AND** builds category list from all subdirectory paths
- **AND** updates category cache

#### Scenario: Discover categories when article created

- **WHEN** user creates article in new category "Python/Django"
- **THEN** system adds "Python/Django" to category list
- **AND** category appears in subsequent category list requests

#### Scenario: Discover categories when article deleted

- **WHEN** user deletes last article in category "Archive"
- **THEN** system keeps "Archive" in category list (directory still exists)
- **AND** article count updates to 0

### Requirement: Category validation

The system SHALL validate category paths before creating articles.

#### Scenario: Validate new category name

- **WHEN** user creates article with category "Invalid/Name/With//Slash"
- **THEN** system normalizes the path (removes double slashes, trailing slashes)
- **AND** creates valid directory structure

#### Scenario: Prevent category with invalid characters

- **WHEN** user creates article with category containing `<`, `>`, `:`, `"`, `|`, `?`, `*`
- **THEN** system returns validation error
- **AND** prevents file creation

### Requirement: Category metadata

The system SHALL provide metadata for each category including article counts and last updated timestamp.

#### Scenario: Get category metadata

- **WHEN** user requests category details for "Java"
- **THEN** system returns article count (including subcategories)
- **AND** returns most recent article's published date
- **AND** returns list of direct child categories

### Requirement: Rename category

The system SHALL support renaming a category by moving all articles to a new path.

#### Scenario: Rename top-level category

- **WHEN** user renames category "Golang" to "Go"
- **THEN** system moves directory `src/content/posts/Golang/` to `src/content/posts/Go/`
- **AND** updates category frontmatter in all contained articles
- **AND** returns count of moved articles

#### Scenario: Rename nested category

- **WHEN** user renames "Java/Spring" to "Java/Spring-Boot"
- **THEN** system moves directory and updates parent path
- **AND** preserves parent directory structure

#### Scenario: Rename non-existent category

- **WHEN** user attempts to rename category that doesn't exist
- **THEN** system returns 404 error

### Requirement: Delete category

The system SHALL support deleting a category directory, optionally moving or deleting contained articles.

#### Scenario: Delete empty category

- **WHEN** user deletes category with no articles
- **THEN** system removes the directory
- **AND** returns success confirmation

#### Scenario: Delete category with articles (move option)

- **WHEN** user deletes "Archive" category and chooses to move articles to "Blog"
- **THEN** system moves all articles to `src/content/posts/Blog/`
- **AND** removes "Archive" directory
- **AND** updates frontmatter category for all moved articles

#### Scenario: Delete category with articles (delete option)

- **WHEN** user deletes category and chooses to delete articles
- **THEN** system deletes all article files in category
- **AND** removes the directory
- **AND** returns count of deleted articles

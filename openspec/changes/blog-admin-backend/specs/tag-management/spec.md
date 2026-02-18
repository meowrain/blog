## ADDED Requirements

### Requirement: List all tags

The system SHALL provide a list of all unique tags discovered from article frontmatter, including usage counts.

#### Scenario: Get all tags

- **WHEN** user requests all tags
- **THEN** system returns list of unique tag names
- **AND** includes article count for each tag
- **AND** tags are sorted alphabetically (case-insensitive)

#### Scenario: Get popular tags

- **WHEN** user requests tags sorted by popularity
- **THEN** system returns tags sorted by article count (descending)
- **AND** limits result to requested number (default 20)

### Requirement: Get articles by tag

The system SHALL allow filtering articles by a specific tag.

#### Scenario: Get articles with tag

- **WHEN** user requests articles with tag "Spring"
- **THEN** system returns all articles containing "Spring" in their tags array
- **AND** preserves case sensitivity (tag matching is exact)

#### Scenario: Get articles with multiple tags

- **WHEN** user requests articles with tags ["Spring", "Java"]
- **AND** filter mode is "AND"
- **THEN** system returns articles containing BOTH tags

#### Scenario: Get articles with any tag

- **WHEN** user requests articles with tags ["Spring", "Java"]
- **AND** filter mode is "OR"
- **THEN** system returns articles containing EITHER tag

### Requirement: Auto-discover tags

The system SHALL automatically discover tags from existing article frontmatter without manual configuration.

#### Scenario: Discover tags on startup

- **WHEN** backend starts
- **THEN** system scans all markdown files in `src/content/posts/`
- **AND** extracts tags from frontmatter
- **AND** builds unique tag list with counts

#### Scenario: Discover tags when article created

- **WHEN** user creates article with tags ["Rust", "Tokio"]
- **THEN** system adds new tags to tag list
- **AND** increments count for existing tags
- **AND** new tags appear in subsequent tag list requests

#### Scenario: Discover tags when article deleted

- **WHEN** user deletes article with tags ["Go", "Gin"]
- **THEN** system decrements count for those tags
- **AND** removes tags from list if count reaches 0

#### Scenario: Discover tags when article updated

- **WHEN** user updates article tags from ["Spring"] to ["Spring", "Spring-Boot"]
- **THEN** system updates tag counts accordingly
- **AND** adds "Spring-Boot" to tag list if new

### Requirement: Rename tag

The system SHALL support renaming a tag across all articles that contain it.

#### Scenario: Rename existing tag

- **WHEN** user renames tag "Gin" to "Gin-Framework"
- **THEN** system updates all articles containing "Gin" tag
- **AND** replaces "Gin" with "Gin-Framework" in tags array
- **AND** returns count of updated articles

#### Scenario: Rename tag to existing tag (merge)

- **WHEN** user renames "Gin" to "Go" (and "Go" already exists)
- **THEN** system merges tags - removes "Gin", keeps "Go"
- **AND** articles don't have duplicate "Go" tags
- **AND** returns count of updated articles

#### Scenario: Rename non-existent tag

- **WHEN** user attempts to rename tag that doesn't exist
- **THEN** system returns 404 error

### Requirement: Delete tag

The system SHALL support removing a tag from all articles that contain it.

#### Scenario: Delete existing tag

- **WHEN** user deletes tag "Deprecated"
- **THEN** system removes "Deprecated" from all article tag arrays
- **AND** preserves other tags on affected articles
- **AND** returns count of updated articles

#### Scenario: Delete non-existent tag

- **WHEN** user attempts to delete tag that doesn't exist
- **THEN** system returns 404 error

### Requirement: Tag validation

The system SHALL validate tag names before adding them to articles.

#### Scenario: Validate tag name format

- **WHEN** user creates article with tag containing commas or brackets
- **THEN** system strips invalid characters or returns validation error
- **AND** prevents malformed frontmatter

#### Scenario: Normalize tag whitespace

- **WHEN** user creates article with tag " Spring Boot "
- **THEN** system trims whitespace to "Spring Boot"

### Requirement: Tag suggestions

The system SHALL provide tag suggestions based on existing tags and partial input.

#### Scenario: Get tag suggestions

- **WHEN** user types "Spr" for tag suggestions
- **THEN** system returns matching tags (e.g., ["Spring", "Spring-Boot", "Sprout"])
- **AND** results are case-insensitive
- **AND** includes usage counts

#### Scenario: Get related tags

- **WHEN** user views articles with tag "Spring"
- **THEN** system returns frequently co-occurring tags (e.g., "Java", "Spring-Boot")

### Requirement: Bulk tag operations

The system SHALL support adding or removing tags from multiple articles at once.

#### Scenario: Bulk add tag to articles

- **WHEN** user selects multiple articles and adds tag "Featured"
- **THEN** system adds "Featured" to all selected articles
- **AND** avoids duplicate tags if article already has it
- **AND** returns count of updated articles

#### Scenario: Bulk remove tag from articles

- **WHEN** user selects multiple articles and removes tag "Draft"
- **THEN** system removes "Draft" from all selected articles
- **AND** returns count of updated articles

#### Scenario: Bulk replace tag on articles

- **WHEN** user selects articles with tag "Old" and replaces with "New"
- **THEN** system removes "Old" and adds "New" to selected articles
- **AND** returns count of updated articles

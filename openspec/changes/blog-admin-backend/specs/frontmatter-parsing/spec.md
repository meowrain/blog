## ADDED Requirements

### Requirement: Parse frontmatter from markdown file

The system SHALL parse YAML frontmatter from markdown files and extract all metadata fields.

#### Scenario: Parse complete frontmatter

- **WHEN** system reads markdown file with valid frontmatter
- **THEN** system extracts all fields (title, published, description, image, tags, category, draft, lang)
- **AND** returns structured object with proper types (strings, arrays, booleans, dates)

#### Scenario: Parse frontmatter with optional fields

- **WHEN** system reads markdown file missing some fields
- **THEN** system returns available fields
- **AND** provides default values for missing fields (empty string for description, empty array for tags, false for draft)

#### Scenario: Parse frontmatter with custom date format

- **WHEN** system reads file with `published: 2025-07-19` (date only)
- **THEN** system parses as valid Date object
- **AND** handles both date-only and ISO timestamp formats

#### Scenario: Parse frontmatter with array formats

- **WHEN** system reads file with `tags: [Gin, Go]` or `tags: Gin, Go`
- **THEN** system returns tags as string array
- **AND** normalizes different YAML array formats

### Requirement: Write frontmatter to markdown file

The system SHALL write YAML frontmatter to markdown files, preserving formatting and handling all field types.

#### Scenario: Write complete frontmatter

- **WHEN** system saves article with all metadata fields
- **THEN** system writes valid YAML frontmatter between `---` delimiters
- **AND** includes all fields with proper YAML formatting
- **AND** preserves markdown content after frontmatter

#### Scenario: Write frontmatter with array fields

- **WHEN** system saves article with tags array
- **THEN** system writes tags in YAML list format (e.g., `tags: [Gin, Go]`)
- **AND** properly quotes strings with special characters if needed

#### Scenario: Write frontmatter with special characters

- **WHEN** system saves article with title containing colons, quotes, or special chars
- **THEN** system properly quotes or escapes values in YAML
- **AND** ensures valid YAML syntax

#### Scenario: Write frontmatter with empty fields

- **WHEN** system saves article with empty description or no tags
- **THEN** system writes empty string or empty array in YAML
- **AND** maintains consistent format (includes all fields even if empty)

### Requirement: Validate frontmatter schema

The system SHALL validate frontmatter fields against the expected schema before saving.

#### Scenario: Validate required fields

- **WHEN** user saves article without title
- **THEN** system returns validation error
- **AND** prevents saving incomplete frontmatter

#### Scenario: Validate field types

- **WHEN** user provides invalid type (e.g., tags as string instead of array)
- **THEN** system returns validation error
- **AND** indicates which field has wrong type

#### Scenario: Validate date format

- **WHEN** user provides invalid date for published field
- **THEN** system returns validation error
- **AND** suggests valid date format

#### Scenario: Validate category path

- **WHEN** user provides category with invalid characters
- **THEN** system returns validation error
- **AND** lists allowed characters (alphanumeric, hyphens, slashes, Chinese characters)

### Requirement: Preserve existing frontmatter format

The system SHALL preserve the existing frontmatter format when possible to maintain git history and minimize diffs.

#### Scenario: Preserve field order

- **WHEN** system updates article frontmatter
- **THEN** system maintains existing field order if possible
- **AND** adds new fields at the end

#### Scenario: Preserve comments

- **WHEN** frontmatter contains YAML comments
- **THEN** system preserves comments when updating
- **AND** only updates modified fields

#### Scenario: Handle frontmatter parsing errors

- **WHEN** system reads file with malformed YAML frontmatter
- **THEN** system returns descriptive error message
- **AND** indicates line number of parsing error
- **AND** allows user to manually fix or discard frontmatter

### Requirement: Frontmatter field defaults

The system SHALL provide sensible defaults for optional frontmatter fields.

#### Scenario: Default values for new article

- **WHEN** user creates new article without specifying optional fields
- **THEN** system sets description to empty string
- **AND** sets tags to empty array
- **AND** sets draft to false
- **AND** sets lang to empty string (or site default)
- **AND** sets published to current timestamp in ISO format

#### Scenario: Auto-generate published date

- **WHEN** user creates article and published field is empty
- **THEN** system sets published to current datetime (YYYY-MM-DDTHH:mm:ss)

### Requirement: Frontmatter field transformations

The system SHALL support transformations for certain frontmatter fields.

#### Scenario: Normalize tag whitespace

- **WHEN** user provides tags with extra whitespace
- **THEN** system trims each tag value
- **AND** removes empty tags from array

#### Scenario: Normalize category path

- **WHEN** user provides category with backslashes or extra slashes
- **THEN** system converts to forward slashes
- **AND** removes duplicate slashes

#### Scenario: Sanitize image URL

- **WHEN** user provides image URL with spaces or special characters
- **THEN** system preserves URL as-is (URL encoding is user's responsibility)
- **AND** does not modify URL scheme or domain

### Requirement: Merge frontmatter updates

The system SHALL support partial updates to frontmatter without affecting unspecified fields.

#### Scenario: Update only title field

- **WHEN** user submits update with only title changed
- **THEN** system updates title in frontmatter
- **AND** preserves all other fields (tags, category, etc.)

#### Scenario: Add tag without modifying existing tags

- **WHEN** user adds single tag to article
- **THEN** system appends tag to existing tags array
- **AND** does not remove or modify other tags

### Requirement: Handle edge cases

The system SHALL gracefully handle edge cases in frontmatter processing.

#### Scenario: File without frontmatter

- **WHEN** system reads markdown file with no frontmatter delimiters
- **THEN** system treats entire file as content
- **AND** returns empty object for metadata
- **AND** allows adding frontmatter on save

#### Scenario: File with empty frontmatter

- **WHEN** system reads file with only `---` delimiters and no content
- **THEN** system returns empty object for metadata
- **AND** treats rest of file as markdown content

#### Scenario: Unicode and multi-byte characters

- **WHEN** frontmatter contains Chinese, emoji, or other Unicode characters
- **THEN** system preserves characters exactly as provided
- **AND** writes UTF-8 encoded markdown files

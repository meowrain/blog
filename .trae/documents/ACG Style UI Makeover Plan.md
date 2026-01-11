I will modify the project's configuration and CSS to implement an "ACG (Anime/Manga) Style" makeover. The changes will make the UI cuter, softer, and more translucent with an anime-style background.

### 1. Global Theme Configuration (`src/config.ts`)
- **Theme Color**: Change the primary hue to **Pink** (`340`) for a soft, cute look.
- **Background Image**: Enable the background and set it to a high-quality random anime wallpaper API (`https://t.alcy.cc/acg`) to ensure every visit feels fresh and "ACG".
- **Background Opacity**: Ensure the background is fully visible (`opacity: 1`).

### 2. Styling Overhaul (`src/styles/variables.styl` & `src/styles/main.css`)
- **Rounded Corners**: Increase the global border radius (`--radius-large`) to `1.75rem` to make all cards and elements look bubblier and softer.
- **Translucency (Glassmorphism)**:
  - Reduce the opacity of the **Card Background** (`--card-bg`) and **Float Panel** (`--float-panel-bg`) to `0.6` (60% opacity) for light mode.
  - This creates a "frosted glass" effect, allowing the anime background to show through the content.
- **Blur Effect**: Increase the `backdrop-filter` blur in `main.css` to `16px` to enhance the glass effect and ensure text readability.

### 3. Typography (`src/layouts/Layout.astro` & `tailwind.config.cjs`)
- **Cute Font**: Import the **"M PLUS Rounded 1c"** font from Google Fonts. This is a popular rounded font often used in anime/manga designs.
- **Font Integration**: Update Tailwind configuration to prioritize this new rounded font for the entire website.

### 4. Interactive Animations (`src/styles/main.css`)
- **Hover Effects**: Add a gentle "floating" animation (slight lift and shadow increase) to all cards (`.card-base`) when hovered, making the interface feel more alive and playful.

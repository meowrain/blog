I will implement several interactive animations and visual enhancements to meet the user's request for a "prettier" and more "animated" ACG-style blog.

### 1. Emoji Click Burst Effect
I will create a new component `EmojiCursor.astro` that listens for click events and spawns floating emojis that fade out.
- **Implementation**: A client-side script that creates `span` elements with random emojis at the cursor position, animates them upwards, and removes them.
- **Emojis**: 🌸, 💖, ✨, 🍬, 🎀, 🍭, 🍡 (ACG/cute themed).

### 2. Falling Sakura (Cherry Blossom) Effect
I will create a `Sakura.astro` component using a lightweight canvas script to simulate falling cherry blossom petals.
- **Placement**: A fixed-position canvas covering the screen, with `pointer-events: none` so it doesn't interfere with clicks.
- **Visuals**: Pink/White petals gently drifting down.

### 3. Fade-in & Slide-up Animations
I will add global CSS keyframes to `src/styles/main.css` to animate elements when they appear.
- **Target**: `.card-base`, `.btn-card`
- **Effect**: `fade-in-up` (opacity 0 -> 1, translate-y 20px -> 0).
- **Stagger**: I'll try to use CSS nth-child selectors or a simple JS script to stagger the animation for a cascading effect.

### 4. Integration
I will import `EmojiCursor` and `Sakura` components into `src/layouts/Layout.astro` so they are available on every page.

### 5. Polishing
- **Live2D Suggestion**: I will add a comment/placeholder for Live2D in the layout, as a full implementation might be heavy, but I'll focus on the requested "emoji animations" first.
- **Link Hover**: Add a "rubber band" or "pulse" animation to navigation links.

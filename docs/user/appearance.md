# Appearance and themes

On web and desktop, open **Settings → Appearance** to choose a theme and follow the system
appearance or stay in light or dark mode. To use different themes for light and dark mode, select
the corresponding preview within each theme. Appearance preferences are saved separately on each
device or browser.

On web and desktop, use **Change theme** in the command palette to select a theme without leaving chat.
Press **Cmd+Option+A** on macOS or **Ctrl+Alt+A** on Windows/Linux to open the theme picker directly.
Use **Change appearance** in the command palette to choose System, Light, or Dark independently of
the theme. **Cmd+Option+Shift+A** on macOS or **Ctrl+Alt+Shift+A** on Windows/Linux cycles through
those modes. Customize these shortcuts under **Settings → Keybindings**.

On mobile, open **Settings → Appearance**. Mobile has its own themes and text,
code, and terminal preferences. It does not follow environment themes or defaults.

On Android 12 or newer, choose the **Material You** theme in Appearance to use colors from
your wallpaper. Selecting another theme replaces those colors. Like other themes, Material You
can be selected separately for light and dark appearances.
Android uses **Material You Layout** by default unless you have turned it off in Appearance.
It changes shapes, spacing, and controls independently
of the selected theme.

## Composer context

Git-backed projects show branch and worktree controls below the composer while you create a thread.
The controls retreat as the composer docks after you send the first message.

Turn on **Composer context** to keep those controls visible after the thread starts. This preference
applies to the web and desktop clients.

## Math

Turn on **Render math** in **Settings → Appearance** to typeset LaTeX in messages and Markdown
previews on web, desktop, and mobile. It reads `$…$`, `$$…$$`, `\(…\)`, and `\[…\]`, outside of code.
Fenced `math` blocks also render. Formulas work in tables, including absolute-value bars.
Dollar amounts such as `$5 and $10` stay text; write `\$` to keep any other dollar sign literal.
Wide formulas scroll horizontally while the surrounding text wraps. Copying a formula or
exporting a table preserves the TeX.

The composer keeps TeX source editable, including when rich text is enabled. The Render math
preference is saved separately on each device.

## Highlights

On web and desktop, select text in an assistant message and choose **Highlight** beside
**Cite**. You can also highlight text in a Markdown file while it is shown with **Show rendered
markdown**. Highlights stay in the browser where you made them; they are not synced across
devices.

Under **Settings → Appearance → Highlight colors**, pick how new highlights get their color:

- **Thread default** makes **Highlight** apply the thread's default color. Picking a swatch in the
  palette highlights the current selection and makes that color the thread's default. The swatch in
  settings is the starting color for new threads.
- **Per selection** shows a palette of swatches beside the selection, and each highlight uses
  the color you click.

Click highlighted text to **Cite** the original passage or **Add note** beside it. A highlight
can have several notes. Use its note marker to reopen them, or choose **Add to chat draft** on
a note to append it and its source without sending. If you’re answering a question, your answer
stays unchanged and the note is waiting in your regular chat draft. Editing the draft does not
change the saved note.

Open **Highlights** in the thread details card for the current conversation, or use **Highlights**
next to **Usage** in the sidebar (or **Open highlights** in the command palette) to browse across
conversations and projects. Search passages and notes, filter by source or color, and use **Context**
to read the surrounding text. Select multiple highlights to merge their notes and quotes into the
chat draft for the target thread shown at the bottom of the overview.

While writing a note, press **Enter** to save and focus **Add to chat draft**, then press **Enter**
again to add it without sending. **Shift+Enter** adds a line break. Use **Esc** to return to the
conversation from the overview. A note’s menu can open [Smalltalk](smalltalk.md) with **Explain note
in plain language**. Removing a highlight also removes its notes; use **Undo** to restore them.

## Conversation navigation

In **Settings → Chat → Conversation navigation**, choose **Left timeline**, **Question outline**,
or **Off**. With Question outline, open the directory from thread details to revisit your prompts,
including earlier questions that have not loaded in the chat yet. The previous and next question
controls navigate from your current reading position without opening the directory. This preference
is saved separately in each browser or desktop client.

## Motion

The main sidebar, right panel, and terminal drawer open and close immediately by default. Move the
**Panel animations** slider above 0 ms to add motion, up to 400 ms, unless reduced motion is enabled
in your operating system. Moving between threads always snaps to the selected thread's panel state
without replaying its transitions.

## Custom themes

On web and desktop, choose **Create theme** to adjust a palette, or import a T3 Code or VS Code
theme. The theme editor's color picker lets you select an area of the app to find the color to
change. Export your theme as JSON to share it.

### Custom CSS

For a change that colors cannot make, open **Custom CSS** in the theme editor. The CSS is saved with
the theme, applies after T3 Code's own styles on web and desktop, and is included in exports. Use
`.dark` or `:root:not(.dark)` to target one appearance.

Custom CSS cannot load files. `@import`, `image-set()`, and `url()` are ignored, except `url()`
with a `data:` address or an `#id`. This keeps an imported theme from sending what is on your screen
to another site. For a full-size image, use a [background image](#background-image).

Class names in the app change between releases. For rules that keep working, target `data-slot`
and other `data-` attributes, such as `[data-chat-header]` or `[data-slot="button"]`.

If a rule hides something you need, run `t3 theme set t3-chat` on the server to switch to a
built-in theme, or press **Cmd+Option+A** on macOS or **Ctrl+Alt+A** on Windows/Linux to pick
another theme.

### Ask an agent

An agent on the same machine as the server can restyle T3 Code for you. Ask it to change the look,
for example "make T3 Code's chat header taller" or "give T3 Code a solarized theme". It publishes
an [environment theme](#environment-themes) with colors and CSS, and web and desktop clients of that
server switch to it. It can also switch them to light, dark, or system mode. The thread must run
in Full access. Ask the agent to set a built-in theme to undo it.

## Environment themes

Environment themes and defaults come from the server serving your web app or the desktop app's
main local environment. With the desktop app's local environment off, they come from the
[background service](./background-service.md) on the same machine while the app is connected to
it. app.t3.codes and other connections do not use them.

Select a published theme in **Settings → Appearance** to follow its palette as the server updates
it. **Duplicate** makes an independent copy you can edit. A saved custom theme with the same ID
takes precedence. If the server stops publishing the selected theme, T3 Code falls back to its
standard theme.

Run this on the server to set a default and switch connected clients to it:

```bash
t3 theme set nightfall
```

Clients that are offline apply it when they reconnect. Each client applies the setting once;
choosing another theme afterward sticks until the next `t3 theme set`. Run the command again to
reapply it, even if the name is unchanged.

`t3 theme clear` removes the default without changing anyone's current theme. `t3 theme show` lists
the default and published themes.

### Publish a theme

Save a theme exported from T3 Code into `~/.t3/userdata/themes/` on the server, or the `themes`
directory under your custom state directory. The filename supplies the theme ID: `nightfall.json`
can be selected with `t3 theme set nightfall`. Keep the filename stable when updating its colors.
Do not use `system`, `light`, `dark`, or a built-in theme's ID.

For an integration that generates a palette, this shorter format also works:

```json
{
  "name": "Nightfall",
  "appearance": "dark",
  "canvas": "#1a1b26",
  "accent": "#7aa2f7",
  "colors": {
    "terminalSelection": "#292e42",
    "error": "#f7768e"
  }
}
```

Set `appearance` to `light` or `dark` and supply hex colors for `canvas` and `accent`. T3 Code
generates the rest. The optional `colors` overrides use the names in the theme editor's advanced
view. An optional `css` string adds [custom CSS](#custom-css).

Write updates to a temporary file and rename it into place so clients never read a partial theme.
Invalid files are not published.

### Background image

A published theme can have a full-size background image. Ask an agent, for example "use
~/Pictures/wallpaper.jpg as T3 Code's background", or save a JPEG, PNG, or WebP file of up to
16 MB beside the theme file: `nightfall.jpg` beside `nightfall.json`. The theme's CSS decides
where the image shows:

```css
[data-workspace-area="conversation"] {
  background: var(--theme-background-image) center / cover no-repeat;
}
```

Delete the image file to remove it.

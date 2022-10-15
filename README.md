[![Project Status: Active – The project has reached a stable, usable state and is being actively developed.](https://www.repostatus.org/badges/latest/active.svg)](https://www.repostatus.org/#active) 
![GitHub release (latest by date)](https://img.shields.io/github/v/release/artem-barmin/obsidian-block-drag-n-drop)

# Demo

![Demo](https://raw.githubusercontent.com/artem-barmin/obsidian-block-drag-n-drop/master/demo/demo.gif)

# Features

-   ✅ Drag-n-drop for list items in the same pane and between different panes
-   ✅ 3 modes:
    -   embed block - default for moving between different panes
    -   move block - default for moving in the same pane
    -   copy block - Shift + drag
-   ✅ Ability to reorder items keeping their nested level(like Notion)
    -   Drop to the **right** of intendation dot • to nest dragged item under the previous item
    -   Drop to the **left** of intendation dot • to keep intendation level and just reorder items
-   ✅ Automatic reference link generation for dragged block
-   ✅ Live editor support

# No planned

-   [ ] Support for arbitrary block dragging - paragraphs, headings etc

Feel free to create feature requests HERE: https://github.com/artem-barmin/obsidian-block-drag-n-drop/issues

# How to use

You can see a drag-n-drop handler in the gutter. You can drag it and drop at line you want.

For now you can drag only list items, so handler will appear only near lines that belongs to list

## Defaults

-   Drag and drop from one pane to another without modifiers will create embed link for the block. Id for block will be automatically created.
-   Drag and drop in the same pane without modifiers will move the block.
-   Drag and drop with "Shift" modifier will copy the block.

You can change behavior for settings in the plugin settings tab.

# How to install

## From within Obsidian

You can activate this plugin within Obsidian by doing the following:

-   Open Settings > Third-party plugin
-   Make sure Safe mode is off
-   Click Browse community plugins
-   Search for "Drag-n-Drop"
-   Click Install
-   Once installed, close the community plugins window and activate the newly installed plugin

## Manual installation

Download main.js, manifest.json, styles.css from the latest release and put them into <vault>/.obsidian/plugins/obsidian-outliner folder.

# Limitations

Plugin was developed and tested only with Live preview editor. Legacy editor not supported

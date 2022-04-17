// @ts-nocheck
import { Plugin, MarkdownView, PluginSettingTab, Setting } from "obsidian";
import { gutter, GutterMarker } from "@codemirror/gutter";
import { EditorView } from "@codemirror/view";
import _ from "lodash";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";

function findListItem(text, line, itemType, cache) {
	const ast = unified().use(remarkParse).parse(text);
	const allItems = [];
	visit(ast, itemType, (node, index, parent) => {
		const start = node.position.start.line;
		const end = node.position.end.line;
		if (start <= line && end >= line)
			allItems.push({
				node,
				parent,
				index,
				height: end - start,
			});
	});
	return _.minBy(allItems, "height");
}

function generateId(): string {
	return Math.random().toString(36).substr(2, 6);
}

function copyItemLinesToDragContainer(app, line, drag) {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view || !view.editor) return;
	const targetEditor = view.editor.cm;
	const lineHandle = targetEditor.state.doc.line(line);
	const lineDom = targetEditor.domAtPos(lineHandle.from).node;
	const lines = getAllLinesForCurrentItem(app, lineDom, targetEditor);

	const container = document.createElement("div");
	container.className =
		"markdown-source-view mod-cm6 cm-content dnd-drag-container";
	const cmContent = document.querySelector(
		".cm-contentContainer .cm-content"
	);
	if (cmContent)
		container.setAttribute("style", cmContent.getAttribute("style"));
	lines.forEach(({ line }) => container.appendChild(line.cloneNode(true)));
	drag.appendChild(container);
	document.body.classList.add("dnd-render-draggable-content");
	setTimeout(() => {
		container.classList.add("dnd-drag-container-inactive");
		document.body.classList.remove("dnd-render-draggable-content");
	}, 0);
}

const dragHandle = (line, app) =>
	new (class extends GutterMarker {
		toDOM(editor) {
			const fileCache = findFile(app, editor);
			const block = (fileCache?.sections || []).find((s) =>
				findSection(s, line - 1)
			);
			const drag = document.createElement("div");
			if (!block || block.type !== "list") return drag;
			drag.appendChild(document.createTextNode(":::"));
			drag.className = "dnd-gutter-marker";
			drag.setAttribute("draggable", true);
			drag.addEventListener("dragstart", (e) => {
				e.dataTransfer.setData("line", line);
				copyItemLinesToDragContainer(app, line, drag);
			});
			return drag;
		}
	})();

const dragLineMarker = (app) =>
	gutter({
		lineMarker(view, line) {
			return line.from == line.to
				? null
				: dragHandle(view.state.doc.lineAt(line.from).number, app);
		},
	});

function shouldInsertAfter(block) {
	if (block.type) {
		return [
			"blockquote",
			"code",
			"table",
			"comment",
			"footnoteDefinition",
		].includes(block.type);
	}
}

function getAllChildrensOfBlock(parents, allItems) {
	if (!parents.length) return [];

	// Deconstruct hierarchy according to
	// https://github.com/obsidianmd/obsidian-api/blob/036708710c4a4b652d8166c5929d5ba1ffb7fb91/obsidian.d.ts#L1581
	// parentItem.position.start.line === childItem.parent
	const idx = new Set(_.map(parents, (parent) => parent.position.start.line));
	const childrens = _.filter(allItems, ({ parent }) => idx.has(parent));

	const nestedChildrens = getAllChildrensOfBlock(childrens, allItems);

	return [...parents, ...childrens, ...nestedChildrens];
}

function findSection(section, line) {
	return (
		section.position.start.line <= line && section.position.end.line >= line
	);
}

function getBlock(app, line, fileCache) {
	const block = (fileCache?.listItems || []).find((s) =>
		findSection(s, line)
	);
	if (!block) return;
	const allChildren = _.uniq(
		getAllChildrensOfBlock([block], fileCache.listItems)
	);

	// generate and write block id
	const id = generateId();
	const spacer = shouldInsertAfter(block) ? "\n\n" : " ";
	const changes = {
		from: block.position.end.offset,
		insert: spacer + "^" + id,
	};
	const fromLine = _.minBy(allChildren, "position.start.line").position.start;
	const toLine = _.maxBy(allChildren, "position.end.line").position.end;

	return {
		...block,
		fromLine,
		toLine,
		id: block.id || id,
		children: allChildren,
		changes: block.id ? [] : [changes],
	};
}

function defineOperationType(event, settings, isSameEditor) {
	const modifier = event.shiftKey ? "shift" : event.altKey ? "alt" : "simple";

	if (modifier === "simple") {
		if (isSameEditor) return settings["simple_same_pane"];
		else return settings["simple_different_panes"];
	} else return settings[modifier];
}

function processDrop(app, event, settings) {
	const sourceLineNum = parseInt(event.dataTransfer.getData("line"), 10);
	const targetLinePos = event.target.cmView.posAtStart;

	const view = app.workspace.getActiveViewOfType(MarkdownView);

	if (!view || !view.editor) return;

	const sourceEditor = view.editor;
	const targetEditor = event.target.cmView.editorView;

	const targetLine = targetEditor.state.doc.lineAt(targetLinePos);

	const isSameEditor = sourceEditor.cm == targetEditor;

	const type = defineOperationType(event, settings, isSameEditor);

	if (type === "none") return;

	const text = sourceEditor.getValue();
	const item = findListItem(text, sourceLineNum, "listItem");
	if (item) {
		const from = item.node.position.start.offset;
		const to = item.node.position.end.offset;
		let operations;

		const targetItem = findListItem(
			targetEditor.state.toJSON().doc,
			targetLine.number,
			"paragraph"
		);

		// if line was not moved or moved inside it's enclosing block - do nothing
		if (isSameEditor) {
			const pos = item.node.position;
			if (
				targetLine.number >= pos.start.line &&
				targetLine.number <= pos.end.line
			) {
				console.log("Moved inside same block - do nothing");
				return;
			}
		}

		const targetItemLastLine =
			targetItem.node.position.end.offset || targetLine.to;

		if (type === "move" || type === "copy") {
			const sourceLine = sourceEditor.cm.state.doc.lineAt(from);

			const textToInsert = "\n" + text.slice(sourceLine.from, to);

			// adjust indent for each line of the source block
			const computeIndent = (line) => line.text.match(/^\t*/)[0].length;

			const sourceIndent = computeIndent(sourceLine);
			const targetIndent = computeIndent(targetLine);

			const addTabsNum = Math.max(targetIndent - sourceIndent + 1, 0);
			const removeTabsNum = Math.max(sourceIndent - targetIndent - 1, 0);

			const removeTabsRegex = new RegExp(
				"\n" + "\t".repeat(removeTabsNum),
				"g"
			);
			const addTabsRegex = "\n" + "\t".repeat(addTabsNum);

			const indentedText = textToInsert.replace(
				removeTabsRegex,
				addTabsRegex
			);

			// build operations for applying with editor
			const deleteOp = { from: Math.max(sourceLine.from - 1, 0), to };
			const insertOp = { from: targetItemLastLine, insert: indentedText };

			operations = {
				source: type === "move" ? [deleteOp] : [],
				target: [insertOp],
			};
		} else if (type === "embed") {
			const { id, changes } = getBlock(app, sourceLineNum - 1, view.file);
			const insertBlockOp = {
				from: targetItemLastLine,
				insert: ` ![[${view.file.basename}#^${id}]]`,
			};

			operations = { source: [changes], target: [insertBlockOp] };
		}

		console.log("Move item", type, operations);
		const { source, target } = operations;
		if (sourceEditor.cm == targetEditor)
			sourceEditor.cm.dispatch({ changes: [...source, ...target] });
		else {
			sourceEditor.cm.dispatch({ changes: source });
			targetEditor.dispatch({ changes: target });
		}
	}
}

function findFile(app, targetEditor) {
	const leafs = app.workspace.getLeavesOfType("markdown");
	const targetLeaf = _.find(
		leafs,
		(leaf) => leaf?.view?.editor?.cm === targetEditor
	);
	if (targetLeaf) return app.metadataCache.getFileCache(targetLeaf.view.file);
}

function getAllLinesForCurrentItem(app, lineDom, targetEditor) {
	const doc = targetEditor.state.doc;
	const posAtLine = targetEditor.posAtDOM(lineDom);
	const targetLine = doc.lineAt(posAtLine);

	const targetFile = findFile(app, targetEditor);
	const block = getBlock(app, targetLine.number - 1, targetFile);
	if (!block) return;

	const targetItemLastLine = block.position.end.line + 1;

	return _.range(block.fromLine.line + 1, block.toLine.line + 1 + 1)
		.map((lineNum) => ({
			line: targetEditor.domAtPos(doc.line(lineNum).from).node,
			isTargetLine: lineNum === targetItemLastLine,
		}))
		.filter(({ line }) => !!line);
}

function highlightWholeItem(app, target) {
	removeAllClasses("drag-over");
	removeAllClasses("drag-last");

	const allLines = getAllLinesForCurrentItem(
		app,
		target.closest(".cm-line"),
		target.cmView.editorView
	);

	_.forEach(allLines, ({ line, isTargetLine }) => {
		line.classList.add("drag-over");
		if (isTargetLine) line.classList.add("drag-last");
	});
}

const highlightWholeItemThrottled = _.throttle(highlightWholeItem, 10);

const DEFAULT_SETTINGS = {
	simple_same_pane: "move",
	simple_different_panes: "embed",
	shift: "copy",
	alt: "none",
};

function removeAllClasses(className) {
	const allLines = document.querySelectorAll(`.${className}`);
	_.forEach(allLines, (line) => line.classList.remove(className));
}

export default class DragNDropPlugin extends Plugin {
	async onload() {
		const app = this.app;
		const settings = await this.loadSettings();
		this.addSettingTab(new DragNDropSettings(this.app, this));
		this.registerEditorExtension(dragLineMarker(app));
		this.registerEditorExtension(
			EditorView.domEventHandlers({
				dragover(event, view) {
					highlightWholeItemThrottled(app, event.target);
					event.preventDefault();
				},
				dragleave(event, view) {
					removeAllClasses("drag-over");
					removeAllClasses("drag-last");
				},
				drop(event, viewDrop) {
					highlightWholeItemThrottled.cancel();
					processDrop(app, event, settings);
					removeAllClasses("drag-over");
					removeAllClasses("drag-last");
				},
			})
		);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
		return this.settings;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class DragNDropSettings extends PluginSettingTab {
	plugin: DragNDropPlugin;

	constructor(app: App, plugin: DragNDropPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", {
			text: "Modifiers",
		});

		const addDropdownVariants = (settingName) => (dropDown) => {
			dropDown.addOption("none", "Do nothing");
			dropDown.addOption("embed", "Embed link");
			dropDown.addOption("copy", "Copy block");
			dropDown.addOption("move", "Move block");
			dropDown.setValue(this.plugin.settings[settingName]);
			dropDown.onChange(async (value) => {
				this.plugin.settings[settingName] = value;
				await this.plugin.saveSettings();
			});
		};

		new Setting(containerEl)
			.setName("Drag'n'drop without modifiers in the same pane")
			.addDropdown(addDropdownVariants("simple_same_pane"));

		new Setting(containerEl)
			.setName("Drag'n'drop without modifiers in the different panes")
			.addDropdown(addDropdownVariants("simple_different_panes"));

		new Setting(containerEl)
			.setName("Drag'n'drop with Shift")
			.addDropdown(addDropdownVariants("shift"));

		new Setting(containerEl)
			.setName("Drag'n'drop with Alt/Meta")
			.addDropdown(addDropdownVariants("alt"));
	}
}
